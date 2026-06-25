'use client';

import { useCallback, useRef, useState } from 'react';

type Status = 'idle' | 'recording' | 'transcribing';

// Mic capture → /api/stt → transcript. Click `toggle` to start recording, click
// again to stop + transcribe; the resulting text is handed back so the UI can fill
// the turn input. (start/stop stay exposed for any hold-to-talk callers.)
export function usePushToTalk(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<Status>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    if (status !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1200) {
          setStatus('idle');
          return;
        }
        setStatus('transcribing');
        try {
          const res = await fetch('/api/stt', {
            method: 'POST',
            headers: { 'Content-Type': blob.type },
            body: blob,
          });
          const data = await res.json().catch(() => ({ text: '' }));
          if (data.text) onTranscript(data.text);
        } catch {
          /* ignore */
        }
        setStatus('idle');
      };
      rec.start();
      recorderRef.current = rec;
      setStatus('recording');
    } catch {
      // mic blocked / unavailable
      setStatus('idle');
    }
  }, [status, onTranscript]);

  // Click-to-toggle: begin a fresh recording, or stop (and transcribe) the current
  // one. Ignored while a previous clip is still transcribing.
  const toggle = useCallback(() => {
    if (status === 'recording') stop();
    else if (status === 'idle') void start();
  }, [status, start, stop]);

  return { status, start, stop, toggle };
}
