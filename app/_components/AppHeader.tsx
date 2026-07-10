"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { UserButton } from "./UserButton";

const NAV = [{ href: "/explore", label: "Explore" }] as const;

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { signedIn, hasProfile, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  // Signed-out visitors (e.g. on the landing page) get a sign-in CTA instead of the
  // account menu. Mirrors the homepage Google flow: sign in, then route by profile.
  const handleLogin = () => {
    if (busy) return;
    setBusy(true);
    if (!signedIn) signInWithGoogle();
    setTimeout(() => {
      router.push(hasProfile ? "/explore" : "/onboarding");
    }, 650);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-stage/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/explore" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-3 w-3 rotate-45"
            style={{
              background:
                "linear-gradient(135deg, var(--human-1), var(--ai-1))",
            }}
          />
          <span className="font-display text-lg font-bold tracking-tight">
            Adversary
          </span>
          <span className="rounded border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-white/45">
            Beta
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {NAV.map((l) => {
            const active =
              pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`relative px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-[0.18em] transition-colors ${
                  active
                    ? "text-white"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                {l.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-[1px] h-px"
                    style={{ background: "white" }}
                  />
                )}
              </Link>
            );
          })}
          <span
            aria-hidden
            className="mx-1 h-5 w-px bg-[var(--hairline)] sm:mx-2"
          />
          {signedIn && hasProfile ? (
            <UserButton />
          ) : (
            <button
              type="button"
              onClick={handleLogin}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--hairline)] px-4 py-1.5 font-mono text-xs font-medium uppercase tracking-[0.16em] text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {busy && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              )}
              {busy ? "Signing in…" : signedIn ? "Finish setup" : "Log in"}
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
