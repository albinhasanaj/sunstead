'use client';

import { useCallback, useMemo, useRef } from 'react';

// Plays spoken lines as audio, one at a time and in order, so voices never
// overlap. TTS is fetched on demand from /api/tts. Lives entirely on the client;
// the game stream is untouched.
export function useVoiceQueue() {
  const queue = useRef<{ agent: string; text: string }[]>([]);
  const playing = useRef(false);
  const enabled = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const pump = useCallback(async () => {
    if (playing.current) return;
    const item = queue.current.shift();
    if (!item) return;
    playing.current = true;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (enabled.current && res.ok && res.headers.get('content-type')?.includes('audio')) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
      }
    } catch {
      /* skip this line silently */
    }
    playing.current = false;
    if (queue.current.length) void pump();
  }, []);

  const enqueue = useCallback(
    (agent: string, text: string) => {
      if (!enabled.current) return;
      queue.current.push({ agent, text });
      void pump();
    },
    [pump],
  );

  const setEnabled = useCallback((on: boolean) => {
    enabled.current = on;
    if (!on) {
      queue.current = [];
      audioRef.current?.pause();
    }
  }, []);

  const reset = useCallback(() => {
    queue.current = [];
    audioRef.current?.pause();
    playing.current = false;
  }, []);

  // Stable object so consumers' useCallback deps don't churn every render.
  return useMemo(() => ({ enqueue, setEnabled, reset }), [enqueue, setEnabled, reset]);
}
