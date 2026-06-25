"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/#what", label: "About" },
  { href: "/explore", label: "Explore Games" },
  { href: "/onboarding", label: "Log in" },
] as const;

export function SiteNav() {
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
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
        </div>
      </nav>
    </header>
  );
}
