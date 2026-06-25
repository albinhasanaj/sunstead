/**
 * Agent long-term memory, backed by Aiven PostgreSQL + pgvector — reached ONLY
 * through genuine Aiven MCP tool calls (aiven_service_create / aiven_service_get /
 * aiven_pg_read / aiven_pg_write). No direct pg client: every provision, read, and
 * write is an MCP tool invocation, which is the thing the hackathon scores.
 *
 *   provision() — stand up our OWN Postgres service via aiven_service_create, then
 *                 wait for RUNNING (idempotent: a no-op when the service exists)
 *   embed()     — 1536-dim vector via the AI Gateway (openai/text-embedding-3-small)
 *   remember()  — embed a statement + INSERT it (aiven_pg_write)
 *   recall()    — embed a query + pgvector `<=>` similarity search (aiven_pg_read)
 *
 * The bootstrap chain is provision → enable pgvector → create table/index, all via
 * MCP, so the agent stands up the entire database itself with no console clicks.
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
    // Used only when the service doesn't exist yet and we provision it via MCP.
    // Defaults are Aiven's free PostgreSQL tier; override for a bigger plan/region.
    plan: process.env.AIVEN_PG_PLAN || 'free-1-1gb',
    cloud: process.env.AIVEN_CLOUD || 'do-blr',
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

// Generic MCP call returning the unwrapped, parsed JSON payload. Service ops return
// a service object (not {rows}), so they need their own parse path. Throws on a
// tool-level error (e.g. a 404 when the service doesn't exist yet).
async function callJson(name: string, args: Record<string, any>): Promise<any> {
  const client = await getClient();
  const res: any = await client.callTool({ name, arguments: args });
  if (res?.isError) throw new Error(`${name}: ${rawText(res).slice(0, 300)}`);
  try {
    return JSON.parse(unwrap(rawText(res)));
  } catch {
    return {};
  }
}

// ── service provisioning (the agent stands up its OWN Postgres via MCP) ─────────
// Live state of our pg service via aiven_service_get; null if it doesn't exist yet
// (a 404 throws inside callJson → caught here → treated as "needs provisioning").
async function serviceState(): Promise<string | null> {
  const { project, service } = cfg();
  try {
    const data = await callJson('aiven_service_get', { project, service_name: service });
    const st = data?.service?.state ?? data?.state;
    return st ? String(st).toUpperCase() : null;
  } catch {
    return null;
  }
}

// Poll aiven_service_get until the service reports RUNNING — a freshly created pg
// takes a few minutes to build, and DDL fails until it's up.
async function waitForRunning(timeoutMs = 10 * 60_000): Promise<void> {
  const { service } = cfg();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await serviceState();
    if (st === 'RUNNING') return;
    if (Date.now() >= deadline) {
      throw new Error(`service ${service} not RUNNING within ${Math.round(timeoutMs / 60_000)}m (last=${st ?? 'missing'})`);
    }
    await new Promise((r) => setTimeout(r, 12_000));
  }
}

// Idempotent: provision our Postgres service through the Aiven MCP if it isn't
// already there, then block until it's RUNNING. Safe to call every game — when the
// service exists this is a single aiven_service_get and returns immediately. This
// is the autonomy claim made literal: the agent creates its own database, no console.
let servicePromise: Promise<void> | null = null;
function ensureService(): Promise<void> {
  if (!servicePromise) {
    servicePromise = (async () => {
      const { project, service, plan, cloud } = cfg();
      const existing = await serviceState();
      if (existing) {
        if (existing !== 'RUNNING') await waitForRunning();
        return;
      }
      // Brand-new project: create the pg service via MCP, then wait for it to build.
      await callJson('aiven_service_create', {
        project,
        service_name: service,
        service_type: 'pg',
        plan,
        cloud,
      });
      console.error(`[memory] provisioned pg service "${service}" via Aiven MCP (aiven_service_create, plan=${plan}, cloud=${cloud}); waiting for RUNNING…`);
      await waitForRunning();
    })().catch((e) => {
      servicePromise = null; // a failed provision shouldn't poison later retries
      throw e;
    });
  }
  return servicePromise;
}

// Public: stand up the Postgres service via MCP (idempotent). Exposed so a deploy /
// bootstrap step (scripts/provision.ts) can provision ahead of the first game.
export async function provision(): Promise<void> {
  if (!memoryEnabled()) throw new Error('AIVEN_TOKEN not set — cannot provision via MCP');
  await ensureService();
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
      await ensureService(); // stand up our own Postgres via MCP before any DDL
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
