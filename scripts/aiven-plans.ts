/**
 * List PostgreSQL plans (+ pricing) available in the project, so we can pick a
 * free/cheap plan before provisioning. Read-only.
 * Run: npx tsx scripts/aiven-plans.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
loadEnv({ path: '.env.local' });

const TOKEN = process.env.AIVEN_TOKEN;

async function main() {
  const client = new Client({ name: 'mafia-agent', version: '0.1.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  }));

  const project = process.env.AIVEN_PROJECT || 'albinhasanaj06-1f56';
  const res: any = await client.callTool({
    name: 'aiven_service_type_plans',
    arguments: { project, service_type: 'pg' },
  });
  const text = (res?.content ?? []).map((c: any) => c.text ?? '').join('');
  const m = text.match(/<untrusted-[^>]*>([\s\S]*?)<\/untrusted-[^>]*>/);
  const inner = (m ? m[1] : text).trim();
  let data: any;
  try { data = JSON.parse(inner); } catch { console.log(inner.slice(0, 2000)); await client.close(); return; }

  const plans: any[] = Array.isArray(data) ? data : data?.plans ?? data?.service_plans ?? [];
  console.log(`pg plans (${plans.length}):`);
  for (const p of plans) {
    const name = p.service_plan ?? p.plan ?? p.name;
    const mem = p.node_memory_mb ? `${Math.round(p.node_memory_mb / 1024)}GB` : '?';
    const nodes = p.node_count ?? '?';
    const price = p.regions ? Object.values(p.regions)[0] : (p.price_usd ?? p.monthly_price ?? '?');
    const free = /free/i.test(String(name)) || JSON.stringify(p).includes('"price_usd":0');
    console.log(`   ${free ? '🆓' : '  '} ${String(name).padEnd(18)} nodes=${nodes} mem=${mem} price~${JSON.stringify(price).slice(0, 80)}`);
  }
  // Dump the first plan raw so we can see the exact pricing/region shape.
  if (plans[0]) console.log('\nsample plan raw:\n' + JSON.stringify(plans[0], null, 2).slice(0, 1200));

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
