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
  // Real-time discussion: the human isn't a scheduled seat — they interject. A line
  // they submit lands here and the SSE loop injects it at the next beat boundary.
  pendingSay?: NonNullable<HumanChoice> | null;
  // Epoch (ms) until which the human is actively composing (recording/typing): while
  // set, the loop holds — it won't let an AI take the floor over them.
  composingUntil?: number;
  // Bumped each time the client finishes voicing a line; the loop waits for the next
  // bump before the next beat, so AI talk paces to the audio instead of racing ahead.
  voiceDoneSeq?: number;
  // Resolver that wakes the loop's current pacing wait the instant a client signal
  // (say / composing / voice-done) arrives, so it reacts without polling latency.
  wake?: (() => void) | null;
}

const g = globalThis as unknown as { __mafiaSessions?: Map<string, GameSession> };
export const sessions: Map<string, GameSession> = g.__mafiaSessions ?? new Map();
g.__mafiaSessions = sessions;
