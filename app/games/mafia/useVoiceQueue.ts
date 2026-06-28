'use client';

import { useCallback, useMemo, useRef } from 'react';

export type VoiceItem = { id: string; name: string; text: string };

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
  // A MediaElementSource can be created ONCE per element, so we cache it per <audio>.
  const sourceFor = useRef<WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>>(new WeakMap());

  // Lazily build the shared AudioContext + AnalyserNode (returns null if unavailable).
  const getCtx = useCallback((): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6; // snappier → the glow tracks syllables, not a smear
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      return ctx;
    } catch {
      return null;
    }
  }, []);

  // Call from a user gesture (e.g. the Play button) so the context is 'running' before
  // any line plays. Without this, browsers start it suspended and routing audio through
  // it would mute playback — so we only hijack the element's output once it's running.
  const prime = useCallback(() => {
    const ctx = getCtx();
    if (ctx && ctx.state !== 'running') void ctx.resume();
  }, [getCtx]);

  const ensureGraph = useCallback(
    (audio: HTMLAudioElement) => {
      try {
        const ctx = getCtx();
        const analyser = analyserRef.current;
        if (!ctx || !analyser) return;
        // While suspended, DON'T route the element through the graph — that would mute
        // it. Let it play normally (no analysis this line) and nudge the context awake.
        if (ctx.state !== 'running') {
          void ctx.resume();
          return;
        }
        let src = sourceFor.current.get(audio);
        if (!src) {
          src = ctx.createMediaElementSource(audio);
          src.connect(analyser); // analyser already feeds destination, so we still hear it
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
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: item.name, text: item.text }),
      });
      if (enabled.current && res.ok && res.headers.get('content-type')?.includes('audio')) {
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
    if (elapsed < MIN_HOLD_MS) await new Promise((r) => setTimeout(r, MIN_HOLD_MS - elapsed));
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
        if (queue.current.length) listeners.current.onFlush?.(queue.current.slice()); // don't lose un-voiced lines from the transcript
        queue.current = [];
        audioRef.current?.pause();
        finishRef.current?.(); // unblock any in-flight line so the pump can drain
        setIdle(true);
      }
    },
    [setIdle],
  );

  const reset = useCallback(() => {
    if (queue.current.length) listeners.current.onFlush?.(queue.current.slice()); // keep un-voiced lines in the transcript
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

  // Stable object so consumers' useCallback deps don't churn every render.
  return useMemo(() => ({ enqueue, setEnabled, reset, bind, getLevel, prime }), [enqueue, setEnabled, reset, bind, getLevel, prime]);
}
