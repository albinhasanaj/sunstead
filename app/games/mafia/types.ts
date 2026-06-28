// ── shapes mirrored from engine/types GameEvent (kept loose on the client) ──────
export type Player = { id: string; name: string; role: string; model?: string | null; alive: boolean; human?: boolean };

export type NameRef = { id: string; name: string };

export type Turn = {
  agent: string;
  phase: string;
  legal: string[];
  alive: NameRef[];
  voteTargets?: NameRef[]; // restricted to the runoff slate during a dayVoteTie revote
  killTargets: NameRef[];
  investigateTargets: NameRef[];
  protectTargets: NameRef[];
  teammates: NameRef[];
};

export type Feed =
  | { k: 'phase'; phase: string; round: number }
  | { k: 'speak'; who: string; text: string }
  | { k: 'whisper'; who: string; text: string }
  | { k: 'system'; text: string }
  | { k: 'vote'; who: string; target: string }
  | { k: 'knowledge'; who: string; text: string }
  | { k: 'win'; winner: string }
  | { k: 'error'; text: string };

// Big transient announcement banner (death / doctor-save / quiet night).
export type Announce = { eyebrow: string; title: string; face: string | null; tone: 'death' | 'save' | 'quiet' };
