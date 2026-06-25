'use client';

import { useCallback, useRef, useState } from 'react';

type Status = 'idle' | 'recording' | 'transcribing';

// Push-to-talk mic capture → /api/stt → transcript. Hold to record, release to
// transcribe; the resulting text is handed back so the UI can fill the turn input.
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

  return { status, start, stop };
}
