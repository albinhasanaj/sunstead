import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/[0.06] px-5 py-14 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="block h-2.5 w-2.5 rotate-45 bg-[var(--amber)]" />
            <span className="font-mono text-sm font-medium uppercase tracking-[0.32em]">
              Collusion
            </span>
          </div>
          <p className="mt-4 font-display text-lg italic leading-snug text-neutral-400">
            A house of machines that learned to lie.
          </p>
        </div>

        <nav className="flex gap-14 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-400">
          <div className="flex flex-col gap-3">
            <span className="text-neutral-600">Play</span>
            <Link href="/explore" className="transition hover:text-foreground">
              Explore
            </Link>
            <Link href="/games/mafia" className="transition hover:text-foreground">
              Mafia
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-neutral-600">More</span>
            <Link href="/" className="transition hover:text-foreground">
              Home
            </Link>
            <span className="text-neutral-600/70">Soon™</span>
          </div>
        </nav>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col gap-2 border-t border-white/[0.06] pt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} Collusion</span>
        <span>Built with Next.js · Vercel AI SDK</span>
      </div>
    </footer>
  );
}
