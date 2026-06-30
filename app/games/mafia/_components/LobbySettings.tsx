'use client';

// ── Lobby settings (spec §2.5) — a TIERED config editor ───────────────────────
// A first-time host sees ~4 controls; power users keep everything. Three tiers:
//   Tier 1  always visible: preset row, AI difficulty, Voice, the live role-
//           composition readout, and a "Customize roster & rules" disclosure.
//   Tier 2  (Customize) collapsed: the player-facing knobs, grouped — Table,
//           Roles & abilities, House rules, Tie-breaks, Game speed.
//   Tier 3  ("Advanced (engine)") collapsed under Tier 2: the engine knobs that
//           difficulty/speed normally set (rounds, context window, memory, …) plus
//           a separate Paid-features group. Nothing is removed — only reorganized.
//
// The UI is a pure VIEW/EDITOR over a ConfigSelection. No setting lives in component
// state: every control reads the RESOLVED config and writes back to the draft
// selection. resolveConfig — the same function the server runs — defaults/clamps so
// illegal combinations correct live. A field shows a "modified" dot when the host has
// explicitly overridden it away from the active preset/difficulty.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import {
  resolveConfig,
  roleComposition,
  presetDefaults,
  selectionForPreset,
  PRESET_META,
  type ConfigSelection,
  type MafiaConfig,
  type PresetName,
} from '@/games/mafia/config';

export default function LobbySettings({
  selection,
  setSelection,
}: {
  selection: ConfigSelection;
  setSelection: (s: ConfigSelection) => void;
}) {
  const [showCustomize, setShowCustomize] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // The authoritative, clamped config the server would produce from this selection.
  const resolved = useMemo(() => resolveConfig(selection), [selection]);
  const comp = roleComposition(resolved);
  const maxMafia = Math.max(1, Math.floor((resolved.tableSize - 1) / 2));

  // A field is "modified" when the host explicitly overrode it (userOverrides is
  // sparse — it only holds fields they changed). gameSpeed is a selection field, so
  // it's "modified" when it differs from the active preset's default speed.
  const modified = (key: keyof MafiaConfig) => key in selection.userOverrides;
  const speedModified = selection.gameSpeed !== presetDefaults(selection.preset).gameSpeed;

  // Write a single override into the SPARSE bag — deleting the key when the value is
  // undefined so the bag never grows phantom entries (keeps the "modified" dot honest).
  const setOverride = <K extends keyof MafiaConfig>(key: K, value: MafiaConfig[K] | undefined) => {
    const next: Partial<MafiaConfig> = { ...selection.userOverrides };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setSelection({ ...selection, userOverrides: next });
  };
  const setDifficulty = (difficulty: MafiaConfig['difficulty']) => setSelection({ ...selection, difficulty });
  const setGameSpeed = (gameSpeed: ConfigSelection['gameSpeed']) => setSelection({ ...selection, gameSpeed });

  // Selecting a preset resets to that preset's defaults. If the host has unsaved
  // overrides, confirm before discarding them (spec §2.5).
  const applyPreset = (name: PresetName) => {
    const dirty = Object.keys(selection.userOverrides).length > 0;
    const label = PRESET_META.find((p) => p.name === name)?.label ?? name;
    if (dirty && name !== selection.preset && !confirm(`Reset custom changes to ${label}?`)) return;
    setSelection(selectionForPreset(name));
  };

  return (
    <div className="w-full max-w-2xl text-left">
      {/* ═══ Tier 1 — the default view (preset · difficulty · voice · summary) ═══ */}

      {/* Preset picker */}
      <Label>Gamestyle</Label>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PRESET_META.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p.name)}
            title={p.blurb}
            className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-center transition ${
              selection.preset === p.name
                ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                : 'border-neutral-700/70 bg-neutral-950/50 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100'
            }`}
          >
            <span className="text-[13px] font-semibold">{p.label}</span>
          </button>
        ))}
      </div>

      {/* Live role-composition readout — villager count is DERIVED, shown read-only. */}
      <div className="mt-3.5 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2.5 text-center text-sm text-neutral-300">
        <span className="font-semibold tabular-nums text-neutral-100">{comp.total} players</span> →{' '}
        <span className="text-red-300">{comp.mafia} Mafia</span>
        {comp.detective ? <>, <span className="text-sky-300">{comp.detective} Detective</span></> : null}
        {comp.doctor ? <>, <span className="text-teal-300">{comp.doctor} Doctor</span></> : null}
        , <span className="text-neutral-300">{comp.villager} Villager{comp.villager === 1 ? '' : 's'}</span>
      </div>

      {/* AI difficulty + Voice — the only two knobs in the default view. */}
      <div className="mt-5 flex flex-col gap-5">
        <Choice
          label="AI difficulty"
          lead="How sharp the AI players are:"
          value={resolved.difficulty}
          options={[
            { value: 'casual', label: 'Casual', desc: 'plays it straight, minimal bluffing.' },
            { value: 'standard', label: 'Standard', desc: 'solid, balanced play.' },
            { value: 'cunning', label: 'Cunning', desc: 'bluffs, buses teammates, and counterclaims.' },
          ]}
          onChange={(v) => setDifficulty(v as MafiaConfig['difficulty'])}
        />
        <Toggle label="Voice" hint="Speak the players' lines aloud and pace the game to the audio." value={resolved.voiceEnabled} modified={modified('voiceEnabled')} onChange={(v) => setOverride('voiceEnabled', v)} />
      </div>

      {/* ═══ Tier 2 — Customize roster & rules (collapsed, grouped) ═══ */}
      <Disclosure
        open={showCustomize}
        onToggle={() => setShowCustomize((v) => !v)}
        label="Customize roster & rules"
      />
      {showCustomize && (
        <div className="mt-4 flex flex-col gap-6 border-t border-neutral-800 pt-4">
          <Section title="Table">
            <Stepper label="Table size" hint="Total players at the table, including you in Play mode." value={resolved.tableSize} min={5} max={15} modified={modified('tableSize')} onChange={(n) => setOverride('tableSize', n)} />
            <Stepper label="Mafia" hint="How many Mafia are hidden among the players. Always kept a minority of the table." value={resolved.mafiaCount} min={1} max={maxMafia} modified={modified('mafiaCount')} onChange={(n) => setOverride('mafiaCount', n)} />
          </Section>

          <Section title="Roles & abilities">
            <Toggle label="Detective" hint="Adds a Detective who secretly learns one player's alignment each night." value={resolved.enableDetective} modified={modified('enableDetective')} onChange={(v) => setOverride('enableDetective', v)} />
            <Toggle label="Doctor" hint="Adds a Doctor who secretly protects one player from the Mafia each night." value={resolved.enableDoctor} modified={modified('enableDoctor')} onChange={(v) => setOverride('enableDoctor', v)} />
            <Toggle label="Doctor self-protect" hint="Let the Doctor shield themselves at night." value={resolved.doctorSelfProtect} modified={modified('doctorSelfProtect')} onChange={(v) => setOverride('doctorSelfProtect', v)} />
            <Toggle label="Doctor repeat-protect" hint="Let the Doctor protect the same player two nights in a row." value={resolved.doctorRepeatProtect} modified={modified('doctorRepeatProtect')} onChange={(v) => setOverride('doctorRepeatProtect', v)} />
            <Toggle label="Detective self-investigate" hint="Let the Detective spend a night checking their own (already-known) alignment." value={resolved.detectiveSelfInvestigate} modified={modified('detectiveSelfInvestigate')} onChange={(v) => setOverride('detectiveSelfInvestigate', v)} />
          </Section>

          <Section title="House rules">
            <Toggle label="First-night kill" hint="Let the Mafia kill on the very first night. Off gives town a fairer start." value={resolved.firstNightKill} modified={modified('firstNightKill')} onChange={(v) => setOverride('firstNightKill', v)} />
            <Toggle label="Allow no-lynch" hint="Permit a day to end with nobody eliminated." value={resolved.allowNoLynch} modified={modified('allowNoLynch')} onChange={(v) => setOverride('allowNoLynch', v)} />
            <Toggle label="Reveal role on death" hint="When a player dies, show what role they were. Off keeps every role hidden." value={resolved.revealRoleOnDeath} modified={modified('revealRoleOnDeath')} onChange={(v) => setOverride('revealRoleOnDeath', v)} />
          </Section>

          <Section title="Tie-breaks">
            <Choice
              label="Day-vote tie"
              lead="When the day vote ends in a tie:"
              value={resolved.dayVoteTie}
              modified={modified('dayVoteTie')}
              options={[
                { value: 'random', label: 'Random', desc: 'one of the tied players is chosen at random.' },
                { value: 'no_lynch', label: 'No lynch', desc: 'nobody is eliminated that day.' },
                { value: 'revote', label: 'Revote', desc: 'a runoff is held between the tied players.' },
              ]}
              onChange={(v) => setOverride('dayVoteTie', v as MafiaConfig['dayVoteTie'])}
            />
            <Choice
              label="Night-kill tie"
              lead="When the Mafia's kill votes tie:"
              value={resolved.nightKillTie}
              modified={modified('nightKillTie')}
              options={[
                { value: 'random', label: 'Random', desc: 'one of the tied targets is killed.' },
                { value: 'no_kill', label: 'No kill', desc: 'nobody dies that night.' },
              ]}
              onChange={(v) => setOverride('nightKillTie', v as MafiaConfig['nightKillTie'])}
            />
          </Section>

          <Section title="Game speed">
            {/* Player-language pacing — maps to the raw turnDelay/paceMax ms (Tier 3). */}
            <Choice
              label="Game speed"
              lead="How briskly the game moves:"
              value={selection.gameSpeed}
              modified={speedModified}
              options={[
                { value: 'relaxed', label: 'Relaxed', desc: 'a longer beat between turns; lingers on each line.' },
                { value: 'normal', label: 'Normal', desc: 'the standard pace.' },
                { value: 'fast', label: 'Fast', desc: 'snappier; waits less on audio.' },
              ]}
              onChange={(v) => setGameSpeed(v as ConfigSelection['gameSpeed'])}
            />
          </Section>

          {/* ═══ Tier 3 — Advanced (engine) · buried under Customize ═══ */}
          <div className="border-t border-neutral-800 pt-4">
            <Disclosure
              open={showAdvanced}
              onToggle={() => setShowAdvanced((v) => !v)}
              label="Advanced (engine)"
            />
            {showAdvanced && (
              <div className="mt-4 flex flex-col gap-6">
                <p className="text-[12px] leading-snug text-neutral-500">
                  These are normally set by AI difficulty and Game speed — you rarely need to touch them by hand.
                </p>
                <Section title="Engine">
                  <Stepper label="Discussion rounds" hint="How many speaking passes the table gets each day before the vote." value={resolved.discussionRounds} min={1} max={4} modified={modified('discussionRounds')} onChange={(n) => setOverride('discussionRounds', n)} />
                  <Stepper label="Context window" hint="How many recent lines an AI sees before older talk is pulled from long-term memory. 0 shows everything." value={resolved.contextWindow} min={0} max={40} modified={modified('contextWindow')} onChange={(n) => setOverride('contextWindow', n)} />
                  <Toggle label="Memory recall" hint="AIs search this game's earlier statements (pgvector) to catch contradictions." value={resolved.enableMemoryRecall} modified={modified('enableMemoryRecall')} onChange={(v) => setOverride('enableMemoryRecall', v)} />
                  <Toggle label="Reactive discussion" hint="Whoever most wants the floor speaks next, instead of a fixed seat order." value={resolved.reactiveDiscussion} modified={modified('reactiveDiscussion')} onChange={(v) => setOverride('reactiveDiscussion', v)} />
                  <Toggle label="Parallel night" hint="Resolve all night actions at once instead of one at a time (faster)." value={resolved.parallelNight} modified={modified('parallelNight')} onChange={(v) => setOverride('parallelNight', v)} />
                  <Toggle label="Parallel vote" hint="Collect all votes simultaneously instead of in turn (faster)." value={resolved.parallelVote} modified={modified('parallelVote')} onChange={(v) => setOverride('parallelVote', v)} />
                  <Stepper label="Turn delay (ms)" hint="Extra pause added after each AI turn, to slow the game down. Set by Game speed." value={resolved.turnDelayMs} min={0} max={5000} step={100} modified={modified('turnDelayMs')} onChange={(n) => setOverride('turnDelayMs', n)} />
                  <Stepper label="Pace max (ms)" hint="Longest the game waits for a line's audio before moving on. Set by Game speed." value={resolved.paceMaxMs} min={0} max={30000} step={1000} modified={modified('paceMaxMs')} onChange={(n) => setOverride('paceMaxMs', n)} />
                  <label className="flex items-center justify-between gap-3">
                    <FieldLabel label="Seed" hint="Fixes the randomness so the same setup replays identically. Leave blank for a fresh random game." modified={modified('seed')} />
                    <input
                      value={selection.userOverrides.seed ?? ''}
                      onChange={(e) => setOverride('seed', e.target.value || undefined)}
                      placeholder="(random)"
                      className="w-44 rounded border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-right text-[13px] text-neutral-200"
                    />
                  </label>
                </Section>

                <Section title="Paid features">
                  <Toggle label="Live urge (paid)" hint="Poll each AI's own model for how badly it wants to talk. Costs extra API calls." value={resolved.liveUrge} modified={modified('liveUrge')} onChange={(v) => setOverride('liveUrge', v)} />
                  <Toggle label="Hero lines (v3, paid)" hint="The rare, most intense line gets a richer, higher-latency voice (eleven_v3). Capped per round; normal lines stay fast." value={resolved.heroLineModel === 'eleven_v3'} modified={modified('heroLineModel')} onChange={(v) => setOverride('heroLineModel', v ? 'eleven_v3' : undefined)} />
                </Section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── small controls ─────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-neutral-400">{children}</span>;
}

// A labeled group of fields (Tier 2/3 sections). Renders its heading then a tidy
// two-column grid on wider viewports, single-column on mobile.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{title}</Label>
      <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

// A real <button> disclosure toggle with aria-expanded (keyboard-navigable).
function Disclosure({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mt-5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400 transition hover:text-neutral-200"
    >
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      {label}
    </button>
  );
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

// A field label with an optional info tooltip and a subtle "modified" dot shown when
// the value differs from the active preset/difficulty.
function FieldLabel({ label, hint, modified }: { label: string; hint?: React.ReactNode; modified?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-neutral-200">
      {modified && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label="modified from preset" title="Modified from preset" />}
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

function Toggle({ label, hint, value, modified, onChange }: { label: string; hint?: string; value: boolean; modified?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <FieldLabel label={label} hint={hint} modified={modified} />
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

function Stepper({ label, hint, value, min, max, step = 1, modified, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; modified?: boolean; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center justify-between gap-3">
      <FieldLabel label={label} hint={hint} modified={modified} />
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
function Choice<T extends string>({ label, lead, value, options, modified, onChange }: { label: string; lead?: string; value: T; options: Opt<T>[]; modified?: boolean; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* The tooltip describes EVERY option, one per line (e.g. "Random: …"). */}
      <FieldLabel label={label} hint={optionTip(lead, options)} modified={modified} />
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
