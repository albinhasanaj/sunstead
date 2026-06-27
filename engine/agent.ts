import { generateText, stepCountIs, tool } from 'ai';
import type { AgentState, Emit, GameDefinition, GameState, ToolContext } from './types';
import { resolveModel } from './models';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';

// A single seat's LLM call is hard-capped so one slow/stalled model can never
// freeze the whole game. On timeout we abort and (below) retry on the fallback.
const TURN_TIMEOUT_MS = Number(process.env.MAFIA_TURN_TIMEOUT_MS ?? 30000);

// One agent's turn = exactly one AI SDK call.
// The agent is instructed to FIRST record private beliefs (drives the minds panel)
// and THEN take exactly one action. Both are genuine tool calls.
export async function takeTurn(
  def: GameDefinition,
  state: GameState,
  agent: AgentState,
  emit: Emit,
  // Optional external abort (e.g. a human barging into the discussion): when it
  // fires we drop this turn silently rather than retrying — see the catch below.
  opts?: { signal?: AbortSignal },
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
  const wrapTool = (t: (typeof legalTools)[number]) =>
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
    });
  // Split the turn into two FORCED steps: the private "prep" tools (e.g.
  // update_beliefs) first, then EXACTLY ONE turn-ending public action. Forcing the
  // action in its own step is what stops a turn ending silently on beliefs alone —
  // the old single 2-step call let a weak model spend BOTH steps on update_beliefs,
  // so it "deliberated" then said nothing.
  const prepTools = Object.fromEntries(legalTools.filter((t) => t.prep).map((t) => [t.name, wrapTool(t)]));
  const actionTools = Object.fromEntries(legalTools.filter((t) => !t.prep).map((t) => [t.name, wrapTool(t)]));

  const baseContext = (def.renderContext ?? defaultRenderContext)(state, agent);

  // Long-term memory: let the game pull similar prior statements (pgvector) and
  // inject a contradiction-spotting block before the agent reasons.
  // Memory must never break a turn, so any failure is swallowed.
  let prompt = baseContext;
  if (def.recallForTurn) {
    const t0 = Date.now();
    try {
      // Memory must never STALL a turn. recall() makes networked calls (embedding
      // + pgvector read); if that backend is slow or hangs, the whole game freezes
      // waiting on it. Time-box it so a sluggish memory backend just means this one
      // turn proceeds memory-less instead of locking up the game.
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
  // A seat may carry its own, tighter timeout: a model that reliably stalls (e.g.
  // DeepSeek on the free tier) is failed over to the fallback sooner instead of
  // burning the full budget every turn.
  const timeoutMs = Number(agent.private.timeoutMs) || TURN_TIMEOUT_MS;

  // One attempt on model `m` = two forced steps (prep, then exactly one public
  // action), sharing a single timeout budget so the whole turn is still hard-capped.
  const run = async (m: string) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    // Don't let a single slow/hung provider stall the table forever — and let a
    // human barge-in (opts.signal) cancel the in-flight line on top of that.
    const signal = opts?.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
    const base = {
      // featherless/* → Featherless (open weights); everything else → AI Gateway.
      model: resolveModel(m),
      system: def.systemPrompt(state, agent),
      // Prompt caching (AI Gateway v4): cache the stable system + transcript prefix
      // that every turn re-sends. 'auto' adds cache_control for providers that need
      // it (Anthropic) and is a no-op for those that cache implicitly.
      providerOptions: { gateway: { caching: 'auto' } },
      abortSignal: signal,
    };
    // Step 1 — private prep (beliefs). Skipped for games with no prep tool.
    if (Object.keys(prepTools).length > 0) {
      await generateText({ ...base, prompt, tools: prepTools, toolChoice: 'required', stopWhen: [stepCountIs(1)] });
    }
    // Step 2 — EXACTLY ONE turn-ending public action, so the seat always acts. Hand
    // the model its own just-recorded read for continuity between the two steps.
    const actionPrompt = agent.private.notes
      ? `${prompt}\n\nYour private read (just recorded): ${agent.private.notes}\nNow take exactly ONE public action.`
      : prompt;
    await generateText({
      ...base,
      prompt: actionPrompt,
      tools: Object.keys(actionTools).length > 0 ? actionTools : prepTools,
      toolChoice: 'required',
      stopWhen: [stepCountIs(1)],
    });
  };

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
      // Human barge-in: the floor was handed to a person mid-turn. Drop this
      // (now-stale, human-blind) line silently — retrying would talk over them.
      if (opts?.signal?.aborted) {
        console.log(`[turn]   ${agent.name} · interrupted by human — dropping turn`);
        return;
      }
      const timedOut = (err as Error)?.name === 'TimeoutError' || /abort|timeout/i.test((err as Error)?.message ?? '');
      const why = timedOut ? `timed out after ${Date.now() - llmStart}ms` : `failed: ${(err as Error).message}`;
      // A single provider hiccup (rate limit, gated model, hang) shouldn't stall the
      // table. Retry once on the fallback model so the seat still gets to act.
      if (def.fallbackModel && def.fallbackModel !== model) {
        try {
          console.error(`[turn]   ${agent.name} · ${model} ${why} → retrying on ${def.fallbackModel}`);
          const fbStart = Date.now();
          await run(def.fallbackModel);
          console.log(`[turn]   ${agent.name} · fallback LLM (${def.fallbackModel}) took ${Date.now() - fbStart}ms`);
          return;
        } catch (err2) {
          console.error(`[turn]   ${agent.name} · fallback also failed:`, (err2 as Error).message);
          return;
        }
      }
      console.error(`[turn]   ${agent.name} · ${model} ${why} (no fallback) — skipping turn`);
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
