import { GoogleButton } from "./_components/GoogleButton";
import { SiteNav } from "./_components/SiteNav";

// Placeholder slots for the LinkedIn / video embeds. Drop a URL into `src`
// (e.g. a LinkedIn post embed or YouTube embed URL) and the iframe renders.
const VIDEOS: { id: string; label: string; src?: string }[] = [
  { id: "ai-vs-ai", label: "AI vs AI — Mafia in the lab" },
  { id: "ceo-vs-ceo", label: "Tech CEO vs Tech CEO" },
  { id: "going-viral", label: "Why it's blowing up" },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">{children}</p>
  );
}

// Placeholder icon slot. Provide an asset path in `src` later; until then it
// shows a subtle bordered square so the layout is intact.
function IconSlot({ src, alt }: { src?: string; alt?: string }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--hairline)] bg-stage-raised">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ""} className="h-6 w-6 object-contain" />
      ) : (
        <span className="h-2.5 w-2.5 rounded-sm bg-white/20" />
      )}
    </span>
  );
}

// Placeholder video embed. Drop a URL into `src` to render the iframe;
// otherwise a labelled 16:9 dashed frame holds the space.
function VideoEmbed({ label, src }: { label: string; src?: string }) {
  return (
    <figure className="group">
      <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-stage-raised">
        {src ? (
          <iframe
            src={src}
            title={label}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 border border-dashed border-white/10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15">
              <span className="ml-1 h-0 w-0 border-y-[8px] border-l-[13px] border-y-transparent border-l-white/40" />
            </span>
            <span className="px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Paste LinkedIn / video URL
            </span>
          </div>
        )}
      </div>
      <figcaption className="mt-3 text-sm text-muted">{label}</figcaption>
    </figure>
  );
}

export default function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-stage text-foreground">
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

        <div className="fade-up relative mt-10" style={{ animationDelay: "120ms" }}>
          <GoogleButton variant="plain" label="Start Playing" />
        </div>
      </section>

      {/* ── MANIFESTO ─────────────────────────────────────────── */}
      <section id="what" className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        {/* Beat 1 — the problem: we're outsourcing our minds */}
        <div className="border-b border-[var(--hairline)] py-28 sm:py-36">
          <Eyebrow>The quiet cost</Eyebrow>
          <h2 className="mt-7 max-w-4xl font-display text-[clamp(2rem,5.5vw,3.75rem)] font-bold leading-[1.04]">
            Every time we let AI do our thinking, we lose a little of our own.
          </h2>
          <div className="mt-10 flex max-w-2xl items-start gap-5">
            <IconSlot />
            <p className="text-lg leading-relaxed text-muted">
              Reasoning, persuasion, reading a room — these are muscles, and they atrophy when
              they go unused. Talking games are the opposite of autopilot. Bluffing, deducing, and
              defending yourself out loud force your brain to challenge itself again.
            </p>
          </div>
        </div>

        {/* Beat 2 — the signal: it's already happening in tech */}
        <div className="border-b border-[var(--hairline)] py-28 sm:py-36">
          <Eyebrow>The signal</Eyebrow>
          <h2 className="mt-7 max-w-3xl font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-tight">
            Games like Mafia are blowing up across tech — AI against AI, tech CEO against tech CEO.
          </h2>
          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {VIDEOS.map((v) => (
              <VideoEmbed key={v.id} label={v.label} src={v.src} />
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
        <div className="border-t border-[var(--hairline)] py-28 sm:py-36">
          <Eyebrow>So we made it</Eyebrow>
          <h2 className="mt-7 max-w-4xl font-display text-[clamp(2rem,5.5vw,3.75rem)] font-bold leading-[1.04]">
            A talking game you play <span className="text-ai">against real AI.</span>
          </h2>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted">
            You talk. They talk back. You bluff, accuse, defend, and vote — out loud, in real time,
            against frontier models that read how you play. No scripts, no menus. Just you and your
            wits versus the machines.
          </p>

          <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2">
            <div className="flex items-start gap-5">
              <IconSlot />
              <div>
                <h3 className="font-display text-xl font-medium">Pick a game, take a seat.</h3>
                <p className="mt-2 leading-relaxed text-muted">
                  Jump into a live table and start talking. Your voice goes straight into the round.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-5">
              <IconSlot />
              <div>
                <h3 className="font-display text-xl font-medium">Outtalk the models.</h3>
                <p className="mt-2 leading-relaxed text-muted">
                  Persuade, deceive, and deduce your way to the last seat standing.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-5">
              <IconSlot />
              <div>
                <h3 className="font-display text-xl font-medium">Endless game concepts.</h3>
                <p className="mt-2 leading-relaxed text-muted">
                  Mafia, debate, negotiation, interrogation — any game where talking and reading
                  people decides who wins.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-5">
              <IconSlot />
              <div>
                <h3 className="font-display text-xl font-medium">Your brain, switched on.</h3>
                <p className="mt-2 leading-relaxed text-muted">
                  Every round is a rep. The more you play, the sharper you think.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      <section className="relative border-t border-[var(--hairline)]">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 50% 80% at 50% 100%, rgba(177,76,255,0.18), transparent 70%)",
          }}
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
