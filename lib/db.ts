/**
 * Shared Postgres connection (node-postgres) for the memory + games data model.
 * One pooled, reused TLS connection. Point DATABASE_URL at your Supabase database
 * (Project → Settings → Database) — prefer the pooled connection string for
 * serverless, the direct host for the long-lived `pnpm play` process.
 *
 * ensureSchema() mirrors supabase/migrations so the app self-heals against a DB
 * that was never migrated; the migrations remain the source of truth (and add RLS).
 */
import { readFileSync } from 'node:fs';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const DIM = 1536; // embedding dimensions (openai/text-embedding-3-small)

// Read config at CALL time (not import time): scripts load .env.local AFTER their
// imports run, so capturing process.env at module init would miss the connection URL.
function cfg() {
  return {
    url: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL,
    caPath: process.env.PGSSLROOTCERT || process.env.SUPABASE_CA_PATH,
  };
}

// The data layer is optional: with no connection URL the game still runs, just
// memory-less and without persisted game rows.
export function dbEnabled(): boolean {
  return !!cfg().url;
}

// Local Postgres needs no TLS; managed hosts (Supabase) require it. A CA path turns
// on verify-full; otherwise we use TLS without CA verification (PGSSL=disable opts out).
function sslFor(url: string, caPath?: string): false | { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
  if (process.env.PGSSL === 'disable' || /@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false;
  if (caPath) {
    try {
      return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
    } catch {
      /* unreadable CA → fall back to unverified TLS rather than failing the connection */
    }
  }
  return { rejectUnauthorized: false };
}

// ── pooled connection (one pool, reused across calls) ──────────────────────────
let pool: Pool | null = null;
export function getPool(): Pool {
  if (!pool) {
    const { url, caPath } = cfg();
    if (!url) throw new Error('DATABASE_URL not set — the data layer is disabled');
    pool = new Pool({
      connectionString: url,
      ssl: sslFor(url, caPath),
      max: Number(process.env.PGPOOL_MAX ?? 5),
    });
    // An idle client erroring out (e.g. the server dropping the connection) must
    // never crash the process — log it and let the pool reconnect on next use.
    pool.on('error', (err) => console.error('[db.pool] idle client error:', err.message));
  }
  return pool;
}

// Thin parameterized-query helper. Values are bound ($1, $2, …), never concatenated.
export function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

// ── one-time schema bootstrap (idempotent; mirrors supabase/migrations) ─────────
let schemaPromise: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query('create extension if not exists vector');
        await client.query(
          `create table if not exists statements (
             id         bigserial primary key,
             game_id    text not null,
             round      int not null,
             phase      text not null,
             speaker    text not null,
             text       text not null,
             embedding  vector(${DIM}) not null,
             user_id    uuid,
             created_at timestamptz not null default now()
           )`,
        );
        // Self-heal an older statements table that predates user_id.
        await client.query('alter table statements add column if not exists user_id uuid');
        await client.query('create index if not exists statements_game_idx on statements (game_id)');
        await client.query('create index if not exists statements_user_idx on statements (user_id)');

        await client.query(
          `create table if not exists games (
             id         text primary key,
             user_id    uuid not null,
             mode       text not null default 'play',
             status     text not null default 'running',
             winner     text,
             settings   jsonb not null default '{}'::jsonb,
             created_at timestamptz not null default now(),
             ended_at   timestamptz
           )`,
        );
        await client.query('create index if not exists games_user_idx on games (user_id)');
        await client.query('create index if not exists games_status_idx on games (status)');
      } finally {
        client.release();
      }
    })().catch((e) => {
      schemaPromise = null; // a failed bootstrap shouldn't poison later retries
      throw e;
    });
  }
  return schemaPromise;
}
