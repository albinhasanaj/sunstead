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
  { name: 'GPT', model: 'openai/gpt-5.1-nano' },
  { name: 'Claude', model: 'anthropic/claude-haiku-4.5' },
  { name: 'Gemini', model: 'google/gemini-2.5-flash' },
  { name: 'Grok', model: 'xai/grok-4.1-fast-non-reasoning' },
  // Open-weight seats route through Featherless (FEATHERLESS_API_KEY). IDs are the
  // HuggingFace org/repo the platform serves. DeepSeek keeps a tighter leash: it's
  // a large reasoning model and can blow past the global cap, so it fails over to
  // the gateway fallback (gemini) sooner instead of stalling the table.
  { name: 'DeepSeek', model: 'featherless/deepseek-ai/DeepSeek-V3.1', timeoutMs: 20000 },
  { name: 'Kimi', model: 'featherless/moonshotai/Kimi-K2-Instruct-0905' },
  { name: 'GLM', model: 'featherless/zai-org/GLM-4.6' },
  { name: 'Qwen', model: 'featherless/Qwen/Qwen3-235B-A22B' },
  { name: 'Llama', model: 'featherless/meta-llama/Llama-3.3-70B-Instruct' },
  { name: 'Mistral', model: 'featherless/mistralai/Mistral-Small-3.2-24B-Instruct-2506' },
];

// Look up a seat's default model by character name (case-insensitive).
export function personalityByName(name: string): Personality | undefined {
  return PERSONALITIES.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
}

// Default game roster — six seats so a full game features every role
// (2 Mafia coordinating + a Detective + a Doctor + 2 Villagers).
export const DEFAULT_ROSTER = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Grok'];

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
