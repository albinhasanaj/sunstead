import type { AgentState, Emit, GameState, PlayerId } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { busEnabled, drain, publish, TOPIC_TABLE, TOPIC_VOTES } from '../../lib/bus';

export const PHASE = {
  NIGHT: 'NIGHT',
  DISCUSSION: 'DISCUSSION',
  VOTE: 'VOTE',
} as const;

export const PHASES = [PHASE.NIGHT, PHASE.DISCUSSION, PHASE.VOTE];

const DISCUSSION_ROUNDS = 2;

// Phase 1 concurrency: instead of a fixed seat order, pick the next discussion
// speaker per beat from a cheap heuristic "eagerness" — so whoever was just
// accused/named jumps in to respond, quieter players get pulled in, and nobody
// speaks twice in a row. No extra LLM calls: only the chosen speaker generates.
export function nextSpeaker(state: GameState): PlayerId | null {
  if (state.phase !== PHASE.DISCUSSION) return null;
  const living = alive(state);
  const meta = state.meta as any;

  // Per-discussion state, re-initialised each round (discussion runs once/round).
  if (!meta.disc || meta.disc.round !== state.round) {
    meta.disc = { round: state.round, beat: 0, budget: living.length * DISCUSSION_ROUNDS, spoke: {} as Record<PlayerId, number>, last: null as PlayerId | null };
    meta.humanWantsSkip = false; // fresh discussion → no pending skip request
  }
  const d = meta.disc;

  // Consensus skip-to-vote: if the human has asked to move on AND a majority of the
  // living table is ready (the human + every AI that has already said its piece),
  // end discussion early. Otherwise the request is ignored and discussion continues.
  if (meta.humanWantsSkip) {
    const ready = living.filter((p) => p.private.human || (d.spoke[p.id] ?? 0) >= DISCUSSION_ROUNDS).length;
    if (ready * 2 > living.length) return null;
  }

  if (d.beat >= d.budget) return null;

  const recent = state.publicLog.filter((l) => l.speaker !== 'system').slice(-2);

  let bestId: PlayerId | null = null;
  let bestScore = -Infinity;
  for (const p of living) {
    if (p.id === d.last) continue; // never speak twice in a row
    let s = 0.1 + Math.random() * 0.15;
    s += 0.25 * Math.max(0, 2 - (d.spoke[p.id] ?? 0)); // pull in quieter players
    // addressed/named by someone else in the last couple of lines → wants to reply
    if (recent.some((l) => l.speaker !== p.id && l.text.toLowerCase().includes(p.name.toLowerCase()))) s += 0.6;
    if (p.private.human) s += 0.5; // make sure a human is regularly offered the floor
    if (s > bestScore) { bestScore = s; bestId = p.id; }
  }
  if (bestId) {
    d.beat += 1;
    d.spoke[bestId] = (d.spoke[bestId] ?? 0) + 1;
    d.last = bestId;
  }
  return bestId;
}

const alive = (s: GameState) => s.players.filter((p) => p.alive);
const aliveMafia = (s: GameState) => alive(s).filter((p) => isMafia(p.role));
const nameOf = (s: GameState, id: PlayerId) => s.players.find((p) => p.id === id)?.name ?? id;

// Who acts this phase, and in what order. Repeats a player to give a phase
// multiple conversational rounds.
export function turnOrder(state: GameState): PlayerId[] {
  switch (state.phase) {
    case PHASE.NIGHT: {
      // The night is silent: each Mafia takes ONE turn to lock in a kill (no chat),
      // then the special roles act. There are no discussion passes.
      const mafia = aliveMafia(state);
      const specials = alive(state).filter(
        (p) => p.role === ROLE.DETECTIVE || p.role === ROLE.DOCTOR,
      );
      return [...mafia, ...specials].map((p) => p.id);
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
export async function advancePhase(state: GameState, emit: Emit): Promise<void> {
  switch (state.phase) {
    case PHASE.NIGHT:
      resolveNight(state, emit);
      state.phase = PHASE.DISCUSSION;
      break;
    case PHASE.DISCUSSION:
      state.phase = PHASE.VOTE;
      break;
    case PHASE.VOTE:
      await tallyVotes(state, emit);
      state.phase = PHASE.NIGHT;
      state.round += 1;
      // fresh night
      state.meta.killProposals = {};
      state.meta.nightKill = null;
      state.meta.protect = null;
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
      void publish(TOPIC_TABLE, {
        kind: 'death', gameId: state.meta.gameId as string, round: state.round,
        target: victim.name, role: victim.role, // structured (analytics) only — never shown to agents
        text: `${victim.name} was found dead.`,
      });
      // Hidden-role variant: the death does NOT reveal what they were. Only the
      // player themselves (and Mafia teammates) ever know a role.
      state.publicLog.push({
        speaker: 'system',
        text: `Dawn breaks. ${victim.name} was found dead.`,
      });
      return;
    }
  }
  state.publicLog.push({
    speaker: 'system',
    text: 'Dawn breaks. Miraculously, no one died last night.',
  });
}

async function tallyVotes(state: GameState, emit: Emit): Promise<void> {
  const gameId = state.meta.gameId as string;
  const round = state.round;
  const memVotes: Record<PlayerId, PlayerId> = state.meta.votes ?? {};

  // Primary path: decide the result by CONSUMING the votes topic from Kafka via
  // the Aiven MCP. Fall back to the in-memory votes if Kafka is off or empty.
  const counts: Record<PlayerId, number> = {};
  let source = 'memory';
  if (busEnabled()) {
    const msgs = await drain(TOPIC_VOTES);
    const mine = msgs.filter((m) => m.gameId === gameId && m.round === round && m.targetId);
    if (mine.length) {
      const byVoter: Record<string, string> = {};
      for (const m of mine) byVoter[m.voterId as string] = m.targetId as string; // last vote wins
      for (const target of Object.values(byVoter)) counts[target] = (counts[target] ?? 0) + 1;
      source = 'kafka';
      console.error(`\u{1F5F3}\uFE0F  tally via Kafka: consumed ${mine.length} vote record(s) for round ${round} through Aiven MCP.`);
    }
  }
  if (source === 'memory') {
    for (const target of Object.values(memVotes)) counts[target] = (counts[target] ?? 0) + 1;
  }

  // Emit each vote for the UI (from the always-present in-memory record).
  for (const [voter, target] of Object.entries(memVotes)) {
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
  void publish(TOPIC_TABLE, {
    kind: 'reveal', gameId, round, target: victim.name, role: victim.role, // structured only — never shown to agents
    text: `${victim.name} was voted out.`,
  });
  // Hidden-role variant: the vote-out does NOT reveal what they were.
  state.publicLog.push({
    speaker: 'system',
    text: `The town voted out ${victim.name} (${bestN} votes).`,
  });
}

// The Mafia's kill is a vote: each member proposes a target, and the target with
// the most proposals dies. On a tie, pick uniformly at random among the tied
// front-runners (rather than silently favouring whoever proposed first).
function majority(ids: PlayerId[]): PlayerId | null {
  if (ids.length === 0) return null;
  const counts: Record<PlayerId, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  const bestN = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === bestN);
  return top[Math.floor(Math.random() * top.length)];
}

// exported for context rendering
export { nameOf, alive };
