import { generateText } from 'ai';
import type { AgentState, GameState, PlayerId } from '../../engine/types';
import { resolveModel } from '../../engine/models';

// Paid-tier "hand-raise" (gated behind MAFIA_LIVE_URGE=1). Instead of PREDICTING a
// seat's urge from its last on-deck bid, each silent seat rates — on ITS OWN model —
// how badly it wants to respond to the live table RIGHT NOW: a single digit 0-9.
// Cheap because the output is one token and the shared transcript prefix is cached
// (providerOptions caching:'auto'). The digit is written to agent.private.liveUrge;
// the scheduler's urge() reads it in place of the predicted pressure. Never throws —
// a failed/slow hand-raise just leaves that seat on its predicted urge.
//
// This adds one request PER SILENT SEAT PER BEAT, so it is OFF by default: it only
// makes sense on a paid tier with high rate limits. The free-tier auction needs none
// of this.

const FALLBACK_MODEL = 'google/gemini-2.5-flash';
const POLL_TIMEOUT_MS = Number(process.env.MAFIA_LIVE_URGE_TIMEOUT_MS ?? 6000);
const TRANSCRIPT_TAIL = 12; // how many recent lines the raters see

export async function pollLiveUrge(state: GameState, candidates: AgentState[]): Promise<void> {
  if (!candidates.length) return;
  const transcript = state.publicLog
    .filter((l) => l.speaker !== 'system')
    .slice(-TRANSCRIPT_TAIL)
    .map((l) => `${nameOf(state, l.speaker)}: ${l.text}`)
    .join('\n');
  await Promise.all(candidates.map((p) => rate(state, p, transcript)));
}

async function rate(state: GameState, p: AgentState, transcript: string): Promise<void> {
  const model = (p.private.model as string) ?? FALLBACK_MODEL;
  try {
    const r = await generateText({
      model: resolveModel(model),
      system:
        `You are ${p.name}, a player in a game of Mafia. Read the latest table talk and decide how badly you ` +
        `want to speak RIGHT NOW. Reply with ONE digit 0-9 only — 9 = you must jump in, 0 = you have nothing to add.`,
      prompt: `${transcript || '(the table is quiet so far)'}\n\nYour urge to speak (single digit 0-9):`,
      maxOutputTokens: 4,
      providerOptions: { gateway: { caching: 'auto' } },
      abortSignal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    const digit = r.text.match(/[0-9]/)?.[0];
    if (digit != null) {
      p.private.liveUrge = { value: Number(digit), round: state.round, beat: (state.meta.disc?.beat as number | undefined) ?? 0 };
    }
  } catch {
    // Swallow: this seat simply keeps whatever urge it already had.
  }
}

function nameOf(state: GameState, id: PlayerId): string {
  return state.players.find((pl) => pl.id === id)?.name ?? id;
}
