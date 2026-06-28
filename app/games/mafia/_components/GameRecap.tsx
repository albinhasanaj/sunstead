'use client';

import { PlayerFace } from '../TribunalScene';

// ── Post-game scorecard ───────────────────────────────────────────────────────
// Shown after the reveal-orbit cutscene (EndgameOverlay → Continue). Closes the loop
// the 3D unmasking opens: it spells out who was who, how they fell, and — for the
// human — how their own game went (role, fate, vote accuracy). Reuses the now-public
// roles folded into player state by the `win` event.

export type RecapPlayer = { id: string; name: string; role: string; alive: boolean; fate?: 'killed' | 'lynched' };

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  mafia: { label: 'Mafia', color: '#e0454f' },
  detective: { label: 'Detective', color: '#6fb4ff' },
  doctor: { label: 'Doctor', color: '#2dd4bf' },
  villager: { label: 'Villager', color: '#9aa3c0' },
};
const FACTION_TITLE: Record<string, string> = { village: 'The town prevails', mafia: 'The Mafia win', draw: 'A stalemate' };

function fateLabel(p: RecapPlayer): string {
  if (p.alive) return 'survived';
  if (p.fate === 'killed') return 'killed at night';
  if (p.fate === 'lynched') return 'voted out';
  return 'eliminated';
}

export default function GameRecap({
  winner,
  youWon,
  you,
  table,
  rounds,
  voteStat,
  onPlayAgain,
  onLobby,
}: {
  winner: string;
  youWon: boolean | null; // null when you had no seat (watching)
  you: { name: string; role: string; survived: boolean; fate?: 'killed' | 'lynched' } | null;
  table: RecapPlayer[];
  rounds: number;
  voteStat: { total: number; onMafia: number } | null;
  onPlayAgain: () => void;
  onLobby: () => void;
}) {
  // Mafia first, then by who lasted longest — reads like a reveal, villains up top.
  const ordered = [...table].sort((a, b) => {
    const am = a.role === 'mafia' ? 0 : 1;
    const bm = b.role === 'mafia' ? 0 : 1;
    if (am !== bm) return am - bm;
    return Number(b.alive) - Number(a.alive);
  });
  const verdictColor = youWon == null ? '#9aa3c0' : youWon ? '#34d399' : '#e0454f';

  return (
    <div className="recap absolute inset-0 z-[58] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-neutral-700/60 bg-neutral-950/85 p-6 font-mono shadow-2xl">
        {/* headline */}
        <div className="text-center">
          {youWon != null && (
            <p className="text-3xl font-bold tracking-tight" style={{ color: verdictColor, textShadow: `0 0 26px ${verdictColor}66` }}>
              {youWon ? 'Victory' : 'Defeat'}
            </p>
          )}
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.35em] text-neutral-400">
            {FACTION_TITLE[winner] ?? FACTION_TITLE.draw} · {rounds} {rounds === 1 ? 'round' : 'rounds'}
          </p>
        </div>

        {/* your game */}
        {you && (
          <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm text-neutral-300">
            You played the{' '}
            <span className="font-semibold" style={{ color: (ROLE_BADGE[you.role] ?? ROLE_BADGE.villager).color }}>
              {(ROLE_BADGE[you.role] ?? ROLE_BADGE.villager).label}
            </span>{' '}
            and {you.survived ? 'made it to the end' : you.fate === 'lynched' ? 'were voted out' : 'were killed in the night'}.
            {voteStat && (
              <div className="mt-1 text-xs text-neutral-400">
                Your votes: {voteStat.onMafia}/{voteStat.total} landed on a real Mafia.
              </div>
            )}
          </div>
        )}

        {/* the table unmasked */}
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-500">The table, unmasked</p>
          <div className="flex flex-col gap-1.5">
            {ordered.map((p) => {
              const badge = ROLE_BADGE[p.role] ?? ROLE_BADGE.villager;
              const isMafia = p.role === 'mafia';
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-1.5"
                  style={{
                    borderColor: isMafia ? '#e0454f44' : '#ffffff10',
                    background: isMafia ? '#e0454f12' : 'transparent',
                  }}
                >
                  <PlayerFace name={p.name} size={26} />
                  <span className="flex-1 truncate text-sm text-neutral-200">{p.name}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: badge.color }}>
                    {badge.label}
                  </span>
                  <span className="w-20 text-right text-[10px] uppercase tracking-wide text-neutral-500">{fateLabel(p)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* actions */}
        <div className="mt-6 flex gap-2">
          <button
            onClick={onPlayAgain}
            className="flex-1 rounded-full border border-amber-400/50 bg-amber-500/15 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100 transition hover:bg-amber-500/25"
          >
            Play again
          </button>
          <button
            onClick={onLobby}
            className="rounded-full border border-neutral-600/70 bg-neutral-950/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300 transition hover:border-neutral-400 hover:text-white"
          >
            Lobby
          </button>
        </div>
      </div>

      <style>{`
        @keyframes recapIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        .recap { animation: recapIn .5s ease both; }
      `}</style>
    </div>
  );
}
