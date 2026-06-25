/**
 * Deterministic proof of the Kafka bus (lib/bus.ts) via Aiven MCP: publish a few
 * table events + votes, then consume the votes topic and tally — exactly what
 * phases.ts does. No LLM game needed.
 * Run: npx tsx scripts/probe-bus.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { publish, drain, TOPIC_TABLE, TOPIC_VOTES, busEnabled } from '../lib/bus';

async function main() {
  console.log(`busEnabled: ${busEnabled()}`);
  const gameId = 'bus-proof-' + Date.now();

  await publish(TOPIC_TABLE, { kind: 'speak', gameId, round: 1, phase: 'DISCUSSION', speaker: 'GPT', text: 'I trust Claude.' });
  await publish(TOPIC_VOTES, { kind: 'vote', gameId, round: 1, voter: 'GPT', voterId: 'p1', target: 'Claude', targetId: 'p2' });
  await publish(TOPIC_VOTES, { kind: 'vote', gameId, round: 1, voter: 'Grok', voterId: 'p3', target: 'Claude', targetId: 'p2' });
  await publish(TOPIC_VOTES, { kind: 'vote', gameId, round: 1, voter: 'Qwen', voterId: 'p4', target: 'Gemini', targetId: 'p5' });
  console.log(`published 1 table event + 3 votes for ${gameId}. draining…`);

  await new Promise((r) => setTimeout(r, 2500));

  const votes = await drain(TOPIC_VOTES);
  const mine = votes.filter((m) => m.gameId === gameId && m.round === 1 && m.targetId);
  const byVoter: Record<string, string> = {};
  for (const m of mine) byVoter[m.voterId as string] = m.targetId as string;
  const counts: Record<string, number> = {};
  for (const t of Object.values(byVoter)) counts[t] = (counts[t] ?? 0) + 1;
  console.log(`consumed ${mine.length} votes for this game → counts:`, counts);

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  console.log(`\n${top && top[0] === 'p2' && top[1] === 2 ? '✅ Kafka tally correct: p2 (Claude) eliminated with 2 votes.' : '❌ tally mismatch'}`);
  process.exit(top && top[0] === 'p2' ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
