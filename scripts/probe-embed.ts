/**
 * Step 1(d): prove we can get a 1536-dim embedding.
 * Tries the AI Gateway (text-embedding-3-small) first; reports the dimension.
 * If the gateway doesn't serve embeddings, we'll know to wire OPENAI_API_KEY.
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { embed } from 'ai';
loadEnv({ path: '.env.local' });

const MODEL = 'openai/text-embedding-3-small';

async function tryEmbed(label: string, model: any) {
  const t0 = Date.now();
  try {
    const { embedding } = await embed({ model, value: 'The quick brown fox tested a vector.' });
    console.log(`✅ ${label}: dim=${embedding.length} in ${Date.now() - t0}ms`);
    return embedding.length;
  } catch (e) {
    console.log(`❌ ${label}: ${(e as Error).message.slice(0, 160)}`);
    return 0;
  }
}

async function main() {
  console.log(`AI_GATEWAY_API_KEY set: ${!!process.env.AI_GATEWAY_API_KEY}`);
  console.log(`OPENAI_API_KEY set:     ${!!process.env.OPENAI_API_KEY}\n`);

  // Strategy A: bare gateway string (same pattern generateText uses).
  let dim = await tryEmbed(`gateway string "${MODEL}"`, MODEL);

  // Strategy B: explicit gateway provider, if the bare string didn't work.
  if (!dim) {
    try {
      const { gateway } = await import('ai');
      dim = await tryEmbed('gateway.textEmbeddingModel(...)', (gateway as any).textEmbeddingModel(MODEL));
    } catch (e) {
      console.log(`(gateway provider import failed: ${(e as Error).message.slice(0, 120)})`);
    }
  }

  console.log(`\nRESULT: ${dim === 1536 ? 'OK — 1536 dims' : dim ? `got ${dim} dims (NOT 1536)` : 'NO embedding from gateway → need OPENAI_API_KEY'}`);
  process.exit(dim === 1536 ? 0 : 1);
}

main();
