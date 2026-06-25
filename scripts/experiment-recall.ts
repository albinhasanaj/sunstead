/**
 * Fix-2 artifact: recall-vs-control A/B with LIVE models.
 *
 * Same scenario, same model, same temperature (0) — run twice on the SAME built
 * GameState, the only difference being the long-term memory block:
 *   ARM A  (memory ON)  — recallForTurn() injects pgvector-recalled prior
 *                         statements (Aiven Postgres via MCP) into the prompt.
 *   ARM B  (control)    — identical prompt, but no memory block (recall disabled).
 *
 * The deciding agent (Claude, a Villager) votes at round 2. A cross-round
 * contradiction — Gemini claimed DETECTIVE in round 1, then denies ever holding a
 * role in round 2 — lives ONLY in long-term memory, not in the in-prompt
 * transcript (it has "scrolled out" of the recent window). That is exactly the
 * regime where vector recall earns its keep: ARM A should recall the round-1
 * Detective claim, catch the contradiction, and vote Gemini; ARM B, blind to it,
 * should follow the live discussion and vote elsewhere.
 *
 * This is a controlled existence proof (a planted contradiction, temperature 0),
 * not a claim of determinism — one clean instance is the artifact.
 *
 * The turn machinery here mirrors engine/agent.ts::takeTurn exactly (same prompt
 * assembly, same wrapped tools, same toolChoice/stepCountIs) so ARM A reproduces
 * the real game loop; the only addition is that we capture the prompt + vote.
 *
 * Writes: artifacts/recall-vs-control.md  (committed)
 * Run:    npx tsx scripts/experiment-recall.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { mkdirSync, writeFileSync } from 'node:fs';
import { generateText, stepCountIs, tool } from 'ai';
import type { AgentState, GameEvent, GameState } from '../engine/types';
import { mafiaGame } from '../games/mafia';
import { remember, memoryEnabled } from '../lib/memory';

const MODEL = process.env.MAFIA_MODEL || 'anthropic/claude-haiku-4.5'; // rate-limit-safe
const DECIDER = 'Claude'; // the seat that votes

// ── build the scenario state ───────────────────────────────────────────────────
function buildState(gameId: string): GameState {
  const mk = (id: string, name: string, role: string, alive = true): AgentState => ({
    id, name, alive, role, private: { model: MODEL, trait: traitOf(name), suspicions: {}, notes: '' },
  });
  const players: AgentState[] = [
    mk('p1', 'GPT', 'villager'),
    mk('p2', 'Claude', 'villager'), // the decider (town)
    mk('p3', 'Gemini', 'mafia'),    // the liar (role hidden from Claude)
    mk('p4', 'DeepSeek', 'villager'),
    mk('p5', 'Qwen', 'villager', false), // killed night 1 — justifies round 2
  ];
  // Round-2 discussion the decider SEES in-prompt. It points suspicion at GPT
  // (DeepSeek accuses him) and contains Gemini DENYING any role — but NOT the
  // round-1 Detective claim, which lives only in long-term memory.
  const publicLog: GameState['publicLog'] = [
    { speaker: 'system', text: 'Dawn breaks. Qwen was found dead. They were a Villager.' },
    { speaker: 'p4', text: 'GPT, you have dodged every question and kept pushing to lynch townsfolk. I think you are Mafia.' },
    { speaker: 'p1', text: 'That is a stretch, DeepSeek. I have done nothing suspicious.' },
    { speaker: 'p3', text: 'I am just an ordinary villager like most of us — I never had any special role. Let us reason this out calmly.' },
    { speaker: 'p4', text: 'I am voting GPT.' },
  ];
  return {
    players,
    phase: 'VOTE',
    round: 2,
    publicLog,
    winner: null,
    meta: { gameId, votes: {}, killProposals: {}, nightKill: null, protect: null, mafiaChat: [] },
  };
}

function traitOf(name: string): string {
  if (name === 'Claude') return 'a thoughtful, principled analyst who weighs every side carefully and refuses to accuse without reasoning it through.';
  return 'a sharp, observant player who keeps their cards close.';
}

// Round-1 statements that have scrolled out of the prompt but live in memory.
// Seeded via the real remember() → Aiven Postgres (pgvector) over MCP.
async function seedMemory(gameId: string): Promise<void> {
  const r1 = [
    { speaker: 'Gemini', text: 'I am the Detective. Last night I investigated DeepSeek and he came back innocent — you can all trust him.' },
    { speaker: 'GPT', text: 'Good to know, Gemini. That clears DeepSeek in my book.' },
    { speaker: 'DeepSeek', text: 'Appreciated. Then let us put pressure on the players who have stayed quiet.' },
  ];
  for (const s of r1) {
    await remember({ gameId, round: 1, phase: 'DISCUSSION', speaker: s.speaker, text: s.text });
  }
}

// ── one turn, mirroring engine/agent.ts::takeTurn (capturing prompt + vote) ─────
interface TurnResult { prompt: string; memBlock: string | null; vote: string | null; reasoning: string | null; }

async function runTurn(state: GameState, agent: AgentState, withMemory: boolean): Promise<TurnResult> {
  // Fresh private slate so the two arms start identically.
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
    memBlock = await mafiaGame.recallForTurn(state, agent); // real pgvector recall via Aiven MCP
    if (memBlock) prompt = `${baseContext}\n\n${memBlock}`;
  }

  await generateText({
    model: MODEL,
    system: mafiaGame.systemPrompt(state, agent),
    prompt,
    tools,
    toolChoice: 'required',
    stopWhen: [stepCountIs(2)],
    temperature: 0, // hold everything but the memory block constant
  });

  const vote = voteTargetId ? (state.players.find((p) => p.id === voteTargetId)?.name ?? voteTargetId) : null;
  return { prompt, memBlock, vote, reasoning };
}

// ── artifact writer ─────────────────────────────────────────────────────────────
function writeArtifact(path: string, gameId: string, a: TurnResult, b: TurnResult, pass: boolean): void {
  const recalledGeminiR1 = /Detective/i.test(a.memBlock ?? '');
  const md = [
    '# Recall-vs-control artifact — does pgvector memory change the vote?',
    '',
    '> Generated by `scripts/experiment-recall.ts` against a LIVE model. This is a',
    '> controlled A/B existence proof, not a determinism claim.',
    '',
    '## Method',
    '',
    `- **Model:** \`${MODEL}\`, **temperature:** 0 (same in both arms).`,
    `- **Decider:** ${DECIDER} (a Villager) casts a vote at round 2 (\`VOTE\` phase).`,
    `- **Game id:** \`${gameId}\` — memory is scoped to this id in Aiven.`,
    '- **Only variable:** ARM A appends the pgvector-recalled memory block to the',
    '  prompt; ARM B (control) does not. Same system prompt, same in-prompt transcript.',
    '- **Planted contradiction:** in round 1 (held only in Aiven memory, NOT in the',
    '  prompt transcript) Gemini claimed to be the **Detective**; in the round-2',
    `  discussion shown to ${DECIDER}, Gemini denies ever holding a role.`,
    '',
    '## Result',
    '',
    `| | ARM A — memory ON | ARM B — control (no memory) |`,
    `|---|---|---|`,
    `| Recalled block present in prompt | ${a.memBlock ? 'YES' : 'no'} | n/a |`,
    `| Round-1 Detective claim recalled | ${recalledGeminiR1 ? 'YES' : 'no'} | n/a |`,
    `| **Vote** | **${a.vote ?? '(none)'}** | **${b.vote ?? '(none)'}** |`,
    '',
    `**Votes differ:** ${a.vote !== b.vote ? `YES (${a.vote} vs ${b.vote})` : 'no'} — ` +
      `**verdict: ${pass ? 'PASS — recall changed the vote' : 'INCONCLUSIVE this run'}**`,
    '',
    '---',
    '',
    '## ARM A (memory ON) — recalled memory block injected into the prompt',
    '',
    'This block is produced by `mafiaGame.recallForTurn()` → `recall()` → Aiven',
    '`aiven_pg_read` pgvector similarity search, exactly as in the live game loop:',
    '',
    '```',
    (a.memBlock ?? '(no memory recalled)').trim(),
    '```',
    '',
    `**ARM A private reasoning (update_beliefs):** ${a.reasoning ?? '(none)'}`,
    '',
    `**ARM A vote:** ${a.vote ?? '(none)'}`,
    '',
    '---',
    '',
    '## ARM B (control) — same prompt WITHOUT the memory block',
    '',
    `**ARM B private reasoning (update_beliefs):** ${b.reasoning ?? '(none)'}`,
    '',
    `**ARM B vote:** ${b.vote ?? '(none)'}`,
    '',
    '---',
    '',
    '## Full ARM A prompt (system context + memory block)',
    '',
    '```',
    a.prompt.trim(),
    '```',
    '',
    '## Full ARM B prompt (control — no memory block)',
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
    console.error('❌ AIVEN_TOKEN not set — this experiment needs live memory.');
    process.exit(1);
  }
  const gameId = `exp-recall-${Date.now()}`;
  console.log(`model=${MODEL}  gameId=${gameId}`);

  console.log('Seeding round-1 history into Aiven memory (via MCP)…');
  await seedMemory(gameId);

  const state = buildState(gameId);

  console.log('ARM A (memory ON) — recalling + voting…');
  const a = await runTurn(state, state.players.find((p) => p.name === DECIDER)!, true);
  console.log(`  recalled block: ${a.memBlock ? 'present' : 'EMPTY'}  vote=${a.vote}`);

  console.log('ARM B (control, no memory) — voting…');
  const b = await runTurn(state, state.players.find((p) => p.name === DECIDER)!, false);
  console.log(`  vote=${b.vote}`);

  const recalledContradiction = /Detective/i.test(a.memBlock ?? '');
  const pass = !!a.memBlock && recalledContradiction && !!a.vote && !!b.vote && a.vote !== b.vote;

  mkdirSync('artifacts', { recursive: true });
  const path = 'artifacts/recall-vs-control.md';
  writeArtifact(path, gameId, a, b, pass);

  console.log('');
  console.log(`Recalled Detective contradiction in ARM A prompt: ${recalledContradiction}`);
  console.log(`ARM A vote=${a.vote}   ARM B vote=${b.vote}   differ=${a.vote !== b.vote}`);
  console.log(`${pass ? '✅ PASS' : '⚠️  INCONCLUSIVE'} — artifact written to ${path}`);
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
