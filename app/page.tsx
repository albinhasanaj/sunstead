import { GoogleButton } from "./_components/GoogleButton";
import { LazyVideo } from "./_components/LazyVideo";
import { SiteNav } from "./_components/SiteNav";

// The two clips play side by side, muted-autoplaying and looping.
const VIDEOS: { id: string; label: string; src: string }[] = [
  { id: "mafia", label: "Mafia, AI vs AI", src: "/mafia.mp4" },
  { id: "mafia-2", label: "Tech CEO vs Tech CEO", src: "/mafia-2.mp4" },
];

const CARDS: { title: string; body: string }[] = [
  {
    title: "Pick a game, take a seat.",
    body: "Jump into a live table and start talking. Your voice goes straight into the round.",
  },
  {
    title: "Outtalk the models.",
    body: "Persuade, deceive, and deduce your way to the last seat standing.",
  },
  {
    title: "Endless game concepts.",
    body: "Mafia, debate, negotiation, interrogation — any game where talking and reading people decides who wins.",
  },
  {
    title: "Your brain, switched on.",
    body: "Every round is a rep. The more you play, the sharper you think.",
  },
];

export default function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-black text-foreground">
      <SiteNav />

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section className="relative flex min-h-[92vh] flex-col items-center justify-center overflow-hidden bg-black px-5 py-24 text-center sm:px-8">
        {/* the provided gradients, anchored to each side, drifting vibrantly */}
        <div
          aria-hidden
          className="side-grad side-grad-left pointer-events-none"
          style={{ backgroundImage: "url(/human-gradient.png)" }}
        />
        <div
          aria-hidden
          className="side-grad side-grad-right pointer-events-none"
          style={{ backgroundImage: "url(/ai-gradient.png)" }}
        />

        <h1 className="fade-up relative mx-auto flex w-full max-w-4xl flex-col items-center px-5 font-display font-bold uppercase leading-[0.85] text-white sm:px-8">
          <span className="text-[clamp(2.25rem,9.5vw,6.75rem)] tracking-tight">
            The New Age Of
          </span>
          <span id="hero-gaming" className="text-[clamp(4.5rem,19vw,13.5rem)] tracking-tight">
            Gaming
          </span>
        </h1>

        <div className="fade-up relative mt-10 cursor-pointer" style={{ animationDelay: "120ms" }}>
          <GoogleButton variant="plain" label="Start Playing" />
        </div>
      </section>

      {/* ── MANIFESTO ─────────────────────────────────────────── */}
      <section id="what" className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        {/* Beat 2 — the signal: it's already happening in tech */}
        <div className="border-b border-[var(--hairline)] py-28 text-center sm:py-36">
          <h2 className="font-display text-[clamp(1rem,3vw,2.25rem)] font-semibold leading-tight whitespace-nowrap">
            Games like Mafia are blowing up across tech
            <br />
            AI against AI, tech CEO against tech CEO
          </h2>
          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {VIDEOS.map((v) => (
              <LazyVideo key={v.id} src={v.src} title={v.label} />
            ))}
          </div>
        </div>

        {/* Beat 3 — the pivot, big letters */}
        <div className="py-32 text-center sm:py-44">
          <p className="font-display text-[clamp(2.5rem,11vw,7.5rem)] font-bold leading-[0.92] tracking-tight text-white">
            Why not
            <br />
            combine them?
          </p>
        </div>

        {/* Beat 4 — the answer: so we made it */}
        <div className="border-t border-[var(--hairline)] py-28 text-center sm:py-36">
          <p className="mx-auto max-w-5xl font-display text-[clamp(3rem,8vw,5.5rem)] font-semibold leading-tight text-white">
            <span
              style={{
                backgroundImage:
                  "linear-gradient(to right, var(--human-2), var(--human-1) 35%, var(--text) 85%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              You
            </span>{" "}
            play against{" "}
            <span
              style={{
                backgroundImage:
                  "linear-gradient(to left, var(--ai-1), var(--ai-2) 35%, var(--text) 85%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              AI
            </span>
            .
          </p>
          <div className="marquee-mask mt-16 overflow-hidden">
            <ul className="marquee-track gap-6">
              {[...CARDS, ...CARDS].map((c, i) => (
                <li
                  key={i}
                  aria-hidden={i >= CARDS.length}
                  className="w-[min(82vw,22rem)] shrink-0"
                >
                  <article className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-[var(--hairline)] bg-black p-8 text-center">
                    <div
                      aria-hidden
                      className="card-grad card-grad-left"
                      style={{ backgroundImage: "url(/human-gradient.png)" }}
                    />
                    <div
                      aria-hidden
                      className="card-grad card-grad-right"
                      style={{ backgroundImage: "url(/ai-gradient.png)" }}
                    />
                    <h3 className="relative font-display text-2xl font-bold text-white">
                      {c.title}
                    </h3>
                    <p className="relative mt-3 text-sm leading-relaxed text-white/80">{c.body}</p>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-[var(--hairline)] bg-black">
        <div
          aria-hidden
          className="side-grad side-grad-left pointer-events-none"
          style={{ backgroundImage: "url(/human-gradient.png)" }}
        />
        <div
          aria-hidden
          className="side-grad side-grad-right pointer-events-none"
          style={{ backgroundImage: "url(/ai-gradient.png)" }}
        />
        <div className="relative mx-auto w-full max-w-3xl px-5 py-28 text-center sm:px-8">
          <h2 className="font-display text-4xl font-bold leading-tight sm:text-6xl">
            Do you think you would win?
          </h2>
          <div className="mt-9 flex justify-center">
            <GoogleButton variant="plain" label="Start Playing" />
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--hairline)] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className="h-3 w-3 rotate-45"
              style={{ background: "linear-gradient(135deg, var(--human-1), var(--ai-1))" }}
            />
            <span className="font-display text-base font-bold tracking-tight">Adversary</span>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            © {new Date().getFullYear()} Adversary · Outtalk the machines
          </p>
        </div>
      </footer>
    </div>
  );
}
