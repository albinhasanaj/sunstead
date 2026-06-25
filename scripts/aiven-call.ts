/**
 * Generic Aiven MCP caller for ad-hoc probing during the build.
 * Usage: npx tsx scripts/aiven-call.ts <toolName> '<jsonArgs>'
 * Example: npx tsx scripts/aiven-call.ts aiven_pg_read '{"project":"p","service_name":"s","query":"SELECT 1","reasoning":"probe"}'
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
loadEnv({ path: '.env.local' });

async function main() {
  const [, , toolName, jsonArgs] = process.argv;
  if (!toolName) { console.error('usage: aiven-call.ts <toolName> [jsonArgs]'); process.exit(1); }
  const args = jsonArgs ? JSON.parse(jsonArgs) : {};

  const client = new Client({ name: 'mafia-agent', version: '0.1.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.AIVEN_TOKEN}` } },
  }));

  const res: any = await client.callTool({ name: toolName, arguments: args });
  const text = (res?.content ?? []).map((c: any) => c.text ?? '').join('');
  console.log(`isError=${!!res?.isError}`);
  console.log(text);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
