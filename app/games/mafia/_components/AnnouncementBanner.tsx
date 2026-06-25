'use client';

import { PlayerFace } from '../TribunalScene';
import type { Announce } from '../types';

// Dramatic outcome announcement: death (red), doctor-save (teal), quiet (slate).
export default function AnnouncementBanner({ announce }: { announce: Announce }) {
  return (
    <div key={announce.eyebrow + announce.title} className="pointer-events-none absolute inset-x-0 top-[20%] z-30 flex justify-center px-6">
      <div
        className={`death-banner flex flex-col items-center gap-3 rounded-2xl border px-10 py-6 text-center shadow-2xl backdrop-blur-md ${
          announce.tone === 'death'
            ? 'border-red-500/30 bg-black/55 shadow-red-950/40'
            : announce.tone === 'save'
              ? 'border-teal-400/30 bg-black/55 shadow-teal-950/40'
              : 'border-neutral-500/25 bg-black/55 shadow-black/40'
        }`}
      >
        <span
          className={`text-[11px] font-semibold uppercase tracking-[0.45em] ${
            announce.tone === 'death' ? 'text-red-300/80' : announce.tone === 'save' ? 'text-teal-300/80' : 'text-neutral-400'
          }`}
        >
          {announce.eyebrow}
        </span>
        <span
          className={`flex items-center gap-3 text-4xl font-bold tracking-tight ${
            announce.tone === 'death' ? 'text-red-50' : announce.tone === 'save' ? 'text-teal-50' : 'text-neutral-100'
          }`}
        >
          {announce.face && <PlayerFace name={announce.face} size={48} />}
          {announce.title}
        </span>
        {announce.tone === 'death' && <span className="text-xs uppercase tracking-[0.3em] text-neutral-400">is dead</span>}
      </div>
      <style>{`
        @keyframes deathBannerIn {
          0% { opacity: 0; transform: translateY(-14px) scale(.92); }
          12% { opacity: 1; transform: translateY(0) scale(1.03); }
          22% { transform: scale(1); }
          82% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-8px) scale(.98); }
        }
        .death-banner { animation: deathBannerIn 4.2s ease forwards; }
      `}</style>
    </div>
  );
}
