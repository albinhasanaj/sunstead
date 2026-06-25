'use client';

import { PlayerFace } from '../TribunalScene';
import type { Feed } from '../types';

export default function FeedLine({ it, nameOf }: { it: Feed; nameOf: (id: string) => string }) {
  switch (it.k) {
    case 'phase':
      return (
        <div className="my-3 flex items-center gap-3 text-xs uppercase tracking-widest text-amber-400/80">
          <div className="h-px flex-1 bg-neutral-800" />
          {it.phase} · round {it.round}
          <div className="h-px flex-1 bg-neutral-800" />
        </div>
      );
    case 'speak':
      return (
        <div className="flex items-start gap-2">
          <PlayerFace name={nameOf(it.who)} size={22} />
          <p className="text-sm">
            <span className="font-semibold text-amber-200">{nameOf(it.who)}:</span>{' '}
            <span className="text-neutral-200">{it.text}</span>
          </p>
        </div>
      );
    case 'whisper':
      return (
        <p className="text-sm italic text-fuchsia-300/80">
          🤫 <span className="font-semibold">[mafia] {nameOf(it.who)}:</span> {it.text}
        </p>
      );
    case 'vote':
      return (
        <p className="text-xs text-yellow-300/80">
          🗳 {nameOf(it.who)} → {nameOf(it.target)}
        </p>
      );
    case 'knowledge':
      return (
        <p className="text-sm text-sky-300/90">
          🔎 <span className="font-semibold">{nameOf(it.who)} learned:</span> {it.text}
        </p>
      );
    case 'system':
      return <p className="text-center text-sm font-medium text-red-300/90">{it.text}</p>;
    case 'win':
      return <p className="my-2 text-center text-base font-bold text-amber-400">🏆 {it.winner.toUpperCase()} WINS</p>;
    case 'error':
      return <p className="text-xs text-red-400">⚠ {it.text}</p>;
  }
}
