"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { GAMES, type Game } from "../_games";

const isVideo = (src: string) => /\.(mp4|webm|mov)$/i.test(src);

export default function GameDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const game = GAMES.find((g) => g.slug === slug);

  if (!game) return <NotFound />;

  return <GameDetail g={game} />;
}

function GameDetail({ g }: { g: Game }) {
  const live = g.status === "live";
  const gallery = g.gallery ?? (g.video ? [g.video] : []);
  const [active, setActive] = useState(gallery[0] ?? null);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-28 pt-8 sm:px-8 sm:pt-12">
      <Link
        href="/explore"
        className="text-sm text-white/40 transition-colors hover:text-white"
      >
        ← Explore
      </Link>

      {/* ── cinematic hero: media with the title laid over it ── */}
      <div className="fade-up relative mt-6 overflow-hidden rounded-xl border border-[var(--hairline)]">
        <div className="aspect-[16/10] w-full sm:aspect-[21/9]">
          {active ? (
            <Media
              key={active}
              src={active}
              className="h-full w-full object-cover"
              big
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background:
                  "linear-gradient(135deg, var(--stage-raised), var(--stage))",
              }}
            />
          )}
        </div>
        {/* legibility scrims */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stage via-stage/45 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-stage/70 via-transparent to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
          <div className="flex items-center gap-2.5">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/50">
              {live ? "Live" : "In development"}
            </p>
            <span className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-white/60">
              Beta
            </span>
          </div>
          <h1 className="mt-2 font-display text-5xl font-bold tracking-tight text-white sm:text-6xl">
            {g.title}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70 sm:text-base">
            {g.tagline}
          </p>
        </div>
      </div>

      {/* ── action row: play + the media strip ── */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
        {live && g.href ? (
          <Link
            href={g.href}
            className="inline-flex items-center rounded-md bg-white px-7 py-3 text-sm font-semibold text-stage transition hover:bg-white/90"
          >
            Play now
          </Link>
        ) : (
          <span className="inline-flex cursor-default items-center rounded-md border border-[var(--hairline)] px-7 py-3 text-sm font-semibold text-white/40">
            Coming soon
          </span>
        )}

        {g.players && (
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
            {g.players}
          </span>
        )}

        {gallery.length > 1 && (
          <div className="ml-auto flex gap-2.5">
            {gallery.map((src) => {
              const on = src === active;
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => setActive(src)}
                  aria-label="Show media"
                  aria-pressed={on}
                  className={`h-11 w-20 overflow-hidden rounded transition ${
                    on ? "ring-1 ring-white/70" : "opacity-45 hover:opacity-80"
                  }`}
                >
                  <Media src={src} className="h-full w-full object-cover" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── body: asymmetric two columns, split by a hairline rail ── */}
      <div className="mt-16 grid gap-x-12 gap-y-12 lg:grid-cols-12">
        {/* left — the read */}
        <div className="lg:col-span-7">
          <p className="text-lg leading-relaxed text-white/75">
            {g.blurb ?? g.tagline}
          </p>

          {g.howItPlays && g.howItPlays.length > 0 && (
            <section className="mt-14">
              <Label>How it plays</Label>
              <div className="mt-7 space-y-9">
                {g.howItPlays.map((step, i) => (
                  <div key={step.title} className="flex gap-5">
                    <span className="font-display text-3xl font-bold leading-none tabular-nums text-white/15">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="pt-0.5">
                      <p className="font-medium text-white">{step.title}</p>
                      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/55">
                        {step.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* right — the facts, set off by a rule */}
        <aside className="lg:col-span-5 lg:border-l lg:border-[var(--hairline)] lg:pl-12">
          <div className="space-y-12">
            {g.specs && g.specs.length > 0 && (
              <div>
                <Label>Details</Label>
                <dl className="mt-4 divide-y divide-[var(--hairline)]">
                  {g.specs.map((s) => (
                    <div
                      key={s.label}
                      className="flex items-baseline justify-between gap-4 py-3"
                    >
                      <dt className="text-sm text-white/40">{s.label}</dt>
                      <dd className="text-right text-sm text-white/80">
                        {s.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {g.highlights && g.highlights.length > 0 && (
              <div>
                <Label>What&apos;s inside</Label>
                <ul className="mt-4 divide-y divide-[var(--hairline)]">
                  {g.highlights.map((h) => (
                    <li
                      key={h}
                      className="py-3 text-sm leading-relaxed text-white/60"
                    >
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Media({
  src,
  className,
  big = false,
}: {
  src: string;
  className?: string;
  big?: boolean;
}) {
  if (isVideo(src)) {
    return (
      <video
        src={src}
        autoPlay={big}
        muted
        loop
        playsInline
        preload="metadata"
        className={className}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} />;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/35">
      {children}
    </h2>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 py-32 text-center">
      <p className="font-display text-2xl font-bold text-white">
        Game not found
      </p>
      <p className="mt-2 text-sm text-white/50">
        That game isn&apos;t in the arcade — it may have moved or isn&apos;t
        live yet.
      </p>
      <Link
        href="/explore"
        className="mt-6 inline-flex items-center rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-stage transition hover:bg-white/90"
      >
        ← Back to explore
      </Link>
    </main>
  );
}
