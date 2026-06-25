"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "./UserButton";

const NAV = [
  { href: "/explore", label: "Explore" },
] as const;

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-stage/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/explore">
          <span className="font-display text-lg font-bold tracking-tight">Adversary</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {NAV.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`relative px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-[0.18em] transition-colors ${
                  active ? "text-white" : "text-[var(--text-muted)] hover:text-white"
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
          <span aria-hidden className="mx-1 h-5 w-px bg-[var(--hairline)] sm:mx-2" />
          <UserButton />
        </nav>
      </div>
    </header>
  );
}
