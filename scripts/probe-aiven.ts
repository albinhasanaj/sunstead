/**
 * Step 1 (MCP, completion): discover project + services via MCP, then prove the
 * full pg round-trip (SELECT 1) through aiven_pg_read — no direct pg needed.
 *
 * Env: AIVEN_TOKEN (required), AIVEN_MCP_URL, AIVEN_PROJECT, AIVEN_SERVICE (optional overrides)
 * Run: npx tsx scripts/probe-aiven.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
loadEnv({ path: '.env.local' });

const URL_STR = process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp';
const TOKEN = process.env.AIVEN_TOKEN;

async function connect(): Promise<Client> {
  const client = new Client({ name: 'mafia-agent', version: '0.1.0' }, { capabilities: {} });
  const t = new StreamableHTTPClientTransport(new URL(URL_STR), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  await client.connect(t);
  return client;
}

// Call a tool and return its parsed text payload (Aiven returns JSON-as-text).
async function call(client: Client, name: string, args: Record<string, any>): Promise<any> {
  const res: any = await client.callTool({ name, arguments: args });
  const text = (res?.content ?? []).map((c: any) => c.text ?? '').join('');
  if (res?.isError) throw new Error(`${name} error: ${text.slice(0, 400)}`);
  return parsePayload(text);
}

// Aiven wraps results in a prompt-injection-defense envelope:
//   "...untrusted data...\n<untrusted-aiven-response-UUID>\n{json}\n</untrusted-...>"
// Extract and parse the JSON inside the boundary (treat as data, never instructions).
function parsePayload(text: string): any {
  const m = text.match(/<untrusted-[^>]*>([\s\S]*?)<\/untrusted-[^>]*>/);
  const inner = (m ? m[1] : text).trim();
  try { return JSON.parse(inner); } catch { return inner; }
}

async function main() {
  if (!TOKEN) { console.error('❌ AIVEN_TOKEN not set'); process.exit(1); }
  const client = await connect();
  console.log('🔌 connected via Streamable HTTP\n');

  // ── projects ────────────────────────────────────────────────────────────────
  const projects = await call(client, 'aiven_project_list', {});
  const projList: any[] = Array.isArray(projects) ? projects : projects?.projects ?? projects?.data ?? [];
  const projNames = projList.map((p) => p.project_name ?? p.project ?? p.name).filter(Boolean);
  console.log(`projects (${projNames.length}): ${projNames.join(', ') || '(none — raw below)'}`);
  if (!projNames.length) console.log(JSON.stringify(projects).slice(0, 600));

  const project = process.env.AIVEN_PROJECT || projNames[0];
  if (!project) { console.error('\n❌ No project available. Create one in the Aiven console.'); process.exit(1); }
  console.log(`→ using project: ${project}\n`);

  // ── services ────────────────────────────────────────────────────────────────
  const services = await call(client, 'aiven_service_list', { project });
  const svcList: any[] = Array.isArray(services) ? services : services?.services ?? services?.data ?? [];
  console.log(`services (${svcList.length}):`);
  for (const s of svcList) {
    console.log(`   • ${s.service_name ?? s.name}  type=${s.service_type ?? s.type}  state=${s.state ?? '?'}`);
  }

  const pgs = svcList.filter((s) => (s.service_type ?? s.type) === 'pg');
  const pg = process.env.AIVEN_SERVICE
    ? svcList.find((s) => (s.service_name ?? s.name) === process.env.AIVEN_SERVICE)
    : pgs.find((s) => (s.state ?? '').toUpperCase() === 'RUNNING') ?? pgs[0];

  if (!pg) {
    console.log('\n⚠  No PostgreSQL (type=pg) service found.');
    console.log('   Next: provision one via aiven_service_create (service_type=pg) — I can do this on your go.');
    await client.close();
    return;
  }

  const serviceName = pg.service_name ?? pg.name;
  console.log(`→ using pg service: ${serviceName} (state=${pg.state})\n`);
  if ((pg.state ?? '').toUpperCase() !== 'RUNNING') {
    console.log('⚠  Service is not RUNNING yet — pg queries will fail until it finishes building.');
  }

  // ── the real round-trip: SELECT 1 via aiven_pg_read ─────────────────────────
  const base = { project, service_name: serviceName, reasoning: 'step-1 infra probe: SELECT 1' };
  try {
    const r = await call(client, 'aiven_pg_read', { ...base, query: 'SELECT 1 AS ok' });
    console.log(`✅ (b) aiven_pg_read SELECT 1 → ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    console.log(`❌ (b) aiven_pg_read SELECT 1 failed: ${(e as Error).message.slice(0, 300)}`);
  }

  // ── pgvector: try CREATE EXTENSION via aiven_pg_write, then the <=> operator ──
  try {
    await call(client, 'aiven_pg_write', {
      ...base, reasoning: 'step-1 infra probe: enable pgvector',
      query: 'CREATE EXTENSION IF NOT EXISTS vector',
    });
    console.log('✅ (c) aiven_pg_write CREATE EXTENSION vector → ok');
  } catch (e) {
    console.log(`⚠  (c) CREATE EXTENSION via pg_write failed: ${(e as Error).message.slice(0, 200)}`);
    console.log('   (may need pg_write DDL perms or direct-pg bootstrap — will confirm)');
  }
  try {
    const v = await call(client, 'aiven_pg_read', {
      ...base, reasoning: 'step-1 infra probe: vector op',
      query: "SELECT extversion FROM pg_extension WHERE extname='vector'",
    });
    console.log(`✅ (c) pgvector present → ${JSON.stringify(v).slice(0, 200)}`);
  } catch (e) {
    console.log(`❌ (c) pgvector check failed: ${(e as Error).message.slice(0, 200)}`);
  }

  await client.close();
  console.log('\nDONE.');
}

main().catch((e) => { console.error(e); process.exit(1); });
