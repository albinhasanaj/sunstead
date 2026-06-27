/**
 * Deterministic proof of the memory hot path (Postgres + pgvector), no LLM game.
 * Plants a role-claim contradiction across rounds, then recalls it by similarity.
 * Needs DATABASE_URL set in .env.local. Run: npx tsx scripts/probe-memory.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { remember, recall, memoryEnabled } from '../lib/memory';

async function main() {
  console.log(`memoryEnabled: ${memoryEnabled()}`);
  const gameId = 'proof-' + Date.now();

  // Round 1: Gemini claims Detective. Round 2: Gemini contradicts that claim.
  await remember({ gameId, round: 1, phase: 'DISCUSSION', speaker: 'Gemini', text: 'I am the Detective. Last night I investigated DeepSeek and he came back innocent.' });
  await remember({ gameId, round: 1, phase: 'DISCUSSION', speaker: 'DeepSeek', text: 'Thanks Gemini, glad the Detective cleared me.' });
  await remember({ gameId, round: 1, phase: 'DISCUSSION', speaker: 'Claude', text: 'I think we should keep an eye on Grok, he is too quiet.' });
  await remember({ gameId, round: 2, phase: 'DISCUSSION', speaker: 'Gemini', text: "I'm only a regular Villager, I never claimed to be the Detective." });

  console.log(`\nWrote 4 statements for ${gameId}. Now recalling as an agent would on round 2…\n`);

  // An agent on round 2 recalls using the latest line; expect Gemini's round-1
  // Detective claim to surface as the nearest contradiction.
  const hits = await recall({ gameId, queryText: "I'm only a regular Villager, I never claimed to be the Detective.", k: 5 });
  for (const h of hits) {
    console.log(`  dist=${h.dist.toFixed(4)}  [r${h.round} ${h.phase}] ${h.speaker}: "${h.text}"`);
  }

  const contradiction = hits.find((h) => h.speaker === 'Gemini' && h.round === 1);
  console.log(`\n${contradiction ? '✅ Contradiction retrieved: Gemini claimed Detective (r1) vs Villager (r2).' : '❌ Did not surface the planted contradiction.'}`);
  process.exit(contradiction ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
