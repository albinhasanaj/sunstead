import { runGame, type TurnFn } from '@/engine/orchestrator';
import { humanTurn, type HumanController } from '@/engine/human';
import { takeTurn } from '@/engine/agent';
import { mafiaGame } from '@/games/mafia';
import type { AgentState, GameEvent, GameState, GameTool } from '@/engine/types';
import { sessions, type GameSession, type HumanChoice } from '@/lib/gameSessions';

// Discussion paces to the client's voice: after each AI beat the loop waits (up to
// this long) for the client to finish voicing it before the next beat, so AI talk
// never races ahead of the audio. The wait ends early on a human interjection.
const PACE_MAX_MS = Number(process.env.MAFIA_PACE_MAX_MS ?? 14000);

// The game is a long-running multi-agent sim; we run it inside a streaming
// response and push each typed GameEvent to the client as it happens (SSE).
// In "play" mode one seat is the human: the loop pauses on their turn and waits
// for an action POSTed to /api/game/action. Run locally so there's no timeout.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

const DEFAULT_HUMAN_NAME = 'You';

// The human's seat name comes from the signup profile, so the AI players address
// them naturally ("Albin is bluffing") instead of the awkward literal "You".
// Sanitize it: this string lands in the prompt transcript, so strip control chars,
// collapse whitespace, cap the length, and fall back to "You" if it's empty.
function cleanHumanName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_HUMAN_NAME;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return cleaned || DEFAULT_HUMAN_NAME;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: 'watch' | 'play' = body?.mode === 'play' ? 'play' : 'watch';
  const turnDelayMs = Number(process.env.MAFIA_TURN_DELAY_MS ?? body?.turnDelayMs ?? 0);

  // In play mode the human takes a real name from their profile; watch mode has no
  // human seat so the name is irrelevant.
  const humanName = mode === 'play' ? cleanHumanName(body?.playerName) : DEFAULT_HUMAN_NAME;

  // Dev-only: let the local tester force the human's role for testing. Ignored in
  // production and for non-roles. Applied at setup by swapping seats so the role
  // distribution (and win-condition balance) stays intact.
  const DEV_ROLES = ['mafia', 'detective', 'doctor', 'villager'];
  const devRole =
    process.env.NODE_ENV !== 'production' && mode === 'play' && typeof body?.devRole === 'string' && DEV_ROLES.includes(body.devRole)
      ? (body.devRole as string)
      : null;

  // Roster. In play mode we seat the human alongside four AI players. Drop any AI
  // whose name collides with the human's so the seat name stays unique.
  let names: string[] = Array.isArray(body?.names) && body.names.length ? body.names : [];
  if (mode === 'play') {
    const ai = (names.length ? names : ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen']).filter((n) => n !== humanName);
    names = [...ai.slice(0, 5), humanName];
  }

  const gameId = crypto.randomUUID();
  const session: GameSession = { id: gameId, humanId: null, pending: null, closed: false };
  sessions.set(gameId, session);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client gone */
        }
      };

      let humanId: string | null = null;
      let humanIsMafia = false;

      // In play mode, hide what a fair player shouldn't see: AI private reasoning,
      // other roles, the Mafia channel (unless the human is Mafia), other players'
      // night actions, and other players' private findings (e.g. an AI Detective's).
      const emit = (e: GameEvent) => {
        if (mode === 'play') {
          if (e.type === 'beliefs') return;
          if (e.type === 'whisper' && !humanIsMafia) return;
          // Hide other players' night actions — except a human Mafia may see their
          // teammates' kill proposals (propose_kill is a Mafia-only action).
          if (e.type === 'action' && e.agent !== humanId && !(humanIsMafia && e.kind === 'propose_kill')) return;
          if (e.type === 'knowledge' && e.agent !== humanId) return;
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
            send(requestAction(state, agent, tools));
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
        const tool = mafiaGame.toolsFor(state, human).find((t) => t.name === say.tool && t.legalIn(state, human));
        if (!tool) return;
        try {
          await tool.execute(say.args ?? {}, { state, agent: human, emit });
          const disc = state.meta.disc as { last?: string } | undefined;
          if (disc) disc.last = human.id;
        } catch (err) {
          console.error('[say] human interjection failed:', (err as Error).message);
        }
      }

      // After every AI discussion beat: pace to the client's voice (so talk doesn't
      // race ahead of the audio) and fold in the human's real-time interjection. The
      // wait ends early when the human cuts in, and holds open while they're composing
      // so no AI talks over them.
      async function beatHook(state: GameState): Promise<void> {
        if (state.phase !== 'DISCUSSION') return;
        await injectPendingSay(state);
        const startSeq = session.voiceDoneSeq ?? 0;
        const deadline = Date.now() + PACE_MAX_MS;
        for (;;) {
          if (session.closed || session.pendingSay) break; // human cut in → react now
          const composing = (session.composingUntil ?? 0) > Date.now();
          const voiced = (session.voiceDoneSeq ?? 0) > startSeq;
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
        if (agent.private.human) return humanTurn(def, state, agent, emit, controller_);
        if (state.phase !== 'DISCUSSION') return takeTurn(def, state, agent, emit);
        const ac = new AbortController();
        session.turnAbort = ac;
        return takeTurn(def, state, agent, emit, { signal: ac.signal }).finally(() => {
          if (session.turnAbort === ac) session.turnAbort = null;
        });
      };

      try {
        await runGame(
          mafiaGame,
          names,
          emit,
          (state: GameState) => {
            state.meta.gameId = gameId; // align long-term memory with this SSE session
            session.state = state; // let the action route flip control flags (e.g. skip-to-vote)
            if (mode === 'play') {
              const h = state.players.find((p) => p.name === humanName);
              if (h) {
                // Dev override: force the human's role by swapping with a player who
                // already holds it (keeps the exact role counts); if none has it,
                // force it directly.
                if (devRole && h.role !== devRole) {
                  const other = state.players.find((p) => p.id !== h.id && p.role === devRole);
                  if (other) other.role = h.role;
                  h.role = devRole;
                }
                h.private.human = true;
                humanId = h.id;
                humanIsMafia = h.role === 'mafia';
                session.humanId = h.id;
              }
            }
            send({ type: 'game', gameId, mode, humanId });
            send({
              type: 'setup',
              phase: state.phase,
              round: state.round,
              players: state.players.map((p) => ({
                id: p.id,
                name: p.name,
                // Reveal only the human's own role up front; others stay hidden
                // until a death/reveal exposes them.
                role: mode === 'watch' || p.id === humanId ? p.role : 'unknown',
                model: p.private.human ? null : p.private.model,
                human: !!p.private.human,
              })),
            });
          },
          turnFn,
          turnDelayMs,
          beatHook,
        );
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      } finally {
        session.closed = true;
        session.pending?.resolve(null);
        sessions.delete(gameId);
        send({ type: 'done' });
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — unblock any pending human turn and drop the session.
      session.closed = true;
      session.pending?.resolve(null);
      sessions.delete(gameId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Describe the human's legal options this turn so the client can render inputs.
function requestAction(state: GameState, agent: AgentState, tools: GameTool[]) {
  const names = (ps: AgentState[]) => ps.map((p) => ({ id: p.id, name: p.name }));
  const alive = state.players.filter((p) => p.alive);
  const aliveOthers = alive.filter((p) => p.id !== agent.id);
  return {
    type: 'request_action',
    agent: agent.id,
    phase: state.phase,
    round: state.round,
    legal: tools.map((t) => t.name),
    alive: names(aliveOthers),
    killTargets: names(aliveOthers.filter((p) => p.role !== 'mafia')),
    investigateTargets: names(aliveOthers), // Detective: anyone but yourself
    protectTargets: names(alive), // Doctor: anyone alive, including yourself
    teammates: agent.role === 'mafia' ? names(state.players.filter((p) => p.alive && p.role === 'mafia' && p.id !== agent.id)) : [],
  };
}
