import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

let client: ElevenLabsClient | null = null;
function el(): ElevenLabsClient {
  return (client ??= new ElevenLabsClient());
}

// scribe_v2 is the current Scribe speech-to-text model.
export const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';

// Transcribe a recorded audio clip (the human speaking their turn) → text.
export async function transcribe(audio: ArrayBuffer, mime = 'audio/webm'): Promise<string> {
  const file = new Blob([audio], { type: mime });
  const res: any = await el().speechToText.convert({ file, modelId: STT_MODEL } as any);
  return (res?.text ?? '').trim();
}
