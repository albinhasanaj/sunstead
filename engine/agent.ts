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
  if (legalTools.length === 0) return;

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

  const context = (def.renderContext ?? defaultRenderContext)(state, agent);

  // Each seat can run on its own model (any AI Gateway string); fall back to the
  // game-wide model, then the engine default.
  const model = (agent.private.model as string) ?? def.model ?? DEFAULT_MODEL;

  const run = (m: string) =>
    generateText({
      model: m, // routed via AI Gateway (AI_GATEWAY_API_KEY)
      system: def.systemPrompt(state, agent),
      prompt: context,
      tools,
      // 'required' forces genuine tool use; with stepCountIs(2) the agent makes
      // exactly two calls per turn: update_beliefs, then one game action.
      toolChoice: 'required',
      stopWhen: [stepCountIs(2)],
    });

  try {
    await run(model);
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
