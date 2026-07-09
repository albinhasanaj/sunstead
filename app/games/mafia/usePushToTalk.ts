"use client";

import { useCallback, useRef, useState } from "react";

type Status = "idle" | "recording" | "transcribing";

// Mic capture → /api/stt → transcript. Click `toggle` to start recording, click
// again to stop + transcribe; the resulting text is handed back so the UI can fill
// the turn input. (start/stop stay exposed for any hold-to-talk callers.)
// `onError` surfaces a user-visible message when transcription actually fails, so a
// dropped clip doesn't look like the game silently ignored you (Bug #14).
export function usePushToTalk(
  onTranscript: (text: string) => void,
  onError?: (message: string) => void,
) {
  const [status, setStatus] = useState<Status>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    if (status !== "idle") return;
    let stream: MediaStream | null = null;
    try {
      // Echo cancellation + noise suppression so the game's own TTS playing through the
      // speakers doesn't bleed into the mic and corrupt the transcript (Bug #13).
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      rec.ondataavailable = (e) =>
        e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        if (blob.size < 1200) {
          setStatus("idle"); // too short to be speech — not an error, just ignore
          return;
        }
        setStatus("transcribing");
        try {
          const res = await fetch("/api/stt", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          if (!res.ok) throw new Error(`STT ${res.status}`);
          const data = await res.json().catch(() => ({ text: "" }));
          if (data.text) onTranscript(data.text);
          else onError?.("Couldn't make out any speech — try again.");
        } catch {
          onError?.(
            "Transcription failed — check your connection and try again.",
          );
        }
        setStatus("idle");
      };
      rec.start();
      recorderRef.current = rec;
      setStatus("recording");
    } catch (err) {
      // getUserMedia was denied OR MediaRecorder failed to init. If we already opened
      // the mic, stop its tracks so it can't stay live in the background (Bug #11).
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("idle");
      const name = (err as Error)?.name;
      if (name && name !== "NotAllowedError" && name !== "AbortError")
        onError?.("Microphone unavailable.");
    }
  }, [status, onTranscript, onError]);

  // Click-to-toggle: begin a fresh recording, or stop (and transcribe) the current
  // one. Ignored while a previous clip is still transcribing.
  const toggle = useCallback(() => {
    if (status === "recording") stop();
    else if (status === "idle") void start();
  }, [status, start, stop]);

  return { status, start, stop, toggle };
}
