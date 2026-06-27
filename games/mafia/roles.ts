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
  trait: string; // one line injected into the system prompt
  // Optional tighter per-seat LLM timeout (ms). For a model that reliably stalls on
  // the free tier, this fails it over to the fallback fast instead of burning the
  // full global budget every turn. Omit to use the global MAFIA_TURN_TIMEOUT_MS.
  timeoutMs?: number;
}

export const PERSONALITIES: Personality[] = [
  // Closed-source seats route through the Vercel AI Gateway (AI_GATEWAY_API_KEY).
  { name: 'GPT', model: 'openai/gpt-5.1-nano', trait: 'a polished, agreeable diplomat who hedges everything and always sounds reasonable, even when accusing.' },
  { name: 'Claude', model: 'anthropic/claude-haiku-4.5', trait: 'a thoughtful, principled analyst who weighs every side carefully and refuses to accuse without reasoning it through.' },
  { name: 'Gemini', model: 'google/gemini-2.5-flash', trait: 'a confident know-it-all who cites "data" for everything and dazzles the table with facts.' },
  { name: 'Grok', model: 'xai/grok-4.1-fast-non-reasoning', trait: 'a snarky, irreverent jokester who roasts everyone at the table and hides sharp reads behind memes.' },
  // Open-weight seats route through Featherless (FEATHERLESS_API_KEY). IDs are the
  // HuggingFace org/repo the platform serves. DeepSeek keeps a tighter leash: it's
  // a large reasoning model and can blow past the global cap, so it fails over to
  // the gateway fallback (gemini) sooner instead of stalling the table.
  { name: 'DeepSeek', model: 'featherless/deepseek-ai/DeepSeek-V3.1', timeoutMs: 20000, trait: 'a quiet, calculating strategist who reasons several moves ahead and reveals nothing early.' },
  { name: 'Kimi', model: 'featherless/moonshotai/Kimi-K2-Instruct-0905', trait: 'a sharp, long-memoried observer who quietly tracks every contradiction and brings receipts.' },
  { name: 'GLM', model: 'featherless/zai-org/GLM-4.6', trait: 'a measured, methodical reasoner who builds a case brick by brick and rarely overreaches.' },
  { name: 'Qwen', model: 'featherless/Qwen/Qwen3-235B-A22B', trait: 'an adaptable, polite chameleon who mirrors whoever they talk to and shifts tactics on the fly.' },
  { name: 'Llama', model: 'featherless/meta-llama/Llama-3.3-70B-Instruct', trait: 'a friendly open-book who shares freely and trusts the crowd, sometimes to a fault.' },
  { name: 'Mistral', model: 'featherless/mistralai/Mistral-Small-3.2-24B-Instruct-2506', trait: 'a lean, blunt minimalist who says little, wastes no words, and cuts straight to the suspect.' },
];

// Look up a seat's default model/trait by character name (case-insensitive).
export function personalityByName(name: string): Personality | undefined {
  return PERSONALITIES.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
}

// Default game roster — six seats so a full game features every role
// (2 Mafia coordinating + a Detective + a Doctor + 2 Villagers).
export const DEFAULT_ROSTER = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Grok'];

// Fallback model for any seat without an explicit one (e.g. a custom name).
export const FALLBACK_MODEL = 'google/gemini-2.5-flash';

// Standard role distribution by table size. Specials are town, so they don't
// worsen Mafia≥Town parity. Tuned so a single night kill can never instantly end
// the game, and so a full table shows off every role (Mafia coord + Detective + Doctor).
//   n≥5 → a Detective (town gains information)
//   n≥6 → a Doctor (town gains protection)
// `mafiaOverride` lets the lobby pick the Mafia count (1–3); it's clamped to keep
// Mafia a strict minority (mafia < town) so the game can't open already-decided.
export function roleDistribution(n: number, mafiaOverride?: number): string[] {
  const mafiaCount =
    mafiaOverride != null
      ? Math.max(1, Math.min(Math.round(mafiaOverride), Math.floor((n - 1) / 2)))
      : n <= 5 ? 1 : n <= 8 ? 2 : 3;
  const detectives = n >= 5 ? 1 : 0;
  const doctors = n >= 6 ? 1 : 0;
  const roles: string[] = [];
  for (let i = 0; i < mafiaCount; i++) roles.push(ROLE.MAFIA);
  for (let i = 0; i < detectives; i++) roles.push(ROLE.DETECTIVE);
  for (let i = 0; i < doctors; i++) roles.push(ROLE.DOCTOR);
  while (roles.length < n) roles.push(ROLE.VILLAGER);
  return roles;
}
