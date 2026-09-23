import { snapshotRates } from '@/lib/rateHistory';
import { getRates } from '@/lib/rates';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await getRates();
    void snapshotRates(payload.venues).catch(() => {
      // Rate history is best-effort; a Redis miss must not break live quotes.
    });
    return Response.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=10, s-maxage=15' },
    });
  } catch {
    return Response.json({ error: 'Live rates are unavailable. Try again in a moment.' }, { status: 503 });
  }
}
