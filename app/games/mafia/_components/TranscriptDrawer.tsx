'use client';

import type { RefObject } from 'react';
import { PlayerFace } from '../TribunalScene';
import FeedLine from './FeedLine';
import type { Feed } from '../types';

// Right drawer — the full transcript (toggled by the Transcript button).
export default function TranscriptDrawer({
  open,
  feed,
  thinkingIds,
  phase,
  nameOf,
  feedEndRef,
}: {
  open: boolean;
  feed: Feed[];
  // Seats mid-LLM right now. We mirror the scene's overhead "thinking" bubble as a
  // transient row at the foot of the log, replaced by the real line when it lands —
  // so the transcript reads as a live conversation, not lines that just pop in.
  thinkingIds: string[];
  phase?: string;
  nameOf: (id: string) => string;
  feedEndRef: RefObject<HTMLDivElement | null>;
}) {
  // Only during discussion: that's the phase whose deliberation actually produces a
  // spoken line. Night/vote turns are silent, so a "thinking…" row there would just
  // appear and vanish with nothing said.
  // Also drop whoever just spoke: their `speak` lands a beat before their `thinking
  // off`, so without this their line and their "thinking…" row would flash together.
  const lastSpeaker = [...feed].reverse().find((f) => f.k === 'speak');
  const justSpoke = lastSpeaker?.k === 'speak' ? lastSpeaker.who : null;
  const thinking = (phase === 'DISCUSSION' ? thinkingIds : []).filter((id) => id !== justSpoke);

  return (
    <div
      className={`absolute inset-y-0 right-0 z-40 flex w-[340px] max-w-[85%] transform flex-col border-l border-neutral-800 bg-neutral-950/95 backdrop-blur transition-transform duration-300 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="border-b border-neutral-800 px-4 py-3">
        <h3 className="text-xs uppercase tracking-wider text-neutral-400">Full transcript</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {feed.length === 0 && thinking.length === 0 && <p className="text-sm text-neutral-600">Nothing said yet.</p>}
        {feed.map((it, i) => (
          <FeedLine key={i} it={it} nameOf={nameOf} />
        ))}
        {thinking.map((id) => (
          <ThinkingLine key={`thinking-${id}`} name={nameOf(id)} />
        ))}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}

// A transient "Name is thinking …" row — same layout as a spoken line so the real
// line slides in cleanly where the placeholder was.
function ThinkingLine({ name }: { name: string }) {
  return (
    <div className="flex items-start gap-2" style={{ animation: 'thinkRowIn .3s ease both' }}>
      <style>{`
        @keyframes thinkRowIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
        @keyframes thinkRowDot { 0%,100% { opacity:.2 } 50% { opacity:1 } }
      `}</style>
      <div className="opacity-60">
        <PlayerFace name={name} size={22} />
      </div>
      <p className="flex items-center gap-1.5 text-sm">
        <span className="font-semibold text-amber-200/60">{name}</span>
        <span className="italic text-neutral-500">is thinking</span>
        <span className="inline-flex gap-0.5">
          {[0, 1, 2].map((n) => (
            <span key={n} className="h-1 w-1 rounded-full bg-amber-300/70" style={{ animation: `thinkRowDot 1s ease ${n * 0.18}s infinite` }} />
          ))}
        </span>
      </p>
    </div>
  );
}
