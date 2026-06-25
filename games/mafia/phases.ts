import type { AgentState, Emit, GameState, PlayerId } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { busEnabled, drain, publish, TOPIC_TABLE, TOPIC_VOTES } from '../../lib/bus';
import { pollLiveUrge } from './liveUrge';

// Paid-tier live hand-raise (each seat rates its own urge via its own model) vs the
// default free-tier pure-code auction. Plus an opt-in score breakdown for debugging.
const LIVE_URGE = process.env.MAFIA_LIVE_URGE === '1';
const DEBUG_URGE = !!process.env.MAFIA_DEBUG_URGE;

export const PHASE = {
  NIGHT: 'NIGHT',
  DISCUSSION: 'DISCUSSION',
  VOTE: 'VOTE',
} as const;

export const PHASES = [PHASE.NIGHT, PHASE.DISCUSSION, PHASE.VOTE];

const DISCUSSION_ROUNDS = 2;

// Reactive discussion: instead of a fixed seat order, each beat picks the speaker who
// most wants the floor — an "urge to speak" auction (urge() below). Whoever was just
// named jumps in to reply, a quieter seat with a live-triggered thought breaks into a
// two-person duel, and nobody speaks twice in a row. On the free tier this costs ZERO
// extra LLM calls: the urge is assembled from signals each seat already produced in
// its own update_beliefs (its on-deck "bid") plus the live transcript. The optional
// paid path (MAFIA_LIVE_URGE=1) first polls each silent seat's own model for a 1-token
// hand-raise, then scores — see ./liveUrge.
type LogLine = { speaker: PlayerId; text: string };
// Per-discussion scratch held on state.meta.disc (untyped Record there; typed here).
type Disc = { round: number; beat: number; budget: number; spoke: Record<PlayerId, number>; last: PlayerId | null };

export function nextSpeaker(state: GameState): PlayerId | null | Promise<PlayerId | null> {
  if (state.phase !== PHASE.DISCUSSION) return null;
  const living = alive(state);
  const meta = state.meta; // Record<string, any> — per-discussion scratch lives here

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

  const recent = state.publicLog.filter((l) => l.speaker !== 'system').slice(-2) as LogLine[];
  const candidates = living.filter((p) => p.id !== d.last); // never speak twice in a row

  // Score every candidate, take the keenest, and COMMIT the pick (spend a beat of the
  // round's speaking budget). Shared by the sync free path and the async live path.
  const pick = (): PlayerId | null => {
    let bestId: PlayerId | null = null;
    let bestScore = -Infinity;
    for (const p of candidates) {
      let s = urge(state, p, recent, d);
      if (p.private.human) s += 0.5; // keep offering a human the floor regularly
      if (DEBUG_URGE) console.log(`[urge] r${state.round} b${d.beat} ${p.name.padEnd(9)} ${s.toFixed(3)}`);
      if (s > bestScore) { bestScore = s; bestId = p.id; }
    }
    if (bestId) {
      d.beat += 1;
      d.spoke[bestId] = (d.spoke[bestId] ?? 0) + 1;
      d.last = bestId;
      if (DEBUG_URGE) console.log(`[urge] → floor: ${nameOf(state, bestId)} (${bestScore.toFixed(3)})`);
    }
    return bestId;
  };

  if (LIVE_URGE) return pollLiveUrge(state, candidates.filter((p) => !p.private.human)).then(pick);
  return pick();
}

// Idle "speaking pressure": when the human holds the DISCUSSION floor but has gone
// quiet, this picks the AI most eager to break the silence so the table never freezes.
// Excludes the human, the seat that just spoke, and any ids passed in; never picks a
// non-AI. It commits the pick (so the speaker won't immediately repeat) but does NOT
// spend the round's speaking budget — these are bonus lines filling idle time, not
// beats. Returns null if no AI is available to step in.
export function mostEagerSpeaker(state: GameState, excludeIds: PlayerId[] = []): PlayerId | null | Promise<PlayerId | null> {
  if (state.phase !== PHASE.DISCUSSION) return null;
  const d = state.meta.disc; // per-discussion state seeded by nextSpeaker
  if (!d) return null;
  const recent = state.publicLog.filter((l) => l.speaker !== 'system').slice(-2) as LogLine[];
  const exclude = new Set<PlayerId>([...excludeIds, ...(d.last ? [d.last as PlayerId] : [])]);
  const candidates = alive(state).filter((p) => !p.private.human && !exclude.has(p.id));

  const pick = (): PlayerId | null => {
    let bestId: PlayerId | null = null;
    let bestScore = -Infinity;
    for (const p of candidates) {
      const s = urge(state, p, recent, d);
      if (s > bestScore) { bestScore = s; bestId = p.id; }
    }
    if (bestId) {
      d.spoke[bestId] = (d.spoke[bestId] ?? 0) + 1;
      d.last = bestId;
    }
    return bestId;
  };

  if (LIVE_URGE) return pollLiveUrge(state, candidates).then(pick);
  return pick();
}

// ── the "urge to speak" auction ────────────────────────────────────────────────
// A pure read of how much one living seat wants the floor this beat. All scheduler
// mutation (beat/spoke/last) stays in the callers. The legacy heuristic (jitter +
// quiet-pull + named-bonus) is preserved verbatim as the spine, and every new content
// signal defaults to zero, so with no bids the auction degrades to the old behaviour.
function urge(state: GameState, p: AgentState, recent: LogLine[], d: Disc): number {
  const others = recent.filter((l) => l.speaker !== p.id); // ignore my own last line
  const beat = d.beat;

  // 1) LEGACY SPINE — unchanged.
  let s = 0.1 + Math.random() * 0.15;
  s += 0.25 * Math.max(0, 2 - (d.spoke[p.id] ?? 0)); // pull in quieter seats
  if (others.some((l) => l.text.toLowerCase().includes(p.name.toLowerCase()))) s += 0.6; // I was named

  const bid = p.private.bid as { pressure?: number; triggers?: string[]; round?: number; beat?: number } | undefined;
  const hay = others.map((l) => l.text.toLowerCase()).join('  ¶  ');

  // 2) TRIGGER-HIT — a self-authored trigger matches the live last lines (content-
  //    driven entry, even when I wasn't named). Substring = strong; token-overlap = fuzzy.
  if (bid?.triggers?.length && hay) {
    let best = 0;
    for (const raw of bid.triggers) {
      const t = String(raw).trim().toLowerCase();
      if (!t) continue;
      if (t.length >= 3 && hay.includes(t)) { best = 1; break; }
      const tt = tokenize(t);
      if (tt.length) {
        const ht = new Set(tokenize(hay));
        best = Math.max(best, tt.filter((w) => ht.has(w)).length / tt.length);
      }
    }
    s += 0.7 * best;
  }

  // 3) STAKE — how suspicious I am of whoever just spoke (I want to push back).
  const lastOther = others[others.length - 1];
  if (lastOther) s += 0.45 * (p.private.suspicions?.[lastOther.speaker] ?? 0);

  // 4) PRESSURE — my self-rated 0-10 urge (or the live hand-raise), decayed by beats
  //    since I posted it; a stale-round bid is heavily discounted so it can't hog the floor.
  const live = p.private.liveUrge as { value?: number; round?: number; beat?: number } | undefined;
  let pressure = 0;
  if (live && live.round === state.round) {
    pressure = live.value ?? 0; // a fresh live hand-raise overrides the predicted bid
  } else if (bid && typeof bid.pressure === 'number') {
    const age = bid.round === state.round ? Math.max(0, beat - (bid.beat ?? beat)) : beat + 2;
    pressure = bid.pressure * Math.pow(0.5, age);
  }
  s += 0.06 * Math.max(0, Math.min(10, pressure));

  // 5) ANTI-MONOPOLY — when a tight pair owns the recent floor, lift the outsiders so
  //    a third voice can break into the duel.
  s += antiMonopolyBoost(state, p.id);

  // 6) PERSONA — loud seats volunteer; quiet, calculating seats hold back.
  s += personaBias(p);

  // 7) a little extra noise so it never feels mechanical.
  s += Math.random() * 0.1;
  return s;
}

const URGE_STOP = new Set(['the', 'and', 'you', 'are', 'that', 'this', 'was', 'for', 'with', 'but', 'they', 'not', 'who', 'your', 'out', 'has', 'its', 'what', 'why', 'how', 'is', 'it', 'to', 'of', 'im', 'dont', 'about', 'just', 'think']);
function tokenize(x: string): string[] {
  return (x.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2 && !URGE_STOP.has(w));
}

const MONO_WINDOW = 4; // last N non-system lines examined for a floor monopoly
function antiMonopolyBoost(state: GameState, candidateId: PlayerId): number {
  const lines = state.publicLog.filter((l) => l.speaker !== 'system').slice(-MONO_WINDOW);
  if (lines.length < MONO_WINDOW) return 0; // not enough talk yet to have a monopoly
  const counts: Record<PlayerId, number> = {};
  for (const l of lines) counts[l.speaker] = (counts[l.speaker] ?? 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topTwoShare = sorted.slice(0, 2).reduce((n, [, c]) => n + c, 0) / lines.length;
  const dominated = sorted.length <= 2 || topTwoShare >= 0.75; // a tight pair owns the floor
  if (!dominated) return 0;
  const dominators = new Set(sorted.slice(0, 2).map(([id]) => id));
  return dominators.has(candidateId) ? 0 : 0.5; // boost only the OUTSIDERS
}

// Loud ↔ quiet baseline. Known seats get a hand-tuned delta (justified by their trait);
// an unknown/custom seat derives one from trait keywords. Cached on the seat so we
// don't re-parse the trait string every beat.
const PERSONA_BIAS: Record<string, number> = {
  Grok: 0.2, // roasts everyone — always has a quip
  Gemini: 0.15, // know-it-all who dazzles — volunteers facts
  Llama: 0.1, // open-book, shares freely
  GPT: 0.05, // agreeable diplomat — engages, but hedged
  Qwen: 0.0, // chameleon — reactive, neutral baseline
  Claude: -0.05, // weighs every side — deliberate, slightly held back
  Mistral: -0.1, // says little, wastes no words
  DeepSeek: -0.15, // quiet, reveals nothing early — most reserved
};
const PERSONA_LOUD = ['roast', 'snark', 'dazzle', 'confident', 'know-it-all', 'shares freely', 'open-book', 'loud', 'blunt', 'irreverent', 'jokester', 'assertive'];
const PERSONA_QUIET = ['quiet', 'calculating', 'reveals nothing', 'minimalist', 'says little', 'reserved', 'careful', 'deliberate', 'weighs', 'principled', 'cautious'];
function personaBias(p: AgentState): number {
  if (typeof p.private._persona === 'number') return p.private._persona;
  let delta = PERSONA_BIAS[p.name];
  if (delta === undefined) {
    const t = String(p.private.trait ?? '').toLowerCase();
    delta = 0;
    for (const k of PERSONA_LOUD) if (t.includes(k)) delta += 0.05;
    for (const k of PERSONA_QUIET) if (t.includes(k)) delta -= 0.05;
    delta = Math.max(-0.15, Math.min(0.2, delta));
  }
  p.private._persona = delta;
  return delta;
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
  const victim = target ? state.players.find((p) => p.id === target) : undefined;

  console.log(
    `[night] resolve — proposals: ${Object.values(proposals).map((id) => nameOf(state, id)).join(', ') || 'none'} | ` +
      `target: ${target ? nameOf(state, target) : 'none'} | protected: ${protectedId ? nameOf(state, protectedId) : 'none'} | ` +
      `outcome: ${target && victim?.alive ? (target === protectedId ? 'SAVED' : 'KILL') : 'QUIET'}`,
  );

  // Doctor save: the Mafia DID lock a target, but it was the protected player.
  // Announced anonymously — no one learns who was targeted or who shielded them.
  if (target && victim && victim.alive && target === protectedId) {
    emit({ type: 'night', outcome: 'saved' });
    state.publicLog.push({
      speaker: 'system',
      text: 'Dawn breaks. The Mafia struck in the night — but the doctor shielded their target. No one died.',
    });
    return;
  }

  // A kill landed.
  if (target && victim && victim.alive) {
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

  // No kill was locked in at all (Mafia never settled on a target).
  emit({ type: 'night', outcome: 'quiet' });
  state.publicLog.push({
    speaker: 'system',
    text: 'Dawn breaks. The night passed quietly — no one died.',
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
