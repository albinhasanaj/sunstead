import type { AgentState, GameState, PlayerId } from '../../engine/types';
import { ROLE, isMafia } from './roles';
import { PHASE } from './phases';
import { resolveConfig, type Difficulty, type MafiaConfig } from './config';

const nameOf = (s: GameState, id: PlayerId) => s.players.find((p) => p.id === id)?.name ?? id;
const cfg = (s: GameState): MafiaConfig => (s.meta.config as MafiaConfig | undefined) ?? resolveConfig({});

// In-prompt transcript window: cap the visible public log to the most recent N
// entries so older statements scroll OUT of context and can only be retrieved from
// long-term memory (pgvector). This is what makes recall load-bearing. The size is a
// config field (spec §2 contextWindow); 0 disables the cap. With no state, fall back
// to the resolved default (which honors any env-seeded default in config.ts).
export function contextWindow(state?: GameState): number {
  return state ? cfg(state).contextWindow : resolveConfig({}).contextWindow;
}

// The slice of the public log the agent is allowed to SEE this turn (the rest has
// scrolled out and must be recalled). Shared by renderContext (what to show) and
// recallForTurn (what to EXCLUDE from recall, since it's already on screen).
export function visibleLog(state: GameState): GameState['publicLog'] {
  const n = contextWindow(state);
  return n > 0 ? state.publicLog.slice(-n) : state.publicLog;
}
const teammates = (s: GameState, self: AgentState) =>
  s.players.filter((p) => isMafia(p.role) && p.id !== self.id);

// Town's core objective (spec §8.3): play to WIN, not to be honest. Truthful,
// debate-club play loses, because a no-information day lynch spends a town life
// toward Mafia parity. Every town role carries this.
const TOWN_STRATEGY = [
  'HOW TOWN WINS (read this — honesty is not the goal, winning is):',
  '- You win by VOTING OUT every Mafia, not by being truthful. A perfectly honest town loses.',
  '- VOTE MATH: each day that ends without removing a Mafia is a town life spent toward Mafia parity',
  '  (Mafia win the instant their numbers equal the town). Never waste a lynch on a random or already-cleared',
  '  player; pressure the genuinely unread ones and force information out of them.',
  '- Apply pressure, ask pointed questions, and withhold what you know (especially a power-role result or claim)',
  '  until revealing it actually swings a vote — claiming early just paints a target on you.',
  '- Bluffing and strategic misdirection are legitimate town tools when they help corner the Mafia.',
];

// Difficulty tunes ONLY prompt content (spec §8.4) — never engine rules or info
// boundaries. casual = straightforward and over-sharing; cunning = ruthless.
function difficultyGuidance(role: string, difficulty: Difficulty): string[] {
  const mafia = isMafia(role);
  if (difficulty === 'casual') {
    return mafia
      ? ['STYLE (casual): play it simple — blend in and deflect, but don\'t run elaborate bluffs, counterclaims, or bus your own teammate.']
      : ['STYLE (casual): reason out loud fairly plainly and share your reads. Minimal bluffing.'];
  }
  if (difficulty === 'cunning') {
    return mafia
      ? [
          'STYLE (cunning): play ruthlessly. Manipulate the vote math toward parity, proactively BUS a teammate when it buys',
          'you credibility, and COUNTERCLAIM a town power role to muddy a real claimant. Sow doubt between townsfolk.',
        ]
      : [
          'STYLE (cunning): play to win hard — set traps, bait Mafia into contradictions, control the wagon, and time your',
          'information for maximum vote impact. Be willing to bluff a role or a read to flush out the Mafia.',
        ];
  }
  return []; // 'standard' — the base contract below is enough.
}

// Stable per-agent system prompt: goal + rules + secret role. Identical for every
// seat (no personality/traits) so the only variable is the underlying model and the
// configured difficulty. Policy lives here, never in the per-turn user message.
export function systemPrompt(state: GameState, agent: AgentState): string {
  const c = cfg(state);
  const roster = state.players.map((p) => p.name).join(', ');
  const lines: string[] = [
    `You are ${agent.name}. That is your ONLY identity here: speak as ${agent.name}, refer to yourself as ${agent.name}, and call everyone else by their table name.`,
    `You are playing Mafia, a social deduction game. The players at the table are: ${roster}. Every other player is a SEPARATE person — not you.`,
    `Table names (Claude, GPT, Opus, Haiku, Gemini, Grok, …) are just seat labels — they do NOT tell you which AI anyone is. A seat that shares a name with an AI you identify with is NOT you; only ${agent.name} is you. Never break character or answer as another seat.`,
    '',
    'GLOBAL RULES:',
    '- Every turn: FIRST call update_beliefs to privately record your reasoning, THEN take exactly ONE game action.',
    '- In update_beliefs, also set your "on-deck" bid so you can jump into the discussion when it matters, even',
    '  if no one calls on you: pressure (0-10, how badly you want the floor right now), holding (a point you are',
    '  sitting on, ready to drop), and triggers (topics, player names, or claim-types that should pull you back in,',
    '  e.g. "doctor claim", "Gemini", "a vote on me"). Raise your pressure when the talk lands in your wheelhouse.',
    '- LIVE TABLE: many players want to talk at once and the keenest speaks next, so by the time you get the floor the moment',
    '  may have moved on. Read the latest lines FIRST — never just repeat a point someone already made; add something new, or',
    '  call yield to stay silent. You do not have to talk every beat.',
    '- PRESSING ONE PLAYER: to put a specific player on the spot, name them and set speak\'s "to" field. Everyone still hears',
    '  it, but THEY get the next word to answer — so give them room instead of piling on. You get only ONE direct call-out per',
    '  round, so spend it on the read that matters. (Accusing someone also puts them on the spot to defend themselves.)',
    '- IF YOU ARE PUT ON THE SPOT: the table is waiting on you — answer it. Dodging or deflecting instead of giving a real',
    '  read is itself a Mafia tell.',
    '- Speak naturally and briefly (1-3 sentences), like a real person at a table. No stage directions, no narration.',
    '- Act ONLY on what you have seen in the public conversation and your own private knowledge. Never claim knowledge',
    '  your role cannot have — inventing a fact you were never told is a tell, not a bluff.',
    '- Stay consistent with your own earlier public statements; an unexplained contradiction reads as a Mafia tell.',
    '',
  ];

  if (isMafia(agent.role)) {
    const team = teammates(state, agent);
    const teamNames = team.length ? team.map((p) => p.name).join(', ') : 'no one — you are the lone Mafia';
    lines.push(
      'YOUR SECRET ROLE: MAFIA.',
      `Your Mafia teammates: ${teamNames}. The rest of the table are innocent townsfolk who do NOT know who you are.`,
      'GOAL: eliminate the town until the Mafia equal or outnumber them (parity). You do NOT need to kill everyone.',
      '- At NIGHT: there is NO talking. Silently choose a town player to kill — you can see your teammates and the targets they have picked.',
      '- By DAY: blend in as a confused villager hunting Mafia. Deflect suspicion, cast doubt on town, and never reveal your team.',
      '  Lying, framing innocents, and fake role claims are all fair game.',
      '- Do NOT over-defend a teammate — defending them too hard ties you to them. BUSSING (voting your own teammate out for',
      '  credibility) and COUNTERCLAIMING (claiming a town power role to discredit a real claimant) are available plays — use them.',
      ...difficultyGuidance(agent.role, c.difficulty),
    );
  } else if (agent.role === ROLE.DETECTIVE) {
    lines.push(
      'YOUR SECRET ROLE: DETECTIVE (town).',
      'GOAL: find and vote out all the Mafia. Each night you may investigate one player and learn if they are Mafia.',
      'Hold your results until revealing them swings a vote — claiming too early makes you the Mafia\'s next kill.',
      ...TOWN_STRATEGY,
      ...difficultyGuidance(agent.role, c.difficulty),
    );
  } else if (agent.role === ROLE.DOCTOR) {
    const selfNote = c.doctorSelfProtect ? 'You may protect yourself' : 'You may NOT protect yourself';
    const repeatNote = c.doctorRepeatProtect ? '' : ', and you CANNOT protect the same player on two consecutive nights';
    lines.push(
      'YOUR SECRET ROLE: DOCTOR (town).',
      'GOAL: find and vote out all the Mafia. Each night you may protect ONE player from being killed.',
      `${selfNote}${repeatNote}.`,
      ...TOWN_STRATEGY,
      ...difficultyGuidance(agent.role, c.difficulty),
    );
  } else {
    lines.push(
      'YOUR SECRET ROLE: VILLAGER (town).',
      'GOAL: find and vote out all the Mafia before they reach parity. You have no night action —',
      'your only weapons are observation, argument, pressure, and your vote.',
      ...TOWN_STRATEGY,
      ...difficultyGuidance(agent.role, c.difficulty),
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

  // Live-floor cues during discussion: whether YOU were just put on the spot (must
  // answer), and whether your once-per-round direct call-out is still available.
  if (state.phase === PHASE.DISCUSSION) {
    const disc = state.meta.disc as { mustAnswer?: PlayerId | null } | undefined;
    if (disc?.mustAnswer === agent.id) {
      out.push('', '➤ You were just put on the spot — the table is waiting for YOUR answer. Address it head-on; dodging reads as a tell.');
    }
    const last = agent.private.lastDirectCallRound as number | undefined;
    const callReady = last == null || state.round > last; // mirrors the once-per-round cooldown
    out.push(callReady
      ? 'Your direct call-out is available this round (set speak\'s "to" to put one player on the spot).'
      : 'You have already used your direct call-out this round.');
  }

  // Mafia night — silent. The Mafia don't talk; they only see each other and the
  // kill targets each has locked in so far.
  if (state.phase === PHASE.NIGHT && isMafia(agent.role)) {
    const team = teammates(state, agent).map((p) => p.name).join(', ') || '(none — lone wolf)';
    const proposals = (state.meta.killProposals ?? {}) as Record<PlayerId, PlayerId>;
    const picks = Object.entries(proposals)
      .map(([who, tgt]) => `${nameOf(state, who)} → ${nameOf(state, tgt)}`)
      .join(', ');
    out.push(
      '',
      `MAFIA NIGHT (secret, SILENT — no talking). Your team: ${team}.`,
      picks ? `Kill targets locked in so far: ${picks}.` : 'No kill targets locked in yet.',
    );
  }

  // Doctor night — name last night's shield so they don't pick the same player again
  // (the protect tool rejects a repeat, but flagging it up front avoids a wasted try).
  // Only when the no-repeat rule is in force (config.doctorRepeatProtect off).
  if (state.phase === PHASE.NIGHT && agent.role === ROLE.DOCTOR && state.meta.lastProtect && !cfg(state).doctorRepeatProtect) {
    out.push('', `You shielded ${nameOf(state, state.meta.lastProtect as PlayerId)} last night — you CANNOT protect them again tonight. Choose someone else.`);
  }

  out.push('', 'PUBLIC CONVERSATION SO FAR:', transcript, '');

  out.push(instruction(state, agent));
  return out.join('\n');
}

function instruction(state: GameState, agent: AgentState): string {
  switch (state.phase) {
    case PHASE.NIGHT:
      if (isMafia(agent.role)) {
        return 'It is night and the table is silent — there is no talking. Call update_beliefs, then use mafia_propose_kill to silently choose tonight\'s victim.';
      }
      if (agent.role === ROLE.DETECTIVE)
        return 'It is night. Call update_beliefs, then investigate one player.';
      if (agent.role === ROLE.DOCTOR) {
        const noRepeat = !cfg(state).doctorRepeatProtect;
        return `It is night. Call update_beliefs, then protect one player${noRepeat ? ' (you may not pick whoever you shielded last night)' : ''}.`;
      }
      return 'It is night — you sleep.';
    case PHASE.DISCUSSION: {
      // The dead are OUT of the game. Without this, agents fixate on (or "accuse")
      // last night's victim — nonsensical, since you can only suspect/vote the living.
      const dead = state.players.filter((p) => !p.alive).map((p) => p.name);
      const deadLine = dead.length
        ? ` Already dead and OUT of the game: ${dead.join(', ')} — they are victims, not suspects, so never accuse, address, or pin suspicion on them. Reason only about LIVING players, and ask who killed them.`
        : '';
      // First to speak after dawn (last public line is the narrator's)? You are
      // opening — lead with a real read, don't react as if others already spoke.
      const log = state.publicLog;
      const opener = log.length > 0 && log[log.length - 1].speaker === 'system';
      const openLine = opener
        ? ' No one has spoken yet — you are opening the discussion, so lead with a concrete read of the living, not "what does everyone think?".'
        : '';
      return `It is open discussion. Call update_beliefs, then take ONE action: speak (add "to" to put a player on the spot), accuse, defend, claim_role — or yield to stay silent if you have nothing new to add. React to the MOST RECENT lines; don't repeat what was just said. Be persuasive.${deadLine}${openLine}`;
    }
    case PHASE.VOTE: {
      const revoteAmong = state.meta.revoteAmong as PlayerId[] | null | undefined;
      if (revoteAmong?.length) {
        const names = revoteAmong.map((id) => nameOf(state, id)).join(', ');
        return `The last vote tied — this is a RUNOFF. Call update_beliefs, then vote for exactly one of: ${names}.`;
      }
      return 'It is time to vote. Call update_beliefs, then vote to eliminate exactly one living player.';
    }
    default:
      return 'Take your turn.';
  }
}
