import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
loadEnv({ path: '.env.local' });

const drain = async (s: ReadableStream<Uint8Array>) => {
  let n = 0;
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    if (value) n += value.length;
  }
  return n;
};

async function main() {
  const el = new ElevenLabsClient();

  // 1) Sound effects
  try {
    const t0 = Date.now();
    const s = (await el.textToSoundEffects.convert({ text: 'a tense low cinematic drone, ominous' })) as ReadableStream<Uint8Array>;
    console.log(`OK   SFX: ${await drain(s)} bytes ${Date.now() - t0}ms`);
  } catch (e: any) {
    console.log(`FAIL SFX: ${(e.message ?? '').slice(0, 110)}`);
  }

  // 2) Music
  try {
    const t0 = Date.now();
    const s = (await el.music.compose({ prompt: 'slow dark suspense bed, sparse heartbeat, no drums', musicLengthMs: 10000 } as any)) as ReadableStream<Uint8Array>;
    console.log(`OK   MUSIC: ${await drain(s)} bytes ${Date.now() - t0}ms`);
  } catch (e: any) {
    console.log(`FAIL MUSIC: ${(e.message ?? '').slice(0, 110)}`);
  }

  // 3) Speech-to-text (transcribe a clip we generated earlier, if present)
  try {
    const path = '/private/tmp/claude-501/-Users-albinhasanaj-Desktop-mafia/f1cbbb01-3fa8-467e-9f65-e7b81ca0122c/scratchpad/out.mp3';
    const buf = readFileSync(path);
    const file = new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' });
    const t0 = Date.now();
    const r: any = await el.speechToText.convert({ file, modelId: 'scribe_v2' } as any);
    console.log(`OK   STT (${Date.now() - t0}ms): "${(r.text ?? '').slice(0, 80)}"`);
  } catch (e: any) {
    console.log(`FAIL STT: ${(e.message ?? '').slice(0, 110)}`);
  }
}
main();
