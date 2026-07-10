"use client";

import Link from "next/link";
import { GAMES, type Game } from "./_games";

export default function ExplorePage() {
  const live = GAMES.filter((g) => g.status === "live");

  return (
    <>
      {/* ambient brand glow — the two poles, faint, behind everything */}
      <div
        aria-hidden
        className="pointer-events-none fixed -left-40 -top-40 h-[34rem] w-[34rem] rounded-full opacity-[0.18] blur-3xl"
        style={{
          backgroundImage: "url(/human-gradient.png)",
          backgroundSize: "cover",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -right-40 -top-24 h-[34rem] w-[34rem] rounded-full opacity-[0.18] blur-3xl"
        style={{
          backgroundImage: "url(/ai-gradient.png)",
          backgroundSize: "cover",
        }}
      />

      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-20 pt-14 sm:px-8 sm:pt-20">
        {/* ── page title ── */}
        <header className="fade-up mb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/35">
            The arcade
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Explore our games
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/50">
            Voice-first tables where talking, reading people, and out-thinking
            the models decides who walks away.
          </p>
        </header>

        {/* ── live games (each opens its own page) ── */}
        <section
          className="fade-up flex flex-col gap-6"
          style={{ animationDelay: "90ms" }}
          aria-label="Games"
        >
          {live.map((g) => (
            <FeaturedCard key={g.slug} g={g} />
          ))}
        </section>
      </main>
    </>
  );
}

function StatusPill({ live }: { live: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em]"
      style={
        live
          ? { background: "rgba(177,76,255,0.15)", color: "var(--collision)" }
          : {
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.4)",
            }
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "live-dot" : ""}`}
        style={{ background: live ? "var(--collision)" : "currentColor" }}
      />
      {live ? "Live now" : "Soon"}
    </span>
  );
}

function FeaturedCard({ g }: { g: Game }) {
  return (
    <Link
      href={`/explore/${g.slug}`}
      className="block focus-visible:outline-none"
      aria-label={`View ${g.title}`}
    >
      <article className="surface lift group relative h-[420px] overflow-hidden !rounded-3xl sm:h-[460px]">
        {/* moving thumbnail */}
        {g.video && (
          <video
            src={g.video}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover opacity-55 transition-all duration-700 group-hover:scale-[1.04] group-hover:opacity-70"
          />
        )}
        {/* legibility scrims */}
        <div className="absolute inset-0 bg-gradient-to-t from-stage via-stage/55 to-stage/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-stage/85 via-transparent to-transparent" />

        <div className="relative flex h-full flex-col justify-end p-7 sm:p-10">
          <div className="flex items-center gap-3">
            <StatusPill live={g.status === "live"} />
            {g.players && (
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
                {g.players}
              </span>
            )}
          </div>

          <h3 className="mt-4 font-display text-[clamp(2.5rem,6vw,4.25rem)] font-bold leading-none tracking-tight text-white">
            {g.title}
          </h3>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
            {g.blurb ?? g.tagline}
          </p>

          <div className="mt-7">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-display text-sm font-bold text-stage shadow-lg shadow-black/30 transition-transform duration-300 group-hover:translate-x-1">
              View game
              <span aria-hidden>→</span>
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
