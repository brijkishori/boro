import { snapshotRates } from '@/lib/rateHistory';
import { getRates } from '@/lib/rates';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get('fresh') === '1';
    const payload = await getRates({ bypassCache: fresh });
    void snapshotRates(payload.venues).catch(() => {
      // Rate history is best-effort; a Redis miss must not break live quotes.
    });
    return Response.json(payload, {
      headers: { 'Cache-Control': fresh ? 'no-store' : 'public, max-age=10, s-maxage=15' },
    });
  } catch {
    return Response.json({ error: 'Live rates are unavailable. Try again in a moment.' }, { status: 503 });
  }
}
