/**
 * Token-free regression probe for the discussion "urge to speak" auction.
 * Builds synthetic DISCUSSION states and asserts the new signals behave:
 *   - trigger-hit: an UNNAMED seat whose self-authored trigger matches the live line
 *     gets pulled in;
 *   - anti-monopoly: when two seats own the recent floor, a third (outsider) is lifted;
 *   - safety: discussion terminates at budget and nobody speaks twice in a row.
 * Stochastic terms (jitter) make this statistical — we assert strong tendencies over
 * many trials, not single picks. Run: npx tsx scripts/probe-scheduler.ts
 */
import { nextSpeaker } from '../games/mafia/phases';
import type { AgentState, GameState, PlayerId } from '../engine/types';

const NAMES = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen'];
const mk = (id: string, name: string, priv: Record<string, unknown> = {}): AgentState => ({
  id,
  name,
  alive: true,
  role: 'villager',
  private: { suspicions: {}, notes: '', ...priv },
});

function freshState(log: { speaker: PlayerId; text: string }[], privBy: Record<string, Record<string, unknown>> = {}): GameState {
  return {
    players: NAMES.map((n, i) => mk(`p${i + 1}`, n, privBy[`p${i + 1}`] ?? {})),
    phase: 'DISCUSSION',
    round: 1,
    publicLog: log,
    winner: null,
    meta: {},
  };
}

const pickOnce = async (s: GameState): Promise<string | null> => (await nextSpeaker(s)) as string | null;

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failures++;
};

async function trialWinner(build: () => GameState, trials = 400): Promise<Record<string, number>> {
  const wins: Record<string, number> = {};
  for (let i = 0; i < trials; i++) {
    const w = await pickOnce(build());
    if (w) wins[w] = (wins[w] ?? 0) + 1;
  }
  return wins;
}

async function main() {
  // ── 1) TRIGGER-HIT — p3 (Gemini) holds trigger "doctor claim"; the live line raises
  //    it WITHOUT naming Gemini. p3 should win the floor far more than its 1/5 share.
  const triggerWins = await trialWinner(() =>
    freshState(
      [
        { speaker: 'system', text: 'Dawn breaks. No one died.' },
        { speaker: 'p1', text: 'Honestly the doctor claim from earlier feels shaky to me.' },
      ],
      { p3: { bid: { pressure: 0, triggers: ['doctor claim'], round: 1, beat: 0 }, suspicions: {} } },
    ),
  );
  const p3share = (triggerWins.p3 ?? 0) / 400;
  console.log(`   trigger-hit win shares:`, triggerWins);
  assert(p3share > 0.6, `trigger-hit: Gemini (unnamed but topic-matched) wins ${(p3share * 100).toFixed(0)}% (>60%, vs 20% baseline)`);

  // ── 2) ANTI-MONOPOLY — p1 & p2 own the last 4 lines (no names mentioned). An outsider
  //    (p3/p4/p5) should win most beats; the dominating pair should be suppressed.
  const monoWins = await trialWinner(() =>
    freshState([
      { speaker: 'p1', text: 'I still feel the same way about the read.' },
      { speaker: 'p2', text: 'And I keep pushing back on that read.' },
      { speaker: 'p1', text: 'But the logic holds up if you trace it.' },
      { speaker: 'p2', text: 'It really does not hold up at all.' },
    ]),
  );
  const outsiders = (monoWins.p3 ?? 0) + (monoWins.p4 ?? 0) + (monoWins.p5 ?? 0);
  const insiders = (monoWins.p1 ?? 0) + (monoWins.p2 ?? 0);
  console.log(`   anti-monopoly win shares:`, monoWins);
  assert(outsiders > insiders * 2, `anti-monopoly: outsiders ${outsiders} beat dominating pair ${insiders} by >2x`);

  // ── 3) SAFETY — full discussion: terminates at budget, no seat speaks twice in a row.
  const s = freshState([{ speaker: 'system', text: 'Dawn breaks.' }]);
  const order: string[] = [];
  let id: string | null;
  let guard = 0;
  while ((id = await pickOnce(s)) !== null && guard++ < 100) {
    order.push(id);
    s.publicLog.push({ speaker: id, text: `(${id} speaks)` });
  }
  const budget = s.players.length * 2;
  const noRepeat = order.every((x, i) => i === 0 || x !== order[i - 1]);
  console.log(`   floor order: ${order.join(' → ')}`);
  assert(order.length === budget, `terminates at budget (${order.length} beats == ${budget})`);
  assert(noRepeat, 'no seat speaks twice in a row');

  console.log(failures ? `\n❌ ${failures} assertion(s) failed` : '\n✅ all scheduler assertions passed');
  if (failures) process.exit(1);
}
main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
