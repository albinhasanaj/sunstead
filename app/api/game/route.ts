import { runGame } from '@/engine/orchestrator';
import { withHuman, type HumanController } from '@/engine/human';
import { takeTurn } from '@/engine/agent';
import { mafiaGame } from '@/games/mafia';
import { mostEagerSpeaker } from '@/games/mafia/phases';
import type { AgentState, GameEvent, GameState, GameTool } from '@/engine/types';
import { sessions, type GameSession, type HumanChoice } from '@/lib/gameSessions';

// Idle "speaking pressure". While the human holds the DISCUSSION floor but stays
// silent, the most eager AI jumps in every IDLE_MS so the table never goes dead.
// After IDLE_MAX fill-ins with no input we pass the turn so the discussion keeps
// moving — the human can still speak at any moment until then. Night/Vote are
// silent target-picks, so they're never filled. Both knobs are env-tunable.
const IDLE_MS = Number(process.env.MAFIA_IDLE_MS ?? 18000);
const IDLE_MAX = Number(process.env.MAFIA_IDLE_MAX ?? 3);

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

      // The human controller: emit a request, park a promise, resume when the
      // action route resolves it. During DISCUSSION we also let eager AIs fill any
      // silence so the table never freezes while the human is thinking.
      const controller_: HumanController = {
        decide(state, agent, tools) {
          const humanChoice = new Promise<HumanChoice>((resolve) => {
            session.pending = { agentId: agent.id, resolve };
            send(requestAction(state, agent, tools));
          });
          // Only the open DISCUSSION floor gets filled — the night and the vote are
          // silent target-picks, so a quiet human there is expected, not dead air.
          return state.phase === 'DISCUSSION' ? fillSilenceWhileIdle(state, agent, humanChoice) : humanChoice;
        },
      };

      // While the human holds the discussion floor, let the most eager AI speak into
      // any silence so the table never goes dead (the human can still jump in at any
      // moment). After IDLE_MAX fill-ins with no input, pass the turn so discussion
      // keeps moving and tell the client its turn is over.
      async function fillSilenceWhileIdle(
        state: GameState,
        human: AgentState,
        humanChoice: Promise<HumanChoice>,
      ): Promise<HumanChoice> {
        const IDLE = Symbol('idle');
        for (let fills = 0; fills < IDLE_MAX; fills++) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const idle = new Promise<typeof IDLE>((r) => {
            timer = setTimeout(() => r(IDLE), IDLE_MS);
          });
          const winner = await Promise.race([humanChoice, idle]);
          clearTimeout(timer);
          if (winner !== IDLE) return humanChoice; // the human acted (or the game ended)
          if (session.closed || !session.pending) return humanChoice;

          const speakerId = await mostEagerSpeaker(state, [human.id]);
          const speaker = speakerId ? state.players.find((p) => p.id === speakerId) : undefined;
          if (!speaker || !speaker.alive) break; // no AI free to step in
          console.log(`[idle] ${human.name} quiet ${IDLE_MS}ms — ${speaker.name} fills the silence (${fills + 1}/${IDLE_MAX})`);
          await takeTurn(mafiaGame, state, speaker, emit);
        }
        // Still silent after every fill-in → pass the human's turn so the discussion
        // advances. They'll be offered the floor again on a later beat.
        if (session.pending && session.pending.agentId === human.id) {
          const pending = session.pending;
          session.pending = null;
          send({ type: 'turn_over', agent: human.id });
          pending.resolve(null);
        }
        return humanChoice;
      }

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
          withHuman(controller_),
          turnDelayMs,
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
