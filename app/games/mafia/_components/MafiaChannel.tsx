'use client';

// Mafia private channel — your allies + the targets they've silently picked.
export default function MafiaChannel({
  teammates,
  humanId,
  killVotesByAgent,
  nameOf,
}: {
  teammates: string[];
  humanId: string | null;
  killVotesByAgent: Record<string, string>;
  nameOf: (id: string) => string;
}) {
  const team = [...(humanId ? [humanId] : []), ...teammates];
  return (
    <div className="absolute left-3 top-16 z-30 flex max-h-[42vh] w-72 flex-col rounded-xl border border-fuchsia-500/30 bg-neutral-950/80 backdrop-blur">
      <div className="border-b border-fuchsia-500/20 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fuchsia-300">🔪 Mafia · night</div>
        <div className="mt-0.5 truncate text-[10px] text-fuchsia-300/60">
          {teammates.length ? `with ${teammates.map((id) => nameOf(id)).join(', ')}` : 'you’re the lone wolf'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        <p className="text-[11px] leading-snug text-fuchsia-300/60">No talking at night — point at a victim. Click a face in the scene, then press Kill.</p>
        {team.map((id) => {
          const pick = killVotesByAgent[id];
          return (
            <p key={id} className="text-xs leading-snug text-fuchsia-200/90">
              <span className="font-semibold">
                {nameOf(id)}
                {id === humanId ? ' (you)' : ''}:
              </span>{' '}
              {pick ? <span className="text-red-300">⚔ {nameOf(pick)}</span> : <span className="text-neutral-500">choosing…</span>}
            </p>
          );
        })}
      </div>
    </div>
  );
}
