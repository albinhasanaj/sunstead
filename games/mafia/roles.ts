export const ROLE = {
  MAFIA: 'mafia',
  VILLAGER: 'villager',
  DETECTIVE: 'detective', // optional (Phase 7)
  DOCTOR: 'doctor', // optional (Phase 7)
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const isMafia = (role: string) => role === ROLE.MAFIA;
export const isTown = (role: string) => role !== ROLE.MAFIA;

// Each seat is named after a real AI lab and is driven by that lab's actual model
// — the "every seat is a different model" thesis. Routing is by prefix (see
// engine/models.ts): closed-source labs (OpenAI, Anthropic, Google, xAI) run
// through the Vercel AI Gateway as `creator/model`; open-weight labs (DeepSeek,
// Moonshot/Kimi, Zhipu/GLM, Qwen, Llama, Mistral) run through Featherless as
// `featherless/<hf-org>/<model>`. This list is only the default catalog
// (personalities/models become dynamic options later).
export interface Personality {
  name: string;
  model: string; // routed model string — gateway `creator/model` or `featherless/<org>/<model>`
  // Optional tighter per-seat LLM timeout (ms). For a model that reliably stalls on
  // the free tier, this fails it over to the fallback fast instead of burning the
  // full global budget every turn. Omit to use the global MAFIA_TURN_TIMEOUT_MS.
  timeoutMs?: number;
}

export const PERSONALITIES: Personality[] = [
  // Closed-source seats route through the Vercel AI Gateway (AI_GATEWAY_API_KEY).
  // Several labs field more than one tier, so the table can pit a flagship against
  // its own lightweight sibling (GPT vs GPT-mini, Claude Opus vs Haiku, …).
  { name: 'GPT', model: 'openai/gpt-5.4-nano' },
  { name: 'GPTmini', model: 'openai/gpt-5.4-mini' },
  { name: 'Claude', model: 'anthropic/claude-sonnet-4.5' },
  { name: 'Opus', model: 'anthropic/claude-opus-4.5' },
  { name: 'Haiku', model: 'anthropic/claude-haiku-4.5' },
  { name: 'Gemini', model: 'google/gemini-2.5-flash' },
  { name: 'GeminiPro', model: 'google/gemini-2.5-pro' },
  { name: 'Grok', model: 'xai/grok-4.20-0309-non-reasoning' },
  // Open-weight seats. Most route through Featherless (FEATHERLESS_API_KEY) — IDs are
  // the HuggingFace org/repo the platform serves. Llama and Gemma are GATED on the
  // Featherless plan, so they route through the Vercel AI Gateway instead (a `meta/` or
  // `google/` slug falls through to the gateway in resolveModel). DeepSeek keeps a
  // tighter leash: it's a large reasoning model and can blow past the global cap, so it
  // fails over to the gateway fallback (gemini) sooner instead of stalling the table.
  { name: 'DeepSeek', model: 'featherless/deepseek-ai/DeepSeek-V3.1', timeoutMs: 20000 },
  { name: 'Kimi', model: 'featherless/moonshotai/Kimi-K2-Instruct-0905' },
  { name: 'GLM', model: 'featherless/zai-org/GLM-4.6' },
  { name: 'Qwen', model: 'featherless/Qwen/Qwen3-235B-A22B' },
  { name: 'Llama', model: 'meta/llama-3.3-70b' }, // gateway (gated on Featherless)
  { name: 'Mistral', model: 'featherless/mistralai/Mistral-Small-3.2-24B-Instruct-2506' },
  { name: 'Gemma', model: 'google/gemma-4-31b-it' }, // gateway (Gemma 3 27B not on Featherless plan)
];

// Look up a seat's default model by character name (case-insensitive).
export function personalityByName(name: string): Personality | undefined {
  return PERSONALITIES.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
}

// Default game roster — fifteen seats so a full Mafia table (3 Mafia coordinating +
// a Detective + a Doctor + 10 Townspeople) features every distinct lab's model.
// Headless callers (scripts/tests) get sliced down to config.tableSize in setup().
export const DEFAULT_ROSTER = [
  'GPT',
  'GPTmini',
  'Claude',
  'Opus',
  'Haiku',
  'Gemini',
  'GeminiPro',
  'Grok',
  'DeepSeek',
  'Kimi',
  'GLM',
  'Qwen',
  'Llama',
  'Mistral',
  'Gemma',
];

// Fallback model for any seat without an explicit one (e.g. a custom name).
export const FALLBACK_MODEL = 'google/gemini-2.5-flash';

// Build the role multiset from an already-resolved composition (see
// games/mafia/config.ts → roleComposition). Specials are TOWN, so they never worsen
// Mafia≥Town parity. The composition is the single place table balance is decided;
// this just expands it into a flat list of role strings of length `total`.
export interface RoleCounts {
  mafia: number;
  detective: number;
  doctor: number;
  villager: number;
  total: number;
}
export function roleDistribution(counts: RoleCounts): string[] {
  const roles: string[] = [];
  for (let i = 0; i < counts.mafia; i++) roles.push(ROLE.MAFIA);
  for (let i = 0; i < counts.detective; i++) roles.push(ROLE.DETECTIVE);
  for (let i = 0; i < counts.doctor; i++) roles.push(ROLE.DOCTOR);
  while (roles.length < counts.total) roles.push(ROLE.VILLAGER);
  return roles;
}
