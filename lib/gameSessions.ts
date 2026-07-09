// In-memory registry of running games, so the SSE route (which runs the loop) and
// the action route (which receives the human's input) can rendezvous. Single
// server process only — fine for the local demo; a real deployment would back
// this with a shared store.
import type { GameState } from "@/engine/types";

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
  // `to` is the addressee id when the human directed the line at a specific agent
  // (clicked them) — that agent is handed the floor for the very next beat.
  pendingSay?: (NonNullable<HumanChoice> & { to?: string | null }) | null;
  // Epoch (ms) until which the human is actively composing (recording/typing): while
  // set, the loop holds — it won't let an AI take the floor over them.
  composingUntil?: number;
  // Bumped each time the client finishes voicing a line; the loop waits for the next
  // bump before the next beat, so AI talk paces to the audio instead of racing ahead.
  voiceDoneSeq?: number;
  // Resolver that wakes the loop's current pacing wait the instant a client signal
  // (say / composing / voice-done) arrives, so it reacts without polling latency.
  wake?: (() => void) | null;
  // Abort handle for the AI turn currently being generated during DISCUSSION. When
  // the human takes the floor (starts composing or sends a line) we abort it so the
  // in-flight, human-blind line is dropped instead of landing before their words.
  // Null whenever no interruptible AI turn is in flight (night/vote, human turn, idle).
  turnAbort?: AbortController | null;

  // ── Session lifecycle / reconnect (Sweep 1) ─────────────────────────────────
  // Aborts the whole runGame loop. Fired when the client is gone past the grace
  // window (so we stop burning tokens with nobody watching) or when a fresh game
  // legitimately supersedes this one.
  abort?: AbortController;
  // The CURRENTLY attached SSE sink — every emitted event is delivered through this.
  // Swapped when a client reconnects; null while detached (loop keeps running, events
  // still accrue in `log` for replay). Decoupling the loop from any single stream is
  // what lets a refresh re-attach to the same running game.
  send?: ((e: unknown) => void) | null;
  // Closes the currently attached stream. Called by the loop's finally so a natural
  // game-over closes whichever stream is attached (possibly a reconnected one).
  closeSink?: (() => void) | null;
  // Every event emitted so far, in order — replayed to a client that (re)connects so
  // it rebuilds the full game state rather than starting blank.
  log?: unknown[];
  // Pending "abort after grace" timer, armed on disconnect and cleared on reconnect.
  graceTimer?: ReturnType<typeof setTimeout> | null;
  // Whether a client is currently reading the stream.
  attached?: boolean;
  // The last request_action event, kept so a reconnecting client can be re-offered a
  // turn that's still parked (its copy in `log` is skipped during replay).
  pendingActionEvent?: unknown;
}

const g = globalThis as unknown as {
  __mafiaSessions?: Map<string, GameSession>;
};
export const sessions: Map<string, GameSession> =
  g.__mafiaSessions ?? new Map();
g.__mafiaSessions = sessions;
