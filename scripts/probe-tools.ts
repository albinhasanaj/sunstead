import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
loadEnv({ path: '.env.local' });

const models = [
  'openai/gpt-oss-120b',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash',
  'deepseek/deepseek-v3.1',
  'alibaba/qwen3-32b',
];

const echo = tool({
  description: 'Record a private note. Call this then call vote.',
  inputSchema: z.object({ note: z.string() }),
  execute: async ({ note }) => `noted: ${note}`,
});
const vote = tool({
  description: 'Vote for a player by name.',
  inputSchema: z.object({ target: z.string() }),
  execute: async ({ target }) => `voted ${target}`,
});

async function main() {
for (const model of models) {
  const t0 = Date.now();
  try {
    const r = await generateText({
      model,
      system: 'You are playing a game. First call echo, then call vote for "Bob".',
      prompt: 'Take your turn.',
      tools: { echo, vote },
      toolChoice: 'required',
      stopWhen: [stepCountIs(2)],
    });
    const calls = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    console.log(`✅ ${model.padEnd(28)} ${Date.now() - t0}ms  calls=[${calls.join(', ')}]`);
  } catch (e) {
    console.log(`❌ ${model.padEnd(28)} ${(e as Error).message.slice(0, 80)}`);
  }
}
}
main();
