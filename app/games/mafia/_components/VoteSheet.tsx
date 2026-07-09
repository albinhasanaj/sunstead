"use client";

import { Check, Gavel } from "lucide-react";
import { PlayerFace } from "../TribunalScene";

// ── Vote roster ───────────────────────────────────────────────────────────────
// Up for the whole vote phase. The scene gives you a top-down view of your real paper
// slip; here you click a name to "write" it on the slip and Confirm to lock it in. It
// then stays up as a status board — every seat that has locked in a vote gets a green
// check (who voted, never their choice), so you watch the table commit in real time.
export default function VoteSheet({
  players,
  targetIds,
  committed,
  totalVoters,
  youId,
  selected,
  canVote,
  confirmed,
  confirmedTarget,
  onPick,
  onConfirm,
}: {
  players: { id: string; name: string }[];
  targetIds: Set<string>;
  committed: string[];
  totalVoters: number;
  youId: string | null;
  selected: string | null;
  canVote: boolean;
  confirmed: boolean;
  confirmedTarget: string | null;
  onPick: (id: string) => void;
  onConfirm: () => void;
}) {
  const title = canVote
    ? "Cast your vote"
    : confirmed
      ? "Vote locked in"
      : "The table votes…";
  // Vote progress: how many living seats have committed a vote so far (who, never their
  // choice) — so you can see the wagon forming in real time.
  const votedCount = committed.length;
  // A confirmed voter picking a DIFFERENT name is changing their vote (Feature #2).
  const changing = confirmed && !!selected && selected !== confirmedTarget;

  return (
    <div className="votesheet pointer-events-none absolute right-4 top-1/2 z-50 -translate-y-1/2">
      <div className="pointer-events-auto flex w-52 max-w-[42vw] flex-col gap-2 rounded-2xl border border-amber-500/25 bg-neutral-950/80 p-3 font-mono shadow-2xl backdrop-blur-md">
        <p className="text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-300/85">
          {title}
        </p>

        {/* live vote progress bar — N / M seats have voted */}
        <div className="flex items-center gap-2 px-0.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-amber-400/70 transition-all duration-300"
              style={{
                width: `${totalVoters ? (votedCount / totalVoters) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
            {votedCount}/{totalVoters} voted
          </span>
        </div>

        <div className="flex flex-col gap-1">
          {players.map((p) => {
            const isYou = p.id === youId;
            const voted = committed.includes(p.id);
            const pickable = canVote && targetIds.has(p.id);
            const on = selected === p.id;
            return (
              <button
                key={p.id}
                onClick={pickable ? () => onPick(p.id) : undefined}
                disabled={!pickable}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm transition ${
                  on
                    ? "border-amber-400 bg-amber-500/20 text-amber-50"
                    : pickable
                      ? "border-neutral-800 bg-neutral-900/40 text-neutral-200 hover:border-neutral-600 hover:text-white"
                      : "border-transparent bg-neutral-900/20 text-neutral-400"
                } ${pickable ? "cursor-pointer" : "cursor-default"}`}
              >
                <PlayerFace name={p.name} size={20} />
                <span className="flex-1 truncate">
                  {p.name}
                  {isYou && <span className="text-neutral-500"> (you)</span>}
                </span>
                {voted && (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                    <Check className="h-3 w-3 text-emerald-400" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {canVote ? (
          <button
            onClick={onConfirm}
            disabled={confirmed ? !changing : !selected}
            className="mt-0.5 flex items-center justify-center gap-2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900/40 disabled:text-neutral-600"
          >
            <Gavel className="h-3.5 w-3.5" />
            {confirmed
              ? changing
                ? "Change vote"
                : "Vote locked in"
              : selected
                ? "Confirm vote"
                : "Pick a name"}
          </button>
        ) : (
          <p className="mt-0.5 text-center text-[10px] tracking-wide text-neutral-500">
            {confirmed ? "waiting for the table…" : "your turn is coming…"}
          </p>
        )}
      </div>

      <style>{`
        @keyframes voteSheetIn { from { opacity:0; transform:translate(16px,-50%); } to { opacity:1; transform:translate(0,-50%); } }
        .votesheet { animation: voteSheetIn .3s ease both; }
      `}</style>
    </div>
  );
}
