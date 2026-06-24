/**
 * Engine smoke test — NO API key, NO tokens.
 * Drives the real orchestrator, phases, tools and win condition with a scripted
 * heuristic policy instead of the LLM, to prove the game loop terminates with a
 * valid winner and that every phase transition / kill / vote wires up correctly.
 * Run:  pnpm tsx scripts/simulate.ts
 */
import { EventBus, terminalRenderer } from '../engine/events';
import { runGame, type TurnFn } from '../engine/orchestrator';
import { mafiaGame } from '../games/mafia';
import type { AgentState, GameState, ToolContext } from '../engine/types';
import { isMafia } from '../games/mafia/roles';

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// Deterministic-ish heuristic agent: records beliefs, then takes one legal action.
const mockTurn: TurnFn = async (def, state, agent, emit) => {
  const ctx: ToolContext = { state, agent, emit };
  const tools = def.toolsFor(state, agent);
  const alive = state.players.filter((p) => p.alive && p.id !== agent.id);
  const town = alive.filter((p) => !isMafia(p.role));
  const byName = (name: string) => state.players.find((p) => p.id === name)?.name ?? name;

  const beliefs = tools.find((t) => t.name === 'update_beliefs')!;
  await beliefs.execute(
    {
      reasoning: `${agent.name} is sizing up the table.`,
      suspicions: alive.map((p) => ({ player: p.name, level: Math.random() })),
    },
    ctx,
  );

  const has = (n: string) => tools.find((t) => t.name === n);
  if (has('mafia_propose_kill') && town.length) {
    await has('mafia_propose_kill')!.execute({ target: pick(town).name, reason: 'soft target' }, ctx);
  } else if (has('mafia_discuss')) {
    await has('mafia_discuss')!.execute({ message: 'Let us hit a quiet one tonight.' }, ctx);
  } else if (has('vote') && alive.length) {
    await has('vote')!.execute({ target: pick(alive).name }, ctx);
  } else if (has('accuse') && alive.length) {
    await has('accuse')!.execute({ target: pick(alive).name, reason: 'a hunch' }, ctx);
  } else if (has('speak')) {
    await has('speak')!.execute({ text: 'I am keeping my eyes open.' }, ctx);
  }
};

async function main() {
  console.log('\n🧪  Engine smoke test (mock agents, no LLM)\n');
  const bus = new EventBus();
  const winner = await runGame(
    mafiaGame,
    [],
    bus.emit,
    (state: GameState) => {
      bus.on(terminalRenderer(state));
      console.log('Roster:', state.players.map((p: AgentState) => `${p.name}[${p.role}]`).join(', '), '\n');
    },
    mockTurn,
  );
  console.log(`\n✅  Loop terminated cleanly. Winner: ${winner.toUpperCase()}\n`);
  if (winner !== 'village' && winner !== 'mafia') throw new Error('invalid winner');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
