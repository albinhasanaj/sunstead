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
// Player-facing pacing tier (§2.5). Maps to raw turnDelay/paceMax ms via GAME_SPEED
// so the lobby never shows milliseconds; the raw ms fields stay in Tier 3 (Advanced).
export type GameSpeed = 'relaxed' | 'normal' | 'fast';

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

  // — Expressive "hero" lines (Stage 5) — a richer, higher-latency TTS model used
  // ONLY for the occasional decisive line. Default OFF so the fast crossfire path is
  // never touched. heroLineModel unset = off.
  heroLineModel?: 'eleven_v3';
  heroLineMinIntensity: number; // a line must be at least this intense to qualify
  heroLinesPerRound: number; // hard cap per round so latency stays bounded

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
const clampRange01 = (v: unknown, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt;
};
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
// filled in normalizeConfig once the size is known.
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
  // heroLineModel left unset (off) by default — opt-in only.
  heroLineMinIntensity: 0.85,
  heroLinesPerRound: 1,
};

// ── Difficulty → engine knobs (§2.5) — the ONE table mapping a single player word
// to the engine tunables it implies. The host picks "Casual / Standard / Cunning"
// and resolveConfig sets these; the raw knobs live in Tier 3 (Advanced) only.
// STANDARD intentionally re-asserts the STATIC_DEFAULTS values, so a Classic+Standard
// game is byte-for-byte identical to the old flat default (§ acceptance #5).
export const DIFFICULTY_ENGINE: Record<Difficulty, Partial<MafiaConfig>> = {
  // small context window, one discussion round, no reactive auction, short memory.
  casual: { contextWindow: 8, discussionRounds: 1, reactiveDiscussion: false, enableMemoryRecall: false },
  // the baseline — equals the historical defaults so nothing changes by default.
  standard: { contextWindow: 15, discussionRounds: 2, reactiveDiscussion: true, enableMemoryRecall: true },
  // larger window, three rounds, full reactive + memory recall.
  cunning: { contextWindow: 24, discussionRounds: 3, reactiveDiscussion: true, enableMemoryRecall: true },
};

// ── Game speed → pacing ms (§2.5) — translate "Relaxed / Normal / Fast" into the
// raw turnDelay/paceMax fields so a player never sees milliseconds. NORMAL equals the
// historical defaults (turnDelayMs 0, paceMaxMs 14000) for byte-for-byte parity.
export const GAME_SPEED: Record<GameSpeed, Partial<MafiaConfig>> = {
  relaxed: { turnDelayMs: 800, paceMaxMs: 18000 },
  normal: { turnDelayMs: 0, paceMaxMs: 14000 },
  fast: { turnDelayMs: 0, paceMaxMs: 9000 },
};

// ── Presets (§2.3) — named partial patches the lobby applies in one click ──────
// A preset now carries (a) the difficulty + game-speed it implies (which in turn pick
// the engine knobs above) and (b) PLAYER-FACING overrides only (table/roles/rules).
// Engine knobs (discussion rounds, context window, reactive, memory, pacing) are NOT
// duplicated here — they flow from difficulty/gameSpeed — so a preset never quietly
// re-asserts an engine value as if it were a separate setting.
export const PRESETS: Record<string, Partial<MafiaConfig>> = {
  classic: {},
  casual: { revealRoleOnDeath: true, allowNoLynch: true },
  hardcore: { firstNightKill: true },
  chaos: { tableSize: 9, mafiaCount: 3 },
  // A full 15-seat table (3 Mafia, Detective, Doctor, 10 Townspeople) — the model
  // battle royale, where every distinct lab takes a seat and we see who survives.
  battle: { tableSize: 15, mafiaCount: 3 },
};
export type PresetName = keyof typeof PRESETS;

export const PRESET_META: { name: PresetName; label: string; blurb: string; difficulty: Difficulty; gameSpeed: GameSpeed }[] = [
  { name: 'classic', label: 'Classic', blurb: 'Balanced default', difficulty: 'standard', gameSpeed: 'normal' },
  { name: 'casual', label: 'Casual', blurb: 'Forgiving, easy to read', difficulty: 'casual', gameSpeed: 'normal' },
  { name: 'hardcore', label: 'Hardcore', blurb: 'Ruthless AIs, night-1 kill', difficulty: 'cunning', gameSpeed: 'normal' },
  { name: 'chaos', label: 'Chaos', blurb: 'Big & fast — 9 seats, 3 Mafia', difficulty: 'standard', gameSpeed: 'fast' },
  { name: 'battle', label: 'Battle', blurb: '15 seats, every model', difficulty: 'cunning', gameSpeed: 'normal' },
];

// ── ConfigSelection — the tiered lobby state (§2.5). The UI edits THIS, not a flat
// patch: a chosen preset, the one-word difficulty + game speed, and a SPARSE bag of
// fields the host explicitly overrode. resolveConfig layers them into a MafiaConfig.
export interface ConfigSelection {
  preset: PresetName;
  difficulty: Difficulty;
  gameSpeed: GameSpeed;
  userOverrides: Partial<MafiaConfig>; // only fields the host explicitly changed
}

export const DEFAULT_SELECTION: ConfigSelection = { preset: 'classic', difficulty: 'standard', gameSpeed: 'normal', userOverrides: {} };

// The difficulty + game speed a preset starts from (used when the host picks a preset).
export function presetDefaults(name: PresetName): { difficulty: Difficulty; gameSpeed: GameSpeed } {
  const m = PRESET_META.find((p) => p.name === name);
  return { difficulty: m?.difficulty ?? 'standard', gameSpeed: m?.gameSpeed ?? 'normal' };
}

// A fresh selection for a preset — its difficulty/speed defaults and NO user overrides.
// Selecting a preset resets to these defaults (the lobby confirms before discarding edits).
export function selectionForPreset(name: PresetName): ConfigSelection {
  const d = presetDefaults(name);
  return { preset: name, difficulty: d.difficulty, gameSpeed: d.gameSpeed, userOverrides: {} };
}

// Layer a tiered selection into a flat patch in resolution order (§2.5):
//   preset defaults  ←  difficulty overrides  ←  gameSpeed overrides  ←  userOverrides
// No clamping here — normalizeConfig does that. Kept separate so the UI can preview a
// "baseline" (selection with empty overrides) to flag which fields were modified.
export function layerSelection(sel: Partial<ConfigSelection> = {}): Partial<MafiaConfig> {
  const preset: PresetName = sel.preset && PRESETS[sel.preset] ? sel.preset : 'classic';
  const def = presetDefaults(preset);
  const difficulty = sel.difficulty ?? def.difficulty;
  const gameSpeed = sel.gameSpeed ?? def.gameSpeed;
  return {
    ...PRESETS[preset],
    ...DIFFICULTY_ENGINE[difficulty],
    difficulty, // the chosen word is itself a config field (selects the prompt variant)
    ...GAME_SPEED[gameSpeed],
    ...(sel.userOverrides ?? {}),
  };
}

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

// ── normalizeConfig — the one place a config is fully defaulted, clamped, validated ─
// Idempotent: passing an already-resolved config returns an equivalent one, so it's
// safe to run in the API route (for validation + logging) AND again in setup(). The
// engine calls this directly (it already holds a flat config); the lobby + server go
// through resolveConfig (below), which layers a tiered selection first.
export function normalizeConfig(input: Partial<MafiaConfig> = {}): MafiaConfig {
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
    // Hero lines: only 'eleven_v3' enables them; anything else stays off (undefined).
    heroLineModel: input.heroLineModel === 'eleven_v3' ? 'eleven_v3' : undefined,
    heroLineMinIntensity: clampRange01(input.heroLineMinIntensity, seed.heroLineMinIntensity as number),
    heroLinesPerRound: clampInt(input.heroLinesPerRound, 0, 5, seed.heroLinesPerRound as number),
    // Determinism: keep a provided seed, else generate one so EVERY game is replayable
    // (§10). This is the single allowed non-deterministic bootstrap.
    seed: typeof input.seed === 'string' && input.seed.trim() ? input.seed.trim() : newSeed(),
  };
  return out;
}

// ── resolveConfig — THE single resolution path shared by the lobby UI and the server
// (§ acceptance #4). Layers a tiered selection (preset ← difficulty ← gameSpeed ←
// userOverrides) and then defaults/clamps/validates it. The server re-runs this from
// the client's selection rather than trusting any client-sent resolved config (§2.5).
// resolveConfig({}) → Classic + Standard + Normal + no overrides = the historical
// default, byte-for-byte (the seed aside, which is random either way).
export function resolveConfig(selection: Partial<ConfigSelection> = {}): MafiaConfig {
  return normalizeConfig(layerSelection(selection));
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
