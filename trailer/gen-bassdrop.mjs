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
  text: "a massive cinematic sub-bass drop, an immediate deep powerful low-frequency boom that hits hard then rings out into a long slowly decaying sub rumble fading to silence, epic movie trailer impact, no music",
  durationSeconds: 5,
});
fs.writeFileSync(
  path.join(__dirname, "audio", "sfx_bassdrop.mp3"),
  await drain(stream),
);
console.log("sfx_bassdrop done");
