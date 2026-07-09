import type { ZodTypeAny } from "zod";

export type PlayerId = string;

export interface AgentState {
  id: PlayerId;
  name: string;
  alive: boolean;
  role: string; // engine treats role as an opaque string
  private: Record<string, any>; // role-specific hidden state (suspicions, notes, ...)
}

export interface GameState {
  players: AgentState[];
  phase: string;
  round: number;
  publicLog: { speaker: PlayerId; text: string }[];
  winner: string | null;
  // Game-specific transient state (night target, votes, private channels, ...).
  // The engine never reads this; only the GameDefinition's own code touches it.
  meta: Record<string, any>;
}

// A tool an agent can call. `execute` mutates state and emits events.
export interface GameTool {
  name: string;
  description: string; // write it as a trigger condition, for the model
  inputSchema: ZodTypeAny;
  legalIn: (state: GameState, agent: AgentState) => boolean; // phase/role legality
  execute: (args: any, ctx: ToolContext) => Promise<string>; // returns result string
  // A "prep" tool records private state and does NOT end the turn (e.g. Mafia's
  // update_beliefs). The engine runs prep tools in a first forced step, then forces
  // exactly one non-prep action — so a turn can never end without a visible move.
  prep?: boolean;
}

export interface ToolContext {
  state: GameState;
  agent: AgentState;
  emit: Emit;
}

export type Emit = (e: GameEvent) => void;

// Knobs the host passes into setup to tune a single game. `config` is an opaque,
// game-defined configuration object (resolved by the host, e.g. the lobby's chosen
// settings); the engine never inspects it — the game's own setup() reads it.
export interface SetupOptions {
  config?: unknown;
}

// The plug-in object. Mafia returns one of these. Werewolf would return another.
export interface GameDefinition {
  id: string;
  setup: (playerNames: string[], options?: SetupOptions) => GameState; // assign roles, init state
  phases: string[];
  // For a given phase, who acts and in what order (may repeat a player for
  // multi-round phases like discussion):
  turnOrder: (state: GameState) => PlayerId[];
  toolsFor: (state: GameState, agent: AgentState) => GameTool[];
  // Optional: phases whose speaking order is decided dynamically per beat (e.g. a
  // reactive discussion where whoever is most motivated speaks next) instead of a
  // precomputed turnOrder. For such phases the engine repeatedly calls nextSpeaker
  // until it returns null. May be a function of state so the game can decide per-game
  // (e.g. from its resolved config) whether a phase is reactive.
  beatPhases?: string[] | ((state: GameState) => string[]);
  // May be async: an optional paid "live urge" path polls each seat's own model
  // before picking. The free-tier path stays synchronous; the engine awaits either.
  nextSpeaker?: (
    state: GameState,
  ) => PlayerId | null | Promise<PlayerId | null>;
  // Phases whose turns are independent (e.g. secret simultaneous voting) and may
  // run concurrently instead of one at a time. May be a function of state (config-driven).
  parallelPhases?: string[] | ((state: GameState) => string[]);
  // Optional: called by the orchestrator right before each agent's turn runs, so a
  // game can announce who/what is about to act (e.g. Mafia's night wake-up calls).
  onTurnStart?: (state: GameState, agent: AgentState, emit: Emit) => void;
  // Resolve the phase that just finished and mutate state to the next phase.
  // Gets `emit` so resolution can announce deaths / reveals.
  advancePhase: (state: GameState, emit: Emit) => void | Promise<void>;
  winner: (state: GameState) => string | null;
  systemPrompt: (state: GameState, agent: AgentState) => string;
  // Per-turn dynamic context (public log + this agent's private view). Optional;
  // the engine supplies a generic default when omitted.
  renderContext?: (state: GameState, agent: AgentState) => string;
  // Optional async hook run before each AI turn: returns extra prompt text (e.g.
  // long-term memory recalled via pgvector) to append, or null. May perform I/O.
  recallForTurn?: (
    state: GameState,
    agent: AgentState,
  ) => Promise<string | null>;
  // The model string for agent decisions, routed via the AI Gateway.
  model?: string;
  // If a seat's own model fails (e.g. rate-limited), retry the turn once on this
  // model so the game never stalls on a single provider hiccup.
  fallbackModel?: string;
}

export type GameEvent =
  | {
      type: "setup";
      players: { id: PlayerId; name: string; role: string; model?: string }[];
      phase: string;
      round: number;
    }
  | { type: "phase"; phase: string; round: number }
  | {
      type: "beliefs";
      agent: PlayerId;
      suspicions: Record<PlayerId, number>;
      reasoning: string;
      // On-deck "bid": how much this seat wants the floor + what it's holding. Only
      // ever reaches the client in watch mode (play mode drops 'beliefs' entirely).
      bid?: {
        pressure: number;
        holding: string;
        triggers: string[];
        round: number;
        beat: number;
      };
    }
  | { type: "thinking"; agent: PlayerId; on: boolean } // seat is mid-deliberation — for a "thinking…" UI and to visualise concurrent thinking
  // The PUBLIC expression signal rides the spoken line (never the private beliefs
  // event): emotion + intensity drive voice delivery and body language; lookingAt is
  // a resolved player id the speaker is addressing. Engine treats them as opaque.
  | {
      type: "speak";
      agent: PlayerId;
      text: string;
      audioUrl?: string;
      emotion?: string;
      intensity?: number;
      lookingAt?: PlayerId;
    }
  | { type: "whisper"; agent: PlayerId; text: string; channel: string } // private channel (e.g. Mafia at night)
  | { type: "action"; agent: PlayerId; kind: string; target?: PlayerId }
  | {
      type: "knowledge";
      agent: PlayerId;
      target: PlayerId;
      result: string;
      text: string;
    } // private finding (e.g. Detective)
  // `role` is omitted on the wire in play mode for a hidden-role game (the host's
  // emit filter strips it unless config.revealRoleOnDeath or it's the human's own death).
  | { type: "death"; target: PlayerId; role?: string }
  | { type: "vote"; agent: PlayerId; target: PlayerId }
  | { type: "reveal"; target: PlayerId; role?: string }
  // Anonymous night outcome when no one dies: 'saved' = the Mafia's target was
  // protected by the doctor; 'quiet' = no kill landed; 'night0' = the opening night,
  // which is a guaranteed no-kill BY THE RULES (config.firstNightKill off), not an
  // anomaly. Carries no ids — no one learns who was targeted or who saved them.
  | { type: "night"; outcome: "saved" | "quiet" | "night0" }
  // A night role is about to act now (anonymous — role only, never who). Lets the
  // UI narrate "the Detective wakes up" exactly when they actually do.
  | { type: "wake"; role: string }
  // Game over. The hidden game is decided, so every seat's true role is now public —
  // `roles` carries the full unmasking for the endgame reveal cutscene. (Safe to send
  // unfiltered: it fires exactly once, after the win condition is met.)
  | { type: "win"; winner: string; roles?: { id: PlayerId; role: string }[] }
  // The loop could not make progress (hit its safety iteration bound, or an internal
  // error left no winner). This is NOT a legitimate end — Mafia has no draw — so we
  // surface it explicitly instead of faking a result, letting the UI offer recovery.
  | { type: "stalled"; message: string };
