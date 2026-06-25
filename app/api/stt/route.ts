import { transcribe } from '@/voice/stt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Human voice-in: the client posts a recorded mic clip (raw audio bytes); we
// return the transcript, which the UI drops into the turn input for the player to
// confirm and send. Push-to-talk → Scribe → your move.
export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) return Response.json({ text: '', error: 'no key' }, { status: 204 });
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return Response.json({ text: '', error: 'empty' }, { status: 400 });
  const mime = req.headers.get('content-type') || 'audio/webm';
  try {
    const text = await transcribe(buf, mime);
    return Response.json({ text });
  } catch (e) {
    return Response.json({ text: '', error: (e as Error).message }, { status: 200 });
  }
}
