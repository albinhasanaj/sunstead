"use client";

import { useState } from "react";
import type { Profile } from "./AuthProvider";
import { Avatar } from "./Avatar";
import { CameraCapture } from "./CameraCapture";

const COLORS = [
  "#FF6B4A",
  "#FFB347",
  "#3FE0FF",
  "#5B8CFF",
  "#B14CFF",
  "#F4F5F7",
  "#34C759",
  "#FF375F",
];

const EMOJIS = ["🦊", "🐺", "🎭", "🕵️", "👑", "🃏", "🎲", "🔮", "⚔️", "🧠", "👁️", "🌙"];

const inputCls =
  "mt-2 w-full rounded-xl border border-[var(--hairline)] bg-stage px-4 py-3 text-foreground outline-none transition placeholder:text-muted/70 focus:border-collision focus:ring-1 focus:ring-collision";

export function ProfileForm({
  initial,
  defaultName = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Profile | null;
  defaultName?: string;
  submitLabel: string;
  onSubmit: (profile: Profile) => void;
  onCancel?: () => void;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? defaultName);
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [emoji, setEmoji] = useState(initial?.emoji ?? EMOJIS[0]);
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [photo, setPhoto] = useState<string | null>(initial?.photo ?? null);
  const [mode, setMode] = useState<"camera" | "preset">(initial?.photo ? "camera" : "preset");

  const trimmed = displayName.trim();
  const valid = trimmed.length >= 2;
  const activePhoto = mode === "camera" ? photo : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      displayName: trimmed,
      color,
      emoji,
      photo: activePhoto,
      tagline: tagline.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-7">
      <div className="flex items-center gap-4">
        <Avatar
          profile={{ displayName: trimmed || "?", color, emoji, photo: activePhoto }}
          size="lg"
        />
        <div>
          <p className="font-display text-2xl font-medium">{trimmed || "Your name"}</p>
          <p className="text-sm text-muted">{tagline || "This is your seat at the table."}</p>
        </div>
      </div>

      <label className="block">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          Display name
        </span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={24}
          placeholder="What should we call you?"
          className={inputCls}
        />
      </label>

      <div>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          Profile picture
        </span>

        <div className="mt-3 inline-flex rounded-full border border-[var(--hairline)] p-1">
          {(
            [
              ["camera", "Take a photo"],
              ["preset", "Pick an avatar"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                mode === value ? "bg-foreground text-stage" : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "camera" ? (
          <div className="mt-4">
            {photo ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo}
                  alt="Captured profile"
                  className="h-40 w-40 rounded-2xl border border-[var(--hairline)] object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="rounded-full border border-[var(--hairline)] px-5 py-2 text-sm text-muted transition hover:border-white/30 hover:text-foreground"
                >
                  Retake photo
                </button>
              </div>
            ) : (
              <CameraCapture onCapture={setPhoto} />
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Orb color
              </span>
              <div className="mt-2 flex flex-wrap gap-2.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`color ${c}`}
                    className={`h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-stage transition ${
                      color === c ? "ring-foreground" : "ring-transparent hover:ring-white/30"
                    }`}
                    style={{ backgroundColor: c, boxShadow: `0 0 18px -4px ${c}` }}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Face
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setEmoji(em)}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border text-lg transition ${
                      emoji === em
                        ? "border-foreground bg-white/10"
                        : "border-[var(--hairline)] bg-stage hover:border-white/30"
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <label className="block">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          Tagline <span className="text-muted/60">(optional)</span>
        </span>
        <input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={60}
          placeholder="Trust no one."
          className={inputCls}
        />
      </label>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={!valid}
          style={{ backgroundColor: "var(--collision)" }}
          className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white shadow-[0_0_30px_-8px_var(--collision)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-[var(--hairline)] px-6 py-3 text-sm text-muted transition hover:border-white/30 hover:text-foreground"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
