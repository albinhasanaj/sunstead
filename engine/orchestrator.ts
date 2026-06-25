import { takeTurn } from './agent';
import type { AgentState, Emit, GameDefinition, GameState } from './types';

// How a single agent's turn is taken. Defaults to the real AI SDK call (takeTurn),
// but is injectable so tests can drive the loop with a deterministic mock policy
// (no API key, no tokens) and still exercise every phase transition and win check.
export type TurnFn = (
  def: GameDefinition,
  state: GameState,
  agent: AgentState,
  emit: Emit,
) => Promise<void>;

// The hand-written game loop. THIS is the product: full control over turn order,
// phase transitions, and the win check. The AI SDK is only ever called inside
// takeTurn() — one agent thinking + acting. Everything orchestrating multiple
// agents across phases lives here, game-agnostically.
export async function runGame(
  def: GameDefinition,
  names: string[],
  emit: Emit,
  onState?: (state: GameState) => void, // called once after setup (lets sinks bind to state)
  turnFn: TurnFn = takeTurn,
  turnDelayMs = 0, // optional spacing between turns to respect provider rate limits
): Promise<string> {
  const state = def.setup(names);
  onState?.(state);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Safety bound so a misbehaving game can never loop forever.
  let guard = 0;
  while (def.winner(state) === null && guard++ < 100) {
    emit({ type: 'phase', phase: state.phase, round: state.round });

    for (const id of def.turnOrder(state)) {
      const agent = state.players.find((p) => p.id === id);
      if (!agent || !agent.alive) continue;
      await turnFn(def, state, agent, emit);
      // A turn may have ended the game (e.g. last villager voted out mid-tally).
      if (def.winner(state) !== null) break;
      if (turnDelayMs) await sleep(turnDelayMs);
    }

    if (def.winner(state) !== null) break;
    def.advancePhase(state, emit); // resolve finished phase + advance; may emit deaths/reveals
  }

  const winner = def.winner(state) ?? 'draw';
  state.winner = winner;
  emit({ type: 'win', winner });
  return winner;
}
