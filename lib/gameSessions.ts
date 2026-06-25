// In-memory registry of running games, so the SSE route (which runs the loop) and
// the action route (which receives the human's input) can rendezvous. Single
// server process only — fine for the local demo; a real deployment would back
// this with a shared store.
import type { GameState } from '@/engine/types';

export type HumanChoice = { tool: string; args: any } | null;

export type PendingTurn = {
  agentId: string;
  resolve: (choice: HumanChoice) => void;
};

export interface GameSession {
  id: string;
  humanId: string | null;
  pending: PendingTurn | null;
  closed: boolean;
  // Live game state reference, so the action route can flip control flags (e.g. a
  // human's "ready to vote" skip) that the running game loop reads. Same object the
  // orchestrator mutates — set once when the game starts.
  state?: GameState | null;
}

const g = globalThis as unknown as { __mafiaSessions?: Map<string, GameSession> };
export const sessions: Map<string, GameSession> = g.__mafiaSessions ?? new Map();
g.__mafiaSessions = sessions;
