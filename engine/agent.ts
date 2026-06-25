import { generateText, stepCountIs, tool } from 'ai';
import type { AgentState, Emit, GameDefinition, GameState, ToolContext } from './types';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';

// One agent's turn = exactly one AI SDK call.
// The agent is instructed to FIRST record private beliefs (drives the minds panel)
// and THEN take exactly one action. Both are genuine tool calls.
export async function takeTurn(
  def: GameDefinition,
  state: GameState,
  agent: AgentState,
  emit: Emit,
): Promise<void> {
  const ctx: ToolContext = { state, agent, emit };
  const legalTools = def.toolsFor(state, agent).filter((t) => t.legalIn(state, agent));
  if (legalTools.length === 0) {
    console.log(`[turn] ${agent.name} (${state.phase}) — no legal tools, skipping`);
    return;
  }
  const turnStart = Date.now();
  console.log(`[turn] ▶ ${agent.name} (${state.phase} r${state.round}) — tools: ${legalTools.map((t) => t.name).join(', ')}`);

  // Wrap each GameTool as an AI SDK tool. The execute mutates state + emits events.
  const tools = Object.fromEntries(
    legalTools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (args: any) => {
          // Defend the game rules even if the model calls something out of phase.
          if (!t.legalIn(state, agent)) {
            return `Illegal move: ${t.name} is not allowed for you right now.`;
          }
          return t.execute(args, ctx);
        },
      }),
    ]),
  );

  const baseContext = (def.renderContext ?? defaultRenderContext)(state, agent);

  // Long-term memory: let the game pull similar prior statements (pgvector via the
  // Aiven MCP) and inject a contradiction-spotting block before the agent reasons.
  // Memory must never break a turn, so any failure is swallowed.
  let prompt = baseContext;
  if (def.recallForTurn) {
    const t0 = Date.now();
    try {
      // Memory must never STALL a turn. recall() makes networked calls (embedding
      // + Aiven MCP pgvector read); if that backend is slow or hangs, the whole
      // game freezes waiting on it. Time-box it so a sluggish memory backend just
      // means this one turn proceeds memory-less instead of locking up the game.
      const recallTimeoutMs = Number(process.env.MAFIA_RECALL_TIMEOUT_MS ?? 8000);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const mem = await Promise.race([
        def.recallForTurn(state, agent),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), recallTimeoutMs);
        }),
      ]);
      clearTimeout(timer);
      if (mem) prompt = `${baseContext}\n\n${mem}`;
      console.log(`[turn]   ${agent.name} · memory recall took ${Date.now() - t0}ms${mem ? '' : ' (no hits/timeout)'}`);
    } catch (err) {
      console.error(`[turn]   ${agent.name} · recall FAILED after ${Date.now() - t0}ms:`, (err as Error).message);
    }
  }

  // Each seat can run on its own model (any AI Gateway string); fall back to the
  // game-wide model, then the engine default.
  const model = (agent.private.model as string) ?? def.model ?? DEFAULT_MODEL;

  const run = (m: string) =>
    generateText({
      model: m, // routed via AI Gateway (AI_GATEWAY_API_KEY)
      system: def.systemPrompt(state, agent),
      prompt,
      tools,
      // 'required' forces genuine tool use; with stepCountIs(2) the agent makes
      // exactly two calls per turn: update_beliefs, then one game action.
      toolChoice: 'required',
      stopWhen: [stepCountIs(2)],
    });

  // Light up "thinking" for this seat while its single LLM turn runs. A parallel
  // scheduler can have several of these lit at once — the UI/terminal use it to
  // show (and let us verify) concurrent deliberation.
  emit({ type: 'thinking', agent: agent.id, on: true });
  const llmStart = Date.now();
  try {
    try {
      await run(model);
      console.log(`[turn]   ${agent.name} · LLM (${model}) took ${Date.now() - llmStart}ms`);
    } catch (err) {
      // A single provider hiccup (rate limit, gated model) shouldn't stall the table.
      // Retry once on the fallback model so the seat still gets to act this turn.
      if (def.fallbackModel && def.fallbackModel !== model) {
        try {
          console.error(`[agent ${agent.name}] ${model} failed → retrying on ${def.fallbackModel}`);
          await run(def.fallbackModel);
          return;
        } catch (err2) {
          console.error(`[agent ${agent.name}] fallback also failed:`, (err2 as Error).message);
          return;
        }
      }
      console.error(`[agent ${agent.name}] turn failed:`, (err as Error).message);
    }
  } finally {
    emit({ type: 'thinking', agent: agent.id, on: false });
    console.log(`[turn] ◀ ${agent.name} done in ${Date.now() - turnStart}ms`);
  }
}

// Generic per-turn view. A GameDefinition can override this for game-specific
// framing (e.g. Mafia's private night channel), but this keeps the engine usable
// for any game out of the box.
function defaultRenderContext(state: GameState, agent: AgentState): string {
  const alive = state.players.filter((p) => p.alive).map((p) => p.name);
  const log = state.publicLog
    .map((l) => `${nameOf(state, l.speaker)}: ${l.text}`)
    .join('\n');
  const notes = agent.private.notes ? `\nYour private notes: ${agent.private.notes}` : '';
  return [
    `Phase: ${state.phase} (round ${state.round}).`,
    `Players still alive: ${alive.join(', ')}.`,
    notes,
    '',
    'Conversation so far:',
    log || '(nothing said yet)',
    '',
    'Take your turn now.',
  ].join('\n');
}

function nameOf(state: GameState, id: string): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}
