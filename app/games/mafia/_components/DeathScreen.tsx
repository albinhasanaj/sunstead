'use client';

import Link from 'next/link';
import { ROLE_STYLE } from '../constants';

// Full-screen death screen — raised once you (the human) are eliminated, after the
// outcome announcement has played. A dark, red-bled takeover with your sealed fate
// and two ways out: keep watching the round from the spectator vantage, or leave.
export default function DeathScreen({
  cause,
  role,
  winner,
  onSpectate,
}: {
  cause: 'voted' | 'killed';
  role: string;
  winner: string | null; // set if your death (or a beat after it) ended the round
  onSpectate: () => void;
}) {
  const gameOver = !!winner;
  const headline = cause === 'voted' ? 'Voted out' : 'Killed in the night';
  const eyebrow = cause === 'voted' ? 'The table has spoken' : 'You never saw the dawn';
  const blurb =
    cause === 'voted'
      ? 'The town turned on you and cast you out of the tribunal.'
      : 'The Mafia came for you in the dark. Your seat is empty now.';

  return (
    <div
      className="absolute inset-0 z-[55] flex flex-col items-center justify-center px-6 text-center bg-gradient-to-b from-black/85 via-red-950/40 to-black/90 backdrop-blur-md"
      style={{ animation: 'deathScreenIn .9s ease both' }}
    >
      <style>{`
        @keyframes deathScreenIn { from { opacity:0 } to { opacity:1 } }
        @keyframes deathRise { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:none } }
        @keyframes deathLine { from { opacity:0; transform:scaleX(0) } to { opacity:1; transform:scaleX(1) } }
        @keyframes deathPulse { 0%,100% { opacity:.3 } 50% { opacity:.6 } }
      `}</style>

      <p
        className="text-[11px] font-semibold uppercase tracking-[0.45em] text-red-400/80"
        style={{ animation: 'deathRise .6s ease both' }}
      >
        {eyebrow}
      </p>

      <h1
        className="mt-4 bg-gradient-to-b from-red-50 to-red-500/60 bg-clip-text text-6xl font-bold tracking-tight text-transparent"
        style={{ animation: 'deathRise .7s ease .08s both' }}
      >
        You are dead
      </h1>

      <div
        className="mt-5 h-px w-40 origin-center bg-gradient-to-r from-transparent via-red-500/60 to-transparent"
        style={{ animation: 'deathLine .8s ease .22s both, deathPulse 3.5s ease 1s infinite' }}
      />

      <p
        className="mt-5 text-sm font-medium uppercase tracking-[0.25em] text-neutral-300"
        style={{ animation: 'deathRise .7s ease .18s both' }}
      >
        {headline}
      </p>

      <p
        className="mt-4 max-w-md text-sm leading-relaxed text-neutral-400"
        style={{ animation: 'deathRise .7s ease .26s both' }}
      >
        {blurb}
      </p>

      <div
        className="mt-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-neutral-500"
        style={{ animation: 'deathRise .7s ease .34s both' }}
      >
        you were
        <span className={`rounded-md border px-2.5 py-1 text-[11px] tracking-wider ${ROLE_STYLE[role] ?? 'border-neutral-700 text-neutral-400'}`}>
          {role}
        </span>
      </div>

      {gameOver && (
        <p className="mt-6 text-sm font-semibold text-amber-400" style={{ animation: 'deathRise .7s ease .38s both' }}>
          {winner?.toUpperCase()} prevails — the round is over.
        </p>
      )}

      <div className="mt-10 flex flex-col items-center gap-3" style={{ animation: 'deathRise .7s ease .42s both' }}>
        <button onClick={onSpectate} className="tribunal-action tribunal-action--join min-w-[240px] text-center">
          {gameOver ? 'See how it ended' : 'Spectate the rest'}
        </button>
        <Link href="/explore" className="tribunal-action min-w-[240px] text-center">
          Leave to lobby
        </Link>
      </div>

      <p className="mt-6 text-[10px] uppercase tracking-[0.3em] text-neutral-600" style={{ animation: 'deathRise .7s ease .5s both' }}>
        {gameOver ? 'your part is played' : 'the round plays on without you'}
      </p>
    </div>
  );
}
