"use client";

import { PlayerFace } from "../TribunalScene";
import AutoScrollText, { type CaptionSize } from "./AutoScrollText";

// Fading lower-third caption: who's speaking, with their face + line. Click it
// (while visible) to open the full transcript.
export default function SpeakerCaption({
  captionWho,
  captionText,
  captionVisible,
  lifted,
  size = "md",
  nameOf,
  onOpen,
}: {
  captionWho: string | null;
  captionText?: string;
  captionVisible: boolean;
  lifted: boolean; // raise above the voice dock when the play HUD is mounted
  size?: CaptionSize;
  nameOf: (id: string) => string;
  onOpen: () => void;
}) {
  const nameClass =
    size === "sm"
      ? "text-[10px]"
      : size === "lg"
        ? "text-[13px]"
        : "text-[11px]";
  const faceSize = size === "sm" ? 40 : size === "lg" ? 54 : 46;
  const widthClass =
    size === "lg"
      ? "w-[min(820px,calc(100%-2rem))]"
      : "w-[min(680px,calc(100%-2rem))]";
  return (
    <div
      className={`absolute left-1/2 z-20 -translate-x-1/2 transition-all duration-500 ${widthClass} ${
        lifted ? "bottom-40" : "bottom-4"
      } ${captionVisible && captionWho ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      {captionWho && (
        <button
          type="button"
          onClick={onOpen}
          title="Open the full transcript"
          className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-t from-black/85 via-black/60 to-black/25 px-4 py-3 text-left shadow-lg shadow-black/50 backdrop-blur-md transition hover:border-white/25 hover:from-black/90"
        >
          <PlayerFace name={nameOf(captionWho)} size={faceSize} />
          <div className="min-w-0 flex-1">
            <div
              className={`font-semibold uppercase tracking-[0.18em] text-amber-200/90 ${nameClass}`}
            >
              {nameOf(captionWho)}
            </div>
            <AutoScrollText text={captionText} size={size} />
          </div>
        </button>
      )}
    </div>
  );
}
