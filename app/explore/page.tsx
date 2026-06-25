"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../_components/AuthProvider";
import { UserButton } from "../_components/UserButton";
import { GAMES, type Game } from "./_games";

export default function ExplorePage() {
  const { ready, signedIn, hasProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      router.replace("/");
    } else if (!hasProfile) {
      router.replace("/onboarding");
    }
  }, [ready, signedIn, hasProfile, router]);

  if (!ready || !signedIn || !hasProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-white" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            Adversary
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/stats"
              className="text-sm font-bold uppercase tracking-wide text-white/60 transition-colors hover:text-white"
            >
              Stats
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8">
        <section>
          <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-white/40">
            Games
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GAMES.map((g) => (
              <GameTile key={g.slug} g={g} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function GameTile({ g }: { g: Game }) {
  const live = g.status === "live";

  const inner = (
    <article className="group flex h-full flex-col justify-between rounded-xl border border-white/10 bg-black p-6 transition hover:border-white/30">
      <div className="flex items-start justify-between">
        <span className="font-display text-2xl font-bold text-white">{g.title}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          {live ? "Live" : "Soon"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/50">{g.tagline}</p>
    </article>
  );

  if (live && g.href) {
    return (
      <Link href={g.href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return <div className="h-full cursor-default select-none opacity-70">{inner}</div>;
}
