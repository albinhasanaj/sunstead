"use client";

import Link from "next/link";
import { GAMES, type Game } from "./_games";

export default function ExplorePage() {
  const featured = GAMES.find((g) => g.status === "live") ?? GAMES[0];

  return (
    <>
      {/* ambient brand glow — the two poles, faint, behind everything */}
      <div
        aria-hidden
        className="pointer-events-none fixed -left-40 -top-40 h-[34rem] w-[34rem] rounded-full opacity-[0.18] blur-3xl"
        style={{ backgroundImage: "url(/human-gradient.png)", backgroundSize: "cover" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -right-40 -top-24 h-[34rem] w-[34rem] rounded-full opacity-[0.18] blur-3xl"
        style={{ backgroundImage: "url(/ai-gradient.png)", backgroundSize: "cover" }}
      />

      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-12 pt-14 sm:px-8 sm:pt-20">
        {/* ── page title ── */}
        <h1 className="fade-up mb-8 font-display text-2xl font-semibold tracking-tight text-white/90">
          Explore our games
        </h1>

        {/* ── featured (live) ── */}
        <section className="fade-up " style={{ animationDelay: "90ms" }}>
          <FeaturedCard g={featured} />
        </section>

        {/* ── more coming soon ── */}
        <p className="fade-up mt-auto pt-16 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-white/25">
          More coming soon
        </p>
      </main>
    </>
  );
}

function FeaturedCard({ g }: { g: Game }) {
  const body = (
    <article className="group relative h-[420px] overflow-hidden rounded-3xl bg-stage-raised transition-all duration-500  sm:h-[460px]">
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
      {/* legibility scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-stage via-stage/55 to-stage/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-stage/85 via-transparent to-transparent" />

      <div className="relative flex h-full flex-col justify-end p-7 sm:p-10">


        <h3 className="mt-4 font-display text-[clamp(2.5rem,6vw,4.25rem)] font-bold leading-none tracking-tight">
          {g.title}
        </h3>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
          {g.blurb ?? g.tagline}
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-5">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-display text-sm font-bold text-stage transition-transform duration-300 group-hover:translate-x-1">
            Take a seat
            <span aria-hidden>→</span>
          </span>
          {g.players && (
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-white/45">
              {g.players}
            </span>
          )}
        </div>
      </div>

      {/* top accent hairline */}
    </article>
  );

  if (g.status === "live" && g.href) {
    return (
      <Link href={g.href} className="block focus-visible:outline-none">
        {body}
      </Link>
    );
  }
  return body;
}