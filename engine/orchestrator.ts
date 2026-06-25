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

// Cap on simultaneous LLM turns in a parallel phase (e.g. voting), so we don't
// trigger a provider rate-limit burst. Override with MAFIA_PARALLEL_LIMIT.
const PARALLEL_LIMIT = Number(process.env.MAFIA_PARALLEL_LIMIT ?? 8);

// Run fn over items with at most `limit` of them in flight at once.
async function runConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const n = Math.min(Math.max(1, limit), items.length || 1);
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

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
    const phaseStart = Date.now();
    const aliveNow = state.players.filter((p) => p.alive).length;
    console.log(`\n[phase] ══ ${state.phase} · round ${state.round} ══ (${aliveNow} alive)`);

    // Reactive phases (e.g. discussion): the game picks the next speaker per beat
    // based on who's most motivated, so the table feels alive instead of round-robin.
    if (def.beatPhases?.includes(state.phase) && def.nextSpeaker) {
      let id: string | null;
      while ((id = def.nextSpeaker(state)) !== null) {
        const agent = state.players.find((p) => p.id === id);
        if (agent && agent.alive) {
          await turnFn(def, state, agent, emit);
          if (def.winner(state) !== null) break;
          if (turnDelayMs) await sleep(turnDelayMs);
        }
      }
    } else if (def.parallelPhases?.includes(state.phase)) {
      // Independent actions (e.g. secret simultaneous votes): every seat
      // deliberates at once, capped so we don't trigger a rate-limit burst.
      const actors = def
        .turnOrder(state)
        .map((id) => state.players.find((p) => p.id === id))
        .filter((a): a is AgentState => !!a && a.alive);
      await runConcurrent(actors, PARALLEL_LIMIT, (agent) => turnFn(def, state, agent, emit));
    } else {
      for (const id of def.turnOrder(state)) {
        const agent = state.players.find((p) => p.id === id);
        if (!agent || !agent.alive) continue;
        await turnFn(def, state, agent, emit);
        // A turn may have ended the game (e.g. last villager voted out mid-tally).
        if (def.winner(state) !== null) break;
        if (turnDelayMs) await sleep(turnDelayMs);
      }
    }

    console.log(`[phase] ${state.phase} r${state.round} turns finished in ${Date.now() - phaseStart}ms — resolving…`);
    if (def.winner(state) !== null) break;
    await def.advancePhase(state, emit); // resolve finished phase + advance; may emit deaths/reveals
  }

  const winner = def.winner(state) ?? 'draw';
  state.winner = winner;
  emit({ type: 'win', winner });
  return winner;
}
