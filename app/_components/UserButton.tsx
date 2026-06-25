"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Avatar } from "./Avatar";

export function UserButton() {
  const { profile, user, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!profile) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-stage-raised py-1 pl-1 pr-3 transition hover:border-white/30"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar profile={profile} size="md" />
        <span className="hidden max-w-[8rem] truncate text-sm font-medium text-foreground sm:block">
          {profile.displayName}
        </span>
        <svg
          className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
        >
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-[var(--hairline)] bg-stage-raised shadow-2xl shadow-black/60"
        >
          <div className="flex items-center gap-3 border-b border-[var(--hairline)] px-4 py-3">
            <Avatar profile={profile} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{profile.displayName}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>
          </div>
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-sm text-muted transition hover:bg-white/5 hover:text-foreground"
          >
            <span className="text-muted">◉</span> View profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut();
              router.replace("/");
            }}
            className="flex w-full items-center gap-2.5 border-t border-[var(--hairline)] px-4 py-3 text-left text-sm text-muted transition hover:bg-white/5 hover:text-foreground"
          >
            <span className="text-muted">⇥</span> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
