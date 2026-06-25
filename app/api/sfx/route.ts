import { sfx } from '@/voice/score';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One-shot sound cues: /api/sfx?cue=night|death|reveal|win. Cached after first gen.
export async function GET(req: Request) {
  if (!process.env.ELEVENLABS_API_KEY) return new Response(null, { status: 204 });
  const cue = new URL(req.url).searchParams.get('cue') ?? '';
  try {
    const audio = await sfx(cue);
    if (!audio) return new Response(null, { status: 404 });
    return new Response(new Blob([audio as BlobPart], { type: 'audio/mpeg' }), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
}
