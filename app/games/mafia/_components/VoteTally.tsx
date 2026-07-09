"use client";

import { PlayerFace } from "../TribunalScene";

// ── Live vote tally ───────────────────────────────────────────────────────────
// Shown during the vote-reveal cutscene, climbing as each slip is flipped. The seat
// with the most votes so far is highlighted — the wagon forming in real time.
export default function VoteTally({
  rows,
}: {
  rows: { id: string; name: string; count: number; leading: boolean }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="votetally pointer-events-none absolute left-4 top-1/2 z-50 w-52 max-w-[42vw] -translate-y-1/2">
      <div className="rounded-2xl border border-white/10 bg-neutral-950/80 p-3 font-mono shadow-2xl backdrop-blur-md">
        <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.35em] text-neutral-400">
          The tally
        </p>
        <div className="flex flex-col gap-1.5">
          {rows.length === 0 && (
            <p className="py-2 text-center text-[11px] text-neutral-600">
              counting…
            </p>
          )}
          {rows.map((r) => (
            <div
              key={r.id}
              className="relative overflow-hidden rounded-lg border border-white/5"
            >
              {/* fill bar scaled to the leader */}
              <div
                className="absolute inset-y-0 left-0 transition-all duration-300"
                style={{
                  width: `${(r.count / max) * 100}%`,
                  background: r.leading
                    ? "rgba(224,69,79,0.22)"
                    : "rgba(255,255,255,0.06)",
                }}
              />
              <div className="relative flex items-center gap-2 px-2 py-1.5">
                <PlayerFace name={r.name} size={18} />
                <span
                  className={`flex-1 truncate text-sm ${r.leading ? "text-red-200" : "text-neutral-200"}`}
                >
                  {r.name}
                </span>
                <span
                  className={`tabular-nums text-sm font-bold ${r.leading ? "text-red-300" : "text-neutral-300"}`}
                >
                  ×{r.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes voteTallyIn { from { opacity:0; transform:translate(-12px,-50%); } to { opacity:1; transform:translate(0,-50%); } }
        .votetally { animation: voteTallyIn .3s ease both; }
      `}</style>
    </div>
  );
}
