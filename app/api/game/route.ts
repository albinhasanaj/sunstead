import { runGame } from '@/engine/orchestrator';
import { withHuman, type HumanController } from '@/engine/human';
import { mafiaGame } from '@/games/mafia';
import type { AgentState, GameEvent, GameState, GameTool } from '@/engine/types';
import { sessions, type GameSession } from '@/lib/gameSessions';

// The game is a long-running multi-agent sim; we run it inside a streaming
// response and push each typed GameEvent to the client as it happens (SSE).
// In "play" mode one seat is the human: the loop pauses on their turn and waits
// for an action POSTed to /api/game/action. Run locally so there's no timeout.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

const HUMAN_NAME = 'You';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: 'watch' | 'play' = body?.mode === 'play' ? 'play' : 'watch';
  const turnDelayMs = Number(process.env.MAFIA_TURN_DELAY_MS ?? body?.turnDelayMs ?? 0);

  // Roster. In play mode we seat the human alongside four AI players.
  let names: string[] = Array.isArray(body?.names) && body.names.length ? body.names : [];
  if (mode === 'play') {
    const ai = (names.length ? names : ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen']).filter((n) => n !== HUMAN_NAME);
    names = [...ai.slice(0, 5), HUMAN_NAME];
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
          if (e.type === 'action' && e.agent !== humanId) return;
          if (e.type === 'knowledge' && e.agent !== humanId) return;
        }
        send(e);
      };

      // The human controller: emit a request, park a promise, resume when the
      // action route resolves it.
      const controller_: HumanController = {
        decide(state, agent, tools) {
          return new Promise((resolve) => {
            session.pending = { agentId: agent.id, resolve };
            send(requestAction(state, agent, tools));
          });
        },
      };

      try {
        await runGame(
          mafiaGame,
          names,
          emit,
          (state: GameState) => {
            state.meta.gameId = gameId; // align long-term memory with this SSE session
            if (mode === 'play') {
              const h = state.players.find((p) => p.name === HUMAN_NAME);
              if (h) {
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
