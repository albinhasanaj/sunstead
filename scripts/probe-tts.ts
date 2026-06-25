import { config as loadEnv } from 'dotenv';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
loadEnv({ path: '.env.local' });

async function main() {
  const el = new ElevenLabsClient();
  const cases: [string, string, string][] = [
    ['Sarah', 'EXAVITQu4vr4xnSDxMaL', 'eleven_flash_v2_5'],
    ['Roger', 'CwhRBWXzGAHq8TQ4Fs17', 'eleven_turbo_v2_5'],
    ['Charlie', 'IKne3meq5aSn9XLyUdCD', 'eleven_multilingual_v2'],
  ];
  for (const [name, id, model] of cases) {
    const t0 = Date.now();
    try {
      const stream = await el.textToSpeech.convert(id, {
        text: 'Watch how they deflect — that is a Mafia tell.',
        modelId: model,
        outputFormat: 'mp3_44100_128',
      });
      let n = 0;
      const r = (stream as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        if (value) n += value.length;
      }
      console.log(`OK   ${name}/${model}: ${n} bytes ${Date.now() - t0}ms`);
    } catch (e: any) {
      console.log(`FAIL ${name}/${model}: ${(e.message ?? '').slice(0, 100)}`);
    }
  }
}
main();
