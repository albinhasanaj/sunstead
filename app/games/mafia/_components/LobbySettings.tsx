'use client';

// ── Lobby settings (spec §2.5) ────────────────────────────────────────────────
// The pre-game settings surface: a preset picker, User-tier toggles/steppers, a live
// role-composition readout, and an Advanced disclosure. It edits a Partial<MafiaConfig>
// and shows the resolved/clamped result (illegal combinations are reflected immediately
// rather than silently corrected after submit). The same config.ts that the server uses
// resolves and validates here — one source of truth for defaults, presets, and clamps.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  resolveConfig,
  roleComposition,
  PRESET_META,
  PRESETS,
  type MafiaConfig,
  type PresetName,
} from '@/games/mafia/config';

type Patch = Partial<MafiaConfig>;

export default function LobbySettings({
  patch,
  setPatch,
  preset,
  setPreset,
}: {
  patch: Patch;
  setPatch: (p: Patch) => void;
  preset: PresetName;
  setPreset: (p: PresetName) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // The authoritative, clamped config the server would produce from these inputs.
  const resolved = useMemo(() => resolveConfig(patch), [patch]);
  const comp = roleComposition(resolved);

  const set = <K extends keyof MafiaConfig>(key: K, value: MafiaConfig[K]) => setPatch({ ...patch, [key]: value });

  // Applying a preset replaces the patch with that preset's overrides (the user may
  // then fine-tune any field). Classic = back to defaults.
  const applyPreset = (name: PresetName) => {
    setPreset(name);
    setPatch({ ...PRESETS[name] });
  };

  return (
    <div className="mt-7 w-full max-w-md text-left">
      {/* ── Preset picker ─────────────────────────────────────────────── */}
      <Label>Gamestyle</Label>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {PRESET_META.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p.name)}
            title={p.blurb}
            className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
              preset === p.name
                ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                : 'border-neutral-700/70 bg-neutral-950/50 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Live role-composition readout ─────────────────────────────── */}
      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[11px] text-neutral-300">
        <span className="tabular-nums text-neutral-100">{comp.total} players</span> →{' '}
        <span className="text-red-300">{comp.mafia} Mafia</span>
        {comp.detective ? <>, <span className="text-sky-300">{comp.detective} Detective</span></> : null}
        {comp.doctor ? <>, <span className="text-teal-300">{comp.doctor} Doctor</span></> : null}
        , <span className="text-neutral-300">{comp.villager} Villager{comp.villager === 1 ? '' : 's'}</span>
      </div>

      {/* ── User-tier settings ────────────────────────────────────────── */}
      <div className="mt-4 space-y-3">
        <Stepper label="Table size" value={resolved.tableSize} min={5} max={15} onChange={(n) => set('tableSize', n)} />
        <Stepper label="Mafia" value={resolved.mafiaCount} min={1} max={Math.max(1, Math.floor((resolved.tableSize - 1) / 2))} onChange={(n) => set('mafiaCount', n)} />
        <Stepper label="Discussion rounds" value={resolved.discussionRounds} min={1} max={4} onChange={(n) => set('discussionRounds', n)} />

        <Toggle label="Detective" hint="Town gains a nightly investigation" value={resolved.enableDetective} onChange={(v) => set('enableDetective', v)} />
        <Toggle label="Doctor" hint="Town gains a nightly protection" value={resolved.enableDoctor} onChange={(v) => set('enableDoctor', v)} />
        <Toggle label="Doctor may self-protect" value={resolved.doctorSelfProtect} onChange={(v) => set('doctorSelfProtect', v)} />
        <Toggle label="Reveal role on death" hint="Flip dead players' roles face-up" value={resolved.revealRoleOnDeath} onChange={(v) => set('revealRoleOnDeath', v)} />
        <Toggle label="First-night kill" hint="Mafia kill on the very first night" value={resolved.firstNightKill} onChange={(v) => set('firstNightKill', v)} />
        <Toggle label="Allow no-lynch" hint="A day may end with no elimination" value={resolved.allowNoLynch} onChange={(v) => set('allowNoLynch', v)} />
        <Toggle label="Voice" hint="Spoken lines + pacing" value={resolved.voiceEnabled} onChange={(v) => set('voiceEnabled', v)} />

        <Choice
          label="AI difficulty"
          value={resolved.difficulty}
          options={[
            ['casual', 'Casual'],
            ['standard', 'Standard'],
            ['cunning', 'Cunning'],
          ]}
          onChange={(v) => set('difficulty', v as MafiaConfig['difficulty'])}
        />
        <Choice
          label="Day-vote tie"
          value={resolved.dayVoteTie}
          options={[
            ['random', 'Random'],
            ['no_lynch', 'No lynch'],
            ['revote', 'Revote'],
          ]}
          onChange={(v) => set('dayVoteTie', v as MafiaConfig['dayVoteTie'])}
        />
      </div>

      {/* ── Advanced disclosure ───────────────────────────────────────── */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300"
      >
        {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Advanced
      </button>
      {showAdvanced && (
        <div className="mt-3 space-y-3 border-t border-neutral-800 pt-3">
          <Toggle label="Doctor may repeat-protect" value={resolved.doctorRepeatProtect} onChange={(v) => set('doctorRepeatProtect', v)} />
          <Toggle label="Detective may self-investigate" value={resolved.detectiveSelfInvestigate} onChange={(v) => set('detectiveSelfInvestigate', v)} />
          <Toggle label="Memory recall (pgvector)" value={resolved.enableMemoryRecall} onChange={(v) => set('enableMemoryRecall', v)} />
          <Toggle label="Reactive discussion" hint="Urge-auction speaker order" value={resolved.reactiveDiscussion} onChange={(v) => set('reactiveDiscussion', v)} />
          <Toggle label="Parallel night" value={resolved.parallelNight} onChange={(v) => set('parallelNight', v)} />
          <Toggle label="Parallel vote" value={resolved.parallelVote} onChange={(v) => set('parallelVote', v)} />
          <Toggle label="Live urge (paid)" hint="Poll each seat's model for a hand-raise" value={resolved.liveUrge} onChange={(v) => set('liveUrge', v)} />
          <Choice
            label="Night-kill tie"
            value={resolved.nightKillTie}
            options={[
              ['random', 'Random'],
              ['no_kill', 'No kill'],
            ]}
            onChange={(v) => set('nightKillTie', v as MafiaConfig['nightKillTie'])}
          />
          <Stepper label="Context window" value={resolved.contextWindow} min={0} max={40} step={1} onChange={(n) => set('contextWindow', n)} />
          <Stepper label="Turn delay (ms)" value={resolved.turnDelayMs} min={0} max={5000} step={100} onChange={(n) => set('turnDelayMs', n)} />
          <Stepper label="Pace max (ms)" value={resolved.paceMaxMs} min={0} max={30000} step={1000} onChange={(n) => set('paceMaxMs', n)} />
          <label className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-neutral-300">Seed</span>
            <input
              value={patch.seed ?? ''}
              onChange={(e) => set('seed', e.target.value || undefined)}
              placeholder="(random)"
              className="w-32 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-[11px] text-neutral-300"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ── small controls ─────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-neutral-500">{children}</span>;
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-[12px] text-neutral-300">{label}</span>
        {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
      </span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${value ? 'bg-amber-500/70' : 'bg-neutral-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function Stepper({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-neutral-300">{label}</span>
      <div className="flex items-center gap-1.5">
        <StepBtn onClick={() => onChange(clamp(value - step))} disabled={value <= min}>−</StepBtn>
        <span className="w-12 text-center text-[12px] tabular-nums text-neutral-100">{value}</span>
        <StepBtn onClick={() => onChange(clamp(value + step))} disabled={value >= max}>+</StepBtn>
      </div>
    </div>
  );
}

function StepBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-6 w-6 rounded border border-neutral-700 bg-neutral-950 text-sm text-neutral-300 transition enabled:hover:border-neutral-500 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-neutral-300">{label}</span>
      <div className="flex items-center gap-1 rounded-full border border-neutral-700/70 bg-neutral-950/60 p-0.5">
        {options.map(([v, lbl]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded-full px-2 py-0.5 text-[11px] transition ${value === v ? 'bg-amber-500/20 text-amber-200' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}
