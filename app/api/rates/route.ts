import { getRates } from '@/lib/rates';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await getRates();
    return Response.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=15, s-maxage=30' },
    });
  } catch {
    return Response.json({ error: 'Live rates are unavailable. Try again in a moment.' }, { status: 503 });
  }
}
