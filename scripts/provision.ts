/**
 * Bootstrap the memory schema on your Postgres (e.g. Supabase) — idempotently.
 * Calls memory.provision(), which connects via DATABASE_URL and runs:
 *   CREATE EXTENSION IF NOT EXISTS vector
 *   CREATE TABLE IF NOT EXISTS statements (… embedding vector(1536) …)
 *   CREATE INDEX IF NOT EXISTS statements_game_idx ON statements (game_id)
 *
 * Set DATABASE_URL in .env.local to your Supabase connection string
 * (Project → Settings → Database). Run:  npx tsx scripts/provision.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { provision, memoryEnabled } from '../lib/memory';

async function main() {
  if (!memoryEnabled()) {
    console.error('❌ DATABASE_URL not set in .env.local — cannot provision the memory schema.');
    process.exit(1);
  }
  console.log('Provisioning memory schema (pgvector extension + statements table)…');
  const t0 = Date.now();
  await provision();
  console.log(`✅ memory schema ready (provisioned/confirmed in ${Date.now() - t0}ms).`);
  process.exit(0);
}

main().catch((e) => { console.error('❌ provision failed:', (e as Error).message); process.exit(1); });
