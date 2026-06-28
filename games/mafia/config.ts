// ── MafiaConfig — the single source of truth for game-affecting settings ────────
// Spec §2. Every tunable that changes how a game plays lives here. It is resolved
// ONCE per game (resolveConfig), stamped onto state.meta.config by setup(), and read
// from there by ALL game logic. No game-logic file (phases/tools/prompts/index/
// orchestrator) reads process.env for behavior — only THIS file may consult env, and
// only to seed a default (spec §2.6). The file is dependency-free (no server-only
// imports) so the lobby UI can import the same defaults, presets, and validation.

export type Difficulty = 'casual' | 'standard' | 'cunning';
export type DayVoteTie = 'random' | 'no_lynch' | 'revote';
export type NightKillTie = 'random' | 'no_kill';

export interface MafiaConfig {
  // — Table —
  tableSize: number; // total seats incl. the human in play mode
  mafiaCount: number; // clamped to a strict minority (§2.4.1)

  // — Roles —
  enableDetective: boolean;
  enableDoctor: boolean;
  doctorSelfProtect: boolean;
  doctorRepeatProtect: boolean; // may the Doctor shield the same seat two nights running
  detectiveSelfInvestigate: boolean;

  // — Rules —
  firstNightKill: boolean; // does the Mafia kill on round 1's night
  revealRoleOnDeath: boolean;
  allowNoLynch: boolean; // may a day end with no elimination
  dayVoteTie: DayVoteTie;
  nightKillTie: NightKillTie;
  discussionRounds: number; // speaking passes per discussion (1–4)

  // — AI —
  difficulty: Difficulty; // selects the prompt variant (§8.4)
  contextWindow: number; // visible transcript lines before recall kicks in (0 = unlimited)
  enableMemoryRecall: boolean; // pgvector contradiction surfacing
  reactiveDiscussion: boolean; // urge-auction scheduler vs fixed seat order
  parallelNight: boolean; // resolve night actions concurrently
  parallelVote: boolean; // resolve votes concurrently
  liveUrge: boolean; // paid: poll each seat's model for a hand-raise
  modelOverride?: string; // force every seat onto one model (else per-seat)

  // — Pacing / presentation —
  turnTimeoutMs: number;
  turnDelayMs: number;
  paceMaxMs: number;
  voiceEnabled: boolean;

  // — Determinism (§10) —
  seed?: string; // a stable seed for reproducible replay; auto-generated if unset
}

// Clamp helpers ----------------------------------------------------------------
const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
};
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt);

// Env-seeded defaults. process.env may only SEED a default here (spec §2.6); no
// other file reads it for behavior. This preserves the old MAFIA_* workflows as
// mere defaults that any per-game config field overrides.
function envDefaults(): Partial<MafiaConfig> {
  const env = (typeof process !== 'undefined' && process.env) || ({} as NodeJS.ProcessEnv);
  const d: Partial<MafiaConfig> = {};
  if (env.MAFIA_PARALLEL === '0') {
    d.parallelNight = false;
    d.parallelVote = false;
  }
  if (env.MAFIA_DISCUSSION === 'classic') d.reactiveDiscussion = false;
  if (env.MAFIA_LIVE_URGE === '1') d.liveUrge = true;
  if (env.MAFIA_MODEL) d.modelOverride = env.MAFIA_MODEL;
  if (env.MAFIA_CONTEXT_WINDOW != null && env.MAFIA_CONTEXT_WINDOW !== '') d.contextWindow = Number(env.MAFIA_CONTEXT_WINDOW);
  if (env.MAFIA_TURN_TIMEOUT_MS) d.turnTimeoutMs = Number(env.MAFIA_TURN_TIMEOUT_MS);
  if (env.MAFIA_TURN_DELAY_MS) d.turnDelayMs = Number(env.MAFIA_TURN_DELAY_MS);
  if (env.MAFIA_PACE_MAX_MS) d.paceMaxMs = Number(env.MAFIA_PACE_MAX_MS);
  return d;
}

// Default Mafia count for a table size when the caller doesn't pin it (§2.2).
// Scales up to a big 15-seat table: 3 Mafia is the classic count there (with a
// Detective + Doctor that leaves 10 Townspeople).
export function defaultMafiaCount(tableSize: number): number {
  return tableSize <= 5 ? 1 : tableSize <= 8 ? 2 : tableSize <= 12 ? 3 : tableSize <= 15 ? 3 : 4;
}

// The static (non-env) defaults. Role/mafia defaults that depend on tableSize are
// filled in resolveConfig once the size is known.
const STATIC_DEFAULTS: Omit<MafiaConfig, 'tableSize' | 'mafiaCount' | 'enableDetective' | 'enableDoctor'> = {
  doctorSelfProtect: true,
  doctorRepeatProtect: false,
  detectiveSelfInvestigate: false,
  firstNightKill: false,
  revealRoleOnDeath: false,
  allowNoLynch: false,
  dayVoteTie: 'random',
  nightKillTie: 'random',
  discussionRounds: 2,
  difficulty: 'standard',
  contextWindow: 15,
  enableMemoryRecall: true,
  reactiveDiscussion: true,
  parallelNight: true,
  parallelVote: true,
  liveUrge: false,
  turnTimeoutMs: 30000,
  turnDelayMs: 0,
  paceMaxMs: 14000,
  voiceEnabled: true,
};

// ── Presets (§2.3) — named partial patches the lobby applies in one click ──────
export const PRESETS: Record<string, Partial<MafiaConfig>> = {
  classic: {},
  casual: { revealRoleOnDeath: true, allowNoLynch: true, difficulty: 'casual', discussionRounds: 3 },
  hardcore: { revealRoleOnDeath: false, difficulty: 'cunning', firstNightKill: true, doctorRepeatProtect: false },
  chaos: { mafiaCount: 3, tableSize: 9, discussionRounds: 1, dayVoteTie: 'random', liveUrge: true },
  speedrun: { discussionRounds: 1, parallelNight: true, parallelVote: true, turnDelayMs: 0, voiceEnabled: false },
  showcase: { voiceEnabled: true, paceMaxMs: 14000, turnDelayMs: 800, reactiveDiscussion: true },
  // A full 15-seat table (3 Mafia, Detective, Doctor, 10 Townspeople) — the model
  // battle royale, where every distinct lab takes a seat and we see who survives.
  battle: { tableSize: 15, mafiaCount: 3, enableDetective: true, enableDoctor: true, discussionRounds: 2, difficulty: 'cunning' },
};
export type PresetName = keyof typeof PRESETS;

export const PRESET_META: { name: PresetName; label: string; blurb: string }[] = [
  { name: 'classic', label: 'Classic', blurb: 'Balanced default' },
  { name: 'casual', label: 'Casual', blurb: 'Forgiving, easy to read' },
  { name: 'hardcore', label: 'Hardcore', blurb: 'Hidden, ruthless AIs' },
  { name: 'chaos', label: 'Chaos', blurb: 'Big, fast, unpredictable' },
  { name: 'speedrun', label: 'Speedrun', blurb: 'Minimal latency' },
  { name: 'showcase', label: 'Showcase', blurb: 'Slow, voiced, dramatic' },
  { name: 'battle', label: 'Battle', blurb: '15 seats, every model' },
];

// Role composition derived from a resolved config — used by setup() to deal roles
// and by the lobby's live readout. Specials are TOWN, so they never worsen parity.
export interface RoleComposition {
  mafia: number;
  detective: number;
  doctor: number;
  villager: number;
  total: number;
}
export function roleComposition(c: Pick<MafiaConfig, 'tableSize' | 'mafiaCount' | 'enableDetective' | 'enableDoctor'>): RoleComposition {
  const mafia = c.mafiaCount;
  const detective = c.enableDetective ? 1 : 0;
  const doctor = c.enableDoctor ? 1 : 0;
  const villager = Math.max(0, c.tableSize - mafia - detective - doctor);
  return { mafia, detective, doctor, villager, total: c.tableSize };
}

// ── resolveConfig — the one place a config is fully defaulted, clamped, validated ─
// Idempotent: passing an already-resolved config returns an equivalent one, so it's
// safe to run in the API route (for validation + logging) AND again in setup().
export function resolveConfig(input: Partial<MafiaConfig> = {}): MafiaConfig {
  const seed = { ...STATIC_DEFAULTS, ...envDefaults() };

  // — Table size first; mafia/role defaults derive from it. —
  const tableSize = clampInt(input.tableSize, 5, 15, 6);

  // mafiaCount: default by size, then clamp to a strict minority (§2.4.1):
  // mafiaCount ≤ floor((tableSize − 1) / 2), and ≥ 1.
  const wantMafia = input.mafiaCount != null ? input.mafiaCount : defaultMafiaCount(tableSize);
  const mafiaCount = clampInt(wantMafia, 1, Math.floor((tableSize - 1) / 2), defaultMafiaCount(tableSize));

  // Specials are optional and default-on by table size, but may only be enabled if a
  // Villager seat remains afterward (§2.4.2). Drop the Doctor before the Detective.
  let enableDetective = bool(input.enableDetective, tableSize >= 5);
  let enableDoctor = bool(input.enableDoctor, tableSize >= 6);
  const villagersWith = (det: boolean, doc: boolean) => tableSize - mafiaCount - (det ? 1 : 0) - (doc ? 1 : 0);
  if (villagersWith(enableDetective, enableDoctor) < 1 && enableDoctor) enableDoctor = false;
  if (villagersWith(enableDetective, enableDoctor) < 1 && enableDetective) enableDetective = false;

  // contextWindow: 0 (unlimited) or ≥ 4; values in 1..3 thrash recall, so bump to 4.
  let contextWindow = input.contextWindow != null ? Math.round(Number(input.contextWindow)) : (seed.contextWindow as number);
  if (!Number.isFinite(contextWindow) || contextWindow < 0) contextWindow = 15;
  if (contextWindow > 0 && contextWindow < 4) contextWindow = 4;

  const out: MafiaConfig = {
    tableSize,
    mafiaCount,
    enableDetective,
    enableDoctor,
    doctorSelfProtect: bool(input.doctorSelfProtect, seed.doctorSelfProtect as boolean),
    doctorRepeatProtect: bool(input.doctorRepeatProtect, seed.doctorRepeatProtect as boolean),
    detectiveSelfInvestigate: bool(input.detectiveSelfInvestigate, seed.detectiveSelfInvestigate as boolean),
    firstNightKill: bool(input.firstNightKill, seed.firstNightKill as boolean),
    revealRoleOnDeath: bool(input.revealRoleOnDeath, seed.revealRoleOnDeath as boolean),
    allowNoLynch: bool(input.allowNoLynch, seed.allowNoLynch as boolean),
    dayVoteTie: oneOf(input.dayVoteTie, ['random', 'no_lynch', 'revote'] as const, seed.dayVoteTie as DayVoteTie),
    nightKillTie: oneOf(input.nightKillTie, ['random', 'no_kill'] as const, seed.nightKillTie as NightKillTie),
    discussionRounds: clampInt(input.discussionRounds, 1, 4, seed.discussionRounds as number),
    difficulty: oneOf(input.difficulty, ['casual', 'standard', 'cunning'] as const, seed.difficulty as Difficulty),
    contextWindow,
    enableMemoryRecall: bool(input.enableMemoryRecall, seed.enableMemoryRecall as boolean),
    reactiveDiscussion: bool(input.reactiveDiscussion, seed.reactiveDiscussion as boolean),
    parallelNight: bool(input.parallelNight, seed.parallelNight as boolean),
    parallelVote: bool(input.parallelVote, seed.parallelVote as boolean),
    liveUrge: bool(input.liveUrge, seed.liveUrge as boolean),
    modelOverride: typeof input.modelOverride === 'string' && input.modelOverride.trim() ? input.modelOverride.trim() : (seed.modelOverride as string | undefined),
    turnTimeoutMs: clampInt(input.turnTimeoutMs, 5000, 120000, seed.turnTimeoutMs as number),
    turnDelayMs: clampInt(input.turnDelayMs, 0, 5000, seed.turnDelayMs as number),
    paceMaxMs: clampInt(input.paceMaxMs, 0, 30000, seed.paceMaxMs as number),
    voiceEnabled: bool(input.voiceEnabled, seed.voiceEnabled as boolean),
    // Determinism: keep a provided seed, else generate one so EVERY game is replayable
    // (§10). This is the single allowed non-deterministic bootstrap.
    seed: typeof input.seed === 'string' && input.seed.trim() ? input.seed.trim() : newSeed(),
  };
  return out;
}

function newSeed(): string {
  try {
    return (globalThis.crypto?.randomUUID?.() ?? '').slice(0, 8) || fallbackSeed();
  } catch {
    return fallbackSeed();
  }
}
// crypto-free fallback (Math.random is acceptable ONLY for bootstrapping a fresh seed).
function fallbackSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
