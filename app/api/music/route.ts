import { musicBed } from '@/voice/score';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The looping tension bed. Generated once, then served from cache.
export async function GET() {
  if (!process.env.ELEVENLABS_API_KEY) return new Response(null, { status: 204 });
  try {
    const audio = await musicBed();
    return new Response(new Blob([audio as BlobPart], { type: 'audio/mpeg' }), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
}
