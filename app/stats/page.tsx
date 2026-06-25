"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../_components/AuthProvider";
import { UserButton } from "../_components/UserButton";

const RECORD: [string, string][] = [
  ["Played", "0"],
  ["Survived", "0"],
  ["Caught", "0"],
];

const LEADERBOARD: { rank: number; name: string; wins: number }[] = [];

export default function StatsPage() {
  const { ready, signedIn, hasProfile, profile } = useAuth();
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
          <Link href="/explore" className="font-display text-lg font-bold tracking-tight">
            Adversary
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/explore"
              className="text-sm font-bold uppercase tracking-wide text-white/60 transition-colors hover:text-white"
            >
              Explore
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Stats</h1>

        <section className="mt-10">
          <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-white/40">
            Your record
          </h2>
          <div className="mt-5 grid grid-cols-3 gap-4">
            {RECORD.map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-black px-5 py-7 text-center"
              >
                <p className="font-display text-3xl font-bold text-white">{value}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-white/40">
            Leaderboard
          </h2>
          {LEADERBOARD.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
              <p className="text-white/50">
                No standings yet. Be the first to beat the machines,{" "}
                <span className="text-white">{profile?.displayName}</span>.
              </p>
              <Link
                href="/games/mafia"
                className="mt-5 inline-flex rounded-full border border-white/20 px-5 py-2 text-sm text-white transition hover:border-white/50"
              >
                Play Tell
              </Link>
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
              {LEADERBOARD.map((row) => (
                <div
                  key={row.rank}
                  className="flex items-center justify-between border-b border-white/10 px-5 py-4 last:border-b-0"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm text-white/40">#{row.rank}</span>
                    <span className="font-medium text-white">{row.name}</span>
                  </div>
                  <span className="font-display text-lg font-bold text-white">{row.wins}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
