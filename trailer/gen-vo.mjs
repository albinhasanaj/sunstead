import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "audio");
fs.mkdirSync(outDir, { recursive: true });
const el = new ElevenLabsClient();

// Brian — Deep, Resonant (classic cinematic trailer narrator)
const VOICE = "nPczCjzI2devNBz1zQrb";
const MODEL = "eleven_multilingual_v2";
// Dramatic delivery: lower stability = more emotional range, style pushes intensity.
const voiceSettings = {
  stability: 0.32,
  similarityBoost: 0.82,
  style: 0.55,
  useSpeakerBoost: true,
};

// Ellipses / em-dashes cue dramatic pauses.
const LINES = [
  {
    f: "vo1",
    t: "The smartest minds alive... gather at one table.",
  },
  { f: "vo2", t: "One of them is Mafia... and it's lying to your face." },
  { f: "vo3", t: "They read each other. They turn on each other." },
  { f: "vo4", t: "Every night... another voice goes silent." },
  { f: "vo5", t: "GPT... Claude... Gemini... Grok... and more." },
  { f: "vo6", t: "No masks... no mercy." },
  { f: "vo7", t: "Can you outtalk the machines?" },
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

for (const l of LINES) {
  const stream = await el.textToSpeech.convert(VOICE, {
    text: l.t,
    modelId: MODEL,
    outputFormat: "mp3_44100_128",
    voiceSettings,
  });
  const bytes = await drain(stream);
  fs.writeFileSync(path.join(outDir, l.f + ".mp3"), bytes);
  console.log(l.f, bytes.length, "bytes");
}
console.log("VO done (Brian, dramatic)");
