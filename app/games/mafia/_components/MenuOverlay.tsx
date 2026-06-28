'use client';

// Full-screen menu — a dark overlay over the scene; doubles as the entry and
// game-over screen. The lobby's settings surface (presets + toggles + role readout +
// advanced disclosure, spec §2.5) lives in <LobbySettings>; this owns the framing,
// the pity-odds readout, the dev-role picker, and the Play/Watch buttons.

import LobbySettings from './LobbySettings';
import type { MafiaConfig, PresetName } from '@/games/mafia/config';

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
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center overflow-y-auto px-6 py-10 text-center bg-gradient-to-b from-black/70 via-black/80 to-black/90 backdrop-blur-md">
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

      {/* Settings: presets, role composition, and every User/Advanced knob (§2). */}
      <LobbySettings patch={configPatch} setPatch={setConfigPatch} preset={preset} setPreset={setPreset} />

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
    </div>
  );
}
