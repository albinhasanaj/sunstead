import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "audio");
const el = new ElevenLabsClient();

const CUES = [
  {
    f: "riser",
    text: "a long slow rising cinematic tension riser, building dread over five seconds into a sudden climax, deep ominous whoosh, no music",
    dur: 5.5,
  },
  {
    f: "impact",
    text: "a massive deep cinematic braaam impact hit, epic movie trailer boom with heavy sub bass and a long dark tail",
    dur: 4,
  },
  {
    f: "subdrop",
    text: "a deep sub bass drop and low rumble falling into silence, ominous",
    dur: 3,
  },
];

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

for (const c of CUES) {
  const stream = await el.textToSoundEffects.convert({
    text: c.text,
    durationSeconds: c.dur,
  });
  const bytes = await drain(stream);
  fs.writeFileSync(path.join(outDir, "sfx_" + c.f + ".mp3"), bytes);
  console.log("sfx_" + c.f, bytes.length, "bytes");
}
console.log("cinematic SFX done");
