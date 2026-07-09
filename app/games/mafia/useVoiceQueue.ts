"use client";

import { useCallback, useMemo, useRef } from "react";

// A line to voice. emotion/intensity drive ElevenLabs delivery (sent to /api/tts);
// lookingAt rides along so the scene can aim the speaker's gaze when this line plays.
// hero = a rare decisive line the client gated for the richer v3 model (Stage 5).
export type VoiceItem = {
  id: string;
  name: string;
  text: string;
  emotion?: string;
  intensity?: number;
  lookingAt?: string;
  hero?: boolean;
};

// Drives the spoken lines as audio, one at a time and in order, so voices never
// overlap. TTS is fetched on demand from /api/tts. Critically, it also reports its
// playback lifecycle (onStart / onEnd / onIdle) so the UI can pace the on-screen
// speaker + captions to the ACTUAL audio instead of racing ahead of it — the whole
// point of a voice-first table. Lives entirely on the client.
export type VoiceListeners = {
  onStart?: (item: VoiceItem) => void; // a line just began (caption + speaking head + reveal in transcript)
  onEnd?: (item: VoiceItem) => void; // that line finished playing
  onIdle?: (idle: boolean) => void; // true when nothing is queued/playing
  onFlush?: (items: VoiceItem[]) => void; // queued-but-unvoiced lines being dropped (mute/reset) — so the transcript can still keep them
};

// A silent or failed line still holds the floor briefly so the table never
// flickers through people faster than you can follow.
const MIN_HOLD_MS = 900;

// A cheap procedural reverb impulse: exponentially-decaying stereo noise. Gives the
// table a small-room tail so distant voices read as "across the room", not studio-dry.
function makeImpulse(
  ctx: AudioContext,
  seconds: number,
  decay: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export function useVoiceQueue() {
  const queue = useRef<VoiceItem[]>([]);
  const playing = useRef(false);
  const enabled = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listeners = useRef<VoiceListeners>({});
  const idle = useRef(true);
  // Resolves the in-flight audio promise so muting/resetting mid-line doesn't wedge
  // the queue (pausing alone never fires 'ended').
  const finishRef = useRef<(() => void) | null>(null);

  // ── live voice amplitude (drives the speaking seat's glow in the 3D scene) ──────
  // A single Web Audio graph: each line's <audio> is routed through one shared
  // AnalyserNode → destination, so getLevel() can sample the current loudness (0..1)
  // every animation frame. Created lazily on first playback (needs a user gesture).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  // Binaural panner: each line is positioned in 3D at the speaking seat, so a player
  // on your left is heard on your left. The scene drives the panner + listener poses
  // every frame (see TribunalScene); here we just build the nodes into the graph.
  const pannerRef = useRef<PannerNode | null>(null);
  // Distance "air": a lowpass the scene opens/closes by distance (far = duller), and a
  // reverb send the scene raises with distance (far = more room) — so a voice across
  // the table sounds across the room, not in a dry studio booth.
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const wetRef = useRef<GainNode | null>(null);
  // A MediaElementSource can be created ONCE per element, so we cache it per <audio>.
  const sourceFor = useRef<
    WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>
  >(new WeakMap());

  // Lazily build the shared graph:
  //   source → panner → lowpass → analyser → destination          (dry, positioned)
  //                           └→ convolver → wetGain → destination (room reverb send)
  const getCtx = useCallback((): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6; // snappier → the glow tracks syllables, not a smear
      // analyser is a measurement tap only (drives the glow); audio reaches the speakers
      // via the master bus built below, so it isn't connected onward to destination.

      // HRTF panner → true left/right binaural placement, with a real (inverse) distance
      // falloff so someone across the table is audibly farther than your neighbour.
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 4;
      panner.maxDistance = 40;
      panner.rolloffFactor = 1.1;

      // De-bass: a highpass to kill sub-100Hz rumble/boom, plus a low-shelf cut so male
      // voices aren't muddy. Static tone correction (not distance-modulated).
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 150; // roll off everything below the voice's body
      highpass.Q.value = 0.6;
      const lowshelf = ctx.createBiquadFilter();
      lowshelf.type = "lowshelf";
      lowshelf.frequency.value = 320; // shelve down the low-mids that read as "bassy"
      lowshelf.gain.value = -6; // dB

      // Distance lowpass (the scene modulates .frequency): full-band up close, muffled far.
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 18000;
      lowpass.Q.value = 0.7;

      // Gentle presence shelf so voices stay clear/forward under the distance lowpass
      // (a standard vocal trick — lift "intelligibility" without adding sibilant fizz).
      const presence = ctx.createBiquadFilter();
      presence.type = "highshelf";
      presence.frequency.value = 3500;
      presence.gain.value = 2.5; // dB

      // ── Early reflections: the first wall/table bounces. THIS is what makes a space
      // read as a real room, not a plate. A few short, panned, decorrelated taps —
      // kept subtle (and at irregular times) to avoid comb-filter hollowness.
      const erTaps: [number, number, number][] = [
        // [delay s, gain, pan -1..1] — kept light so the room is felt, not heard.
        [0.009, 0.1, -0.6],
        [0.015, 0.08, 0.5],
        [0.023, 0.055, -0.3],
        [0.031, 0.04, 0.7],
      ];

      // Diffuse tail: real reverb starts a few ms AFTER the direct sound (pre-delay),
      // and its highs decay faster than its body (damping) — warmer than the dry voice.
      const preDelay = ctx.createDelay(0.2);
      preDelay.delayTime.value = 0.022;
      const convolver = ctx.createConvolver();
      convolver.buffer = makeImpulse(ctx, 1.4, 2.4);
      const reverbDamp = ctx.createBiquadFilter();
      reverbDamp.type = "lowpass";
      reverbDamp.frequency.value = 6500; // dark, natural tail
      const wet = ctx.createGain();
      wet.gain.value = 0.05; // scene modulates by distance — kept low (subtle room, not a hall)

      // Master bus: a soft compressor (glues levels + catches peaks like a gentle
      // limiter so dry + reflections + tail never clip and TTS loudness evens out),
      // then a headroom gain.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      const master = ctx.createGain();
      master.gain.value = 0.95;

      // dry chain (positioned + de-bassed + distance-shaped) → master
      panner.connect(highpass);
      highpass.connect(lowshelf);
      lowshelf.connect(presence);
      presence.connect(lowpass);
      lowpass.connect(analyser); // measurement tap (glow)
      lowpass.connect(comp); // dry voice → master bus

      // early reflections off the distance-shaped signal
      for (const [dt, g, pan] of erTaps) {
        const d = ctx.createDelay(0.1);
        d.delayTime.value = dt;
        const gn = ctx.createGain();
        gn.gain.value = g;
        const pn = ctx.createStereoPanner();
        pn.pan.value = pan;
        lowpass.connect(d);
        d.connect(gn);
        gn.connect(pn);
        pn.connect(comp);
      }

      // pre-delayed, damped diffuse tail → master
      lowpass.connect(preDelay);
      preDelay.connect(convolver);
      convolver.connect(reverbDamp);
      reverbDamp.connect(wet);
      wet.connect(comp);

      comp.connect(master);
      master.connect(ctx.destination);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      pannerRef.current = panner;
      lowpassRef.current = lowpass;
      wetRef.current = wet;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      return ctx;
    } catch {
      return null;
    }
  }, []);

  // Hand the scene the live spatial nodes so it can pose the listener (camera) and the
  // panner (speaker's seat) and modulate distance air (lowpass + reverb) each frame.
  const getSpatial = useCallback((): {
    panner: PannerNode;
    listener: AudioListener;
    lowpass: BiquadFilterNode;
    wet: GainNode;
  } | null => {
    const ctx = audioCtxRef.current;
    const panner = pannerRef.current;
    const lowpass = lowpassRef.current;
    const wet = wetRef.current;
    if (!ctx || !panner || !lowpass || !wet) return null;
    return { panner, listener: ctx.listener, lowpass, wet };
  }, []);

  // Call from a user gesture (e.g. the Play button) so the context is 'running' before
  // any line plays. Without this, browsers start it suspended and routing audio through
  // it would mute playback — so we only hijack the element's output once it's running.
  const prime = useCallback(() => {
    const ctx = getCtx();
    if (ctx && ctx.state !== "running") void ctx.resume();
  }, [getCtx]);

  const ensureGraph = useCallback(
    (audio: HTMLAudioElement) => {
      try {
        const ctx = getCtx();
        const analyser = analyserRef.current;
        if (!ctx || !analyser) return;
        // While suspended, DON'T route the element through the graph — that would mute
        // it. Let it play normally (no analysis this line) and nudge the context awake.
        if (ctx.state !== "running") {
          void ctx.resume();
          return;
        }
        let src = sourceFor.current.get(audio);
        if (!src) {
          src = ctx.createMediaElementSource(audio);
          // → panner (3D placement) → analyser → destination, so we hear it positioned.
          src.connect(pannerRef.current ?? analyser);
          sourceFor.current.set(audio, src);
        }
      } catch {
        /* Web Audio unavailable / blocked — the glow just falls back to its idle pulse */
      }
    },
    [getCtx],
  );

  // Current voice loudness, 0..1, sampled live. Returns 0 when nothing is speaking.
  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const data = dataRef.current;
    if (!analyser || !data || !playing.current) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(1, rms * 3.2); // scale typical speech RMS up into a visible range
  }, []);

  const setIdle = useCallback((v: boolean) => {
    if (idle.current === v) return;
    idle.current = v;
    listeners.current.onIdle?.(v);
  }, []);

  const pump = useCallback(async () => {
    if (playing.current) return;
    const item = queue.current.shift();
    if (!item) {
      setIdle(true);
      return;
    }
    playing.current = true;
    setIdle(false);
    const startedAt = Date.now();
    listeners.current.onStart?.(item); // caption + speaking head follow THIS line
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // emotion/intensity → per-line voiceSettings (Stage 1). Absent → neutral default.
        // hero (gated by the caller) → the richer v3 model + an audio tag (Stage 5).
        body: JSON.stringify({
          agent: item.name,
          text: item.text,
          emotion: item.emotion,
          intensity: item.intensity,
          hero: item.hero,
        }),
      });
      if (
        enabled.current &&
        res.ok &&
        res.headers.get("content-type")?.includes("audio")
      ) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        ensureGraph(audio); // route through the analyser so getLevel() tracks this line
        await new Promise<void>((resolve) => {
          finishRef.current = resolve;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        finishRef.current = null;
        URL.revokeObjectURL(url);
      }
    } catch {
      /* skip this line silently */
    }
    // Hold the line on screen for a readable minimum even if its audio was short,
    // failed, or muted — so the presentation never out-runs comprehension.
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_HOLD_MS)
      await new Promise((r) => setTimeout(r, MIN_HOLD_MS - elapsed));
    listeners.current.onEnd?.(item);
    playing.current = false;
    if (queue.current.length) void pump();
    else setIdle(true);
  }, [setIdle, ensureGraph]);

  const enqueue = useCallback(
    (item: VoiceItem) => {
      if (!enabled.current) return;
      queue.current.push(item);
      setIdle(false);
      void pump();
    },
    [pump, setIdle],
  );

  const setEnabled = useCallback(
    (on: boolean) => {
      enabled.current = on;
      if (!on) {
        if (queue.current.length)
          listeners.current.onFlush?.(queue.current.slice()); // don't lose un-voiced lines from the transcript
        queue.current = [];
        audioRef.current?.pause();
        finishRef.current?.(); // unblock any in-flight line so the pump can drain
        setIdle(true);
      }
    },
    [setIdle],
  );

  const reset = useCallback(() => {
    if (queue.current.length)
      listeners.current.onFlush?.(queue.current.slice()); // keep un-voiced lines in the transcript
    queue.current = [];
    audioRef.current?.pause();
    finishRef.current?.();
    playing.current = false;
    setIdle(true);
  }, [setIdle]);

  // Register playback-lifecycle listeners (called once from the page).
  const bind = useCallback((l: VoiceListeners) => {
    listeners.current = l;
  }, []);

  // Fully tear down the Web Audio graph when the game screen unmounts, so leaving and
  // re-entering games doesn't accumulate live AudioContexts (Bug #15). reset() stops
  // playback; this also closes the context and drops the cached nodes/sources.
  const dispose = useCallback(() => {
    reset();
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    analyserRef.current = null;
    pannerRef.current = null;
    lowpassRef.current = null;
    wetRef.current = null;
    dataRef.current = null;
    sourceFor.current = new WeakMap();
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }, [reset]);

  // Stable object so consumers' useCallback deps don't churn every render.
  return useMemo(
    () => ({
      enqueue,
      setEnabled,
      reset,
      dispose,
      bind,
      getLevel,
      prime,
      getSpatial,
    }),
    [enqueue, setEnabled, reset, dispose, bind, getLevel, prime, getSpatial],
  );
}
