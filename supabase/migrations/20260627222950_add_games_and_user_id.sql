-- Per-user / per-game separation.
--
-- `games`: one row per match, owned by a user (settings, status, winner, timing).
-- `statements.user_id`: makes a memory row attributable to a person, not just a game.
--
-- RLS is written in Supabase-native form (auth.uid()). Today the app connects as the
-- table owner over a direct pg pool, which BYPASSES RLS, and isolation is enforced in
-- query code (always filter by user_id). The policies below become the real boundary
-- the moment requests arrive with a Supabase Auth JWT (anon-key / PostgREST access) —
-- so wiring in real auth later needs no schema change.

-- ── games ────────────────────────────────────────────────────────────────────────
create table if not exists games (
  id         text primary key,                  -- gameId (crypto.randomUUID())
  user_id    uuid not null,                      -- owner; → auth.users(id) once auth lands
  mode       text not null default 'play',       -- 'play' | 'watch'
  status     text not null default 'running',    -- 'running' | 'finished' | 'aborted'
  winner     text,                               -- 'town' | 'mafia' | null
  settings   jsonb not null default '{}'::jsonb,  -- e.g. { "mafiaCount": 1 }
  created_at timestamptz not null default now(),
  ended_at   timestamptz
);
create index if not exists games_user_idx on games (user_id);
create index if not exists games_status_idx on games (status);

-- ── statements.user_id ─────────────────────────────────────────────────────────────
alter table statements add column if not exists user_id uuid;
create index if not exists statements_user_idx on statements (user_id);

-- ── Row-Level Security (forward-looking; see header) ───────────────────────────────
alter table games enable row level security;
alter table statements enable row level security;

-- Owner-only access. auth.uid() is null unless a request carries a Supabase Auth JWT,
-- so these don't affect the owner/service connection the app uses today.
drop policy if exists games_owner_rw on games;
create policy games_owner_rw on games
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists statements_owner_rw on statements;
create policy statements_owner_rw on statements
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
