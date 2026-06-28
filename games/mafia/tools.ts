import { z } from 'zod';
import type { AgentState, GameState, GameTool, PlayerId, ToolContext } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { PHASE } from './phases';
import { remember } from '../../lib/memory';
import { resolveConfig, type MafiaConfig } from './config';

// Resolved config off live state (spec §2). Role-rule gates below read from here.
const cfg = (state: GameState): MafiaConfig => (state.meta.config as MafiaConfig | undefined) ?? resolveConfig({});

// Resolve a player the model referred to by name (preferred) or id.
function resolve(state: GameState, ref: string, opts: { aliveOnly?: boolean } = {}): AgentState | undefined {
  const norm = ref.trim().toLowerCase();
  const pool = opts.aliveOnly ? state.players.filter((p) => p.alive) : state.players;
  return (
    pool.find((p) => p.name.toLowerCase() === norm) ??
    pool.find((p) => p.id.toLowerCase() === norm) ??
    pool.find((p) => p.name.toLowerCase().startsWith(norm))
  );
}

const inPhase = (phase: string) => (state: GameState) => state.phase === phase;

// A player may issue at most one DIRECT call-out (speak `to`) this often. Once per
// round keeps a pointed question weighty without letting one seat hog the floor by
// chain-pinning people. Bump to 2-3 for a rarer "few rounds" cooldown.
const DIRECT_CALL_COOLDOWN_ROUNDS = 1;

// Per-discussion scratch the scheduler keeps on state.meta.disc (typed in phases.ts).
type DiscScratch = { directTo?: PlayerId | null; mustAnswer?: PlayerId | null } | undefined;

// Whether this agent's direct call-out is off cooldown right now.
function directCallReady(agent: AgentState, round: number): boolean {
  const last = agent.private.lastDirectCallRound as number | undefined;
  return last == null || round - last >= DIRECT_CALL_COOLDOWN_ROUNDS;
}

// Put one player ON THE SPOT: hand them the next discussion beat (the scheduler's
// directTo) so they answer before anyone piles on. They cannot yield that turn (the
// answer-obligation is enforced in phases.ts via disc.mustAnswer). Public, like all
// day talk — everyone hears the call-out and listens for the reply.
function putOnSpot(ctx: ToolContext, target: AgentState | undefined): boolean {
  if (ctx.state.phase !== PHASE.DISCUSSION) return false;
  const disc = ctx.state.meta.disc as DiscScratch;
  if (!disc || !target || target.id === ctx.agent.id || !target.alive) return false;
  disc.directTo = target.id;
  return true;
}

// Record a public line by persisting it to long-term memory (pgvector). Awaited so
// a later turn's recall is guaranteed to see it.
async function recordPublic(ctx: ToolContext, text: string): Promise<void> {
  const gameId = ctx.state.meta.gameId as string;
  const userId = ctx.state.meta.userId as string | undefined;
  await remember({ gameId, userId, round: ctx.state.round, phase: ctx.state.phase, speaker: ctx.agent.name, text });
}

// ── update_beliefs ────────────────────────────────────────────────────────────
// Every turn starts here. Drives the minds panel and persists the agent's memory.
const updateBeliefs: GameTool = {
  name: 'update_beliefs',
  description:
    'ALWAYS call this FIRST, before any other action. Privately record your current read of the table: ' +
    'your reasoning and how suspicious you are of each living player (0 = certainly innocent, 1 = certainly Mafia). ' +
    'This is private — no one else sees it.',
  inputSchema: z.object({
    reasoning: z.string().describe('Your private chain of thought about who is Mafia and your plan.'),
    suspicions: z
      .array(
        z.object({
          player: z.string().describe('A living player by name'),
          level: z.number().min(0).max(1).describe('0 = trust, 1 = sure they are Mafia'),
        }),
      )
      .describe('Your suspicion of each living player.'),
    // On-deck "bid": how much you want the floor right now and what you're holding.
    // This is how you JUMP IN during discussion — even unprompted. It rides this same
    // call, so it costs nothing extra. Optional: omit it and you simply bid nothing.
    pressure: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe('0-10: how badly you want to speak RIGHT NOW (9 = you must jump in; 0 = nothing to add).'),
    holding: z.string().max(160).optional().describe('One line you are sitting on, ready to say the moment it becomes relevant.'),
    triggers: z
      .array(z.string().max(40))
      .max(5)
      .optional()
      .describe('Topics, player names, or claim-types that would pull you in to speak (e.g. "doctor claim", "Gemini", "vote on me").'),
  }),
  legalIn: () => true,
  // Prep, not an action: this records private state and must NOT end the turn. The
  // engine forces a real public action in a separate step after this one.
  prep: true,
  execute: async (args, ctx: ToolContext) => {
    const map: Record<PlayerId, number> = {};
    for (const s of args.suspicions ?? []) {
      const p = resolve(ctx.state, s.player, { aliveOnly: true });
      if (p) map[p.id] = s.level;
    }
    ctx.agent.private.suspicions = map;
    ctx.agent.private.notes = args.reasoning;
    // Stash the sanitized on-deck bid, stamped with round + beat so the scheduler can
    // decay a stale urge. Caps guard against a verbose/adversarial model bloating it.
    const bid = {
      pressure: typeof args.pressure === 'number' ? Math.max(0, Math.min(10, Math.round(args.pressure))) : 0,
      holding: String(args.holding ?? '').slice(0, 160),
      triggers: (Array.isArray(args.triggers) ? args.triggers : []).slice(0, 5).map((t: unknown) => String(t).toLowerCase().slice(0, 40)),
      round: ctx.state.round,
      beat: (ctx.state.meta.disc?.beat as number | undefined) ?? 0,
    };
    ctx.agent.private.bid = bid;
    // The bid rides the beliefs event (watch-mode only — play mode drops 'beliefs'
    // wholesale, so a human never sees AI pressure/holding/triggers).
    ctx.emit({ type: 'beliefs', agent: ctx.agent.id, suspicions: map, reasoning: args.reasoning, bid });
    return 'Beliefs recorded privately. Now take exactly ONE public/game action for this turn.';
  },
};

// ── speak / accuse / defend / claim_role  (DISCUSSION) ─────────────────────────
const speak: GameTool = {
  name: 'speak',
  description:
    'Say something out loud to the table during discussion — share reads, ask questions, apply pressure, or (if Mafia) ' +
    'blend in. Set "to" to a player\'s name to make it a DIRECT call-out: everyone still hears it, but that player is put ' +
    'on the spot and gets the next word to answer you. You may direct-call only once per round, so spend it well.',
  inputSchema: z.object({
    text: z.string().describe('What you say aloud, in your own voice.'),
    to: z
      .string()
      .optional()
      .describe('Optional: a living player to put on the spot with this line. They must answer next. One per round.'),
  }),
  legalIn: inPhase(PHASE.DISCUSSION),
  execute: async (args, ctx) => {
    ctx.state.publicLog.push({ speaker: ctx.agent.id, text: args.text });
    ctx.emit({ type: 'speak', agent: ctx.agent.id, text: args.text });
    await recordPublic(ctx, args.text);

    // Direct call-out: if a valid target is named and the caller is off cooldown, put
    // them on the spot. On cooldown, the line still posts but compels no answer.
    if (args.to) {
      const t = resolve(ctx.state, args.to, { aliveOnly: true });
      if (t && t.id !== ctx.agent.id) {
        if (directCallReady(ctx.agent, ctx.state.round) && putOnSpot(ctx, t)) {
          ctx.agent.private.lastDirectCallRound = ctx.state.round;
          ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'call_out', target: t.id });
          return `You put ${t.name} on the spot — they answer next. Your turn is over.`;
        }
        return `You spoke (you've already used your direct call-out this round, so ${t.name} isn't compelled to answer). Your turn is over.`;
      }
    }
    return 'You spoke. Your turn is over.';
  },
};

const accuse: GameTool = {
  name: 'accuse',
  description:
    'Publicly accuse a specific living player of being Mafia, with your reasoning. Stronger than just speaking.',
  inputSchema: z.object({
    target: z.string().describe('The player you accuse, by name.'),
    reason: z.string().describe('Why you think they are Mafia — said aloud.'),
  }),
  legalIn: inPhase(PHASE.DISCUSSION),
  execute: async (args, ctx) => {
    const t = resolve(ctx.state, args.target, { aliveOnly: true });
    // A fumbled target — yourself, or a name that doesn't resolve — must NEVER print
    // the hardcoded "I think X is Mafia" line. That's exactly how a cleared player
    // ends up "accusing" itself. Degrade to voicing the reasoning as a normal line
    // so the turn still produces real speech instead of an absurd self-accusation.
    if (!t || t.id === ctx.agent.id) {
      const line = (args.reason ?? '').trim();
      if (!line) return 'No valid player to accuse — skip the accusation and speak instead.';
      ctx.state.publicLog.push({ speaker: ctx.agent.id, text: line });
      ctx.emit({ type: 'speak', agent: ctx.agent.id, text: line });
      await recordPublic(ctx, line);
      return 'You spoke (no valid accusation target). Your turn is over.';
    }
    const line = `I think ${t.name} is Mafia. ${args.reason}`;
    ctx.state.publicLog.push({ speaker: ctx.agent.id, text: line });
    ctx.emit({ type: 'speak', agent: ctx.agent.id, text: line });
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'accuse', target: t.id });
    await recordPublic(ctx, line);
    // An accusation puts the accused on the spot — they get the next word to defend.
    // (No cooldown: accusing is its own weighty, self-committing act.)
    putOnSpot(ctx, t);
    return `You accused ${t.name}. Your turn is over.`;
  },
};

const defend: GameTool = {
  name: 'defend',
  description:
    'Publicly defend yourself or another living player against suspicion, with an argument said aloud.',
  inputSchema: z.object({
    target: z.string().optional().describe('Who you defend, by name. Omit to defend yourself.'),
    argument: z.string().describe('Your defense — said aloud.'),
  }),
  legalIn: inPhase(PHASE.DISCUSSION),
  execute: async (args, ctx) => {
    const t = args.target ? resolve(ctx.state, args.target, { aliveOnly: true }) : ctx.agent;
    const who = t && t.id !== ctx.agent.id ? `${t.name} is not Mafia. ` : '';
    const line = `${who}${args.argument}`;
    ctx.state.publicLog.push({ speaker: ctx.agent.id, text: line });
    ctx.emit({ type: 'speak', agent: ctx.agent.id, text: line });
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'defend', target: t?.id });
    await recordPublic(ctx, line);
    return 'You made your defense. Your turn is over.';
  },
};

const claimRole: GameTool = {
  name: 'claim_role',
  description:
    'Publicly claim to hold a particular role to gain trust. You may claim truthfully or lie — your choice.',
  inputSchema: z.object({
    role: z.string().describe('The role you claim (e.g. villager, detective, doctor).'),
    statement: z.string().describe('What you say as you make the claim, aloud.'),
  }),
  legalIn: inPhase(PHASE.DISCUSSION),
  execute: async (args, ctx) => {
    const line = `I'm the ${args.role}. ${args.statement}`;
    ctx.state.publicLog.push({ speaker: ctx.agent.id, text: line });
    ctx.emit({ type: 'speak', agent: ctx.agent.id, text: line });
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'claim_role' });
    await recordPublic(ctx, line);
    return 'You made your claim. Your turn is over.';
  },
};

// ── yield  (DISCUSSION) ────────────────────────────────────────────────────────
// Stand down and listen this beat instead of adding noise. Not for the opener, and
// not for whoever was just put on the spot (they owe the table an answer).
const yieldFloor: GameTool = {
  name: 'yield',
  description:
    'Stay SILENT this beat and let the discussion go on without you. Use it when your point was already made by someone ' +
    'else, or when a player was just put on the spot and should answer first — listening beats repeating. Adds nothing ' +
    'to the transcript.',
  inputSchema: z.object({
    note: z.string().max(120).optional().describe('Private reason you held back (no one sees this).'),
  }),
  legalIn: (state, agent) => {
    if (state.phase !== PHASE.DISCUSSION) return false;
    const disc = state.meta.disc as { mustAnswer?: PlayerId | null } | undefined;
    if (disc?.mustAnswer === agent.id) return false; // you were called out — you must answer
    const log = state.publicLog;
    return log.length > 0 && log[log.length - 1].speaker !== 'system'; // the opener must lead, not yield
  },
  execute: async (_args, ctx) => {
    // Drop this seat's bid so the auction won't re-pick it on its own urge next beat
    // (it can still be pulled back in by being named or directly addressed).
    ctx.agent.private.bid = {
      pressure: 0,
      holding: '',
      triggers: [],
      round: ctx.state.round,
      beat: (ctx.state.meta.disc?.beat as number | undefined) ?? 0,
    };
    return 'You held back and stayed silent this beat. Your turn is over.';
  },
};

// ── vote  (VOTE) ───────────────────────────────────────────────────────────────
const vote: GameTool = {
  name: 'vote',
  description: 'Cast your vote to eliminate one living player. Choose carefully — majority is eliminated.',
  inputSchema: z.object({ target: z.string().describe('The player you vote to eliminate, by name.') }),
  legalIn: inPhase(PHASE.VOTE),
  execute: async (args, ctx) => {
    const t = resolve(ctx.state, args.target, { aliveOnly: true });
    if (!t) return `No living player named "${args.target}".`;
    // Don't let a fumbled argument make a seat vote to eliminate ITSELF.
    if (t.id === ctx.agent.id) return `You can't vote for yourself — choose a different living player.`;
    // Runoff (dayVoteTie:'revote'): only the tied front-runners are eligible.
    const revoteAmong = ctx.state.meta.revoteAmong as PlayerId[] | null | undefined;
    if (revoteAmong && revoteAmong.length && !revoteAmong.includes(t.id)) {
      const names = revoteAmong.map((id) => ctx.state.players.find((p) => p.id === id)?.name ?? id).join(', ');
      return `This is a runoff — you may only vote for one of: ${names}.`;
    }
    ctx.state.meta.votes = ctx.state.meta.votes ?? {};
    ctx.state.meta.votes[ctx.agent.id] = t.id;
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'vote', target: t.id });
    return `Your vote for ${t.name} is locked in. Your turn is over.`;
  },
};

// ── mafia_propose_kill  (NIGHT, Mafia only) ─────────────────────────────────
// The night is SILENT, like real Mafia: there is no conversation. Each Mafia just
// silently locks in a victim, and they can see each other's picks converge.
const mafiaProposeKill: GameTool = {
  name: 'mafia_propose_kill',
  description:
    'Lock in your vote for which living NON-Mafia player the Mafia kills tonight. The target with the most ' +
    'Mafia votes dies at dawn (unless protected).',
  inputSchema: z.object({
    target: z.string().describe('The town player to kill, by name.'),
    reason: z.string().optional().describe('Your private reasoning for this target (kept secret — shown to no one).'),
  }),
  legalIn: (state, agent) => state.phase === PHASE.NIGHT && isMafia(agent.role),
  execute: async (args, ctx) => {
    const t = resolve(ctx.state, args.target, { aliveOnly: true });
    if (!t) return `No living player named "${args.target}".`;
    if (isMafia(t.role)) return `${t.name} is your own teammate. Pick a town player.`;
    ctx.state.meta.killProposals = ctx.state.meta.killProposals ?? {};
    ctx.state.meta.killProposals[ctx.agent.id] = t.id;
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'propose_kill', target: t.id });
    return `Your kill vote for ${t.name} is recorded.`;
  },
};

// ── optional roles (Phase 7) ───────────────────────────────────────────────────
const investigate: GameTool = {
  name: 'investigate',
  description: 'Secretly investigate one living player tonight. At dawn you privately learn if they are Mafia.',
  inputSchema: z.object({ target: z.string().describe('Who to investigate, by name.') }),
  legalIn: (state, agent) => state.phase === PHASE.NIGHT && agent.role === ROLE.DETECTIVE,
  execute: async (args, ctx) => {
    const t = resolve(ctx.state, args.target, { aliveOnly: true });
    if (!t) return `No living player named "${args.target}".`;
    // §5/§6 [FIX] — no self-investigation unless config.detectiveSelfInvestigate, so an
    // AI Detective can't waste a night learning it's town (mirrors the vote self-check).
    if (t.id === ctx.agent.id && !cfg(ctx.state).detectiveSelfInvestigate) {
      return `You can't investigate yourself — choose another living player.`;
    }
    const result = isMafia(t.role) ? 'MAFIA' : 'not Mafia';
    ctx.agent.private.knowledge = ctx.agent.private.knowledge ?? [];
    ctx.agent.private.knowledge.push(`Round ${ctx.state.round}: ${t.name} is ${result}.`);
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'investigate', target: t.id });
    ctx.emit({
      type: 'knowledge',
      agent: ctx.agent.id,
      target: t.id,
      result,
      text: `${t.name} is ${result}.`,
    });
    return `Your investigation: ${t.name} is ${result}. Keep this secret for now.`;
  },
};

const protect: GameTool = {
  name: 'protect',
  description:
    'Secretly protect one living player from the Mafia tonight. If they are attacked, they survive. ' +
    'You may NOT protect the same player two nights in a row.',
  inputSchema: z.object({ target: z.string().describe('Who to protect, by name.') }),
  legalIn: (state, agent) => state.phase === PHASE.NIGHT && agent.role === ROLE.DOCTOR,
  execute: async (args, ctx) => {
    const c = cfg(ctx.state);
    const t = resolve(ctx.state, args.target, { aliveOnly: true });
    if (!t) return `No living player named "${args.target}".`;
    // §6 — self-protection is config-gated (config.doctorSelfProtect).
    if (t.id === ctx.agent.id && !c.doctorSelfProtect) {
      return `You can't protect yourself in this game — choose another living player.`;
    }
    // No two-nights-in-a-row save unless config.doctorRepeatProtect allows it
    // (lastProtect is whoever you shielded the night just past).
    if (!c.doctorRepeatProtect && t.id === ctx.state.meta.lastProtect) {
      return `You shielded ${t.name} last night — you can't protect the same player two nights in a row. Choose someone else.`;
    }
    ctx.state.meta.protect = t.id;
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'protect', target: t.id });
    return `You are protecting ${t.name} tonight.`;
  },
};

const ALL: GameTool[] = [
  updateBeliefs,
  speak,
  accuse,
  defend,
  claimRole,
  yieldFloor,
  vote,
  mafiaProposeKill,
  investigate,
  protect,
];

// What an agent may do, given the phase and its role. legalIn double-checks at
// call time, but we also pre-filter so the model is only offered legal options.
export function toolsFor(state: GameState, agent: AgentState): GameTool[] {
  return ALL.filter((t) => t.legalIn(state, agent));
}
