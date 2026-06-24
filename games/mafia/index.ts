import type { AgentState, GameDefinition, GameState } from '../../engine/types';
import { PERSONALITIES, roleDistribution } from './roles';
import { PHASE, PHASES, turnOrder, advancePhase } from './phases';
import { toolsFor } from './tools';
import { winner } from './winCondition';
import { systemPrompt, renderContext } from './prompts';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setup(playerNames: string[]): GameState {
  // Use provided names, else fall back to the model-themed personalities.
  const n = Math.max(playerNames.length, 4);
  const personalities = playerNames.length
    ? playerNames.map((name, i) => ({ name, trait: PERSONALITIES[i % PERSONALITIES.length].trait }))
    : shuffle(PERSONALITIES).slice(0, n);

  const roles = shuffle(roleDistribution(personalities.length));

  const players: AgentState[] = personalities.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    alive: true,
    role: roles[i],
    private: { trait: p.trait, suspicions: {}, notes: '' },
  }));

  return {
    players,
    phase: PHASE.NIGHT,
    round: 1,
    publicLog: [],
    winner: null,
    meta: { votes: {}, killProposals: {}, nightKill: null, protect: null, mafiaChat: [] },
  };
}

export const mafiaGame: GameDefinition = {
  id: 'mafia',
  setup,
  phases: PHASES,
  turnOrder,
  toolsFor,
  advancePhase,
  winner,
  systemPrompt,
  renderContext,
  model: process.env.MAFIA_MODEL || 'anthropic/claude-sonnet-4.6',
};

export default mafiaGame;
