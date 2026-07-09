"use client";

import { useEffect, useRef } from "react";

// Caption text that auto-scrolls through itself when a line is too long to fit the
// fixed-height bar — pauses at the top, eases down to reveal the rest, then settles.
export type CaptionSize = "sm" | "md" | "lg";
const BODY_CLASS: Record<CaptionSize, string> = {
  sm: "max-h-[4rem] text-[13px]",
  md: "max-h-[4.5rem] text-sm",
  lg: "max-h-[5.5rem] text-base",
};
export default function AutoScrollText({
  text,
  size = "md",
}: {
  text?: string;
  size?: CaptionSize;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= 2) return;
    let raf = 0;
    let stopped = false;
    let startTs: number | null = null;
    const START_DELAY = 800; // dwell at the top so the start is readable
    const SPEED = 0.024; // px per ms
    const duration = overflow / SPEED;
    const step = (ts: number) => {
      if (stopped) return;
      if (startTs == null) startTs = ts;
      const elapsed = ts - startTs;
      const p = Math.max(0, Math.min(1, (elapsed - START_DELAY) / duration));
      el.scrollTop = overflow * p;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [text]);
  return (
    <div
      ref={ref}
      className={`overflow-hidden leading-snug text-neutral-100 ${BODY_CLASS[size]}`}
    >
      {text}
    </div>
  );
}
