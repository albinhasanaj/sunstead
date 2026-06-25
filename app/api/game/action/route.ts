import { sessions } from '@/lib/gameSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The human's move, sent back to the paused game loop. The SSE route parked a
// promise in session.pending when it asked for an action; we resolve it here.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { gameId, tool, args, skip, control } = body ?? {};
  const session = gameId ? sessions.get(gameId) : undefined;

  if (!session) return Response.json({ ok: false, error: 'no such game' }, { status: 404 });

  // Control: "ready to vote" — flag the live state so the discussion loop can end
  // early IF a majority of the living table is ready. Allowed any time (not a turn).
  if (control === 'skipDiscussion') {
    if (session.state) (session.state.meta as Record<string, unknown>).humanWantsSkip = body.value !== false;
    return Response.json({ ok: true });
  }

  if (!session.pending) return Response.json({ ok: false, error: 'not your turn' }, { status: 409 });

  // Skip / pass the current turn (resolve null — the engine treats it as no action).
  if (skip) {
    const pending = session.pending;
    session.pending = null;
    pending.resolve(null);
    return Response.json({ ok: true });
  }

  if (typeof tool !== 'string') return Response.json({ ok: false, error: 'missing tool' }, { status: 400 });

  const pending = session.pending;
  session.pending = null;
  pending.resolve({ tool, args: args ?? {} });
  return Response.json({ ok: true });
}
