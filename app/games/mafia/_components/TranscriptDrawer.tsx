'use client';

import type { RefObject } from 'react';
import FeedLine from './FeedLine';
import type { Feed } from '../types';

// Right drawer — the full transcript (toggled by the Transcript button).
export default function TranscriptDrawer({
  open,
  feed,
  nameOf,
  feedEndRef,
}: {
  open: boolean;
  feed: Feed[];
  nameOf: (id: string) => string;
  feedEndRef: RefObject<HTMLDivElement | null>;
}) {
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
        {feed.length === 0 && <p className="text-sm text-neutral-600">Nothing said yet.</p>}
        {feed.map((it, i) => (
          <FeedLine key={i} it={it} nameOf={nameOf} />
        ))}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}
