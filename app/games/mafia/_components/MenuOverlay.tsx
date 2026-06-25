'use client';

// Full-screen menu — a dark overlay over the scene; the text and buttons float
// free (no card). Doubles as the entry and game-over screen.
export default function MenuOverlay({
  winner,
  devRole,
  setDevRole,
  onPlay,
  onWatch,
}: {
  winner: string | null;
  devRole: string;
  setDevRole: (role: string) => void;
  onPlay: () => void;
  onWatch: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center bg-gradient-to-b from-black/70 via-black/80 to-black/90 backdrop-blur-md">
      <p className="text-[11px] font-semibold uppercase tracking-[0.45em] text-amber-300/70">The Tribunal</p>
      <h1 className="mt-3 bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
        Agentic Mafia
      </h1>

      {winner ? (
        <p className="mt-5 text-sm font-semibold text-amber-400">{winner.toUpperCase()} prevails — run it back?</p>
      ) : (
        <p className="mt-5 max-w-md text-sm leading-relaxed text-neutral-400">
          A table of AI minds, and one of them is lying.
          <br />
          Watch them deliberate — or take a seat and bluff.
        </p>
      )}

      <div className="mt-10 flex flex-col items-center gap-3">
        <button onClick={onPlay} className="tribunal-action tribunal-action--join min-w-[240px] text-center">
          {winner ? 'Play again' : 'Join the table'}
        </button>
        <button onClick={onWatch} className="tribunal-action min-w-[240px] text-center">
          Watch the agents
        </button>
        {process.env.NODE_ENV !== 'production' && (
          <label className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            dev role
            <select
              value={devRole}
              onChange={(e) => setDevRole(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-[11px] normal-case tracking-normal text-neutral-300"
            >
              <option value="">Random</option>
              <option value="mafia">Mafia</option>
              <option value="detective">Detective</option>
              <option value="doctor">Doctor</option>
              <option value="villager">Villager</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
