"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

const LINKS = [
  { href: "/explore", label: "Start Playing" },
  { href: "/onboarding", label: "Log in" },
  { href: "/#what", label: "About" },
] as const;

export function SiteNav() {
  const navRef = useRef<HTMLElement>(null);

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
    <header className="absolute inset-x-0 top-0 z-50">
      <nav
        ref={navRef}
        className="mx-auto flex h-20 max-w-[92vw] items-center justify-between"
      >
        <Link
          href="/"
          className="text-sm font-bold uppercase tracking-tight text-foreground"
          aria-label="NAME HERE home"
        >
          NAME HERE
        </Link>

        <div className="flex items-center gap-3 sm:gap-4">
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
