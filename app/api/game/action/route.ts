import { sessions } from "@/lib/gameSessions";
import { PHASE } from "@/games/mafia/phases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human's move, sent back to the paused game loop. The SSE route parked a
// promise in session.pending when it asked for an action; we resolve it here.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { gameId, tool, args, skip, control, to } = body ?? {};
  const session = gameId ? sessions.get(gameId) : undefined;

  if (!session)
    return Response.json({ ok: false, error: "no such game" }, { status: 404 });

  // Control: "ready to vote" — flag the live state so the discussion loop can end
  // early IF a majority of the living table is ready. Allowed any time (not a turn).
  if (control === "skipDiscussion") {
    if (session.state)
      (session.state.meta as Record<string, unknown>).humanWantsSkip =
        body.value !== false;
    return Response.json({ ok: true });
  }

  // Dev/testing: force the discussion to end NOW and advance to the vote (bypasses the
  // consensus skip). Abort any in-flight AI line so the jump lands promptly.
  if (control === "forceVote") {
    if (session.state)
      (session.state.meta as Record<string, unknown>).forceSkip = true;
    session.turnAbort?.abort();
    session.wake?.();
    return Response.json({ ok: true });
  }

  // ── Real-time discussion controls (the human isn't a scheduled seat here) ──────
  // Interjection: a line the human said. It's QUEUED and the SSE loop drains it at the
  // next beat boundary so the AIs react to it — the human is always first priority.
  if (control === "say") {
    if (typeof tool === "string") {
      // `say` is only meaningful during DISCUSSION — the only phase the loop injects
      // human lines. Reject it in any other phase so a message typed during night/vote
      // can't sit queued and surface later out of context (Bug #6).
      if (session.state?.phase !== PHASE.DISCUSSION) {
        return Response.json(
          { ok: false, error: "you can only speak during discussion" },
          { status: 409 },
        );
      }
      (session.sayQueue ??= []).push({
        tool,
        args: args ?? {},
        to: typeof to === "string" ? to : null,
      });
      session.turnAbort?.abort(); // barge-in: drop any in-flight AI line so yours lands first
      session.wake?.(); // wake the pacing loop so it injects (and the AIs react) now
    }
    return Response.json({ ok: true });
  }
  // The human is mid-compose (holding the mic / typing): take the floor now — cancel
  // an AI line that's mid-generation, and hold the floor so none starts until they
  // send or stop.
  if (control === "composing") {
    session.composingUntil = Date.now() + 9000; // refreshed by client heartbeats
    session.turnAbort?.abort(); // barge-in the moment they start, not just on send
    session.wake?.();
    return Response.json({ ok: true });
  }
  // The client finished voicing the last line — the loop may advance to the next beat.
  if (control === "voiceDone") {
    session.voiceDoneSeq = (session.voiceDoneSeq ?? 0) + 1;
    session.wake?.();
    return Response.json({ ok: true });
  }

  // Feature #2: change your lynch vote until the phase closes. Your vote turn already
  // completed (its `vote` tool recorded meta.votes[you] and ended the turn); the tally
  // reads the FINAL meta.votes at resolution, so we just overwrite your recorded target.
  // Only valid during VOTE, for a living human, onto a living player that isn't you (and
  // — under a runoff — one of the eligible front-runners).
  if (control === "changeVote") {
    const s = session.state;
    if (!s || s.phase !== PHASE.VOTE)
      return Response.json(
        { ok: false, error: "not the voting phase" },
        { status: 409 },
      );
    const humanId = session.humanId;
    const targetId =
      typeof to === "string" ? to : (args?.target as string | undefined);
    const meta = s.meta as Record<string, unknown>;
    const you = s.players.find((p) => p.id === humanId);
    const tgt = s.players.find(
      (p) => p.id === targetId && p.alive && p.id !== humanId,
    );
    const revoteAmong = meta.revoteAmong as string[] | null | undefined;
    if (!you || !you.alive || !tgt)
      return Response.json(
        { ok: false, error: "invalid vote target" },
        { status: 400 },
      );
    if (revoteAmong && revoteAmong.length && !revoteAmong.includes(tgt.id))
      return Response.json(
        { ok: false, error: "not eligible in this runoff" },
        { status: 400 },
      );
    const votes = (meta.votes ?? (meta.votes = {})) as Record<string, string>;
    votes[humanId!] = tgt.id;
    return Response.json({ ok: true });
  }

  // Feature #6: the human died and chose to keep watching. Flip the session into
  // spectator mode so the wire-level play filter is lifted and they see the hidden
  // game (mafia chat, night actions, roles) for the rest of the match.
  if (control === "spectate") {
    session.spectator = true;
    return Response.json({ ok: true });
  }

  // Dev/testing: the human removes their own seat. Mark them dead in the live state
  // so the loop skips them from here on (and re-checks the win condition), then
  // resolve any turn they were parked on so the round continues without waiting.
  if (control === "suicide") {
    const human = session.humanId
      ? session.state?.players.find((p) => p.id === session.humanId)
      : null;
    if (human) human.alive = false;
    if (session.pending) {
      const pending = session.pending;
      session.pending = null;
      pending.resolve(null);
    }
    session.wake?.();
    return Response.json({ ok: true });
  }

  if (!session.pending)
    return Response.json(
      { ok: false, error: "not your turn" },
      { status: 409 },
    );

  // Skip / pass the current turn (resolve null — the engine treats it as no action).
  if (skip) {
    const pending = session.pending;
    session.pending = null;
    pending.resolve(null);
    return Response.json({ ok: true });
  }

  if (typeof tool !== "string")
    return Response.json({ ok: false, error: "missing tool" }, { status: 400 });

  const pending = session.pending;
  session.pending = null;
  pending.resolve({ tool, args: args ?? {} });
  return Response.json({ ok: true });
}
