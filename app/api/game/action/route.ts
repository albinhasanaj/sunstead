import { sessions } from '@/lib/gameSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The human's move, sent back to the paused game loop. The SSE route parked a
// promise in session.pending when it asked for an action; we resolve it here.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { gameId, tool, args } = body ?? {};
  const session = gameId ? sessions.get(gameId) : undefined;

  if (!session) return Response.json({ ok: false, error: 'no such game' }, { status: 404 });
  if (!session.pending) return Response.json({ ok: false, error: 'not your turn' }, { status: 409 });
  if (typeof tool !== 'string') return Response.json({ ok: false, error: 'missing tool' }, { status: 400 });

  const pending = session.pending;
  session.pending = null;
  pending.resolve({ tool, args: args ?? {} });
  return Response.json({ ok: true });
}
