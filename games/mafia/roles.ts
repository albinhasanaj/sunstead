export const ROLE = {
  MAFIA: 'mafia',
  VILLAGER: 'villager',
  DETECTIVE: 'detective', // optional (Phase 7)
  DOCTOR: 'doctor', // optional (Phase 7)
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const isMafia = (role: string) => role === ROLE.MAFIA;
export const isTown = (role: string) => role !== ROLE.MAFIA;

// Players are named after real AI models — for fun now, and because each seat
// will later be driven by that actual model. Distinct personalities make the
// lies characterful and (later) the voices fun.
// Assigned to players round-robin at setup, independent of secret role.
export interface Personality {
  name: string;
  trait: string; // one line injected into the system prompt
}

export const PERSONALITIES: Personality[] = [
  { name: 'GPT', trait: 'a polished, agreeable diplomat who hedges everything and always sounds reasonable, even when accusing.' },
  { name: 'Claude', trait: 'a thoughtful, principled analyst who weighs every side carefully and refuses to accuse without reasoning it through.' },
  { name: 'Grok', trait: 'a snarky, irreverent jokester who roasts everyone at the table and hides sharp reads behind memes.' },
  { name: 'Gemini', trait: 'a confident know-it-all who cites "data" for everything and dazzles the table with facts.' },
  { name: 'Llama', trait: 'a friendly open-book who shares freely and trusts the crowd, sometimes to a fault.' },
  { name: 'Mistral', trait: 'a lean, blunt minimalist who says little, wastes no words, and cuts straight to the suspect.' },
  { name: 'DeepSeek', trait: 'a quiet, calculating strategist who reasons several moves ahead and reveals nothing early.' },
  { name: 'Qwen', trait: 'an adaptable, polite chameleon who mirrors whoever they talk to and shifts tactics on the fly.' },
];

// Standard role distribution by table size. Tuned for short, lively games.
export function roleDistribution(n: number): string[] {
  const mafiaCount = n <= 4 ? 1 : n <= 6 ? 2 : 3;
  const roles: string[] = [];
  for (let i = 0; i < mafiaCount; i++) roles.push(ROLE.MAFIA);
  while (roles.length < n) roles.push(ROLE.VILLAGER);
  return roles;
}
