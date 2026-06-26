'use client';

import { Skull, Target, Check } from 'lucide-react';

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
  const myPick = humanId ? killVotesByAgent[humanId] : undefined;
  return (
    <div className="absolute left-3 top-16 z-30 flex w-64 flex-col overflow-hidden rounded-xl border border-red-500/30 bg-neutral-950/85 backdrop-blur">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-3 py-2">
        <Skull className="h-4 w-4 text-red-400" />
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-red-300">Mafia · night</span>
          <span className="truncate text-[10px] text-red-300/50">
            {teammates.length ? `with ${teammates.map((id) => nameOf(id)).join(', ')}` : 'you’re the lone wolf'}
          </span>
        </div>
      </div>

      {/* the one instruction that matters, stated as a single clear action */}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-red-400/80" />
        <p className="text-[11px] leading-snug text-neutral-300">
          {myPick ? (
            <>You’re killing <span className="font-semibold text-red-300">{nameOf(myPick)}</span> tonight. Click another face to change.</>
          ) : (
            <>Click a face in the scene, then press <span className="font-semibold text-red-300">Kill</span>.</>
          )}
        </p>
      </div>

      {/* team pick status — only worth showing when you actually have partners */}
      {teammates.length > 0 && (
        <div className="border-t border-red-500/15 px-3 py-2 space-y-1">
          {team.map((id) => {
            const pick = killVotesByAgent[id];
            return (
              <div key={id} className="flex items-center justify-between text-[11px]">
                <span className="text-neutral-400">
                  {nameOf(id)}
                  {id === humanId ? ' (you)' : ''}
                </span>
                {pick ? (
                  <span className="inline-flex items-center gap-1 font-medium text-red-300">
                    <Check className="h-3 w-3" /> {nameOf(pick)}
                  </span>
                ) : (
                  <span className="text-neutral-600">choosing…</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
