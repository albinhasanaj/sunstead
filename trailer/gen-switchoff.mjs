import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const el = new ElevenLabsClient();

async function drain(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const stream = await el.textToSoundEffects.convert({
  text: "a sudden heavy power switch flicked off, one sharp mechanical thunk cutting the sound dead, followed by a long dark reverberant tail ringing out into silence, cinematic",
  durationSeconds: 4,
});
fs.writeFileSync(
  path.join(__dirname, "audio", "sfx_switchoff.mp3"),
  await drain(stream),
);
console.log("sfx_switchoff done");
