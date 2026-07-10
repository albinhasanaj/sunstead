import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "audio");
fs.mkdirSync(outDir, { recursive: true });

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

const prompt =
  "Intense cinematic movie-trailer underscore for a dark AI thriller. " +
  "Begins with an ominous low drone and a slow pulsing sub heartbeat, cold and tense. " +
  "Builds steadily with rising strings, ticking tension, distant metallic hits and a swelling riser. " +
  "Climaxes around 24 seconds into a powerful epic braaam hit, then a short dark resolving chord. " +
  "No vocals, no melody hooks, purely atmospheric suspense and dread.";

console.log("composing cinematic bed...");
const stream = await el.music.compose({ prompt, musicLengthMs: 31000 });
const bytes = await drain(stream);
fs.writeFileSync(path.join(outDir, "cinematic.mp3"), bytes);
console.log("wrote audio/cinematic.mp3", bytes.length, "bytes");
