-- Agent long-term memory: per-game statements with pgvector embeddings.
-- Mirrors ensureSchema() in lib/memory.ts (which also runs these idempotently at
-- runtime, so the app still works against a DB that was never migrated).

-- pgvector for similarity search over embeddings.
create extension if not exists vector;

-- One row per public statement an agent makes, scoped by game_id.
create table if not exists statements (
  id         bigserial primary key,
  game_id    text not null,
  round      int not null,
  phase      text not null,
  speaker    text not null,         -- display name of the player who spoke
  text       text not null,         -- exactly what was said aloud
  embedding  vector(1536) not null, -- openai/text-embedding-3-small via the AI Gateway
  created_at timestamptz not null default now()
);

-- recall() filters by game_id before the vector sort, so index it.
create index if not exists statements_game_idx on statements (game_id);
