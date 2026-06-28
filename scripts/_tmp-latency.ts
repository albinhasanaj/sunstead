// TEMP: representative per-seat latency for a short discussion line. Deleted after use.
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { generateText } from 'ai';
import { resolveModel } from '../engine/models';
import { personalityByName } from '../games/mafia/roles';

const SEATS = ['Opus', 'Claude', 'Haiku', 'GeminiPro', 'Gemini', 'GPT', 'GPTmini', 'Grok'];
const SYS = 'You are a player in a game of Mafia. Speak naturally and briefly.';
const PROMPT = 'The table is debating who is suspicious. In TWO short sentences, give your read on who might be Mafia and why.';

async function main() {
  for (const name of SEATS) {
    const p = personalityByName(name);
    if (!p) continue;
    const t0 = Date.now();
    try {
      const out = await generateText({
        model: resolveModel(p.model),
        system: SYS,
        prompt: PROMPT,
        maxOutputTokens: 400,
        abortSignal: AbortSignal.timeout(60000),
      });
      console.log(`${name.padEnd(10)} ${(Date.now() - t0 + 'ms').padEnd(9)} ${p.model.padEnd(34)} ${out.text.trim().length} chars`);
    } catch (e) {
      console.log(`${name.padEnd(10)} FAILED    ${p.model}  ${(e as Error).message.slice(0, 80)}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
