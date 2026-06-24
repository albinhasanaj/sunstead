import type { AgentState, Emit, GameState, PlayerId } from '../../engine/types';
import { ROLE, isMafia } from './roles';

export const PHASE = {
  NIGHT: 'NIGHT',
  DISCUSSION: 'DISCUSSION',
  VOTE: 'VOTE',
} as const;

export const PHASES = [PHASE.NIGHT, PHASE.DISCUSSION, PHASE.VOTE];

const DISCUSSION_ROUNDS = 2;

const alive = (s: GameState) => s.players.filter((p) => p.alive);
const aliveMafia = (s: GameState) => alive(s).filter((p) => isMafia(p.role));
const nameOf = (s: GameState, id: PlayerId) => s.players.find((p) => p.id === id)?.name ?? id;

// Who acts this phase, and in what order. Repeats a player to give a phase
// multiple conversational rounds.
export function turnOrder(state: GameState): PlayerId[] {
  switch (state.phase) {
    case PHASE.NIGHT: {
      const mafia = aliveMafia(state);
      // 2 passes of night chat when the Mafia is a team; 1 when it's a lone wolf.
      const chat = mafia.length > 1 ? [...mafia, ...mafia] : mafia;
      const specials = alive(state).filter(
        (p) => p.role === ROLE.DETECTIVE || p.role === ROLE.DOCTOR,
      );
      return [...chat, ...specials].map((p) => p.id);
    }
    case PHASE.DISCUSSION: {
      const order: PlayerId[] = [];
      for (let r = 0; r < DISCUSSION_ROUNDS; r++) order.push(...alive(state).map((p) => p.id));
      return order;
    }
    case PHASE.VOTE:
      return alive(state).map((p) => p.id);
    default:
      return [];
  }
}

// Resolve the phase that just finished and advance to the next one.
export function advancePhase(state: GameState, emit: Emit): void {
  switch (state.phase) {
    case PHASE.NIGHT:
      resolveNight(state, emit);
      state.phase = PHASE.DISCUSSION;
      break;
    case PHASE.DISCUSSION:
      state.phase = PHASE.VOTE;
      break;
    case PHASE.VOTE:
      tallyVotes(state, emit);
      state.phase = PHASE.NIGHT;
      state.round += 1;
      // fresh night
      state.meta.killProposals = {};
      state.meta.nightKill = null;
      state.meta.protect = null;
      state.meta.mafiaChat = [];
      break;
  }
}

function resolveNight(state: GameState, emit: Emit): void {
  const proposals: Record<PlayerId, PlayerId> = state.meta.killProposals ?? {};
  const target = majority(Object.values(proposals));
  const protectedId: PlayerId | null = state.meta.protect ?? null;

  if (target && target !== protectedId) {
    const victim = state.players.find((p) => p.id === target);
    if (victim && victim.alive) {
      victim.alive = false;
      emit({ type: 'death', target: victim.id, role: victim.role });
      state.publicLog.push({
        speaker: 'system',
        text: `Dawn breaks. ${victim.name} was found dead. They were a ${victim.role}.`,
      });
      return;
    }
  }
  state.publicLog.push({
    speaker: 'system',
    text: 'Dawn breaks. Miraculously, no one died last night.',
  });
}

function tallyVotes(state: GameState, emit: Emit): void {
  const votes: Record<PlayerId, PlayerId> = state.meta.votes ?? {};
  const counts: Record<PlayerId, number> = {};
  for (const target of Object.values(votes)) counts[target] = (counts[target] ?? 0) + 1;

  for (const [voter, target] of Object.entries(votes)) {
    emit({ type: 'vote', agent: voter, target });
  }

  let best: PlayerId | null = null;
  let bestN = 0;
  // Hardcoded tiebreak: earliest player in seating order among those tied.
  for (const p of state.players) {
    const n = counts[p.id] ?? 0;
    if (n > bestN) {
      bestN = n;
      best = p.id;
    }
  }

  state.meta.votes = {};

  if (!best || bestN === 0) {
    state.publicLog.push({ speaker: 'system', text: 'The town could not agree. No one was eliminated.' });
    return;
  }
  const victim = state.players.find((p) => p.id === best)!;
  victim.alive = false;
  emit({ type: 'reveal', target: victim.id, role: victim.role });
  state.publicLog.push({
    speaker: 'system',
    text: `The town voted out ${victim.name} (${bestN} votes). They were a ${victim.role}.`,
  });
}

function majority(ids: PlayerId[]): PlayerId | null {
  if (ids.length === 0) return null;
  const counts: Record<PlayerId, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  let best: PlayerId | null = null;
  let bestN = 0;
  for (const [id, n] of Object.entries(counts)) {
    if (n > bestN) {
      bestN = n;
      best = id;
    }
  }
  return best;
}

// exported for context rendering
export { nameOf, alive };
