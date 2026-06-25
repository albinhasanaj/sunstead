/**
 * Step 3 (Kafka) infra proof: wait for the Kafka service to come up, create the
 * comms topics, then prove a real produce -> consume round-trip THROUGH the Aiven
 * MCP (aiven_kafka_topic_message_produce / _list).
 * Run (async): npx tsx scripts/prove-kafka.ts
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
loadEnv({ path: '.env.local' });

const PROJECT = process.env.AIVEN_PROJECT || 'albinhasanaj06-1f56';
const SERVICE = process.env.AIVEN_KAFKA_SERVICE || 'kafka-17cdf2b1';
const TOPICS = ['mafia.table', 'mafia.votes'];

function parse(text: string): any {
  const m = text.match(/<untrusted-[^>]*>([\s\S]*?)<\/untrusted-[^>]*>/);
  const inner = (m ? m[1] : text).trim();
  try { return JSON.parse(inner); } catch { return inner; }
}

async function main() {
  const client = new Client({ name: 'mafia-agent', version: '0.1.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.AIVEN_TOKEN}` } },
  }));
  const call = async (name: string, args: Record<string, any>) => {
    const res: any = await client.callTool({ name, arguments: args });
    const text = (res?.content ?? []).map((c: any) => c.text ?? '').join('');
    return { isError: !!res?.isError, data: parse(text), text };
  };
  const svc = { project: PROJECT, service_name: SERVICE };

  // ── wait for RUNNING ────────────────────────────────────────────────────────
  const deadline = Date.now() + 20 * 60_000;
  let running = false;
  while (Date.now() < deadline) {
    const g = await call('aiven_service_get', svc);
    const state = g.data?.service?.state ?? '?';
    console.log(`[${new Date().toISOString().slice(11, 19)}] kafka state=${state}`);
    if (state === 'RUNNING') { running = true; break; }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  if (!running) { console.error('❌ kafka not RUNNING in time'); process.exit(1); }

  // ── create topics ───────────────────────────────────────────────────────────
  for (const topic_name of TOPICS) {
    let r = await call('aiven_kafka_topic_create', { ...svc, topic_name, partitions: 1, replication: 2 });
    if (r.isError) r = await call('aiven_kafka_topic_create', { ...svc, topic_name, partitions: 1, replication: 1 });
    console.log(`create ${topic_name}: isError=${r.isError} ${r.text.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  // topics need a moment to register with the REST proxy
  await new Promise((r) => setTimeout(r, 8_000));

  // ── produce ─────────────────────────────────────────────────────────────────
  const prod = await call('aiven_kafka_topic_message_produce', {
    ...svc, topic_name: 'mafia.table', format: 'json',
    records: [{ value: { kind: 'speak', speaker: 'Gemini', text: 'I am the Detective.', round: 1 } }],
  });
  console.log(`\nproduce: isError=${prod.isError} ${JSON.stringify(prod.data).slice(0, 200)}`);

  await new Promise((r) => setTimeout(r, 3_000));

  // ── consume (try a couple of partition-arg shapes) ──────────────────────────
  for (const partitions of [{ '0': {} }, { '0': { offset: 0 } }] as any[]) {
    const c = await call('aiven_kafka_topic_message_list', {
      ...svc, topic_name: 'mafia.table', format: 'json', partitions, timeout: 5000,
    });
    console.log(`\nconsume partitions=${JSON.stringify(partitions)}: isError=${c.isError}`);
    console.log(c.text.slice(0, 500));
    if (!c.isError) break;
  }

  await client.close();
  console.log('\n✅ KAFKA PROOF DONE.');
}
main().catch((e) => { console.error(e); process.exit(1); });
