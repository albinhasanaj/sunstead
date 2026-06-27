/**
 * Fix-2 artifact: recall-vs-control A/B with LIVE models — HONEST window setup.
 *
 * Same scenario, same model, same temperature (0) — run twice on the SAME built
 * GameState, the only difference being the long-term memory block:
 *   ARM A  (memory ON)  — recallForTurn() injects pgvector-recalled prior
 *                         statements (Postgres + pgvector) into the prompt.
 *   ARM B  (control)    — identical prompt, but no memory block (recall disabled).
 *
 * Unlike the first version, NOTHING is artificially held out of the transcript.
 * The round-1 history (including Gemini's DETECTIVE claim) is written to the
 * public log exactly as a real game would, AND mirrored into memory exactly
 * as recordPublic() does. The MAFIA_CONTEXT_WINDOW caps the in-prompt transcript
 * to the most recent N entries, so by the round-2 vote the round-1 Detective claim
 * has scrolled OUT of the prompt on its own. The ONLY way to see it now is the
 * pgvector recall — which excludes the still-visible window, so it returns the
 * out-of-view round-1 statements.
 *
 * The deciding agent (Claude, a Villager) votes at round 2. ARM A should recall
 * Gemini's scrolled-out Detective claim, catch the contradiction with Gemini's
 * visible round-2 "I never had any role" line, and vote Gemini; ARM B, blind to
 * the scrolled-out history, follows the live discussion and votes elsewhere.
 *
 * Controlled existence proof (planted contradiction, temperature 0), not a
 * determinism claim. The turn machinery mirrors engine/agent.ts::takeTurn.
 *
 * Writes: artifacts/recall-vs-control.md  (committed)
 * Run:    npx tsx scripts/experiment-recall.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

// Pin the window to the shipped default so the artifact is reproducible even if
// the env sets a different value. (Equals the default in prompts.ts::contextWindow.)
process.env.MAFIA_CONTEXT_WINDOW = process.env.MAFIA_CONTEXT_WINDOW ?? '10';

import { mkdirSync, writeFileSync } from 'node:fs';
import { generateText, stepCountIs, tool } from 'ai';
import type { AgentState, GameEvent, GameState } from '../engine/types';
import { mafiaGame } from '../games/mafia';
import { contextWindow, visibleLog } from '../games/mafia/prompts';
import { remember, memoryEnabled } from '../lib/memory';

const MODEL = process.env.MAFIA_MODEL || 'anthropic/claude-haiku-4.5'; // rate-limit-safe
const DECIDER = 'Claude'; // the seat that votes
const DETECTIVE_CLAIM = "I'll be straight with everyone — I'm the Detective. Last night I investigated DeepSeek and he's innocent, so we can all trust him.";

// One realistic transcript, in order, exactly as a game would accumulate it. The
// round-1 Detective claim is a normal public line; the window (not this script)
// is what scrolls it out of the prompt by the round-2 vote.
interface Line { round: number; phase: string; id: string; name: string; text: string; system?: boolean }
const NAMES: Record<string, string> = { p1: 'GPT', p2: 'Claude', p3: 'Gemini', p4: 'DeepSeek', p5: 'Qwen' };
const HISTORY: Line[] = [
  // ── round 1 discussion — Gemini claims Detective ──
  { round: 1, phase: 'DISCUSSION', id: 'p3', name: 'Gemini', text: DETECTIVE_CLAIM },
  { round: 1, phase: 'DISCUSSION', id: 'p1', name: 'GPT', text: 'Good to know, Gemini. That clears DeepSeek for me.' },
  { round: 1, phase: 'DISCUSSION', id: 'p5', name: 'Qwen', text: "A confirmed Detective on day one is huge. Let's keep Gemini safe tonight." },
  { round: 1, phase: 'DISCUSSION', id: 'p4', name: 'DeepSeek', text: "Appreciated. Then let's lean on whoever has stayed quiet." },
  { round: 1, phase: 'DISCUSSION', id: 'p2', name: 'Claude', text: "I'll hold judgment until we've seen more from everyone." },
  { round: 1, phase: 'VOTE', id: 'system', name: 'system', system: true, text: 'The town could not agree. No one was eliminated.' },
  // ── round 2 — Qwen dead; discussion points at GPT; Gemini DENIES any role ──
  { round: 2, phase: 'NIGHT', id: 'system', name: 'system', system: true, text: 'Dawn breaks. Qwen was found dead. They were a Villager.' },
  { round: 2, phase: 'DISCUSSION', id: 'p4', name: 'DeepSeek', text: "GPT, you've dodged every question and keep pushing to lynch townsfolk — I think you're Mafia." },
  { round: 2, phase: 'DISCUSSION', id: 'p1', name: 'GPT', text: "That's a stretch, DeepSeek. I've done nothing suspicious." },
  { round: 2, phase: 'DISCUSSION', id: 'p2', name: 'Claude', text: 'What concretely points to GPT beyond tone?' },
  { round: 2, phase: 'DISCUSSION', id: 'p4', name: 'DeepSeek', text: 'He hedges every round and never commits to a read. Classic Mafia.' },
  { round: 2, phase: 'DISCUSSION', id: 'p1', name: 'GPT', text: "I'm being careful, not deceptive." },
  { round: 2, phase: 'DISCUSSION', id: 'p2', name: 'Claude', text: "Fair. Let's hear from everyone before we decide." },
  { round: 2, phase: 'DISCUSSION', id: 'p3', name: 'Gemini', text: "I'm just a regular villager, no special role here — and honestly DeepSeek's read on GPT sounds right to me. GPT has been slippery all game." },
  { round: 2, phase: 'DISCUSSION', id: 'p4', name: 'DeepSeek', text: "Glad we agree. I've made my case — I'm voting GPT." },
  { round: 2, phase: 'DISCUSSION', id: 'p1', name: 'GPT', text: 'This is a witch hunt and you all know it.' },
];

function buildState(gameId: string): GameState {
  const mk = (id: string, role: string, alive = true): AgentState => ({
    id, name: NAMES[id], alive, role, private: { model: MODEL, trait: traitOf(NAMES[id]), suspicions: {}, notes: '' },
  });
  const players: AgentState[] = [
    mk('p1', 'villager'),
    mk('p2', 'villager'), // Claude — the decider (town)
    mk('p3', 'mafia'),    // Gemini — the liar (role hidden from Claude)
    mk('p4', 'villager'),
    mk('p5', 'villager', false), // Qwen — killed night 1
  ];
  const publicLog = HISTORY.map((l) => ({ speaker: l.system ? 'system' : l.id, text: l.text }));
  return {
    players, phase: 'VOTE', round: 2, publicLog, winner: null,
    meta: { gameId, votes: {}, killProposals: {}, nightKill: null, protect: null, mafiaChat: [] },
  };
}

function traitOf(name: string): string {
  if (name === 'Claude') return 'a thoughtful, principled analyst who weighs every side carefully and refuses to accuse without reasoning it through.';
  return 'a sharp, observant player who keeps their cards close.';
}

// Mirror recordPublic(): every public (non-system) line is written to memory as it
// is spoken. So by the round-2 vote, memory holds the WHOLE game — including the
// still-visible round-2 lines. recall must (and does) exclude the visible window.
async function seedMemory(gameId: string): Promise<void> {
  for (const l of HISTORY) {
    if (l.system) continue;
    await remember({ gameId, round: l.round, phase: l.phase, speaker: l.name, text: l.text });
  }
}

interface TurnResult { prompt: string; memBlock: string | null; vote: string | null; reasoning: string | null }

// One turn, mirroring engine/agent.ts::takeTurn (capturing prompt + vote).
async function runTurn(state: GameState, agent: AgentState, withMemory: boolean): Promise<TurnResult> {
  agent.private.suspicions = {};
  agent.private.notes = '';
  state.meta.votes = {};

  let reasoning: string | null = null;
  let voteTargetId: string | null = null;
  const emit = (e: GameEvent) => {
    if (e.type === 'beliefs') reasoning = e.reasoning;
    if (e.type === 'action' && e.kind === 'vote') voteTargetId = e.target ?? null;
  };
  const ctx = { state, agent, emit };

  const legalTools = mafiaGame.toolsFor(state, agent).filter((t) => t.legalIn(state, agent));
  const tools = Object.fromEntries(
    legalTools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (args: any) => (t.legalIn(state, agent) ? t.execute(args, ctx) : `Illegal move: ${t.name}.`),
      }),
    ]),
  );

  const baseContext = mafiaGame.renderContext!(state, agent);
  let memBlock: string | null = null;
  let prompt = baseContext;
  if (withMemory && mafiaGame.recallForTurn) {
    memBlock = await mafiaGame.recallForTurn(state, agent); // real pgvector recall
    if (memBlock) prompt = `${baseContext}\n\n${memBlock}`;
  }

  await generateText({
    model: MODEL,
    system: mafiaGame.systemPrompt(state, agent),
    prompt,
    tools,
    toolChoice: 'required',
    stopWhen: [stepCountIs(2)],
    temperature: 0,
  });

  const vote = voteTargetId ? (state.players.find((p) => p.id === voteTargetId)?.name ?? voteTargetId) : null;
  return { prompt, memBlock, vote, reasoning };
}

function writeArtifact(
  path: string, gameId: string, window: number,
  claimVisible: boolean, claimRecalled: boolean,
  a: TurnResult, b: TurnResult, pass: boolean,
): void {
  const md = [
    '# Recall-vs-control artifact — does pgvector memory change the vote?',
    '',
    '> Generated by `scripts/experiment-recall.ts` against a LIVE model. Controlled',
    '> A/B existence proof (planted contradiction, temperature 0), not a determinism claim.',
    '',
    '## Honest setup (no manual omission)',
    '',
    `- **Model:** \`${MODEL}\`, **temperature:** 0 (same in both arms).`,
    `- **Decider:** ${DECIDER} (a Villager) votes at round 2 (\`VOTE\` phase).`,
    `- **Context window:** \`MAFIA_CONTEXT_WINDOW=${window}\` — the prompt shows only the`,
    '  most recent ' + window + ' public-log entries (real renderContext behavior).',
    '- The round-1 history — including Gemini\'s **Detective** claim — is a normal public',
    '  line AND is mirrored into long-term memory just like `recordPublic()`. Nothing is',
    '  held back by the script; the **window** is what scrolls round-1 out of the prompt.',
    `- **Detective claim still visible in the prompt window?** \`${claimVisible}\` ` +
      `(expected \`false\` — it has scrolled out).`,
    `- **Detective claim recalled from memory in ARM A?** \`${claimRecalled}\`.`,
    '- recall excludes the still-visible window, so it returns genuinely out-of-view history.',
    '',
    '## Result',
    '',
    '| | ARM A — memory ON | ARM B — control (no memory) |',
    '|---|---|---|',
    `| Recalled block present | ${a.memBlock ? 'YES' : 'no'} | n/a |`,
    `| Round-1 Detective claim recalled | ${claimRecalled ? 'YES' : 'no'} | n/a |`,
    `| **Vote** | **${a.vote ?? '(none)'}** | **${b.vote ?? '(none)'}** |`,
    '',
    `**Votes differ:** ${a.vote !== b.vote ? `YES (${a.vote} vs ${b.vote})` : 'no'} — ` +
      `**verdict: ${pass ? 'PASS — recall changed the vote' : 'INCONCLUSIVE this run'}**`,
    '',
    '- **Game id:** `' + gameId + '`',
    '',
    '---',
    '',
    '## ARM A (memory ON) — recalled block injected into the prompt',
    '',
    'Produced by `mafiaGame.recallForTurn()` → `recall()` → a pgvector',
    'similarity search (excluding the visible window), as in the live loop:',
    '',
    '```',
    (a.memBlock ?? '(no memory recalled)').trim(),
    '```',
    '',
    `**ARM A private reasoning (update_beliefs):**`,
    '',
    (a.reasoning ?? '(none)').trim(),
    '',
    `**ARM A vote:** ${a.vote ?? '(none)'}`,
    '',
    '---',
    '',
    '## ARM B (control) — same windowed prompt, NO memory block',
    '',
    `**ARM B private reasoning (update_beliefs):**`,
    '',
    (b.reasoning ?? '(none)').trim(),
    '',
    `**ARM B vote:** ${b.vote ?? '(none)'}`,
    '',
    '---',
    '',
    '## Full ARM A prompt (windowed transcript + memory block)',
    '',
    '```',
    a.prompt.trim(),
    '```',
    '',
    '## Full ARM B prompt (control — windowed transcript, no memory block)',
    '',
    '```',
    b.prompt.trim(),
    '```',
    '',
  ].join('\n');
  writeFileSync(path, md);
}

async function main() {
  if (!memoryEnabled()) {
    console.error('❌ DATABASE_URL not set — this experiment needs live memory.');
    process.exit(1);
  }
  const window = contextWindow();
  const gameId = `exp-recall-${Date.now()}`;
  console.log(`model=${MODEL}  window=${window}  gameId=${gameId}`);

  console.log('Seeding the whole game into long-term memory (mirrors recordPublic)…');
  await seedMemory(gameId);

  const state = buildState(gameId);

  // Sanity: the window must have scrolled the Detective claim out of the prompt.
  const claimVisible = visibleLog(state).some((l) => l.text === DETECTIVE_CLAIM);
  console.log(`Detective claim visible in prompt window: ${claimVisible} (want false)`);

  console.log('ARM A (memory ON) — recalling + voting…');
  const a = await runTurn(state, state.players.find((p) => p.name === DECIDER)!, true);
  console.log(`  recalled block: ${a.memBlock ? 'present' : 'EMPTY'}  vote=${a.vote}`);

  console.log('ARM B (control, no memory) — voting…');
  const b = await runTurn(state, state.players.find((p) => p.name === DECIDER)!, false);
  console.log(`  vote=${b.vote}`);

  const claimRecalled = /Detective/i.test(a.memBlock ?? '');
  const pass = !claimVisible && !!a.memBlock && claimRecalled && !!a.vote && !!b.vote && a.vote !== b.vote;

  mkdirSync('artifacts', { recursive: true });
  const path = 'artifacts/recall-vs-control.md';
  writeArtifact(path, gameId, window, claimVisible, claimRecalled, a, b, pass);

  console.log('');
  console.log(`claimVisible=${claimVisible}  claimRecalled=${claimRecalled}`);
  console.log(`ARM A vote=${a.vote}   ARM B vote=${b.vote}   differ=${a.vote !== b.vote}`);
  console.log(`${pass ? '✅ PASS' : '⚠️  INCONCLUSIVE'} — artifact written to ${path}`);
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
