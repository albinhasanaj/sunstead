import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

// Model routing — two backends, chosen by a prefix on the model string:
//
//   featherless/<hf-org>/<model>   → Featherless (open-weights: DeepSeek, Kimi,
//                                     GLM, Qwen, Llama, Mistral, …)
//   <creator>/<model>  (no prefix) → Vercel AI Gateway (closed source: OpenAI,
//                                     Anthropic, Google, xAI, …)
//
// Anything not tagged `featherless/` falls through to the gateway unchanged, so
// every existing seat and any new closed-source model keeps working with only
// AI_GATEWAY_API_KEY. Featherless seats additionally need FEATHERLESS_API_KEY.
// https://featherless.ai — OpenAI-compatible, flat-rate hosting for open models.

export const FEATHERLESS_PREFIX = 'featherless/';
const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';

let _featherless: ReturnType<typeof createOpenAICompatible> | undefined;

// Build the provider lazily (and once) so it reads FEATHERLESS_API_KEY only after
// dotenv has loaded .env.local — play.ts loads that in its body, i.e. AFTER all
// module imports have run, so a load-time read here would miss the key.
function featherless() {
  if (!_featherless) {
    _featherless = createOpenAICompatible({
      name: 'featherless',
      baseURL: FEATHERLESS_BASE_URL,
      apiKey: process.env.FEATHERLESS_API_KEY,
    });
  }
  return _featherless;
}

export function isFeatherless(model: string): boolean {
  return model.startsWith(FEATHERLESS_PREFIX);
}

// Turn a model string into something generateText() accepts. A `featherless/…`
// string resolves to a concrete OpenAI-compatible client pointed at Featherless;
// every other string is returned as-is so the AI SDK routes it through the AI
// Gateway exactly as before.
export function resolveModel(model: string): LanguageModel {
  if (isFeatherless(model)) {
    return featherless()(model.slice(FEATHERLESS_PREFIX.length));
  }
  return model;
}
