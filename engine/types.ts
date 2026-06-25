import type { ZodTypeAny } from 'zod';

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
}

export interface ToolContext {
  state: GameState;
  agent: AgentState;
  emit: Emit;
}

export type Emit = (e: GameEvent) => void;

// The plug-in object. Mafia returns one of these. Werewolf would return another.
export interface GameDefinition {
  id: string;
  setup: (playerNames: string[]) => GameState; // assign roles, init state
  phases: string[];
  // For a given phase, who acts and in what order (may repeat a player for
  // multi-round phases like discussion):
  turnOrder: (state: GameState) => PlayerId[];
  toolsFor: (state: GameState, agent: AgentState) => GameTool[];
  // Resolve the phase that just finished and mutate state to the next phase.
  // Gets `emit` so resolution can announce deaths / reveals.
  advancePhase: (state: GameState, emit: Emit) => void;
  winner: (state: GameState) => string | null;
  systemPrompt: (state: GameState, agent: AgentState) => string;
  // Per-turn dynamic context (public log + this agent's private view). Optional;
  // the engine supplies a generic default when omitted.
  renderContext?: (state: GameState, agent: AgentState) => string;
  // The model string for agent decisions, routed via the AI Gateway.
  model?: string;
  // If a seat's own model fails (e.g. rate-limited), retry the turn once on this
  // model so the game never stalls on a single provider hiccup.
  fallbackModel?: string;
}

export type GameEvent =
  | { type: 'setup'; players: { id: PlayerId; name: string; role: string; model?: string }[]; phase: string; round: number }
  | { type: 'phase'; phase: string; round: number }
  | { type: 'beliefs'; agent: PlayerId; suspicions: Record<PlayerId, number>; reasoning: string }
  | { type: 'speak'; agent: PlayerId; text: string; audioUrl?: string }
  | { type: 'whisper'; agent: PlayerId; text: string; channel: string } // private channel (e.g. Mafia at night)
  | { type: 'action'; agent: PlayerId; kind: string; target?: PlayerId }
  | { type: 'knowledge'; agent: PlayerId; target: PlayerId; result: string; text: string } // private finding (e.g. Detective)
  | { type: 'death'; target: PlayerId; role: string }
  | { type: 'vote'; agent: PlayerId; target: PlayerId }
  | { type: 'reveal'; target: PlayerId; role: string }
  | { type: 'win'; winner: string };
