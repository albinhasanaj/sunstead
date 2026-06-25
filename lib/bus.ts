/**
 * Kafka comms bus for the agent table — reached ONLY through Aiven MCP tool calls
 * (aiven_kafka_topic_message_produce / _list). This is the agents' communication +
 * state channel: public statements/accusations/votes are PRODUCED to Kafka, and the
 * vote tally CONSUMES the stream back — matching Aiven's pattern of "agents pass
 * tasks via Kafka, store history in Postgres, all via MCP."
 *
 * Topics:
 *   mafia.table — every public event (speak/accuse/defend/claim/death/reveal)
 *   mafia.votes — one record per vote; consumed to tally
 *
 * Like memory, this is best-effort: it never throws into the game loop, and the
 * engine keeps an in-memory fallback so a flaky MCP call can't break a match.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const TOPIC_TABLE = 'mafia.table';
export const TOPIC_VOTES = 'mafia.votes';

// Read config at CALL time (scripts load .env.local after their imports).
function cfg() {
  return {
    url: process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp',
    project: process.env.AIVEN_PROJECT || 'albinhasanaj06-1f56',
    service: process.env.AIVEN_KAFKA_SERVICE || 'kafka-17cdf2b1',
    token: process.env.AIVEN_TOKEN,
  };
}

export function busEnabled(): boolean {
  return !!process.env.AIVEN_TOKEN && process.env.MAFIA_KAFKA !== '0';
}

// ── MCP client (own connection; mirrors lib/memory.ts) ────────────────────────
let clientPromise: Promise<Client> | null = null;
function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { url, token } = cfg();
      const client = new Client({ name: 'mafia-bus', version: '0.1.0' }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      await client.connect(transport);
      return client;
    })().catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

function rawText(res: any): string {
  return (res?.content ?? []).map((c: any) => c.text ?? '').join('');
}
function unwrap(text: string): string {
  const m = text.match(/<untrusted-[^>]*>([\s\S]*?)<\/untrusted-[^>]*>/);
  return (m ? m[1] : text).trim();
}
async function call(name: string, args: Record<string, any>): Promise<{ isError: boolean; data: any; text: string }> {
  const client = await getClient();
  const res: any = await client.callTool({ name, arguments: args });
  const text = rawText(res);
  let data: any;
  try { data = JSON.parse(unwrap(text)); } catch { data = unwrap(text); }
  return { isError: !!res?.isError, data, text };
}

export interface BusMessage {
  kind: string; // speak | accuse | defend | claim | death | reveal | vote
  gameId?: string;
  round?: number;
  phase?: string;
  speaker?: string;
  text?: string;
  target?: string;
  [k: string]: any;
}

// Produce one JSON record to a topic. Never throws (best-effort comms).
export async function publish(topic: string, value: BusMessage, key?: string): Promise<void> {
  if (!busEnabled()) return;
  try {
    const { project, service } = cfg();
    const record: any = { value };
    if (key) record.key = { id: key };
    await call('aiven_kafka_topic_message_produce', {
      project, service_name: service, topic_name: topic, format: 'json', records: [record],
    });
  } catch (err) {
    console.error(`[bus.publish ${topic}] failed:`, (err as Error).message);
  }
}

// Pull the JSON payloads from a Kafka REST consume response, tolerating a few
// shapes (array of records, {messages:[…]}, {rows:[…]}, or any first array prop).
// Each record's payload is under `.value` for the json format.
function extractValues(data: any): any[] {
  let arr: any[] = [];
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    arr = data.messages ?? data.records ?? data.rows ?? [];
    if (!Array.isArray(arr) || !arr.length) {
      const firstArr = Object.values(data).find((v) => Array.isArray(v));
      if (Array.isArray(firstArr)) arr = firstArr;
    }
  }
  return arr
    .map((m: any) => (m && typeof m === 'object' && 'value' in m ? m.value : m))
    .filter((v: any) => v != null);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Consume the records currently in a single-partition topic; [] on any error.
// The Aiven Kafka REST proxy needs an explicit offset and may briefly answer
// "Messages are temporarily unavailable" right after produce — so we retry.
export async function drain(topic: string): Promise<BusMessage[]> {
  if (!busEnabled()) return [];
  const { project, service } = cfg();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await call('aiven_kafka_topic_message_list', {
        project, service_name: service, topic_name: topic, format: 'json',
        partitions: { '0': { offset: 0 } }, timeout: 5000,
      });
      if (!res.isError) return extractValues(res.data) as BusMessage[];
      if (/temporarily unavailable/i.test(res.text)) { await sleep(1500); continue; }
      return [];
    } catch (err) {
      console.error(`[bus.drain ${topic}] failed:`, (err as Error).message);
      return [];
    }
  }
  return [];
}
