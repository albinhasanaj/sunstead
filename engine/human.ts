import { takeTurn } from './agent';
import type { AgentState, Emit, GameDefinition, GameState, GameTool, ToolContext } from './types';
import type { TurnFn } from './orchestrator';

// A human seat doesn't call the LLM — it asks a controller for a decision and
// then runs the chosen tool, exactly like an AI turn. This keeps the orchestrator
// fully generic: it just calls a TurnFn; whether that's an LLM or a person is
// invisible to it.
export interface HumanController {
  // Resolve when the person has chosen an action. Resolve null to pass/skip.
  decide(
    state: GameState,
    agent: AgentState,
    tools: GameTool[],
  ): Promise<{ tool: string; args: any } | null>;
}

export async function humanTurn(
  def: GameDefinition,
  state: GameState,
  agent: AgentState,
  emit: Emit,
  controller: HumanController,
): Promise<void> {
  // Humans skip update_beliefs (that's the AI's private-reasoning tool) and just
  // take one game action.
  const tools = def
    .toolsFor(state, agent)
    .filter((t) => t.legalIn(state, agent) && t.name !== 'update_beliefs');
  if (tools.length === 0) return;

  const choice = await controller.decide(state, agent, tools);
  if (!choice) return;
  const tool = tools.find((t) => t.name === choice.tool);
  if (!tool) return;

  const ctx: ToolContext = { state, agent, emit };
  await tool.execute(choice.args ?? {}, ctx);
}

// Build a TurnFn that routes human seats to the controller and everyone else to
// the normal AI turn.
export function withHuman(controller: HumanController): TurnFn {
  return (def, state, agent, emit) =>
    agent.private.human
      ? humanTurn(def, state, agent, emit, controller)
      : takeTurn(def, state, agent, emit);
}
