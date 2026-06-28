'use client';

// ── Lobby settings (spec §2.5) ────────────────────────────────────────────────
// The pre-game settings surface, tuned so a NEW player isn't scared: a preset row, a
// live role-composition readout, and a SMALL two-column set of the only knobs most
// people touch. Everything advanced hides behind the "Advanced" disclosure. Every
// control carries an (i) tooltip explaining what it does. It edits a Partial<MafiaConfig>
// and shows the resolved/clamped result, so illegal combinations correct live. The same
// config.ts the server uses resolves/validates here — one source of truth.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
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
  const maxMafia = Math.max(1, Math.floor((resolved.tableSize - 1) / 2));

  const set = <K extends keyof MafiaConfig>(key: K, value: MafiaConfig[K]) => setPatch({ ...patch, [key]: value });

  // Applying a preset replaces the patch with that preset's overrides (the user may
  // then fine-tune any field). Classic = back to defaults.
  const applyPreset = (name: PresetName) => {
    setPreset(name);
    setPatch({ ...PRESETS[name] });
  };

  return (
    <div className="w-full max-w-2xl text-left">
      {/* ── Preset picker ─────────────────────────────────────────────── */}
      <Label>Gamestyle</Label>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PRESET_META.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p.name)}
            title={p.blurb}
            className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-center transition ${
              preset === p.name
                ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                : 'border-neutral-700/70 bg-neutral-950/50 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100'
            }`}
          >
            <span className="text-[13px] font-semibold">{p.label}</span>
          </button>
        ))}
      </div>

      {/* ── Live role-composition readout ─────────────────────────────── */}
      <div className="mt-3.5 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2.5 text-center text-sm text-neutral-300">
        <span className="font-semibold tabular-nums text-neutral-100">{comp.total} players</span> →{' '}
        <span className="text-red-300">{comp.mafia} Mafia</span>
        {comp.detective ? <>, <span className="text-sky-300">{comp.detective} Detective</span></> : null}
        {comp.doctor ? <>, <span className="text-teal-300">{comp.doctor} Doctor</span></> : null}
        , <span className="text-neutral-300">{comp.villager} Villager{comp.villager === 1 ? '' : 's'}</span>
      </div>

      {/* ── The few settings most players actually touch (two columns) ── */}
      <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Choice
            label="AI difficulty"
            lead="How sharp the AI players are:"
            value={resolved.difficulty}
            options={[
              { value: 'casual', label: 'Casual', desc: 'plays it straight, minimal bluffing.' },
              { value: 'standard', label: 'Standard', desc: 'solid, balanced play.' },
              { value: 'cunning', label: 'Cunning', desc: 'bluffs, buses teammates, and counterclaims.' },
            ]}
            onChange={(v) => set('difficulty', v as MafiaConfig['difficulty'])}
          />
        </div>
        <Stepper label="Table size" hint="Total players at the table, including you in Play mode." value={resolved.tableSize} min={5} max={15} onChange={(n) => set('tableSize', n)} />
        <Stepper label="Mafia" hint="How many Mafia are hidden among the players. Always kept a minority of the table." value={resolved.mafiaCount} min={1} max={maxMafia} onChange={(n) => set('mafiaCount', n)} />
        <Toggle label="Detective" hint="Adds a Detective who secretly learns one player's alignment each night." value={resolved.enableDetective} onChange={(v) => set('enableDetective', v)} />
        <Toggle label="Doctor" hint="Adds a Doctor who secretly protects one player from the Mafia each night." value={resolved.enableDoctor} onChange={(v) => set('enableDoctor', v)} />
        <Toggle label="Reveal role on death" hint="When a player dies, show what role they were. Off keeps every role hidden." value={resolved.revealRoleOnDeath} onChange={(v) => set('revealRoleOnDeath', v)} />
        <Toggle label="Voice" hint="Speak the players' lines aloud and pace the game to the audio." value={resolved.voiceEnabled} onChange={(v) => set('voiceEnabled', v)} />
      </div>

      {/* ── Advanced disclosure (everything fiddly lives here) ─────────── */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400 hover:text-neutral-200"
      >
        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Advanced
      </button>
      {showAdvanced && (
        <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-4 border-t border-neutral-800 pt-4 sm:grid-cols-2">
          <Stepper label="Discussion rounds" hint="How many speaking passes the table gets each day before the vote." value={resolved.discussionRounds} min={1} max={4} onChange={(n) => set('discussionRounds', n)} />
          <Stepper label="Context window" hint="How many recent lines an AI sees before older talk is pulled from long-term memory. 0 shows everything." value={resolved.contextWindow} min={0} max={40} step={1} onChange={(n) => set('contextWindow', n)} />
          <Toggle label="First-night kill" hint="Let the Mafia kill on the very first night. Off gives town a fairer start." value={resolved.firstNightKill} onChange={(v) => set('firstNightKill', v)} />
          <Toggle label="Allow no-lynch" hint="Permit a day to end with nobody eliminated." value={resolved.allowNoLynch} onChange={(v) => set('allowNoLynch', v)} />
          <Toggle label="Doctor self-protect" hint="Let the Doctor shield themselves at night." value={resolved.doctorSelfProtect} onChange={(v) => set('doctorSelfProtect', v)} />
          <Toggle label="Doctor repeat-protect" hint="Let the Doctor protect the same player two nights in a row." value={resolved.doctorRepeatProtect} onChange={(v) => set('doctorRepeatProtect', v)} />
          <Toggle label="Detective self-investigate" hint="Let the Detective spend a night checking their own (already-known) alignment." value={resolved.detectiveSelfInvestigate} onChange={(v) => set('detectiveSelfInvestigate', v)} />
          <Toggle label="Memory recall" hint="AIs search this game's earlier statements (pgvector) to catch contradictions." value={resolved.enableMemoryRecall} onChange={(v) => set('enableMemoryRecall', v)} />
          <Toggle label="Reactive discussion" hint="Whoever most wants the floor speaks next, instead of a fixed seat order." value={resolved.reactiveDiscussion} onChange={(v) => set('reactiveDiscussion', v)} />
          <Toggle label="Live urge (paid)" hint="Poll each AI's own model for how badly it wants to talk. Costs extra API calls." value={resolved.liveUrge} onChange={(v) => set('liveUrge', v)} />
          <Toggle label="Hero lines (v3, paid)" hint="The rare, most intense line gets a richer, higher-latency voice (eleven_v3). Capped per round; normal lines stay fast." value={resolved.heroLineModel === 'eleven_v3'} onChange={(v) => set('heroLineModel', v ? 'eleven_v3' : undefined)} />
          <Toggle label="Parallel night" hint="Resolve all night actions at once instead of one at a time (faster)." value={resolved.parallelNight} onChange={(v) => set('parallelNight', v)} />
          <Toggle label="Parallel vote" hint="Collect all votes simultaneously instead of in turn (faster)." value={resolved.parallelVote} onChange={(v) => set('parallelVote', v)} />
          <div className="sm:col-span-2">
            <Choice
              label="Day-vote tie"
              lead="When the day vote ends in a tie:"
              value={resolved.dayVoteTie}
              options={[
                { value: 'random', label: 'Random', desc: 'one of the tied players is chosen at random.' },
                { value: 'no_lynch', label: 'No lynch', desc: 'nobody is eliminated that day.' },
                { value: 'revote', label: 'Revote', desc: 'a runoff is held between the tied players.' },
              ]}
              onChange={(v) => set('dayVoteTie', v as MafiaConfig['dayVoteTie'])}
            />
          </div>
          <div className="sm:col-span-2">
            <Choice
              label="Night-kill tie"
              lead="When the Mafia's kill votes tie:"
              value={resolved.nightKillTie}
              options={[
                { value: 'random', label: 'Random', desc: 'one of the tied targets is killed.' },
                { value: 'no_kill', label: 'No kill', desc: 'nobody dies that night.' },
              ]}
              onChange={(v) => set('nightKillTie', v as MafiaConfig['nightKillTie'])}
            />
          </div>
          <Stepper label="Turn delay (ms)" hint="Extra pause added after each AI turn, to slow the game down." value={resolved.turnDelayMs} min={0} max={5000} step={100} onChange={(n) => set('turnDelayMs', n)} />
          <Stepper label="Pace max (ms)" hint="Longest the game waits for a line's audio before moving on." value={resolved.paceMaxMs} min={0} max={30000} step={1000} onChange={(n) => set('paceMaxMs', n)} />
          <label className="flex items-center justify-between gap-3 sm:col-span-2">
            <FieldLabel label="Seed" hint="Fixes the randomness so the same setup replays identically. Leave blank for a fresh random game." />
            <input
              value={patch.seed ?? ''}
              onChange={(e) => set('seed', e.target.value || undefined)}
              placeholder="(random)"
              className="w-44 rounded border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-right text-[13px] text-neutral-200"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ── small controls ─────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-neutral-400">{children}</span>;
}

// An (i) icon that reveals a description on hover/focus. Pure CSS via group-hover, so
// no state; positioned to open down-right of the icon to avoid clipping at card edges.
function Tip({ content }: { content: React.ReactNode }) {
  return (
    <span className="group relative inline-flex" tabIndex={0}>
      <Info className="h-3.5 w-3.5 cursor-help text-neutral-500 transition group-hover:text-neutral-200 group-focus:text-neutral-200" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] font-normal normal-case leading-snug tracking-normal text-neutral-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}

// A field label with an optional info tooltip beside it.
function FieldLabel({ label, hint }: { label: string; hint?: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-neutral-200">
      {label}
      {hint != null && <Tip content={hint} />}
    </span>
  );
}

// Build a tooltip body that names each option ("Random: …", "No lynch: …"), optionally
// led by a one-line summary — so a multi-choice setting explains every value, not just
// the control as a whole.
function optionTip(lead: string | undefined, options: { label: string; desc: string }[]): React.ReactNode {
  return (
    <span className="flex flex-col gap-1">
      {lead && <span className="text-neutral-400">{lead}</span>}
      {options.map((o) => (
        <span key={o.label}>
          <span className="font-semibold text-neutral-100">{o.label}:</span> {o.desc}
        </span>
      ))}
    </span>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <FieldLabel label={label} hint={hint} />
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${value ? 'bg-amber-500/70' : 'bg-neutral-700'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${value ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function Stepper({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center justify-between gap-3">
      <FieldLabel label={label} hint={hint} />
      <div className="flex items-center gap-2">
        <StepBtn onClick={() => onChange(clamp(value - step))} disabled={value <= min}>−</StepBtn>
        <span className="w-12 text-center text-sm tabular-nums text-neutral-100">{value}</span>
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
      className="h-7 w-7 rounded border border-neutral-700 bg-neutral-950 text-base text-neutral-200 transition enabled:hover:border-neutral-500 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

type Opt<T extends string> = { value: T; label: string; desc: string };
function Choice<T extends string>({ label, lead, value, options, onChange }: { label: string; lead?: string; value: T; options: Opt<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* The tooltip describes EVERY option, one per line (e.g. "Random: …"). */}
      <FieldLabel label={label} hint={optionTip(lead, options)} />
      <div className="flex items-center gap-1 rounded-full border border-neutral-700/70 bg-neutral-950/60 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.desc}
            className={`rounded-full px-3 py-1 text-[13px] transition ${value === o.value ? 'bg-amber-500/20 text-amber-200' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
