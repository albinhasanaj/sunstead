'use client';

import { ROLE_STYLE } from '../constants';
import type { Player, Turn } from '../types';

// Left drawer — the table (toggled by the Players button).
export default function PlayersDrawer({
  open,
  players,
  selected,
  onSelect,
  turn,
  hideRoles,
}: {
  open: boolean;
  players: Player[];
  selected: string | null;
  onSelect: (id: string) => void;
  turn: Turn | null;
  hideRoles?: boolean;
}) {
  return (
    <div
      className={`absolute inset-y-0 left-0 z-40 flex w-[300px] max-w-[85%] transform flex-col border-r border-neutral-800 bg-neutral-950/95 backdrop-blur transition-transform duration-300 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="border-b border-neutral-800 px-4 py-3">
        <h3 className="text-xs uppercase tracking-wider text-neutral-400">The table</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {players.length === 0 && <p className="px-1 text-sm text-neutral-600">Watch the agents, or join in.</p>}
        {players.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
              selected === p.id ? 'border-amber-500/60 bg-neutral-900' : 'border-neutral-800 hover:bg-neutral-900/60'
            } ${p.alive ? '' : 'opacity-40'} ${turn && turn.agent === p.id ? 'ring-1 ring-amber-400/60' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className={`font-semibold ${p.alive ? '' : 'line-through'}`}>
                {p.name}
                {p.human && <span className="ml-1 text-[10px] text-amber-400">(you)</span>}
              </span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${hideRoles || p.role === 'unknown' ? ROLE_STYLE.unknown : (ROLE_STYLE[p.role] ?? 'border-neutral-700 text-neutral-400')}`}>
                {hideRoles || p.role === 'unknown' ? '?' : p.role}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[10px] text-neutral-500">{p.human ? 'human player' : p.model}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
