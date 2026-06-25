/**
 * Step 1 (MCP): prove a real round-trip Aiven MCP tool call from our Node server.
 *   - connects to the Aiven MCP over Streamable HTTP (falls back to SSE)
 *   - lists tools (reveals aiven_pg_read/write arg schemas + whether Kafka tools exist)
 *   - runs one aiven_pg_read "SELECT 1"
 *
 * Env (put in .env.local, do NOT commit):
 *   AIVEN_TOKEN     Aiven personal API token (sent as: Authorization: Bearer <token>)
 *   AIVEN_MCP_URL   optional, defaults to https://mcp.aiven.live/mcp
 *   AIVEN_PROJECT / AIVEN_SERVICE  optional, if the pg tools require explicit targeting
 *
 * Run:  npx tsx scripts/probe-mcp.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
loadEnv({ path: '.env.local' });

const URL_STR = process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp';
const TOKEN = process.env.AIVEN_TOKEN;

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

async function connect(): Promise<Client> {
  const client = new Client({ name: 'mafia-agent', version: '0.1.0' }, { capabilities: {} });
  const url = new URL(URL_STR);

  // Preferred: modern Streamable HTTP transport.
  try {
    const t = new StreamableHTTPClientTransport(url, { requestInit: { headers: authHeaders() } });
    await client.connect(t);
    console.log('🔌 connected via Streamable HTTP');
    return client;
  } catch (e) {
    console.warn(`Streamable HTTP failed (${(e as Error).message.slice(0, 120)}) — trying SSE…`);
  }

  // Fallback: legacy HTTP+SSE transport.
  const t = new SSEClientTransport(url, { requestInit: { headers: authHeaders() } });
  await client.connect(t);
  console.log('🔌 connected via SSE');
  return client;
}

function schemaKeys(s: any): string {
  const props = s?.properties ?? s?.jsonSchema?.properties;
  return props ? Object.keys(props).join(', ') : '(no documented params)';
}

async function main() {
  if (!TOKEN) {
    console.error('❌ AIVEN_TOKEN not set in .env.local — cannot authenticate to the Aiven MCP.');
    console.error('   Create a personal token in the Aiven console (User → Authentication → Tokens),');
    console.error('   then add  AIVEN_TOKEN=<token>  to .env.local.');
    process.exit(1);
  }

  let client: Client;
  try {
    client = await connect();
  } catch (e) {
    console.error(`\n❌ MCP connect failed: ${(e as Error).message}`);
    process.exit(1);
  }

  // ── list tools ──────────────────────────────────────────────────────────────
  const { tools } = await client.listTools();
  console.log(`\n✅ listTools → ${tools.length} tools:`);
  for (const t of tools) {
    console.log(`   • ${t.name}  [${schemaKeys((t as any).inputSchema)}]`);
  }

  const pgRead = tools.find((t) => /pg_read|postgres.*(read|query)|query.*postgres/i.test(t.name));
  const pgWrite = tools.find((t) => /pg_write|postgres.*write/i.test(t.name));
  const kafka = tools.filter((t) => /kafka/i.test(t.name));
  console.log(`\n   pg_read: ${pgRead?.name ?? 'NOT FOUND'} | pg_write: ${pgWrite?.name ?? 'NOT FOUND'}`);
  console.log(`   kafka tools: ${kafka.length ? kafka.map((t) => t.name).join(', ') : 'NONE'}  ← decides step 3`);
  if (pgRead) {
    console.log(`\n   ${pgRead.name} input schema:`);
    console.log('   ' + JSON.stringify((pgRead as any).inputSchema, null, 2).replace(/\n/g, '\n   '));
  }

  // ── one real read: SELECT 1 ─────────────────────────────────────────────────
  if (pgRead) {
    const base: Record<string, any> = {};
    if (process.env.AIVEN_PROJECT) base.project = process.env.AIVEN_PROJECT;
    if (process.env.AIVEN_SERVICE) base.service = process.env.AIVEN_SERVICE;
    // Try the most common arg names for the SQL string until one is accepted.
    const candidates = [
      { ...base, query: 'SELECT 1 AS ok' },
      { ...base, sql: 'SELECT 1 AS ok' },
      { ...base, statement: 'SELECT 1 AS ok' },
    ];
    let ok = false;
    for (const args of candidates) {
      try {
        const res: any = await client.callTool({ name: pgRead.name, arguments: args });
        const text = (res?.content ?? []).map((c: any) => c.text ?? JSON.stringify(c)).join(' ').slice(0, 300);
        if (res?.isError) {
          console.log(`   ↪ args {${Object.keys(args).join(',')}} → tool error: ${text}`);
          continue;
        }
        console.log(`\n✅ aiven_pg_read SELECT 1 OK with args {${Object.keys(args).join(',')}} → ${text}`);
        ok = true;
        break;
      } catch (e) {
        console.log(`   ↪ args {${Object.keys(args).join(',')}} → threw: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    if (!ok) console.log('\n⚠  Connected + listed tools, but SELECT 1 arg shape not matched — see schema above.');
  }

  await client.close();
  console.log('\nDONE.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
