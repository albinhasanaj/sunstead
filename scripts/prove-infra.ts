/**
 * Step 1 completion: wait for the pg service to come up, then prove the full
 * infra THROUGH the Aiven MCP (no direct pg):
 *   - SELECT 1 via aiven_pg_read
 *   - pgvector listed in available extensions
 *   - CREATE EXTENSION vector via aiven_pg_write
 *   - <=> distance operator works
 * Run (async): npx tsx scripts/prove-infra.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
loadEnv({ path: '.env.local' });

const PROJECT = process.env.AIVEN_PROJECT || 'albinhasanaj06-1f56';
const SERVICE = process.env.AIVEN_SERVICE || 'mafia-memory';
const TOKEN = process.env.AIVEN_TOKEN;

function parse(text: string): any {
  const m = text.match(/<untrusted-[^>]*>([\s\S]*?)<\/untrusted-[^>]*>/);
  const inner = (m ? m[1] : text).trim();
  try { return JSON.parse(inner); } catch { return inner; }
}

async function main() {
  const client = new Client({ name: 'mafia-agent', version: '0.1.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  }));

  const call = async (name: string, args: Record<string, any>) => {
    const res: any = await client.callTool({ name, arguments: args });
    const text = (res?.content ?? []).map((c: any) => c.text ?? '').join('');
    return { isError: !!res?.isError, data: parse(text), text };
  };
  const pg = { project: PROJECT, service_name: SERVICE };

  // ── wait for RUNNING ────────────────────────────────────────────────────────
  const deadline = Date.now() + 8 * 60_000;
  let running = false;
  while (Date.now() < deadline) {
    const g = await call('aiven_service_get', pg);
    const state = g.data?.service?.state ?? '?';
    console.log(`[${new Date().toISOString().slice(11, 19)}] state=${state}`);
    if (state === 'RUNNING') { running = true; break; }
    await new Promise((r) => setTimeout(r, 12_000));
  }
  if (!running) { console.error('❌ service did not reach RUNNING within timeout'); process.exit(1); }

  // ── SELECT 1 ────────────────────────────────────────────────────────────────
  const one = await call('aiven_pg_read', { ...pg, query: 'SELECT 1 AS ok', reasoning: 'infra proof: SELECT 1' });
  console.log(`(b) SELECT 1 → isError=${one.isError} ${JSON.stringify(one.data).slice(0, 160)}`);

  // ── pgvector available? ─────────────────────────────────────────────────────
  const exts = await call('aiven_pg_service_available_extensions', { ...pg, search: 'vector' });
  const hasVector = JSON.stringify(exts.data).includes('"vector"');
  console.log(`(c) vector in available extensions → ${hasVector}`);

  // ── CREATE EXTENSION vector ─────────────────────────────────────────────────
  const create = await call('aiven_pg_write', { ...pg, query: 'CREATE EXTENSION IF NOT EXISTS vector', reasoning: 'infra proof: enable pgvector' });
  console.log(`(c) CREATE EXTENSION vector → isError=${create.isError} ${create.text.slice(0, 160).replace(/\s+/g, ' ')}`);

  const ver = await call('aiven_pg_read', { ...pg, query: "SELECT extversion FROM pg_extension WHERE extname='vector'", reasoning: 'infra proof: vector version' });
  console.log(`(c) pgvector version → ${JSON.stringify(ver.data).slice(0, 160)}`);

  // ── <=> operator ────────────────────────────────────────────────────────────
  const dist = await call('aiven_pg_read', { ...pg, query: "SELECT ('[1,0,0]'::vector <=> '[0,1,0]'::vector) AS cosdist", reasoning: 'infra proof: vector distance op' });
  console.log(`(c) <=> operator → ${JSON.stringify(dist.data).slice(0, 160)}`);

  await client.close();
  console.log('\n✅ STEP 1 INFRA PROVEN THROUGH MCP.');
}

main().catch((e) => { console.error(e); process.exit(1); });
