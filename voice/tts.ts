import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

// Server-only ElevenLabs wrapper. Reads ELEVENLABS_API_KEY from the env.
let client: ElevenLabsClient | null = null;
function el(): ElevenLabsClient {
  return (client ??= new ElevenLabsClient());
}

// eleven_flash_v2_5 is the low-latency model (~0.6s here) — right for fast table
// crossfire. Swap to eleven_v3 for dramatic single lines with audio tags.
export const TTS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

// Synthesize speech and return the audio as a single MP3 buffer. (Audio lines are
// small — ~45KB — so buffering keeps the API route simple and lets us set length.)
export async function synthesize(voiceId: string, text: string): Promise<Uint8Array> {
  const stream = (await el().textToSpeech.convert(voiceId, {
    text,
    modelId: TTS_MODEL,
    outputFormat: 'mp3_44100_128',
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
