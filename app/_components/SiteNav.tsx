"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

const LINKS = [
  { href: "/#what", label: "About" },
  { href: "/explore", label: "Explore Games" },
] as const;

export function SiteNav() {
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const { signedIn, hasProfile, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleLogin = () => {
    if (busy) return;
    setBusy(true);
    if (!signedIn) signInWithGoogle();
    // Mirror the homepage Google button: brief round-trip, then route by profile.
    setTimeout(() => {
      router.push(hasProfile ? "/explore" : "/onboarding");
    }, 650);
  };

  useEffect(() => {
    const onScroll = () => {
      // Only flip state when the threshold is actually crossed, so scrolling
      // doesn't re-render the nav on every frame.
      setScrolled((prev) => {
        const next = window.scrollY > 8;
        return prev === next ? prev : next;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const target = document.getElementById("hero-gaming");
    const nav = navRef.current;
    if (!target || !nav) return;

    const sync = () => {
      nav.style.width = `${target.getBoundingClientRect().width}px`;
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(target);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-[var(--hairline)] bg-stage/70 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav
        ref={navRef}
        className="mx-auto flex h-20 max-w-[92vw] items-center justify-between"
      >
        <Link
          href="/"
          className="text-sm font-bold uppercase tracking-tight text-foreground"
          aria-label="Adversary home"
        >
Adversary        </Link>

        <div className="flex items-center gap-12 sm:gap-8">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-sm font-bold uppercase text-neutral-300 transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={handleLogin}
            disabled={busy}
            className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold uppercase text-neutral-300 transition-colors hover:text-foreground disabled:cursor-wait disabled:text-neutral-500"
          >
            {busy && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-500 border-t-foreground" />
            )}
            {busy ? "Signing in…" : signedIn && hasProfile ? "Enter" : "Log in"}
          </button>
        </div>
      </nav>
    </header>
  );
}
