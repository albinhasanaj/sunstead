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
// through the AI Gateway — the "every seat is a different model" thesis. `model`
// is just a gateway `creator/model` string, so ANY gateway model works here; this
// list is only the default catalog (personalities/models become dynamic options later).
export interface Personality {
  name: string;
  model: string; // AI Gateway model string — swappable per seat
  trait: string; // one line injected into the system prompt
}

export const PERSONALITIES: Personality[] = [
  // The first five map to models reachable on the AI Gateway free tier, so a
  // default game runs out of the box. The rest are real but currently gated
  // (need paid credits); they're ready the moment the credit system lands.
  { name: 'GPT', model: 'openai/gpt-oss-120b', trait: 'a polished, agreeable diplomat who hedges everything and always sounds reasonable, even when accusing.' },
  { name: 'Claude', model: 'anthropic/claude-haiku-4.5', trait: 'a thoughtful, principled analyst who weighs every side carefully and refuses to accuse without reasoning it through.' },
  { name: 'Gemini', model: 'google/gemini-2.5-flash', trait: 'a confident know-it-all who cites "data" for everything and dazzles the table with facts.' },
  { name: 'DeepSeek', model: 'deepseek/deepseek-v3.1', trait: 'a quiet, calculating strategist who reasons several moves ahead and reveals nothing early.' },
  { name: 'Qwen', model: 'alibaba/qwen3-32b', trait: 'an adaptable, polite chameleon who mirrors whoever they talk to and shifts tactics on the fly.' },
  { name: 'Grok', model: 'xai/grok-4.1-fast-non-reasoning', trait: 'a snarky, irreverent jokester who roasts everyone at the table and hides sharp reads behind memes.' },
  { name: 'Llama', model: 'meta/llama-4-scout', trait: 'a friendly open-book who shares freely and trusts the crowd, sometimes to a fault.' },
  { name: 'Mistral', model: 'mistral/mistral-small', trait: 'a lean, blunt minimalist who says little, wastes no words, and cuts straight to the suspect.' },
];

// Look up a seat's default model/trait by character name (case-insensitive).
export function personalityByName(name: string): Personality | undefined {
  return PERSONALITIES.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
}

// Default game roster — the five seats that run on the free tier today.
export const DEFAULT_ROSTER = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen'];

// Fallback model for any seat without an explicit one (e.g. a custom name).
export const FALLBACK_MODEL = 'google/gemini-2.5-flash';

// Standard role distribution by table size. Tuned so a single night kill can
// never instantly hit Mafia≥Town parity (which would end the game at dawn round 1).
export function roleDistribution(n: number): string[] {
  const mafiaCount = n <= 5 ? 1 : n <= 7 ? 2 : 3;
  const roles: string[] = [];
  for (let i = 0; i < mafiaCount; i++) roles.push(ROLE.MAFIA);
  while (roles.length < n) roles.push(ROLE.VILLAGER);
  return roles;
}
