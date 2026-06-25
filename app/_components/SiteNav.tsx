import Link from "next/link";

const LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/games/mafia", label: "Mafia" },
] as const;

export function SiteNav({ current }: { current?: "home" | "explore" | "game" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080706]/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="Collusion home">
          <span className="block h-2.5 w-2.5 rotate-45 bg-[var(--amber)] transition-transform duration-500 group-hover:rotate-[225deg]" />
          <span className="font-mono text-sm font-medium uppercase tracking-[0.32em] text-foreground">
            Collusion
          </span>
        </Link>

        <div className="flex items-center gap-6 sm:gap-8">
          <div className="hidden items-center gap-7 sm:flex">
            {LINKS.map((l) => {
              const active =
                (current === "explore" && l.href === "/explore") ||
                (current === "game" && l.href.startsWith("/games"));
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                    active ? "text-[var(--amber-soft)]" : "text-neutral-400 hover:text-foreground"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>

          <Link
            href="/games/mafia"
            className="group relative inline-flex items-center gap-2 rounded-full border border-[var(--amber)]/40 bg-[var(--amber)]/[0.08] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--amber-soft)] transition hover:bg-[var(--amber)]/[0.16]"
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-[var(--amber)] live-dot" />
            Take a seat
          </Link>
        </div>
      </nav>
    </header>
  );
}
