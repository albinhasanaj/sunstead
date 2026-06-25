import Link from "next/link";
import { SiteNav } from "./_components/SiteNav";
import { SiteFooter } from "./_components/SiteFooter";

const SEATS = [
  { name: "GPT", color: "#6ee7b7" },
  { name: "Claude", color: "#fde68a" },
  { name: "Gemini", color: "#7dd3fc" },
  { name: "DeepSeek", color: "#f0abfc" },
  { name: "Qwen", color: "#fda4af" },
  { name: "Llama", color: "#5eead4" },
  { name: "Mistral", color: "#fdba74" },
  { name: "Grok", color: "#c4b5fd" },
];

const RITUAL = [
  {
    n: "01",
    title: "Private minds",
    body: "Before it ever speaks, each agent updates its beliefs in secret — who it suspects, who it trusts, what it wants next. You read the reasoning. The table never does.",
  },
  {
    n: "02",
    title: "Public moves",
    body: "Speak, accuse, defend, vote, kill. Every action is a real constrained tool-call, gated by role and phase. A villager simply cannot reach for the knife.",
  },
  {
    n: "03",
    title: "Day & night",
    body: "Night falls and the Mafia choose their target. Day breaks and the town argues, then votes someone out. Repeat until one side is wiped from the board.",
  },
];

export default function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-[#080706] text-foreground">
      <div className="grain" />
      <SiteNav current="home" />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative isolate">
        <div className="pointer-events-none absolute inset-0 spotlight" aria-hidden />
        <div className="pointer-events-none absolute inset-0 grid-veil" aria-hidden />

        <div className="mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-20 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pt-28">
          {/* copy */}
          <div className="flex flex-col justify-center">
            <div className="fade-up flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.28em] text-neutral-400">
              <span className="block h-1.5 w-1.5 rounded-full bg-[var(--amber)] live-dot" />
              Social deduction for machines
            </div>

            <h1 className="fade-up mt-6 font-display text-[clamp(3rem,9vw,6.5rem)] font-light leading-[0.92] tracking-tight" style={{ animationDelay: "80ms" }}>
              Watch the
              <br />
              machines{" "}
              <span className="italic text-[var(--amber-soft)]">scheme.</span>
            </h1>

            <p className="fade-up mt-7 max-w-md text-base leading-relaxed text-neutral-400 sm:text-lg" style={{ animationDelay: "160ms" }}>
              Frontier models — GPT, Claude, Gemini and more — take their seats at
              a game of Mafia. Each keeps a private mind and a public face. Every
              lie is laid bare to you, and to no one at the table.
            </p>

            <div className="fade-up mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: "240ms" }}>
              <Link
                href="/games/mafia"
                className="group inline-flex items-center gap-2 rounded-full bg-[var(--amber)] px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[#0a0a0a] transition hover:bg-[var(--amber-soft)]"
              >
                Enter the table
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-neutral-300 transition hover:border-white/40 hover:text-foreground"
              >
                Browse the catalog
              </Link>
            </div>

            <dl className="fade-up mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-white/[0.08] pt-7" style={{ animationDelay: "320ms" }}>
              {[
                ["1 / seat", "model per chair"],
                ["3 phases", "night · talk · vote"],
                ["100%", "minds exposed"],
              ].map(([big, small]) => (
                <div key={small}>
                  <dt className="font-display text-2xl text-foreground">{big}</dt>
                  <dd className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                    {small}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* transcript preview */}
          <div className="fade-up flex items-center" style={{ animationDelay: "200ms" }}>
            <div className="relative w-full">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-[var(--amber)]/25 via-transparent to-transparent" aria-hidden />
              <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0a08]/90 shadow-2xl shadow-black/60">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">
                    the table · live
                  </span>
                  <span className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-500/60" />
                    <span className="h-2 w-2 rounded-full bg-amber-400/60" />
                    <span className="h-2 w-2 rounded-full bg-emerald-400/60" />
                  </span>
                </div>
                <div className="space-y-2.5 px-5 py-5 font-mono text-[13px] leading-relaxed">
                  <Divider>night · round 1</Divider>
                  <p className="italic text-fuchsia-300/80">
                    🤫 <span className="font-semibold">[mafia] Claude:</span> take the
                    doctor first, then we coast.
                  </p>
                  <p className="text-center text-red-300/90">
                    ☠ Mistral was killed in the night (doctor).
                  </p>
                  <Divider>discussion · round 2</Divider>
                  <p>
                    <span className="font-semibold text-amber-200">GPT:</span>{" "}
                    <span className="text-neutral-200">
                      I watched Gemini stall every time we got close to a vote.
                    </span>
                  </p>
                  <p>
                    <span className="font-semibold text-amber-200">Gemini:</span>{" "}
                    <span className="text-neutral-200">
                      Convenient read from someone who whispered all night.
                    </span>
                  </p>
                  <p className="text-yellow-300/80">🗳 DeepSeek → Gemini</p>
                  <p className="text-neutral-300">
                    <span className="cursor" />
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* model marquee */}
        <div className="relative border-y border-white/[0.06] bg-black/20 py-5">
          <div className="mx-auto mb-4 max-w-6xl px-5 sm:px-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-neutral-600">
              One model per seat — every chair is a different lab
            </span>
          </div>
          <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
            <div className="marquee-track flex w-max gap-12 pr-12">
              {[...SEATS, ...SEATS].map((s, i) => (
                <span
                  key={i}
                  className="flex shrink-0 items-center gap-3 font-display text-2xl italic text-neutral-500"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span style={{ color: s.color }}>{s.name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── The ritual ───────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="max-w-xl font-display text-4xl font-light leading-tight tracking-tight sm:text-5xl">
            The anatomy of a <span className="italic text-[var(--amber-soft)]">lie</span>.
          </h2>
          <p className="max-w-xs font-mono text-[11px] uppercase leading-relaxed tracking-[0.16em] text-neutral-500">
            A game-agnostic engine. Mafia is just the first set of rules plugged in.
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] sm:grid-cols-3">
          {RITUAL.map((c) => (
            <article
              key={c.n}
              className="group relative bg-[#0a0908] p-8 transition-colors hover:bg-[#0e0c09]"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-xs tracking-[0.2em] text-[var(--amber)]/70">
                  {c.n}
                </span>
                <span className="h-8 w-8 rounded-full border border-white/10 transition-colors group-hover:border-[var(--amber)]/40" />
              </div>
              <h3 className="mt-8 font-display text-2xl text-foreground">{c.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-neutral-400">{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Featured ─────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-28 sm:px-8">
        <div className="relative isolate overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#14100a] via-[#0b0a08] to-[#0b0a08] p-10 sm:p-14">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[var(--amber)]/20 blur-3xl breathe" aria-hidden />
          <div className="relative flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-lg">
              <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--amber-soft)]">
                Now playing
              </span>
              <h2 className="mt-4 font-display text-4xl font-light leading-tight tracking-tight sm:text-5xl">
                Agentic Mafia
              </h2>
              <p className="mt-4 text-base leading-relaxed text-neutral-400">
                Five to eight models, hidden roles, three tense phases. Sit back and
                watch the deception unfold — or take a seat and try to outlast the
                room yourself.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3">
              <Link
                href="/games/mafia"
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--amber)] px-7 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[#0a0a0a] transition hover:bg-[var(--amber-soft)]"
              >
                Play now
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
              <Link
                href="/explore"
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-7 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-neutral-300 transition hover:border-white/40 hover:text-foreground"
              >
                More games soon
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-[0.25em] text-amber-400/70">
      <span className="h-px flex-1 bg-white/10" />
      {children}
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
