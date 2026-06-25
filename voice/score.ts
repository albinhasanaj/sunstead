import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

let client: ElevenLabsClient | null = null;
function el(): ElevenLabsClient {
  return (client ??= new ElevenLabsClient());
}

// Generated audio is identical every game, so cache it in the server process and
// reuse — one music bed + a handful of SFX cost a few credits total, not per game.
const cache: Map<string, Uint8Array> = ((globalThis as any).__mafiaScore ??= new Map());

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
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

// A loopable tension underscore for the table.
export async function musicBed(): Promise<Uint8Array> {
  const key = 'bed';
  const hit = cache.get(key);
  if (hit) return hit;
  const stream = (await el().music.compose({
    prompt:
      'dark minimal suspense underscore for a social-deduction game: slow tense low strings, ' +
      'sparse heartbeat pulse, ominous and patient, loopable, no drums, no melody, no vocals',
    musicLengthMs: 30000,
  } as any)) as ReadableStream<Uint8Array>;
  const bytes = await drain(stream);
  cache.set(key, bytes);
  return bytes;
}

const SFX_PROMPTS: Record<string, string> = {
  night: 'a single deep ominous cinematic boom with soft cold wind, night falls',
  death: 'a sudden tense orchestral stinger, a body is discovered, dread',
  reveal: 'a dramatic verdict stinger, rising tension then a sharp accusatory hit',
  win: 'a short dark triumphant resolution chord, the game is decided',
};

export async function sfx(cue: string): Promise<Uint8Array | null> {
  if (!SFX_PROMPTS[cue]) return null;
  const key = `sfx:${cue}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const stream = (await el().textToSoundEffects.convert({
    text: SFX_PROMPTS[cue],
    durationSeconds: 3,
  } as any)) as ReadableStream<Uint8Array>;
  const bytes = await drain(stream);
  cache.set(key, bytes);
  return bytes;
}
