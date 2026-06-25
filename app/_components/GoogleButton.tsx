"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "./AuthProvider";

function GoogleGlyph() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({
  label = "Log in with Google",
  compact = false,
  variant = "violet",
  className = "",
}: {
  label?: string;
  compact?: boolean;
  variant?: "violet" | "plain";
  className?: string;
}) {
  const { signInWithGoogle, hasProfile, signedIn } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleClick = () => {
    setBusy(true);
    if (!signedIn) signInWithGoogle();
    // Simulate the Google round-trip, then route by whether a profile exists.
    setTimeout(() => {
      router.push(hasProfile ? "/explore" : "/onboarding");
    }, 650);
  };

  const plain = variant === "plain";
  const pad = compact
    ? "px-4 py-2 text-xs gap-2"
    : plain
      ? "px-6 py-2.5 text-sm gap-2"
      : "px-8 py-4 text-base gap-3";
  const glyph = compact ? "h-5 w-5" : "h-6 w-6";

  const tone = plain
    ? "bg-white text-black hover:bg-neutral-200"
    : "text-white shadow-[0_0_40px_-8px_var(--collision)] hover:brightness-110";

  const text = busy
    ? "Signing in…"
    : plain
      ? label
      : signedIn && hasProfile
        ? "Enter the arena"
        : label;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      style={plain ? undefined : { backgroundColor: "var(--collision)" }}
      className={`group inline-flex cursor-pointer items-center justify-center rounded-full font-semibold transition disabled:cursor-wait disabled:opacity-80 ${tone} ${pad} ${className}`}
    >
      {!plain && (
        <span className={`flex items-center justify-center rounded-full bg-white/95 ${glyph}`}>
          {busy ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-[#1f1f1f]" />
          ) : (
            <GoogleGlyph />
          )}
        </span>
      )}
      {plain && busy && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-black" />
      )}
      {text}
    </button>
  );
}
