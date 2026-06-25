import type { AgentState, GameDefinition, GameState } from '../../engine/types';
import { DEFAULT_ROSTER, FALLBACK_MODEL, personalityByName, roleDistribution } from './roles';
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
  // Names → seats. Each known character carries its own model + trait; an unknown
  // custom name falls back to the default model and a neutral trait. With no names,
  // use the default roster (the seats reachable on the free tier today).
  const names = playerNames.length ? playerNames : DEFAULT_ROSTER;
  // MAFIA_MODEL forces every seat onto one model — handy on the free tier where
  // only some providers are reachable. Otherwise each seat keeps its own model.
  const forced = process.env.MAFIA_MODEL;
  const seats = names.map((name) => {
    const known = personalityByName(name);
    return {
      name,
      model: forced || known?.model || FALLBACK_MODEL,
      trait: known?.trait ?? 'a sharp, observant player who keeps their cards close.',
    };
  });

  const roles = shuffle(roleDistribution(seats.length));

  const players: AgentState[] = seats.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    alive: true,
    role: roles[i],
    private: { model: p.model, trait: p.trait, suspicions: {}, notes: '' },
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
  // Per-seat models come from each personality; this is only the fallback for a
  // seat with no model of its own. A game-wide override is still possible via env.
  model: process.env.MAFIA_MODEL || FALLBACK_MODEL,
  fallbackModel: FALLBACK_MODEL,
};

export default mafiaGame;
