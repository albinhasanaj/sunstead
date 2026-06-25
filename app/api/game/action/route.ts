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

  // ── Real-time discussion controls (the human isn't a scheduled seat here) ──────
  // Interjection: a line the human said. The SSE loop injects it at the next beat
  // boundary so the AIs react to it — the human is always first priority.
  if (control === 'say') {
    if (typeof tool === 'string') {
      session.pendingSay = { tool, args: args ?? {} };
      session.wake?.(); // wake the pacing loop so it injects (and the AIs react) now
    }
    return Response.json({ ok: true });
  }
  // The human is mid-compose (holding the mic / typing): hold the floor for them.
  if (control === 'composing') {
    session.composingUntil = Date.now() + 9000; // refreshed by client heartbeats
    session.wake?.();
    return Response.json({ ok: true });
  }
  // The client finished voicing the last line — the loop may advance to the next beat.
  if (control === 'voiceDone') {
    session.voiceDoneSeq = (session.voiceDoneSeq ?? 0) + 1;
    session.wake?.();
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
