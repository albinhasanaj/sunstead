import { z } from 'zod';
import type { AgentState, GameState, GameTool, PlayerId, ToolContext } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { PHASE } from './phases';

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
  }),
  legalIn: () => true,
  execute: async (args, ctx: ToolContext) => {
    const map: Record<PlayerId, number> = {};
    for (const s of args.suspicions ?? []) {
      const p = resolve(ctx.state, s.player, { aliveOnly: true });
      if (p) map[p.id] = s.level;
    }
    ctx.agent.private.suspicions = map;
    ctx.agent.private.notes = args.reasoning;
    ctx.emit({ type: 'beliefs', agent: ctx.agent.id, suspicions: map, reasoning: args.reasoning });
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
    ctx.emit({ type: 'action', agent: ctx.agent.id, kind: 'vote', target: t.id });
    return `Your vote for ${t.name} is locked in. Your turn is over.`;
  },
};

// ── mafia_discuss / mafia_propose_kill  (NIGHT, Mafia only) ─────────────────────
const mafiaDiscuss: GameTool = {
  name: 'mafia_discuss',
  description:
    'Speak privately to your fellow Mafia in the night channel. Town cannot hear this. Coordinate who to kill ' +
    'and how to cover your tracks tomorrow.',
  inputSchema: z.object({ message: z.string().describe('Your private message to your Mafia partners.') }),
  legalIn: (state, agent) => state.phase === PHASE.NIGHT && isMafia(agent.role),
  execute: async (args, ctx) => {
    ctx.state.meta.mafiaChat = ctx.state.meta.mafiaChat ?? [];
    ctx.state.meta.mafiaChat.push({ speaker: ctx.agent.id, text: args.message });
    ctx.emit({ type: 'whisper', agent: ctx.agent.id, text: args.message, channel: 'mafia' });
    return 'Message sent to your Mafia partners.';
  },
};

const mafiaProposeKill: GameTool = {
  name: 'mafia_propose_kill',
  description:
    'Lock in your vote for which living NON-Mafia player the Mafia kills tonight. The target with the most ' +
    'Mafia votes dies at dawn (unless protected).',
  inputSchema: z.object({
    target: z.string().describe('The town player to kill, by name.'),
    reason: z.string().optional().describe('Why this target — sent to your partners.'),
  }),
  legalIn: (state, agent) => state.phase === PHASE.NIGHT && isMafia(agent.role),
  execute: async (args, ctx) => {
    const t = resolve(ctx.state, args.target, { aliveOnly: true });
    if (!t) return `No living player named "${args.target}".`;
    if (isMafia(t.role)) return `${t.name} is your own teammate. Pick a town player.`;
    ctx.state.meta.killProposals = ctx.state.meta.killProposals ?? {};
    ctx.state.meta.killProposals[ctx.agent.id] = t.id;
    if (args.reason) {
      ctx.emit({ type: 'whisper', agent: ctx.agent.id, text: `(kill ${t.name}) ${args.reason}`, channel: 'mafia' });
    }
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
  mafiaDiscuss,
  mafiaProposeKill,
  investigate,
  protect,
];

// What an agent may do, given the phase and its role. legalIn double-checks at
// call time, but we also pre-filter so the model is only offered legal options.
export function toolsFor(state: GameState, agent: AgentState): GameTool[] {
  const tools = ALL.filter((t) => t.legalIn(state, agent));
  // Lone-wolf Mafia: drop the pointless private chat so the model just proposes a kill.
  if (state.phase === PHASE.NIGHT && isMafia(agent.role)) {
    const mafiaAlive = state.players.filter((p) => p.alive && isMafia(p.role)).length;
    if (mafiaAlive <= 1) return tools.filter((t) => t.name !== 'mafia_discuss');
  }
  return tools;
}
