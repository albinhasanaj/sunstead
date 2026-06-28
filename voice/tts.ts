import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { voiceSettingsFor, type Expression } from './emotion';

// Server-only ElevenLabs wrapper. Reads ELEVENLABS_API_KEY from the env.
let client: ElevenLabsClient | null = null;
function el(): ElevenLabsClient {
  return (client ??= new ElevenLabsClient());
}

// eleven_flash_v2_5 is the low-latency model (~0.6s here) — right for fast table
// crossfire. eleven_v3 (richer, higher latency) is used ONLY for rare hero lines
// (Stage 5) and is selected per-call via opts.modelId — never the default.
export const TTS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

export interface SynthOpts {
  // The public expression riding the spoken line → flash voiceSettings (Stage 1).
  // Omit for today's neutral default behavior.
  expression?: Expression;
  // Override the model for this call (e.g. eleven_v3 hero lines). Defaults to TTS_MODEL.
  modelId?: string;
}

// Synthesize speech and return the audio as a single MP3 buffer. (Audio lines are
// small — ~45KB — so buffering keeps the API route simple and lets us set length.)
// An expression (if given) maps to per-line voiceSettings so the same words can be
// delivered panicked vs. confident; when absent, behavior is unchanged.
export async function synthesize(voiceId: string, text: string, opts: SynthOpts = {}): Promise<Uint8Array> {
  // Building voiceSettings must never break a synth — degrade to defaults on any error.
  let voiceSettings: ReturnType<typeof voiceSettingsFor> | undefined;
  try {
    if (opts.expression) voiceSettings = voiceSettingsFor(opts.expression.emotion, opts.expression.intensity);
  } catch {
    voiceSettings = undefined;
  }

  const stream = (await el().textToSpeech.convert(voiceId, {
    text,
    modelId: opts.modelId || TTS_MODEL,
    outputFormat: 'mp3_44100_128',
    ...(voiceSettings ? { voiceSettings } : {}),
  })) as ReadableStream<Uint8Array>;

  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
