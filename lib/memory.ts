/**
 * Agent long-term memory, backed by Postgres + pgvector over a direct, pooled
 * connection (see lib/db.ts). No MCP, no broker: every read/write is a single
 * parameterized SQL query over a reused TLS connection.
 *
 *   provision() — ensure the schema exists (idempotent; mirrors the migrations)
 *   embed()     — 1536-dim vector via the AI Gateway (openai/text-embedding-3-small)
 *   remember()  — embed a statement + INSERT it (stamped with game_id + user_id)
 *   recall()    — embed a query + pgvector `<=>` similarity search, scoped by game_id
 *
 * Memory is optional: with no DATABASE_URL the game still runs, just memory-less.
 */
import { embed as aiEmbed } from "ai";
import { dbEnabled, ensureSchema, query } from "./db";

const EMBED_MODEL = "openai/text-embedding-3-small";

// No external call may freeze a turn (Bug #3). Both remember() and recall() go through
// embed() (a network request) and then a DB write/read — either can hang. We hard cap
// the whole memory op; on timeout the turn just proceeds memory-less. Configurable so a
// slow-but-alive backend can be given more room without a code change.
const MEMORY_TIMEOUT_MS = Number(process.env.MAFIA_MEMORY_TIMEOUT_MS ?? 8000);

// Race a promise against a timeout, clearing the timer either way so we don't leak it.
// Rejects with a labelled error on timeout; the caller's try/catch swallows it (memory
// is best-effort). Note: the underlying work may keep running in the background — for
// the embedding network call we also pass a real AbortSignal (see embed) so it's
// actually cancelled, not just abandoned.
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// Memory is optional: with no connection URL the game still runs, just memory-less.
export function memoryEnabled(): boolean {
  return dbEnabled();
}

// ── embeddings (AI Gateway, 1536-dim) ─────────────────────────────────────────
export async function embed(text: string): Promise<number[]> {
  // Real cancellation: hand aiEmbed an AbortSignal so a slow/hung request is actually
  // torn down at the deadline, not left dangling on the connection.
  const { embedding } = await aiEmbed({
    model: EMBED_MODEL,
    value: text,
    abortSignal: AbortSignal.timeout(MEMORY_TIMEOUT_MS),
  });
  return embedding;
}

// pgvector text literal for a vector param: "[0.1,0.2,…]". 6 decimals keeps the
// payload small; we pass it as a bound parameter and cast it to ::vector in SQL.
const vecLit = (e: number[]) => `[${e.map((x) => x.toFixed(6)).join(",")}]`;

// Public: ensure the schema exists (idempotent). Exposed so a deploy / bootstrap
// step (scripts/provision.ts) can run it ahead of the first game.
export async function provision(): Promise<void> {
  if (!memoryEnabled())
    throw new Error("DATABASE_URL not set — cannot provision schema");
  await ensureSchema();
}

// ── public API ────────────────────────────────────────────────────────────────
export interface RememberInput {
  gameId: string;
  round: number;
  phase: string;
  speaker: string; // display name of the player who spoke
  text: string; // exactly what was said aloud
  userId?: string; // owner of the game (null for memory-only scripts/tests)
}

// Embed a statement and write it to long-term memory. Awaited (not fire-and-forget)
// so a later turn's recall is guaranteed to see it. Never throws — a memory hiccup
// must not break the game loop.
export async function remember(s: RememberInput): Promise<void> {
  if (!memoryEnabled() || !s.gameId || !s.text?.trim()) return;
  try {
    // Hard time-box the whole write (embed + INSERT). embed() self-aborts its network
    // call at the deadline; this guard also covers a hung ensureSchema()/INSERT so a
    // stalled DB can never freeze the turn that awaits this.
    await withTimeout(
      (async () => {
        await ensureSchema();
        const e = await embed(s.text);
        await query(
          `insert into statements (game_id, round, phase, speaker, text, embedding, user_id)
           values ($1, $2, $3, $4, $5, $6::vector, $7)`,
          [
            s.gameId,
            Number(s.round) | 0,
            s.phase,
            s.speaker,
            s.text,
            vecLit(e),
            s.userId ?? null,
          ],
        );
      })(),
      MEMORY_TIMEOUT_MS,
      "memory.remember",
    );
  } catch (err) {
    console.error("[memory.remember] failed:", (err as Error).message);
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
// similar. Scoped by gameId (globally unique per game, so this already isolates one
// game — and therefore one user — from another). Returns [] on any error.
export async function recall(opts: {
  gameId: string;
  queryText: string;
  k?: number;
  excludeSpeaker?: string;
  excludeTexts?: string[]; // statements already visible in-prompt → don't recall them
}): Promise<Recalled[]> {
  if (!memoryEnabled() || !opts.gameId || !opts.queryText?.trim()) return [];
  const k = Math.max(1, Math.min(opts.k ?? 5, 10)); // small k → lean latency
  try {
    await ensureSchema();
    const e = await embed(opts.queryText);

    // Build a parameterized WHERE; P(v) binds v and returns its $N placeholder.
    const params: unknown[] = [];
    const P = (v: unknown) => `$${params.push(v)}`;
    const where = [`game_id = ${P(opts.gameId)}`];
    if (opts.excludeSpeaker) where.push(`speaker <> ${P(opts.excludeSpeaker)}`);
    // Skip anything the agent can already see this turn, so recall surfaces
    // genuinely OUT-OF-VIEW history (the point of long-term memory) instead of
    // echoing the current window back into the prompt.
    const excl = (opts.excludeTexts ?? []).filter((t) => t?.trim());
    if (excl.length) where.push(`text <> ALL(${P(excl)}::text[])`);
    const vecP = P(vecLit(e));

    const { rows } = await query(
      `select speaker, round, phase, text, (embedding <=> ${vecP}::vector) as dist
       from statements
       where ${where.join(" and ")}
       order by dist
       limit ${k}`,
      params,
    );
    return rows.map((r: Record<string, unknown>) => ({
      speaker: String(r.speaker),
      round: Number(r.round),
      phase: String(r.phase),
      text: String(r.text),
      dist: Number(r.dist),
    }));
  } catch (err) {
    console.error("[memory.recall] failed:", (err as Error).message);
    return [];
  }
}
