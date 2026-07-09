import { runGame, type TurnFn } from "@/engine/orchestrator";
import { humanTurn, type HumanController } from "@/engine/human";
import { takeTurn } from "@/engine/agent";
import { mafiaGame } from "@/games/mafia";
import { PERSONALITIES } from "@/games/mafia/roles";
import type {
  AgentState,
  GameEvent,
  GameState,
  GameTool,
} from "@/engine/types";
import {
  sessions,
  type GameSession,
  type HumanChoice,
} from "@/lib/gameSessions";
import { startGame, finishGame } from "@/lib/games";
import {
  resolveConfig,
  type ConfigSelection,
  type MafiaConfig,
} from "@/games/mafia/config";
import { rngFloat } from "@/games/mafia/rng";

// The game is a long-running multi-agent sim; we run it inside a streaming
// response and push each typed GameEvent to the client as it happens (SSE).
// In "play" mode one seat is the human: the loop pauses on their turn and waits
// for an action POSTed to /api/game/action. Run locally so there's no timeout.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

const DEFAULT_HUMAN_NAME = "You";

// Resolve the owning user for this game. Today the client sends a stable per-browser
// UUID (fake auth); we accept it if well-formed, else mint an anonymous one. This is
// the ONE swap-point for real auth: replace the body read with verifying a Supabase
// Auth JWT (supabase.auth.getUser(token)) and returning the authenticated user id.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveUserId(raw: unknown): string {
  return typeof raw === "string" && UUID_RE.test(raw)
    ? raw.toLowerCase()
    : crypto.randomUUID();
}

// The human's seat name comes from the signup profile, so the AI players address
// them naturally ("Albin is bluffing") instead of the awkward literal "You".
// Sanitize it: this string lands in the prompt transcript, so strip control chars,
// collapse whitespace, cap the length, and fall back to "You" if it's empty.
function cleanHumanName(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_HUMAN_NAME;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return cleaned || DEFAULT_HUMAN_NAME;
}

// How long a game keeps running with NO client attached before we abort it. Short in
// dev so a "close the tab" test aborts quickly and is easy to observe in the terminal;
// longer in prod so a flaky network / quick refresh can re-attach without losing the game.
const RESUME_GRACE_MS = process.env.NODE_ENV === "production" ? 60_000 : 10_000;

// The SSE response shell (shared by a fresh game and a reconnect).
function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// The client detached (refresh / tab close / network drop). We do NOT kill the game
// immediately — a quick reconnect should re-attach to the SAME running loop (resume).
// Instead we arm a grace timer; if nobody returns before it fires, we abort the loop
// for real so it stops burning tokens with an empty room (Bug #2).
function armGrace(session: GameSession): void {
  if (session.closed) return;
  session.attached = false;
  session.send = null;
  session.closeSink = null;
  if (session.graceTimer) clearTimeout(session.graceTimer);
  session.graceTimer = setTimeout(() => {
    session.graceTimer = null;
    if (session.attached || session.closed) return; // someone reconnected in time
    console.log(
      `[session] ${session.id} — no client after grace window, aborting game loop`,
    );
    session.pending?.resolve(null); // unblock any parked human turn so the loop can exit
    session.pending = null;
    session.abort?.abort();
    session.wake?.(); // wake any pacing wait so the loop sees the abort promptly
  }, RESUME_GRACE_MS);
}

// Re-attach a (re)connecting client to an already-running game: swap the live sink to
// this new stream and replay every event so far so the UI rebuilds. It NEVER starts a
// second loop — that's the whole point (Bug #1 / Feature #1). The replay is bracketed
// by resume/resumed markers so the client rebuilds state without re-running cutscenes.
function attachStream(session: GameSession): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      if (session.graceTimer) {
        clearTimeout(session.graceTimer);
        session.graceTimer = null;
      }
      session.attached = true;
      const deliver = (e: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      session.send = deliver;
      session.closeSink = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      deliver({ type: "resume" });
      for (const e of session.log ?? []) deliver(e);
      deliver({ type: "resumed" });
      // If there's still a human turn parked server-side, re-offer it live (its history
      // copy is ignored during replay) so a resumed player can act on it immediately.
      if (session.pending && session.pendingActionEvent)
        deliver(session.pendingActionEvent);
      // Game already ended during the gap → finish the catch-up and close.
      if (session.closed) {
        deliver({ type: "done" });
        session.closeSink?.();
      }
    },
    cancel() {
      armGrace(session);
    },
  });
  return sseResponse(stream);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: "watch" | "play" = body?.mode === "play" ? "play" : "watch";

  // ── Resolve the ONE game config (spec §2) ─────────────────────────────────────
  // The lobby sends a tiered SELECTION (preset + difficulty + gameSpeed + the sparse
  // userOverrides the host explicitly changed); we re-run the SAME resolveConfig the
  // UI previews with, never trusting a client-sent resolved config (§2.5). Legacy
  // clients that send a flat body.config (and/or top-level mafiaCount) still work —
  // we fold those into userOverrides. resolveConfig defaults, clamps, and validates
  // everything (§2.4); it runs ONCE and setup() stamps it onto state.meta.config.
  const legacyMafia =
    body?.mafiaCount != null ? { mafiaCount: Number(body.mafiaCount) } : {};
  const sel =
    body?.selection && typeof body.selection === "object"
      ? (body.selection as Partial<ConfigSelection>)
      : null;
  const selection: Partial<ConfigSelection> = sel
    ? {
        ...sel,
        userOverrides: { ...(sel.userOverrides ?? {}), ...legacyMafia },
      }
    : {
        userOverrides: {
          ...(body?.config && typeof body.config === "object"
            ? body.config
            : {}),
          ...legacyMafia,
        },
      };
  const config: MafiaConfig = resolveConfig(selection);
  const turnDelayMs = config.turnDelayMs;

  // In play mode the human takes a real name from their profile; watch mode has no
  // human seat so the name is irrelevant.
  const humanName =
    mode === "play" ? cleanHumanName(body?.playerName) : DEFAULT_HUMAN_NAME;

  // Dev-only: let the local tester force the human's role for testing. Ignored in
  // production and for non-roles. Applied at setup by swapping seats so the role
  // distribution (and win-condition balance) stays intact.
  const DEV_ROLES = ["mafia", "detective", "doctor", "villager"];
  const devRole =
    process.env.NODE_ENV !== "production" &&
    mode === "play" &&
    typeof body?.devRole === "string" &&
    DEV_ROLES.includes(body.devRole)
      ? (body.devRole as string)
      : null;

  // Personal "pity" odds (%) that the human draws Mafia this game, sent by the
  // client (which climbs them each non-Mafia game and resets after a Mafia one). We
  // bias the human's seat toward/away from Mafia by this chance while keeping the
  // overall role counts intact. A dev role override takes precedence over this.
  const mafiaChance =
    mode === "play" && Number.isFinite(Number(body?.mafiaChance))
      ? Math.min(100, Math.max(0, Number(body.mafiaChance)))
      : null;

  // Roster sized to config.tableSize (the human seat is counted, spec §2.4.4).
  // PERSONALITIES holds enough named seats for the largest table; in play mode we
  // seat the human alongside them, dropping any AI whose name collides with theirs.
  const totalSeats = config.tableSize;
  const AI_POOL = PERSONALITIES.map((p) => p.name);
  let names: string[] =
    Array.isArray(body?.names) && body.names.length ? body.names : [];
  if (mode === "play") {
    const ai = (names.length ? names : AI_POOL).filter((n) => n !== humanName);
    names = [...ai.slice(0, totalSeats - 1), humanName];
  } else {
    names = (names.length ? names : AI_POOL).slice(0, totalSeats);
  }

  // The game (session) id. The client mints it up front so the game is addressable
  // in the URL (?id=…) before the stream opens; we honor a well-formed one and mint
  // our own otherwise. It keys the DB row, long-term memory, and the SSE rendezvous.
  const gameId =
    typeof body?.id === "string" && UUID_RE.test(body.id)
      ? body.id.toLowerCase()
      : crypto.randomUUID();
  const userId = resolveUserId(body?.userId);

  // ── Reconnect / duplicate-guard (Sweep 1) ─────────────────────────────────────
  // If a loop already owns this id, NEVER spawn a second one (Bug #1). Re-attach this
  // connection to the running game and replay what's happened so far (Feature #1: a
  // refresh rejoins the SAME match). A client that explicitly asks to resume but finds
  // no live game is told so, so it shows the menu instead of silently starting a new
  // game under the old id.
  const existing = sessions.get(gameId);
  if (existing && !existing.closed) return attachStream(existing);
  if (body?.resume === true)
    return Response.json({ ok: false, error: "no live game" }, { status: 404 });

  const session: GameSession = {
    id: gameId,
    humanId: null,
    pending: null,
    closed: false,
    abort: new AbortController(),
    send: null,
    closeSink: null,
    log: [],
    graceTimer: null,
    attached: false,
  };
  sessions.set(gameId, session);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Register THIS connection as the live sink. Every emitted event ALSO accrues in
      // session.log so a later reconnect can be caught up; delivery goes through
      // session.send (swapped on reconnect), decoupling the loop from any one stream.
      session.attached = true;
      session.send = (e: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client gone — grace/reconnect handles it */
        }
      };
      session.closeSink = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (e: unknown) => {
        session.log!.push(e);
        session.send?.(e);
      };

      let humanId: string | null = null;
      let humanIsMafia = false;
      let humanRole = "";

      // In play mode, hide what a fair player shouldn't see: AI private reasoning,
      // other roles, the Mafia channel (unless the human is Mafia), other players'
      // night actions, and other players' private findings (e.g. an AI Detective's).
      // The filter is the WIRE-level guard (spec §9): hidden facts must not reach the
      // client at all, not merely go unrendered.
      const emit = (e: GameEvent) => {
        if (mode === "play") {
          if (e.type === "beliefs") return;
          if (e.type === "whisper" && !humanIsMafia) return;
          // Other players' actions: a vote COMMITMENT is public (who voted, never their
          // target) → strip the target and let it through so the UI can check them off.
          // A human Mafia may see teammates' kill proposals; all else stays hidden.
          if (e.type === "action" && e.agent !== humanId) {
            if (e.kind === "vote") {
              send({ ...e, target: undefined });
              return;
            }
            if (!(humanIsMafia && e.kind === "propose_kill")) return;
          }
          if (e.type === "knowledge" && e.agent !== humanId) return;
          // Wake narration leaks role composition over rounds (which specials are still
          // alive). Let the atmospheric 'mafia' wake through, and the human's OWN role,
          // but suppress detective/doctor wakes for everyone else (§9 [FIX]).
          if (e.type === "wake" && e.role !== "mafia" && e.role !== humanRole)
            return;
          // Hidden-role game: strip the dead player's true role from the wire unless
          // config.revealRoleOnDeath, or it's the human's own death (they know it).
          if (
            (e.type === "death" || e.type === "reveal") &&
            !config.revealRoleOnDeath &&
            e.target !== humanId
          ) {
            send({ ...e, role: undefined });
            return;
          }
        }
        send(e);
      };

      // The human controller parks on NIGHT/VOTE turns (silent target-picks) and waits
      // for the action route to resolve. DISCUSSION no longer parks here at all — the
      // human isn't a scheduled seat there; they interject in real time (see beatHook).
      const controller_: HumanController = {
        decide(state, agent, tools) {
          return new Promise<HumanChoice>((resolve) => {
            session.pending = { agentId: agent.id, resolve };
            const evt = requestAction(state, agent, tools);
            session.pendingActionEvent = evt; // kept so a reconnect can re-offer this turn
            send(evt);
          });
        },
      };

      // Run a human's interjected line as their own seat's tool, so it lands in the
      // transcript + long-term memory like any spoken line, and mark them as the last
      // speaker so the next AI reacts to them and no one repeats.
      async function injectPendingSay(state: GameState): Promise<void> {
        const say = session.pendingSay;
        if (!say) return;
        session.pendingSay = null;
        const human = state.players.find((p) => p.private.human && p.alive);
        if (!human) return;
        const tool = mafiaGame
          .toolsFor(state, human)
          .find((t) => t.name === say.tool && t.legalIn(state, human));
        if (!tool) return;
        try {
          await tool.execute(say.args ?? {}, { state, agent: human, emit });
          const disc = state.meta.disc as
            | { last?: string; directTo?: string | null }
            | undefined;
          if (disc) {
            disc.last = human.id;
            // If the line was directed at a specific living AI, hand them the floor
            // for the next beat so a direct question gets a direct answer.
            const target = say.to
              ? state.players.find(
                  (p) => p.id === say.to && p.alive && !p.private.human,
                )
              : null;
            disc.directTo = target ? target.id : null;
          }
        } catch (err) {
          console.error(
            "[say] human interjection failed:",
            (err as Error).message,
          );
        }
      }

      // After every AI discussion beat: pace to the client's voice (so talk doesn't
      // race ahead of the audio) and fold in the human's real-time interjection. The
      // wait ends early when the human cuts in, and holds open while they're composing
      // so no AI talks over them.
      async function beatHook(state: GameState): Promise<void> {
        if (state.phase !== "DISCUSSION") return;
        await injectPendingSay(state);
        const startSeq = session.voiceDoneSeq ?? 0;
        const deadline = Date.now() + config.paceMaxMs;
        for (;;) {
          if (
            session.closed ||
            session.pendingSay ||
            session.abort?.signal.aborted
          )
            break; // human cut in / game aborted → stop pacing
          const composing = (session.composingUntil ?? 0) > Date.now();
          const voiced = (session.voiceDoneSeq ?? 0) > startSeq;
          if (!config.voiceEnabled) break; // voice off → don't pace to audio
          if (!composing && (voiced || Date.now() > deadline)) break;
          await new Promise<void>((resolve) => {
            session.wake = resolve; // woken instantly by a say/composing/voiceDone POST
            setTimeout(resolve, 250); // …and tick, so composing-expiry / deadline are seen
          });
          session.wake = null;
        }
        await injectPendingSay(state);
      }

      // How each seat takes its turn. Human → controller. AI in DISCUSSION → an
      // interruptible LLM turn: we hand the loop an AbortController so a human taking
      // the floor (composing/say, via the action route) cancels the in-flight line
      // rather than letting a pre-formed, human-blind thought land first. AI outside
      // discussion (silent night/vote picks) runs plain — nothing to barge into.
      const turnFn: TurnFn = (def, state, agent, emit) => {
        if (agent.private.human)
          return humanTurn(def, state, agent, emit, controller_);
        if (state.phase !== "DISCUSSION")
          return takeTurn(def, state, agent, emit);
        const ac = new AbortController();
        session.turnAbort = ac;
        return takeTurn(def, state, agent, emit, { signal: ac.signal }).finally(
          () => {
            if (session.turnAbort === ac) session.turnAbort = null;
          },
        );
      };

      let winner: string | null = null;
      try {
        winner = await runGame(
          mafiaGame,
          names,
          emit,
          (state: GameState) => {
            state.meta.gameId = gameId; // align long-term memory with this SSE session
            state.meta.userId = userId; // stamp every memory row with the owning user
            session.state = state; // let the action route flip control flags (e.g. skip-to-vote)
            // Record the game row with the FULL resolved config + seed (spec §2.4.5),
            // so a game is auditable and reproducible. Best-effort, never blocks the loop.
            void startGame({ id: gameId, userId, mode, settings: config });
            if (mode === "play") {
              const h = state.players.find((p) => p.name === humanName);
              if (h) {
                // Dev override: force the human's role by swapping with a player who
                // already holds it (keeps the exact role counts); if none has it,
                // force it directly.
                if (devRole && h.role !== devRole) {
                  const other = state.players.find(
                    (p) => p.id !== h.id && p.role === devRole,
                  );
                  if (other) other.role = h.role;
                  h.role = devRole;
                } else if (!devRole && mafiaChance != null) {
                  // Pity roll: swap the human into / out of a Mafia seat to match the
                  // requested odds, trading roles with another player so counts hold.
                  // Drawn from the game's seeded stream so it's part of replay (§10).
                  const wantMafia = rngFloat(state) * 100 < mafiaChance;
                  if (wantMafia && h.role !== "mafia") {
                    const other = state.players.find(
                      (p) => p.id !== h.id && p.role === "mafia",
                    );
                    if (other) {
                      other.role = h.role;
                      h.role = "mafia";
                    }
                  } else if (!wantMafia && h.role === "mafia") {
                    const other = state.players.find(
                      (p) => p.id !== h.id && p.role !== "mafia",
                    );
                    if (other) {
                      h.role = other.role;
                      other.role = "mafia";
                    }
                  }
                }
                h.private.human = true;
                humanId = h.id;
                humanIsMafia = h.role === "mafia";
                humanRole = h.role;
                session.humanId = h.id;
              }
            }
            // Echo the resolved config so the client reflects server-clamped settings
            // (e.g. voiceEnabled default, revealRoleOnDeath) rather than only its local copy.
            send({ type: "game", gameId, mode, humanId, config });
            send({
              type: "setup",
              phase: state.phase,
              round: state.round,
              players: state.players.map((p) => ({
                id: p.id,
                name: p.name,
                // Reveal only the human's own role up front; others stay hidden
                // until a death/reveal exposes them.
                role: mode === "watch" || p.id === humanId ? p.role : "unknown",
                model: p.private.human ? null : p.private.model,
                human: !!p.private.human,
              })),
            });
          },
          turnFn,
          turnDelayMs,
          beatHook,
          { config },
          session.abort!.signal,
        );
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        // Close the game row: a real winner → finished; 'aborted'/null → aborted.
        const finalWinner = winner && winner !== "aborted" ? winner : null;
        void finishGame(gameId, finalWinner);
        session.closed = true;
        if (session.graceTimer) {
          clearTimeout(session.graceTimer);
          session.graceTimer = null;
        }
        session.pending?.resolve(null);
        session.pending = null;
        send({ type: "done" }); // through the current sink (+ log)
        session.closeSink?.(); // close whichever stream is attached now
        sessions.delete(gameId);
      }
    },
    cancel() {
      // Client detached (refresh / tab close / network drop). Don't kill the game — arm
      // a grace timer so a quick reconnect can re-attach to the SAME loop (Feature #1).
      // If nobody returns before it fires, the loop is aborted for real (Bug #2).
      armGrace(session);
    },
  });

  return sseResponse(stream);
}

// Describe the human's legal options this turn so the client can render inputs.
function requestAction(state: GameState, agent: AgentState, tools: GameTool[]) {
  const names = (ps: AgentState[]) =>
    ps.map((p) => ({ id: p.id, name: p.name }));
  const alive = state.players.filter((p) => p.alive);
  const aliveOthers = alive.filter((p) => p.id !== agent.id);
  // During a runoff (dayVoteTie:'revote') only the tied seats are eligible to vote for.
  const revoteAmong = state.meta.revoteAmong as string[] | null | undefined;
  const voteEligible = revoteAmong?.length
    ? aliveOthers.filter((p) => revoteAmong.includes(p.id))
    : aliveOthers;
  // Only send a target list when its tool is actually LEGAL for this seat this turn.
  // This is a §9 wire guard, not just tidiness: killTargets excludes the Mafia, so
  // sending it to a non-Mafia human leaks the entire Mafia by set-difference against
  // `alive`. Gating on legality keeps killTargets off the wire unless the human really
  // is the Mafia taking their night kill (where they already know their teammates).
  // The client only ever reads each list when its tool is in `legal`, so this changes
  // no UI behaviour — it just stops hidden roles from reaching the client at all.
  const legal = tools.map((t) => t.name);
  const can = (name: string) => legal.includes(name);
  return {
    type: "request_action",
    agent: agent.id,
    phase: state.phase,
    round: state.round,
    legal,
    alive: names(aliveOthers),
    voteTargets: can("vote") ? names(voteEligible) : [], // restricted to the runoff slate when revoting
    killTargets: can("mafia_propose_kill")
      ? names(aliveOthers.filter((p) => p.role !== "mafia"))
      : [],
    investigateTargets: can("investigate") ? names(aliveOthers) : [], // Detective: anyone but yourself
    // Doctor: anyone alive (including yourself) EXCEPT whoever you shielded last
    // night — you can't protect the same player two nights in a row.
    protectTargets: can("protect")
      ? names(alive.filter((p) => p.id !== state.meta.lastProtect))
      : [],
    teammates:
      agent.role === "mafia"
        ? names(
            state.players.filter(
              (p) => p.alive && p.role === "mafia" && p.id !== agent.id,
            ),
          )
        : [],
  };
}
