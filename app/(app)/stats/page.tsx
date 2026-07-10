"use client";

import Link from "next/link";
import { useAuth } from "../../_components/AuthProvider";
import { SignInGate } from "../../_components/SignInGate";

const RECORD: [string, string][] = [
  ["Played", "0"],
  ["Survived", "0"],
  ["Caught", "0"],
];

const LEADERBOARD: { rank: number; name: string; wins: number }[] = [];

export default function StatsPage() {
  const { ready, signedIn, hasProfile, profile } = useAuth();

  // Stats are personal — you need an account to see them.
  if (!ready) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
      </div>
    );
  }
  if (!signedIn || !hasProfile) {
    return (
      <SignInGate
        title="Log in to see your stats"
        subtitle="Track your games, wins, and where you rank once you're signed in."
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <header className="fade-up">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/35">
          Your dossier
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Stats
        </h1>
      </header>

      <section className="fade-up mt-10" style={{ animationDelay: "80ms" }}>
        <h2 className="mb-5 font-mono text-xs uppercase tracking-[0.24em] text-white/40">
          Your record
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {RECORD.map(([label, value]) => (
            <div key={label} className="surface px-5 py-7 text-center">
              <p className="font-display text-3xl font-bold text-white sm:text-4xl">
                {value}
              </p>
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="fade-up mt-14" style={{ animationDelay: "140ms" }}>
        <h2 className="mb-5 font-mono text-xs uppercase tracking-[0.24em] text-white/40">
          Leaderboard
        </h2>
        {LEADERBOARD.length === 0 ? (
          <div className="surface flex flex-col items-center px-6 py-12 text-center">
            <p className="max-w-sm text-sm leading-relaxed text-white/50">
              No standings yet. Be the first to beat the machines,{" "}
              <span className="font-medium text-white">
                {profile?.displayName}
              </span>
              .
            </p>
            <Link
              href="/games/mafia"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-display text-sm font-bold text-stage transition hover:translate-x-0.5"
            >
              Play Mafia
              <span aria-hidden>→</span>
            </Link>
          </div>
        ) : (
          <div className="surface overflow-hidden">
            {LEADERBOARD.map((row) => (
              <div
                key={row.rank}
                className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-4 transition-colors last:border-b-0 hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm tabular-nums text-white/40">
                    #{row.rank}
                  </span>
                  <span className="font-medium text-white">{row.name}</span>
                </div>
                <span className="font-display text-lg font-bold text-white">
                  {row.wins}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
