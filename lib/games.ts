/**
 * Game ownership / lifecycle rows. One `games` row per match, tying a game (and,
 * through statements.user_id, its memory) to the user who started it. Best-effort:
 * a DB hiccup here must never break the game loop, so nothing throws into it.
 */
import { dbEnabled, ensureSchema, query } from './db';

export interface StartGameInput {
  id: string; // gameId (same id used for statements.game_id and the SSE session)
  userId: string; // owner
  mode: 'play' | 'watch';
  settings?: Record<string, unknown>; // e.g. { mafiaCount: 1 }
}

// Insert the game row at kickoff. Idempotent on id so a retry can't duplicate it.
export async function startGame(g: StartGameInput): Promise<void> {
  if (!dbEnabled() || !g.id || !g.userId) return;
  try {
    await ensureSchema();
    await query(
      `insert into games (id, user_id, mode, settings)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do nothing`,
      [g.id, g.userId, g.mode, JSON.stringify(g.settings ?? {})],
    );
  } catch (err) {
    console.error('[games.startGame] failed:', (err as Error).message);
  }
}

// Close the game row out. A winner marks it finished; a null winner (error /
// disconnect before a result) marks it aborted.
export async function finishGame(id: string, winner: string | null): Promise<void> {
  if (!dbEnabled() || !id) return;
  try {
    await query(
      `update games set status = $2, winner = $3, ended_at = now() where id = $1`,
      [id, winner ? 'finished' : 'aborted', winner],
    );
  } catch (err) {
    console.error('[games.finishGame] failed:', (err as Error).message);
  }
}
