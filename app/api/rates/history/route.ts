import { storeJson } from '@/lib/store';
import { getRates } from '@/lib/rates';
import { aprFromApy } from '@/lib/finance/rates';
import { historyMetrics, type RateHistoryPoint } from '@/lib/finance/history';
import type { RatePoint } from '@/lib/rateHistory';

export const dynamic = 'force-dynamic';

const MORPHO_URL = 'https://api.morpho.org/graphql';

function rangeSeconds(range: string) {
  if (range === '24h') return 86400;
  if (range === '7d') return 7 * 86400;
  if (range === '90d') return 90 * 86400;
  if (range === '180d') return 180 * 86400;
  if (range === '365d') return 365 * 86400;
  return 30 * 86400;
}

async function morphoHistory(marketId: string, chainId: number, start: number, end: number): Promise<RatePoint[]> {
  const query = `query Hist($uniqueKey: String!, $chainId: Int!, $start: Int!, $end: Int!) {
    marketByUniqueKey(uniqueKey: $uniqueKey, chainId: $chainId) {
      historicalState {
        borrowApy(options: { startTimestamp: $start, endTimestamp: $end, interval: DAY }) { x y }
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
    const body = (await response.json()) as {
      data?: { marketByUniqueKey?: { historicalState?: { borrowApy?: { x?: number; y?: number }[] } } };
    };
    const series = body.data?.marketByUniqueKey?.historicalState?.borrowApy ?? [];
    return series.flatMap((row) => {
      if (!Number.isFinite(row.x) || !Number.isFinite(row.y) || Number(row.y) < 0) return [];
      const apr = aprFromApy(Number(row.y));
      if (!Number.isFinite(apr)) return [];
      return [{ t: Number(row.x), borrow: apr, supply: 0 }];
    });
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const venueId = params.get('venue') ?? '';
  const range = params.get('range') ?? '365d';
  const seconds = rangeSeconds(range);
  const start = Math.floor(Date.now() / 1000) - seconds;
  const stored = ((await storeJson<RatePoint[]>(`rates:hist:${venueId}`)) ?? []).filter((point) => point.t >= start);
  let points = stored;
  if (points.length <= 2) {
    const rates = await getRates().catch(() => null);
    const venue = rates?.venues.find((item) => item.id === venueId);
    if (venue?.morpho) {
      const morphoPoints = await morphoHistory(venue.morpho.marketId, venue.chainId, start, Math.floor(Date.now() / 1000));
      if (morphoPoints.length > 0) points = morphoPoints;
    }
  }
  const historyPoints: RateHistoryPoint[] = points.map((point) => ({ t: point.t, value: point.borrow }));
  return Response.json(
    { points, metrics: historyMetrics(historyPoints) },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
