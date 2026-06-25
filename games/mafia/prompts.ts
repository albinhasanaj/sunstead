import type { AgentState, GameState, PlayerId } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { PHASE } from './phases';

const nameOf = (s: GameState, id: PlayerId) => s.players.find((p) => p.id === id)?.name ?? id;

// In-prompt transcript window: cap the visible public log to the most recent N
// entries so older statements scroll OUT of context and can only be retrieved
// from long-term memory (pgvector). This is what makes recall load-bearing:
// without it the full transcript is always in-prompt and memory is decorative.
// N is small enough that a prior round's claims fall outside a normal game's
// window; 0 or negative disables the cap. Override with MAFIA_CONTEXT_WINDOW.
export function contextWindow(): number {
  const n = Number(process.env.MAFIA_CONTEXT_WINDOW ?? 10);
  return Number.isFinite(n) ? n : 10;
}

// The slice of the public log the agent is allowed to SEE this turn (the rest has
// scrolled out and must be recalled). Shared by renderContext (what to show) and
// recallForTurn (what to EXCLUDE from recall, since it's already on screen).
export function visibleLog(state: GameState): GameState['publicLog'] {
  const n = contextWindow();
  return n > 0 ? state.publicLog.slice(-n) : state.publicLog;
}
const teammates = (s: GameState, self: AgentState) =>
  s.players.filter((p) => isMafia(p.role) && p.id !== self.id);

// Stable per-agent system prompt: goal + rules + personality + secret role.
// Policy lives here, never in the per-turn user message.
export function systemPrompt(state: GameState, agent: AgentState): string {
  const lines: string[] = [
    `You are ${agent.name}, ${agent.private.trait}`,
    `You are playing Mafia, a social deduction game. Stay fully in character as ${agent.name} at all times.`,
    '',
    'GLOBAL RULES:',
    '- Every turn: FIRST call update_beliefs to privately record your reasoning, THEN take exactly ONE game action.',
    '- Speak naturally and briefly (1-3 sentences), like a real person at a table. No stage directions, no narration.',
    '- You only know what you have seen in the public conversation and your own private knowledge.',
    '',
  ];

  if (isMafia(agent.role)) {
    const team = teammates(state, agent);
    const teamNames = team.length ? team.map((p) => p.name).join(', ') : 'no one — you are the lone Mafia';
    lines.push(
      'YOUR SECRET ROLE: MAFIA.',
      `Your Mafia teammates: ${teamNames}. The rest of the table are innocent townsfolk who do NOT know who you are.`,
      'GOAL: eliminate the town until the Mafia equal or outnumber them. To do that you must:',
      '- At NIGHT: coordinate with your team in the private channel and choose a town player to kill.',
      '- By DAY: blend in. Act like an innocent villager hunting Mafia. Deflect suspicion, cast doubt on town players,',
      '  and never reveal your team. Lying, framing innocents, and fake role claims are all fair game.',
      '- Protect your teammates subtly — do not defend them so hard that you look connected to them.',
    );
  } else if (agent.role === ROLE.DETECTIVE) {
    lines.push(
      'YOUR SECRET ROLE: DETECTIVE (town).',
      'GOAL: find and vote out all the Mafia. Each night you may investigate one player and learn if they are Mafia.',
      'Use what you learn carefully — revealing too early makes you the Mafia\'s next target.',
    );
  } else if (agent.role === ROLE.DOCTOR) {
    lines.push(
      'YOUR SECRET ROLE: DOCTOR (town).',
      'GOAL: find and vote out all the Mafia. Each night you may protect one player from being killed.',
    );
  } else {
    lines.push(
      'YOUR SECRET ROLE: VILLAGER (town).',
      'GOAL: find and vote out all the Mafia before they outnumber the town. You have no night action —',
      'your only weapons are observation, argument, and your vote. Watch who deflects, who lies, who protects whom.',
    );
  }

  return lines.join('\n');
}

// Dynamic per-turn view: public transcript + this agent's private memory, plus
// Mafia-specific framing (the night channel) that the generic engine can't know about.
export function renderContext(state: GameState, agent: AgentState): string {
  const alive = state.players.filter((p) => p.alive);
  const aliveNames = alive.map((p) => p.name).join(', ');

  const sus = agent.private.suspicions as Record<PlayerId, number> | undefined;
  const susLine = sus
    ? Object.entries(sus)
        .sort((a, b) => b[1] - a[1])
        .map(([id, v]) => `${nameOf(state, id)} ${(v * 100) | 0}%`)
        .join(', ')
    : '(none yet)';

  // Only the most recent window is shown; older lines have scrolled out and live
  // in long-term memory. A marker tells the agent history exists it can't see, so
  // it leans on the recalled MEMORY block instead of assuming nothing came before.
  const shown = visibleLog(state);
  const omitted = state.publicLog.length - shown.length;
  const transcript = shown.length
    ? (omitted > 0
        ? `… [${omitted} earlier statement(s) have scrolled out of view; older history is in long-term memory] …\n`
        : '') +
      shown
        .map((l) => `${l.speaker === 'system' ? 'NARRATOR' : nameOf(state, l.speaker)}: ${l.text}`)
        .join('\n')
    : '(nothing has been said yet)';

  const out: string[] = [
    `=== ${state.phase} — round ${state.round} ===`,
    `Living players: ${aliveNames}.`,
    `Your current suspicion levels: ${susLine}.`,
  ];

  if (agent.private.knowledge?.length) {
    out.push(`Your secret knowledge: ${agent.private.knowledge.join(' ')}`);
  }

  // Mafia night channel — visible only to Mafia, at night.
  if (state.phase === PHASE.NIGHT && isMafia(agent.role)) {
    const chat = (state.meta.mafiaChat ?? []) as { speaker: PlayerId; text: string }[];
    const team = teammates(state, agent).map((p) => p.name).join(', ') || '(none — lone wolf)';
    out.push(
      '',
      `MAFIA NIGHT CHANNEL (secret). Your team: ${team}.`,
      chat.length ? chat.map((m) => `${nameOf(state, m.speaker)}: ${m.text}`).join('\n') : '(no messages yet tonight)',
    );
  }

  out.push('', 'PUBLIC CONVERSATION SO FAR:', transcript, '');

  out.push(instruction(state, agent));
  return out.join('\n');
}

function instruction(state: GameState, agent: AgentState): string {
  switch (state.phase) {
    case PHASE.NIGHT:
      if (isMafia(agent.role)) {
        const lone = teammates(state, agent).filter((p) => p.alive).length === 0;
        return lone
          ? 'It is night. Call update_beliefs, then use mafia_propose_kill to choose tonight\'s victim.'
          : 'It is night. Call update_beliefs, then EITHER mafia_discuss to coordinate with your team OR mafia_propose_kill to lock your target.';
      }
      if (agent.role === ROLE.DETECTIVE)
        return 'It is night. Call update_beliefs, then investigate one player.';
      if (agent.role === ROLE.DOCTOR)
        return 'It is night. Call update_beliefs, then protect one player.';
      return 'It is night — you sleep.';
    case PHASE.DISCUSSION:
      return 'It is open discussion. Call update_beliefs, then take ONE action: speak, accuse, defend, or claim_role. Be persuasive and in-character.';
    case PHASE.VOTE:
      return 'It is time to vote. Call update_beliefs, then vote to eliminate exactly one living player.';
    default:
      return 'Take your turn.';
  }
}
