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
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex rounded-full outline-none transition-transform duration-200 hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-stage"
      >
        <Avatar profile={profile} size="sm" className={open ? "ring-white/50" : ""} />
      </button>

      {open && (
        <div
          role="menu"
          style={{ animation: "ub-in 0.14s cubic-bezier(0.16,1,0.3,1)" }}
          className="absolute right-0 z-50 mt-2.5 w-64 origin-top-right overflow-hidden rounded-2xl border border-[var(--hairline)] bg-stage-raised/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <style>{`@keyframes ub-in{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:none}}`}</style>

          <div className="flex items-center gap-3 px-4 py-3.5">
            <Avatar profile={profile} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{profile.displayName}</p>
              {user?.email && <p className="truncate text-xs text-muted">{user.email}</p>}
            </div>
          </div>

          <div className="h-px bg-[var(--hairline)]" />

          <div className="p-1.5">
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <UserIcon />
              View profile
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                signOut();
                router.replace("/");
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <SignOutIcon />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 12H3m0 0 3.5-3.5M3 12l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
