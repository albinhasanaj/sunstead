/**
 * Print the inputSchema for one or more Aiven MCP tools.
 * Usage: npx tsx scripts/aiven-schema.ts aiven_kafka_topic_message_produce aiven_kafka_topic_message_list
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
loadEnv({ path: '.env.local' });

async function main() {
  const names = process.argv.slice(2);
  const client = new Client({ name: 'mafia-agent', version: '0.1.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.AIVEN_TOKEN}` } },
  }));
  const { tools } = await client.listTools();
  for (const n of names) {
    const t = tools.find((x) => x.name === n);
    console.log(`\n=== ${n} ===`);
    console.log(t ? JSON.stringify((t as any).inputSchema, null, 2) : 'NOT FOUND');
  }
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
