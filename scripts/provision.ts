/**
 * Provision the agent's own Postgres via the Aiven MCP — idempotently.
 * Calls memory.provision(), which: aiven_service_get → if missing,
 * aiven_service_create (service_type=pg) → wait for RUNNING. Then the first
 * game's ensureSchema() enables pgvector + creates the table, also via MCP.
 *
 * The whole database lifecycle is MCP tool calls — no console clicks, no direct pg.
 *
 *   npx tsx scripts/provision.ts
 *   # provision a fresh service name to exercise the create branch:
 *   AIVEN_SERVICE=mafia-memory-2 npx tsx scripts/provision.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { provision, memoryEnabled } from '../lib/memory';

async function main() {
  if (!memoryEnabled()) {
    console.error('❌ AIVEN_TOKEN not set in .env.local — cannot provision via MCP.');
    process.exit(1);
  }
  const service = process.env.AIVEN_SERVICE || 'mafia-memory';
  console.log(`Provisioning pg service "${service}" via Aiven MCP (idempotent)…`);
  const t0 = Date.now();
  await provision();
  console.log(`✅ "${service}" is RUNNING (provisioned/confirmed via MCP in ${Math.round((Date.now() - t0) / 1000)}s).`);
  process.exit(0);
}

main().catch((e) => { console.error('❌ provision failed:', (e as Error).message); process.exit(1); });
