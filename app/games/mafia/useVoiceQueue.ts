'use client';

import { useCallback, useMemo, useRef } from 'react';

export type VoiceItem = { id: string; name: string; text: string };

// Drives the spoken lines as audio, one at a time and in order, so voices never
// overlap. TTS is fetched on demand from /api/tts. Critically, it also reports its
// playback lifecycle (onStart / onEnd / onIdle) so the UI can pace the on-screen
// speaker + captions to the ACTUAL audio instead of racing ahead of it — the whole
// point of a voice-first table. Lives entirely on the client.
export type VoiceListeners = {
  onStart?: (item: VoiceItem) => void; // a line just began (caption + speaking head)
  onEnd?: (item: VoiceItem) => void; // that line finished playing
  onIdle?: (idle: boolean) => void; // true when nothing is queued/playing
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
  }, [setIdle]);

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
        queue.current = [];
        audioRef.current?.pause();
        finishRef.current?.(); // unblock any in-flight line so the pump can drain
        setIdle(true);
      }
    },
    [setIdle],
  );

  const reset = useCallback(() => {
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
  return useMemo(() => ({ enqueue, setEnabled, reset, bind }), [enqueue, setEnabled, reset, bind]);
}
