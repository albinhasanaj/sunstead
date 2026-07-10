"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { GAMES, type Game } from "../_games";
import { useAuth } from "../../../_components/AuthProvider";

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

  // Anyone can read the page; actually playing needs an account. When signed out the
  // button becomes a one-click "Log in to play".
  const { signedIn, hasProfile, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canPlay = signedIn && hasProfile;
  const play = () => {
    if (!g.href || busy) return;
    if (canPlay) {
      router.push(g.href);
      return;
    }
    setBusy(true);
    if (!signedIn) signInWithGoogle();
    // New here → set up a profile first; returning → straight to the table.
    setTimeout(() => router.push(hasProfile ? g.href! : "/onboarding"), 650);
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-28 pt-8 sm:px-8 sm:pt-12">
      <Link
        href="/explore"
        className="text-sm text-white/40 transition-colors hover:text-white"
      >
        ← Explore
      </Link>

      {/* ── hero: big media showcase on the left, capsule + brief on the right ── */}
      <div className="fade-up mt-6 grid gap-6 lg:grid-cols-12">
        {/* left — the showcase, taking up the majority of the space */}
        <div className="lg:col-span-8">
          <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
            <div className="aspect-video w-full">
              {active ? (
                isVideo(active) ? (
                  <FeaturedVideo key={active} src={active} />
                ) : (
                  <Media
                    key={active}
                    src={active}
                    className="h-full w-full object-cover"
                    big
                  />
                )
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
          </div>

          {gallery.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2.5">
              {gallery.map((src) => {
                const on = src === active;
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setActive(src)}
                    aria-label="Show media"
                    aria-pressed={on}
                    className={`h-14 w-24 overflow-hidden rounded transition ${
                      on
                        ? "ring-1 ring-white/70"
                        : "opacity-45 hover:opacity-80"
                    }`}
                  >
                    <Media src={src} className="h-full w-full object-cover" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* right — capsule art, brief description, and the facts */}
        <aside className="flex flex-col lg:col-span-4">
          <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
            <div className="aspect-video w-full">
              {(g.thumbnail ?? gallery[0]) ? (
                <Media
                  src={(g.thumbnail ?? gallery[0]) as string}
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
          </div>

          <div className="mt-4 flex items-center gap-2.5">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/50">
              {live ? "Live" : "In development"}
            </p>
            <span className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-white/60">
              Beta
            </span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {g.title}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            {g.tagline}
          </p>

          {g.specs && g.specs.length > 0 && (
            <dl className="mt-5 space-y-2.5 border-t border-[var(--hairline)] pt-4">
              {g.specs.map((s) => (
                <div
                  key={s.label}
                  className="flex items-baseline gap-3 text-sm"
                >
                  <dt className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
                    {s.label}
                  </dt>
                  <dd className="text-white/80">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-6">
            {live && g.href ? (
              <button
                type="button"
                onClick={play}
                disabled={busy}
                className="inline-flex w-full items-center justify-center rounded-md bg-white px-7 py-3 text-sm font-semibold text-stage transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-70"
              >
                {busy ? "Signing in…" : canPlay ? "Play now" : "Log in to play"}
              </button>
            ) : (
              <span className="inline-flex w-full cursor-default items-center justify-center rounded-md border border-[var(--hairline)] px-7 py-3 text-sm font-semibold text-white/40">
                Coming soon
              </span>
            )}
          </div>
        </aside>
      </div>

      {/* ── About this game: a fuller read below the brief hero blurb ── */}
      <section className="fade-up mt-20">
        <h2 className="border-b border-[var(--hairline)] pb-4 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
          About this game
        </h2>

        <div className="mt-10 grid gap-x-12 gap-y-14 lg:grid-cols-12">
          {/* left — the read, with illustrations woven in */}
          <div className="lg:col-span-7">
            <p className="text-lg leading-relaxed text-white/80">
              {g.blurb ?? g.tagline}
            </p>

            {gallery.length > 1 && (
              <figure className="mt-10 overflow-hidden rounded-xl border border-[var(--hairline)]">
                <Media
                  src={gallery[1]}
                  className="aspect-video w-full object-cover"
                  big
                />
              </figure>
            )}

            {g.howItPlays && g.howItPlays.length > 0 && (
              <div className="mt-14">
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
              </div>
            )}

            {gallery.length > 2 && (
              <figure className="mt-12 overflow-hidden rounded-xl border border-[var(--hairline)]">
                <Media
                  src={gallery[2]}
                  className="aspect-video w-full object-cover"
                  big
                />
              </figure>
            )}
          </div>

          {/* right — the facts, set off by a rule */}
          <aside className="lg:col-span-5 lg:border-l lg:border-[var(--hairline)] lg:pl-12">
            <div className="space-y-12">
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
      </section>
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

// The featured trailer: a normal video player — a muted autoplay preview with full
// native controls (hover reveals them; use the volume control to unmute).
function FeaturedVideo({ src }: { src: string }) {
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      autoPlay
      muted
      loop
      playsInline
      controls
      preload="metadata"
      className="h-full w-full object-cover"
    />
  );
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
