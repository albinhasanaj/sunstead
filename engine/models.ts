import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModel } from 'ai';

// Model routing — pick the right backend per model string, by its `creator/` prefix:
//
//   featherless/<org>/<model>  → Featherless (open weights)   FEATHERLESS_API_KEY
//   anthropic/<model>          → Anthropic native API         ANTHROPIC_API_KEY
//   openai/<model>             → OpenAI native API             OPENAI_API_KEY
//   xai/<model>                → xAI native API                XAI_API_KEY
//   <creator>/<model> (else)   → Vercel AI Gateway             AI_GATEWAY_API_KEY
//
// The three closed-source labs we hold direct keys for (Anthropic, OpenAI, xAI) hit the
// labs' OWN endpoints (api.anthropic.com / api.openai.com / api.x.ai) with the lab's own
// key — no gateway hop, lower latency, no gateway dependency. Conjure routes the same
// three this way. Gemini — and anything else without a native router here, OR whose
// native key is unset — stays on the gateway. So the app still runs with only
// AI_GATEWAY_API_KEY; adding a native key flips those seats to the direct API, no other
// change. Featherless seats are unaffected.

export const FEATHERLESS_PREFIX = 'featherless/';
const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';

// Providers are built lazily (and once) so they read their API keys only AFTER dotenv
// has loaded .env.local — scripts load it in their body, i.e. AFTER module imports run,
// so a load-time read here would miss the keys.
let _featherless: ReturnType<typeof createOpenAICompatible> | undefined;
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

let _anthropic: ReturnType<typeof createAnthropic> | undefined;
function anthropic() {
  if (!_anthropic) _anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

let _openai: ReturnType<typeof createOpenAI> | undefined;
function openai() {
  if (!_openai) _openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

let _xai: ReturnType<typeof createXai> | undefined;
function xai() {
  if (!_xai) _xai = createXai({ apiKey: process.env.XAI_API_KEY });
  return _xai;
}

export function isFeatherless(model: string): boolean {
  return model.startsWith(FEATHERLESS_PREFIX);
}

// The native model id for a gateway `creator/model` slug. The gateway writes Anthropic
// versions with DOTS (claude-haiku-4.5); the native Anthropic API uses DASHES
// (claude-haiku-4-5). OpenAI and xAI keep their ids verbatim (gpt-5.1-nano, grok-4.1-…).
function nativeId(provider: string, rest: string): string {
  return provider === 'anthropic' ? rest.replace(/\./g, '-') : rest;
}

// Turn a model string into something generateText() accepts:
//   • featherless/…           → an OpenAI-compatible client pointed at Featherless
//   • anthropic|openai|xai/…  → that lab's NATIVE provider client, IF its key is set
//   • anything else (incl. a native seat whose key is unset) → the raw string, which the
//     AI SDK routes through the Vercel AI Gateway exactly as before.
export function resolveModel(model: string): LanguageModel {
  if (isFeatherless(model)) {
    return featherless()(model.slice(FEATHERLESS_PREFIX.length));
  }
  const slash = model.indexOf('/');
  if (slash > 0) {
    const provider = model.slice(0, slash);
    const rest = model.slice(slash + 1);
    if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) return anthropic()(nativeId(provider, rest));
    if (provider === 'openai' && process.env.OPENAI_API_KEY) return openai()(nativeId(provider, rest));
    if (provider === 'xai' && process.env.XAI_API_KEY) return xai()(nativeId(provider, rest));
  }
  // Fallback: hand the raw string to the AI SDK → routed via the Vercel AI Gateway
  // (google/*, or any native seat whose key isn't set).
  return model;
}
