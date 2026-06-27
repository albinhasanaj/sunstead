"use client";

import { useEffect, useRef } from "react";

/**
 * Plays a muted, looping clip but only fetches and decodes it while it is on
 * (or near) the screen. Keeps the heavy mp4s off the initial load and pauses
 * playback once scrolled away so two clips never decode at once needlessly.
 */
export function LazyVideo({
  src,
  title,
  poster,
}: {
  src: string;
  title: string;
  poster?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Attach the source lazily the first time it enters view.
          if (!video.src) video.src = src;
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { rootMargin: "200px" },
    );

    io.observe(video);
    return () => io.disconnect();
  }, [src]);

  return (
    <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-stage-raised">
      <video
        ref={ref}
        title={title}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
