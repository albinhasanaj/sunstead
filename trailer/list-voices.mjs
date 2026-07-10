import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
const el = new ElevenLabsClient();
const res = await el.voices.getAll();
const list = res.voices || res;
for (const v of list) {
  const labels = v.labels ? Object.values(v.labels).join(", ") : "";
  console.log(
    `${v.voiceId || v.voice_id}\t${v.name}\t[${v.category || ""}]\t${labels}`,
  );
}
console.log("TOTAL", list.length);
