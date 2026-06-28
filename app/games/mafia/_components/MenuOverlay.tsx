'use client';

// Full-screen menu — a dark overlay over the scene; doubles as the entry and
// game-over screen. The lobby's settings (presets + role readout + advanced, spec
// §2.5) open in a dedicated POPUP so they get the full screen to breathe instead of
// cramming under the title; this owns the framing, the trigger button, the pity-odds
// readout, the dev-role picker, and the Play/Watch buttons.

import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import LobbySettings from './LobbySettings';
import { PRESET_META, type MafiaConfig, type PresetName } from '@/games/mafia/config';

export default function MenuOverlay({
  winner,
  devRole,
  setDevRole,
  configPatch,
  setConfigPatch,
  preset,
  setPreset,
  mafiaChance,
  onPlay,
  onWatch,
}: {
  winner: string | null;
  devRole: string;
  setDevRole: (role: string) => void;
  configPatch: Partial<MafiaConfig>;
  setConfigPatch: (p: Partial<MafiaConfig>) => void;
  preset: PresetName;
  setPreset: (p: PresetName) => void;
  mafiaChance: number;
  onPlay: () => void;
  onWatch: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const presetLabel = PRESET_META.find((p) => p.name === preset)?.label ?? 'Custom';

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center bg-gradient-to-b from-black/70 via-black/80 to-black/90 backdrop-blur-md">
      <p className="text-[11px] font-semibold uppercase tracking-[0.45em] text-amber-300/70">The Tribunal</p>
      <h1 className="mt-3 bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
        Agentic Mafia
      </h1>

      {winner ? (
        <p className="mt-5 text-sm font-semibold text-amber-400">{winner.toUpperCase()} prevails — run it back?</p>
      ) : (
        <p className="mt-5 max-w-md text-sm leading-relaxed text-neutral-400">
          A table of AI minds, and one of them is lying.
          <br />
          Watch them deliberate — or take a seat and bluff.
        </p>
      )}

      {/* Settings trigger — opens the popup. Shows the active gamestyle at a glance. */}
      <button
        onClick={() => setShowSettings(true)}
        className="mt-8 flex items-center gap-2 rounded-full border border-neutral-700/70 bg-neutral-950/60 px-4 py-2 text-[12px] text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Game settings
        <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">{presetLabel}</span>
      </button>

      {/* Pity odds: your personal chance of drawing Mafia when you take a seat —
          it climbs every game you don't, and resets the game you do. */}
      <p className="mt-5 text-[11px] tracking-wide text-neutral-500">
        Your odds of drawing <span className="font-semibold text-red-300/80">Mafia</span>:{' '}
        <span className="tabular-nums text-neutral-300">{mafiaChance}%</span>
      </p>

      <div className="mt-6 flex flex-col items-center gap-3">
        <button onClick={onPlay} className="tribunal-action tribunal-action--join min-w-[240px] text-center">
          {winner ? 'Play again' : 'Join the table'}
        </button>
        <button onClick={onWatch} className="tribunal-action min-w-[240px] text-center">
          Watch the agents
        </button>
        {process.env.NODE_ENV !== 'production' && (
          <label className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            dev role
            <select
              value={devRole}
              onChange={(e) => setDevRole(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-[11px] normal-case tracking-normal text-neutral-300"
            >
              <option value="">Random</option>
              <option value="mafia">Mafia</option>
              <option value="detective">Detective</option>
              <option value="doctor">Doctor</option>
              <option value="villager">Villager</option>
            </select>
          </label>
        )}
      </div>

      {/* ── Settings popup ──────────────────────────────────────────────── */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-700/70 bg-neutral-950/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
              <h2 className="text-sm font-semibold tracking-wide text-neutral-100">Game settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* scrollable body */}
            <div className="flex justify-center overflow-y-auto px-6 py-5">
              <LobbySettings patch={configPatch} setPatch={setConfigPatch} preset={preset} setPreset={setPreset} />
            </div>

            {/* footer */}
            <div className="flex justify-end border-t border-neutral-800 px-6 py-3">
              <button
                onClick={() => setShowSettings(false)}
                className="rounded-lg border border-amber-400/50 bg-amber-500/15 px-5 py-1.5 text-[12px] font-semibold text-amber-200 transition hover:bg-amber-500/25"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
