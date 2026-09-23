import { storeJson } from '@/lib/store';
import { getRates } from '@/lib/rates';
import type { RatePoint } from '@/lib/rateHistory';

export const dynamic = 'force-dynamic';

const MORPHO_URL = 'https://api.morpho.org/graphql';

type Point = RatePoint;

function rangeSeconds(range: string) {
  if (range === '7d') return 7 * 86400;
  if (range === '90d') return 90 * 86400;
  return 30 * 86400;
}

async function morphoHistory(marketId: string, chainId: number, start: number, end: number): Promise<Point[]> {
  const query = `query Hist($uniqueKey: String!, $chainId: Int!, $start: Int!, $end: Int!) {
    marketByUniqueKey(uniqueKey: $uniqueKey, chainId: $chainId) {
      historicalState(options: { startTimestamp: $start, endTimestamp: $end, interval: DAY }) {
        timeseries { x y }
      }
    }
  }`;
  try {
    const response = await fetch(MORPHO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { uniqueKey: marketId, chainId, start, end } }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { marketByUniqueKey?: { historicalState?: { timeseries?: { x?: number; y?: number }[] } } } };
    const series = body.data?.marketByUniqueKey?.historicalState?.timeseries ?? [];
    return series.flatMap((row) => {
      if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) return [];
      return [{ t: Number(row.x), borrow: Number(row.y), supply: 0 }];
    });
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const venueId = params.get('venue') ?? '';
  const range = params.get('range') ?? '30d';
  const seconds = rangeSeconds(range);
  const start = Math.floor(Date.now() / 1000) - seconds;
  const stored = ((await storeJson<Point[]>(`rates:hist:${venueId}`)) ?? []).filter((point) => point.t >= start);
  if (stored.length > 2) {
    return Response.json({ points: stored }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  }
  const rates = await getRates().catch(() => null);
  const venue = rates?.venues.find((item) => item.id === venueId);
  if (venue?.morpho) {
    const points = await morphoHistory(venue.morpho.marketId, venue.chainId, start, Math.floor(Date.now() / 1000));
    if (points.length > 0) return Response.json({ points }, { headers: { 'Cache-Control': 'public, max-age=600' } });
  }
  return Response.json({ points: stored }, { headers: { 'Cache-Control': 'public, max-age=120' } });
}
