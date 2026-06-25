"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const OUTPUT_SIZE = 256;

export function CameraCapture({ onCapture }: { onCapture: (dataUrl: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch {
      setError("Couldn't access the camera. Allow permission, or pick a preset avatar instead.");
    } finally {
      setStarting(false);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    // Mirror horizontally so the captured selfie matches the preview.
    ctx.translate(OUTPUT_SIZE, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    onCapture(canvas.toDataURL("image/jpeg", 0.82));
    stop();
  };

  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl border border-[var(--hairline)] bg-stage">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full -scale-x-100 object-cover ${active ? "" : "hidden"}`}
        />
        {!active && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--hairline)] text-xl text-muted">
              ⃝
            </span>
            <p className="text-sm text-muted">
              {error ?? "Use your camera to take a profile photo."}
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-center gap-3">
        {active ? (
          <>
            <button
              type="button"
              onClick={capture}
              className="cursor-pointer rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-stage transition hover:brightness-90"
            >
              Capture
            </button>
            <button
              type="button"
              onClick={stop}
              className="cursor-pointer rounded-full border border-[var(--hairline)] px-6 py-2.5 text-sm text-muted transition hover:border-white/30 hover:text-foreground"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="cursor-pointer rounded-full border border-[var(--hairline)] px-6 py-2.5 text-sm text-foreground transition hover:border-white/30 disabled:cursor-default disabled:opacity-50"
          >
            {starting ? "Starting…" : error ? "Try again" : "Start camera"}
          </button>
        )}
      </div>
    </div>
  );
}
