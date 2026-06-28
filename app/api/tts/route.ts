import { synthesize, TTS_MODEL } from '@/voice/tts';
import { DEFAULT_VOICE, voiceFor } from '@/voice/voiceMap';
import { coerceEmotion, coerceIntensity, type Expression } from '@/voice/emotion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Voice is a presentation layer: the client posts a spoken line here and gets back
// MP3 audio. Keeping TTS out of the game loop means the engine stays provider-clean
// and watch/play both get voice for free. 204 = "no audio" so the client just skips.
export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) return new Response(null, { status: 204 });

  const body = await req.json().catch(() => ({}));
  const text: string = (body?.text ?? '').toString().slice(0, 800);
  if (!text.trim()) return new Response(null, { status: 400 });

  const voiceId: string = body?.voiceId || (body?.agent ? voiceFor(body.agent) : DEFAULT_VOICE);

  // The public expression riding the spoken line → flash voiceSettings (Stage 1).
  // Always present (degrades to neutral); absent emotion keys behave like before.
  const expression: Expression | undefined =
    body?.emotion != null || body?.intensity != null
      ? { emotion: coerceEmotion(body.emotion), intensity: coerceIntensity(body.intensity) }
      : undefined;

  const tryVoice = async (vid: string) => {
    const audio = await synthesize(vid, text, { expression });
    return new Response(new Blob([audio as BlobPart], { type: 'audio/mpeg' }), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-TTS-Model': TTS_MODEL,
      },
    });
  };

  try {
    return await tryVoice(voiceId);
  } catch {
    // The mapped voice may be unavailable on this plan — fall back once, then give up quietly.
    try {
      return await tryVoice(DEFAULT_VOICE);
    } catch {
      return new Response(null, { status: 204 });
    }
  }
}
