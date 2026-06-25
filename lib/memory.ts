/**
 * Agent long-term memory, backed by Aiven PostgreSQL + pgvector — reached ONLY
 * through genuine Aiven MCP tool calls (aiven_pg_read / aiven_pg_write). No direct
 * pg client: every read and write is an MCP tool invocation, which is the thing
 * the hackathon scores.
 *
 *   embed()    — 1536-dim vector via the AI Gateway (openai/text-embedding-3-small)
 *   remember() — embed a statement + INSERT it (aiven_pg_write)
 *   recall()   — embed a query + pgvector `<=>` similarity search (aiven_pg_read)
 *
 * Retrieved rows are DATA, never instructions: the MCP wraps results in an
 * <untrusted-…> boundary; we unwrap and parse, and the prompt block that surfaces
 * them is explicitly labelled as untrusted data.
 */
import { embed as aiEmbed } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const EMBED_MODEL = 'openai/text-embedding-3-small';
const DIM = 1536;

// Read config at CALL time (not import time): scripts load .env.local AFTER their
// imports run, so capturing process.env at module init would miss the Aiven token.
function cfg() {
  return {
    url: process.env.AIVEN_MCP_URL || 'https://mcp.aiven.live/mcp',
    project: process.env.AIVEN_PROJECT || 'albinhasanaj06-1f56',
    service: process.env.AIVEN_SERVICE || 'mafia-memory',
    token: process.env.AIVEN_TOKEN,
  };
}

// Memory is optional: with no Aiven token the game still runs, just memory-less.
export function memoryEnabled(): boolean {
  return !!process.env.AIVEN_TOKEN;
}

// ── MCP client (one persistent connection, reused across calls) ────────────────
let clientPromise: Promise<Client> | null = null;
function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { url, token } = cfg();
      const client = new Client({ name: 'mafia-memory', version: '0.1.0' }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      await client.connect(transport);
      return client;
    })().catch((e) => {
      clientPromise = null; // let the next call retry a fresh connection
      throw e;
    });
  }
  return clientPromise;
}

// ── untrusted-data envelope handling ──────────────────────────────────────────
function rawText(res: any): string {
  return (res?.content ?? []).map((c: any) => c.text ?? '').join('');
}
// "…<untrusted-aiven-response-UUID>\n{json}\n</untrusted-…>" → the inner JSON text.
function unwrap(text: string): string {
  const m = text.match(/<untrusted-[^>]*>([\s\S]*?)<\/untrusted-[^>]*>/);
  return (m ? m[1] : text).trim();
}

// ── MCP tool wrappers ─────────────────────────────────────────────────────────
async function pgRead(query: string, reasoning: string): Promise<any[]> {
  const client = await getClient();
  const { project, service } = cfg();
  const res: any = await client.callTool({
    name: 'aiven_pg_read',
    arguments: { project, service_name: service, query, reasoning },
  });
  if (res?.isError) throw new Error(`aiven_pg_read: ${rawText(res).slice(0, 300)}`);
  try {
    return JSON.parse(unwrap(rawText(res)))?.rows ?? [];
  } catch {
    return [];
  }
}

async function pgWrite(query: string, reasoning: string): Promise<void> {
  const client = await getClient();
  const { project, service } = cfg();
  const res: any = await client.callTool({
    name: 'aiven_pg_write',
    arguments: { project, service_name: service, query, reasoning },
  });
  if (res?.isError) throw new Error(`aiven_pg_write: ${rawText(res).slice(0, 300)}`);
}

// ── SQL literal helpers (MCP takes raw SQL strings — no bind params, so escape) ─
const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`; // standard PG string escape
// 6 decimals keeps the vector literal small (do-blr latency) and avoids exponent notation.
const vec = (e: number[]) => `'[${e.map((x) => x.toFixed(6)).join(',')}]'`;

// ── embeddings (AI Gateway, 1536-dim) ─────────────────────────────────────────
export async function embed(text: string): Promise<number[]> {
  const { embedding } = await aiEmbed({ model: EMBED_MODEL, value: text });
  return embedding;
}

// ── one-time schema bootstrap ─────────────────────────────────────────────────
let schemaPromise: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pgWrite('CREATE EXTENSION IF NOT EXISTS vector', 'bootstrap: ensure pgvector');
      await pgWrite(
        `CREATE TABLE IF NOT EXISTS statements (
           id BIGSERIAL PRIMARY KEY,
           game_id TEXT NOT NULL,
           round INT NOT NULL,
           phase TEXT NOT NULL,
           speaker TEXT NOT NULL,
           text TEXT NOT NULL,
           embedding vector(${DIM}) NOT NULL,
           created_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
        'bootstrap: ensure statements table',
      );
      await pgWrite(
        'CREATE INDEX IF NOT EXISTS statements_game_idx ON statements (game_id)',
        'bootstrap: ensure game_id index',
      );
    })().catch((e) => {
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

// ── public API ────────────────────────────────────────────────────────────────
export interface RememberInput {
  gameId: string;
  round: number;
  phase: string;
  speaker: string; // display name of the player who spoke
  text: string; // exactly what was said aloud
}

// Embed a statement and write it to long-term memory via the Aiven MCP. Awaited
// (not fire-and-forget) so a later turn's recall is guaranteed to see it. Never
// throws — a memory hiccup must not break the game loop.
export async function remember(s: RememberInput): Promise<void> {
  if (!memoryEnabled() || !s.gameId || !s.text?.trim()) return;
  try {
    await ensureSchema();
    const e = await embed(s.text);
    await pgWrite(
      `INSERT INTO statements (game_id, round, phase, speaker, text, embedding)
       VALUES (${q(s.gameId)}, ${Number(s.round) | 0}, ${q(s.phase)}, ${q(s.speaker)}, ${q(s.text)}, ${vec(e)}::vector)`,
      `remember: statement by ${s.speaker} (round ${s.round}, ${s.phase})`,
    );
  } catch (err) {
    console.error('[memory.remember] failed:', (err as Error).message);
  }
}

export interface Recalled {
  speaker: string;
  round: number;
  phase: string;
  text: string;
  dist: number; // cosine distance (0 = identical … 2 = opposite)
}

// Embed the query and pgvector-search this game's prior statements for the k most
// similar. Scoped by gameId so games never bleed into each other. Returns [] on
// any error so callers can proceed without memory.
export async function recall(opts: {
  gameId: string;
  queryText: string;
  k?: number;
  excludeSpeaker?: string;
}): Promise<Recalled[]> {
  if (!memoryEnabled() || !opts.gameId || !opts.queryText?.trim()) return [];
  const k = Math.max(1, Math.min(opts.k ?? 5, 10)); // small k → lean latency
  try {
    await ensureSchema();
    const e = await embed(opts.queryText);
    const where = [`game_id = ${q(opts.gameId)}`];
    if (opts.excludeSpeaker) where.push(`speaker <> ${q(opts.excludeSpeaker)}`);
    const rows = await pgRead(
      `SELECT speaker, round, phase, text, (embedding <=> ${vec(e)}::vector) AS dist
       FROM statements
       WHERE ${where.join(' AND ')}
       ORDER BY dist
       LIMIT ${k}`,
      'recall: pgvector similarity search for prior statements',
    );
    return rows.map((r: any) => ({
      speaker: String(r.speaker),
      round: Number(r.round),
      phase: String(r.phase),
      text: String(r.text),
      dist: Number(r.dist),
    }));
  } catch (err) {
    console.error('[memory.recall] failed:', (err as Error).message);
    return [];
  }
}
