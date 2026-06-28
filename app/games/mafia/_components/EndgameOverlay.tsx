'use client';

// ── Endgame reveal card ───────────────────────────────────────────────────────
// Sits over the 3D scene AFTER the game is decided, while the camera lifts into its
// slow orbit and every seat's true role is unmasked overhead (driven by the scene's
// `gameOver` prop). Deliberately a lower-third card with no full backdrop, so the
// table reveal stays visible above it. Fades in a beat late so the win stinger and
// the camera lift land first; "Continue" hands control to the lobby/game-over menu.
const FACTION: Record<string, { tag: string; color: string; sub: string }> = {
  village: { tag: 'The town prevails', color: '#34d399', sub: 'every Mafia has been rooted out' },
  mafia: { tag: 'The Mafia win', color: '#e0454f', sub: 'they reached the town in the dark' },
  draw: { tag: 'A stalemate', color: '#9aa3c0', sub: 'no side could close it out' },
};

export default function EndgameOverlay({
  winner,
  humanWon,
  onContinue,
}: {
  winner: string;
  humanWon: boolean | null; // true/false in play mode, null when watching
  onContinue: () => void;
}) {
  const f = FACTION[winner] ?? FACTION.draw;
  // Personal verdict takes the spotlight in play mode; the faction line becomes the sub.
  const verdict = humanWon == null ? null : humanWon ? 'Victory' : 'Defeat';
  const verdictColor = humanWon == null ? f.color : humanWon ? '#34d399' : '#e0454f';

  return (
    <div className="endgame pointer-events-none absolute inset-x-0 bottom-0 z-[55] flex flex-col items-center px-6 pb-16">
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.5em]"
        style={{ color: f.color + 'b0', textShadow: `0 0 18px ${f.color}55` }}
      >
        {verdict ? f.tag : 'The Tribunal rests'}
      </p>
      <h2
        className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl"
        style={{ color: verdictColor, textShadow: `0 0 30px ${verdictColor}88, 0 0 60px ${verdictColor}44` }}
      >
        {verdict ?? f.tag}
      </h2>
      <p className="mt-3 text-sm tracking-wide text-neutral-300/85">{verdict ? f.tag + ' — ' + f.sub : f.sub}</p>

      <button
        onClick={onContinue}
        className="pointer-events-auto mt-8 rounded-full border border-neutral-600/70 bg-neutral-950/70 px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-200 backdrop-blur transition hover:border-neutral-400 hover:text-white"
      >
        Continue
      </button>

      <style>{`
        @keyframes endgameIn { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
        /* hold dark for a beat so the camera lift + role reveal read first, then rise in */
        .endgame { opacity:0; animation: endgameIn .9s ease 1.3s forwards; }
      `}</style>
    </div>
  );
}
