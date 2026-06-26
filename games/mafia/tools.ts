import { z } from 'zod';
import type { AgentState, GameState, GameTool, PlayerId, ToolContext } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { PHASE } from './phases';
import { remember } from '../../lib/memory';
import { publish, TOPIC_TABLE, TOPIC_VOTES } from '../../lib/bus';

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

// Record a public line: persist to long-term memory (pgvector) AND publish it to
// the Kafka table topic — both via Aiven MCP. Memory is awaited (so a later turn's
// recall sees it); the Kafka publish is fire-and-forget so it never slows the turn.
async function recordPublic(ctx: ToolContext, kind: string, text: string, target?: string): Promise<void> {
  const gameId = ctx.state.meta.gameId as string;
  await remember({ gameId, round: ctx.state.round, phase: ctx.state.phase, speaker: ctx.agent.name, text });
  void publish(TOPIC_TABLE, {
    kind, gameId, round: ctx.state.round, phase: ctx.state.phase, speaker: ctx.agent.name, text, target,
  });
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
    'Say something out loud to the whole table during discussion. Use this to share reads, ask questions, ' +
    'apply pressure, or (if you are Mafia) blend in and steer suspicion away from yourself.',
  inputSchema: z.object({ text: z.string().describe('What you say aloud, in your own voice.') }),
  legalIn: inPhase(PHASE.DISCUSSION),
  execute: async (args, ctx) => {
    ctx.state.publicLog.push({ speaker: ctx.agent.id, text: args.text });
    ctx.emit({ type: 'speak', agent: ctx.agent.id, text: args.text });
    await recordPublic(ctx, 'speak', args.text);
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
    if (!t) return `No living player named "${args.target}".`;
    const line = `I think ${t.name} is Mafia. ${args.reason}`;
    ctx.state.publicLog.push({ speaker: ctx.agent.id, text: line });
    ctx.emit({ type: 'speak', agent: ctx.agent.id, text: line });
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'accuse', target: t.id });
    await recordPublic(ctx, 'accuse', line, t.name);
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
    await recordPublic(ctx, 'defend', line, t?.name);
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
    await recordPublic(ctx, 'claim', line);
    return 'You made your claim. Your turn is over.';
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
    ctx.state.meta.votes = ctx.state.meta.votes ?? {};
    ctx.state.meta.votes[ctx.agent.id] = t.id;
    // Publish the vote to the Kafka votes topic via MCP; the tally consumes it back.
    // Awaited so the record is in Kafka before the (parallel) phase tallies.
    await publish(TOPIC_VOTES, {
      kind: 'vote', gameId: ctx.state.meta.gameId as string, round: ctx.state.round,
      voter: ctx.agent.name, voterId: ctx.agent.id, target: t.name, targetId: t.id,
    });
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
  description: 'Secretly protect one living player from the Mafia tonight. If they are attacked, they survive.',
  inputSchema: z.object({ target: z.string().describe('Who to protect, by name.') }),
  legalIn: (state, agent) => state.phase === PHASE.NIGHT && agent.role === ROLE.DOCTOR,
  execute: async (args, ctx) => {
    const t = resolve(ctx.state, args.target, { aliveOnly: true });
    if (!t) return `No living player named "${args.target}".`;
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
