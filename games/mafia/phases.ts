import type { AgentState, Emit, GameState, PlayerId } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { pollLiveUrge } from './liveUrge';
import { resolveConfig, type MafiaConfig } from './config';
import { rngFloat, rngPick } from './rng';

// Opt-in score breakdown for debugging the urge auction. Debug-only logging — it
// never changes a game outcome, so it stays an env flag (not a game setting).
const DEBUG_URGE = !!(typeof process !== 'undefined' && process.env?.MAFIA_DEBUG_URGE);

// Resolved config off live state (spec §2). Every tunable below reads from here.
const cfg = (state: GameState): MafiaConfig => (state.meta.config as MafiaConfig | undefined) ?? resolveConfig({});

export const PHASE = {
  NIGHT: 'NIGHT',
  DISCUSSION: 'DISCUSSION',
  VOTE: 'VOTE',
} as const;

export const PHASES = [PHASE.NIGHT, PHASE.DISCUSSION, PHASE.VOTE];

const discussionRounds = (state: GameState): number => cfg(state).discussionRounds;

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
type Disc = { round: number; beat: number; budget: number; spoke: Record<PlayerId, number>; last: PlayerId | null; directTo?: PlayerId | null; mustAnswer?: PlayerId | null };

export function nextSpeaker(state: GameState): PlayerId | null | Promise<PlayerId | null> {
  if (state.phase !== PHASE.DISCUSSION) return null;
  const living = alive(state);
  const meta = state.meta; // Record<string, any> — per-discussion scratch lives here

  // Per-discussion state, re-initialised each round (discussion runs once/round).
  // Budget counts AI beats only — the human is no longer a scheduled seat (they
  // interject in real time), so they don't consume the round's speaking turns.
  if (!meta.disc || meta.disc.round !== state.round) {
    const aiCount = living.filter((p) => !p.private.human).length;
    meta.disc = { round: state.round, beat: 0, budget: aiCount * discussionRounds(state), spoke: {} as Record<PlayerId, number>, last: null as PlayerId | null };
    meta.humanWantsSkip = false; // fresh discussion → no pending skip request
    meta.forceSkip = false; // and no pending dev force-skip
  }
  const d = meta.disc;

  // Dev force-skip: jump straight to the vote, bypassing the consensus check below.
  if (meta.forceSkip) return null;

  // Directed reply: the human addressed a specific agent (clicked them; the line was
  // prefixed with their name). Hand THAT agent the floor for the next beat — one
  // guaranteed answer — instead of whoever merely scores highest. It clears after
  // firing, so normal urge-based scheduling resumes and the table still reacts. This
  // overrides the normal budget so a direct question gets a direct answer — but only up
  // to a HARD ceiling, so a table that puts someone on the spot every beat (e.g. accuse
  // → answer → accuse) still ends the day instead of looping forever.
  const hardCap = d.budget + living.length;
  if (d.directTo && d.beat < hardCap) {
    const target = living.find((p) => p.id === d.directTo && !p.private.human);
    d.directTo = null;
    if (target && target.id !== d.last) {
      d.beat += 1;
      d.spoke[target.id] = (d.spoke[target.id] ?? 0) + 1;
      d.last = target.id;
      d.mustAnswer = target.id; // they were just put on the spot → must answer (can't yield)
      return target.id;
    }
  }
  d.mustAnswer = null; // no one is on the spot on a normal beat

  // Consensus skip-to-vote: if the human has asked to move on AND a majority of the
  // living table is ready (the human + every AI that has already said its piece),
  // end discussion early. Otherwise the request is ignored and discussion continues.
  if (meta.humanWantsSkip) {
    const ready = living.filter((p) => p.private.human || (d.spoke[p.id] ?? 0) >= discussionRounds(state)).length;
    if (ready * 2 > living.length) return null;
  }

  if (d.beat >= d.budget) return null;

  const recent = state.publicLog.filter((l) => l.speaker !== 'system').slice(-2) as LogLine[];
  // AIs only, and never twice in a row. The human isn't scheduled — they cut in
  // whenever they want (their line is injected at the beat boundary by the route).
  const candidates = living.filter((p) => p.id !== d.last && !p.private.human);

  // Score every candidate, take the keenest, and COMMIT the pick (spend a beat of the
  // round's speaking budget). Shared by the sync free path and the async live path.
  const pick = (): PlayerId | null => {
    let bestId: PlayerId | null = null;
    let bestScore = -Infinity;
    for (const p of candidates) {
      const s = urge(state, p, recent, d);
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

  if (cfg(state).liveUrge) return pollLiveUrge(state, candidates.filter((p) => !p.private.human)).then(pick);
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

  if (cfg(state).liveUrge) return pollLiveUrge(state, candidates).then(pick);
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

  // 1) LEGACY SPINE — unchanged (jitter now drawn from the seeded stream, §10).
  let s = 0.1 + rngFloat(state) * 0.15;
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

  // 6) a little extra noise so it never feels mechanical (seeded stream, §10).
  s += rngFloat(state) * 0.1;
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

// Loud ↔ quiet baseline removed: every seat now speaks on an equal footing so the
// model — not a hand-tuned personality — decides how often it takes the floor.

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
      for (let r = 0; r < discussionRounds(state); r++) order.push(...alive(state).map((p) => p.id));
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
      // Fresh vote: clear any stale runoff state from a previous day.
      state.meta.revoteAmong = null;
      state.meta.revoteDone = false;
      break;
    case PHASE.VOTE: {
      const needsRevote = await tallyVotes(state, emit);
      if (needsRevote) {
        // A tied day under dayVoteTie:'revote' — stay in VOTE for one runoff among the
        // tied seats (the vote tool restricts targets to state.meta.revoteAmong).
        state.phase = PHASE.VOTE;
        break;
      }
      state.phase = PHASE.NIGHT;
      state.round += 1;
      // fresh night
      state.meta.killProposals = {};
      state.meta.nightKill = null;
      state.meta.protect = null;
      state.meta.revoteAmong = null;
      state.meta.revoteDone = false;
      break;
    }
  }
}

function resolveNight(state: GameState, emit: Emit): void {
  const c = cfg(state);
  const proposals: Record<PlayerId, PlayerId> = state.meta.killProposals ?? {};
  const protectedId: PlayerId | null = state.meta.protect ?? null;

  // Remember who the doctor shielded tonight so they can't protect the same player
  // two nights running (gated by config.doctorRepeatProtect).
  state.meta.lastProtect = protectedId;

  // §5 step 2 — kill selection. Tally Mafia proposals → target via majority(); a tie
  // resolves per config.nightKillTie ('random' picks one of the tied; 'no_kill' fizzles).
  const target = c.firstNightKill || state.round > 1 ? majority(state, Object.values(proposals)) : null;
  const victim = target ? state.players.find((p) => p.id === target) : undefined;
  // §1 firstNightKill: when off, round 1's night never produces a kill (Detective and
  // Doctor still act). Suppress the kill outcome but keep the quiet-night announcement.
  const firstNightSuppressed = !c.firstNightKill && state.round === 1;

  console.log(
    `[night] resolve — proposals: ${Object.values(proposals).map((id) => nameOf(state, id)).join(', ') || 'none'} | ` +
      `target: ${target ? nameOf(state, target) : 'none'} | protected: ${protectedId ? nameOf(state, protectedId) : 'none'} | ` +
      `outcome: ${firstNightSuppressed ? 'NIGHT0' : target && victim?.alive ? (target === protectedId ? 'SAVED' : 'KILL') : 'QUIET'}`,
  );

  // Doctor save: the Mafia DID lock a target, but it was the protected player.
  // §5 [FIX] — announced NEUTRALLY: the public line must NOT reveal that a doctor
  // exists or that an attack happened (the Mafia read the shared transcript). The
  // anonymous {type:'night', outcome:'saved'} event still fires for the presentation.
  if (target && victim && victim.alive && target === protectedId) {
    emit({ type: 'night', outcome: 'saved' });
    state.publicLog.push({ speaker: 'system', text: 'Dawn breaks. No one died.' });
    return;
  }

  // A kill landed.
  if (target && victim && victim.alive) {
    victim.alive = false;
    emit({ type: 'death', target: victim.id, role: victim.role });
    // Role is revealed in the public line only when config.revealRoleOnDeath is set;
    // otherwise the death stays hidden (the host also strips role from the wire, §9).
    const reveal = c.revealRoleOnDeath ? ` They were the ${victim.role}.` : '';
    state.publicLog.push({ speaker: 'system', text: `Dawn breaks. ${victim.name} was found dead.${reveal}` });
    return;
  }

  // §1 firstNightKill OFF: round 1's deathless dawn is mandated by the RULES — not a
  // doctor save, not the Mafia holding back. Announce it as such so the agents (who
  // read the public log) don't treat it as a meaningful anomaly and muse "weird that
  // no one died" about an outcome the ruleset made inevitable.
  if (firstNightSuppressed) {
    emit({ type: 'night', outcome: 'night0' });
    state.publicLog.push({
      speaker: 'system',
      text: 'Dawn breaks on the first day. By the town’s rules no one can be killed on the opening night, so everyone is still here. The hunt for the Mafia begins now.',
    });
    return;
  }

  // No kill landed (no target settled, or a 'no_kill' tie).
  emit({ type: 'night', outcome: 'quiet' });
  state.publicLog.push({ speaker: 'system', text: 'Dawn breaks. The night passed quietly — no one died.' });
}

// Returns true when the day tied under dayVoteTie:'revote' and a single runoff should
// run (the caller keeps the phase on VOTE); false when the day is resolved.
async function tallyVotes(state: GameState, emit: Emit): Promise<boolean> {
  const c = cfg(state);
  const memVotes: Record<PlayerId, PlayerId> = state.meta.votes ?? {};

  // Tally the votes recorded in game state this round.
  const counts: Record<PlayerId, number> = {};
  for (const target of Object.values(memVotes)) counts[target] = (counts[target] ?? 0) + 1;

  // Emit each vote for the UI.
  for (const [voter, target] of Object.entries(memVotes)) {
    emit({ type: 'vote', agent: voter, target });
  }

  state.meta.votes = {};

  // Front-runner(s): the highest vote count, and everyone tied at it.
  const bestN = Object.values(counts).reduce((m, n) => Math.max(m, n), 0);
  const tied: PlayerId[] = state.players.filter((p) => (counts[p.id] ?? 0) === bestN && bestN > 0).map((p) => p.id);

  // No votes at all → no elimination (nothing to act on, regardless of allowNoLynch).
  if (bestN === 0 || tied.length === 0) {
    state.publicLog.push({ speaker: 'system', text: 'The town could not agree. No one was eliminated.' });
    return false;
  }

  // Resolve a tie among the front-runners per config.dayVoteTie.
  let best: PlayerId | null = null;
  if (tied.length === 1) {
    best = tied[0];
  } else {
    const mode = c.dayVoteTie;
    if (mode === 'no_lynch' && c.allowNoLynch) {
      state.publicLog.push({ speaker: 'system', text: `The vote tied (${bestN} each). No one was eliminated.` });
      return false;
    }
    if (mode === 'revote' && !state.meta.revoteDone) {
      // First tie under 'revote': run ONE runoff among the tied seats.
      state.meta.revoteAmong = tied;
      state.meta.revoteDone = true;
      const names = tied.map((id) => nameOf(state, id)).join(', ');
      state.publicLog.push({ speaker: 'system', text: `The vote tied between ${names}. Revote — choose one of them.` });
      return true;
    }
    // 'random', a no_lynch tie when no-lynch is disallowed, or a still-tied second
    // round: break the tie from the seeded stream (§10).
    best = rngPick(state, tied);
  }

  const victim = state.players.find((p) => p.id === best)!;
  victim.alive = false;
  emit({ type: 'reveal', target: victim.id, role: victim.role });
  const reveal = c.revealRoleOnDeath ? ` They were the ${victim.role}.` : '';
  state.publicLog.push({ speaker: 'system', text: `The town voted out ${victim.name} (${bestN} votes).${reveal}` });
  return false;
}

// The Mafia's kill is a vote: each member proposes a target, and the target with the
// most proposals dies. A tie resolves per config.nightKillTie: 'random' picks one of
// the tied front-runners from the seeded stream (§10); 'no_kill' lets the night pass
// with no kill rather than forcing one.
function majority(state: GameState, ids: PlayerId[]): PlayerId | null {
  if (ids.length === 0) return null;
  const counts: Record<PlayerId, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  const bestN = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === bestN);
  if (top.length === 1) return top[0];
  if (cfg(state).nightKillTie === 'no_kill') return null;
  return rngPick(state, top);
}

// exported for context rendering
export { nameOf, alive };
