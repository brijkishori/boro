export type RateHistoryPoint = { t: number; value: number };

export type RateHistoryMetrics = {
  currentApr?: number;
  currentApy?: number;
  avg24h?: number;
  avg7d?: number;
  avg30d?: number;
  avg90d?: number;
  avg180d?: number;
  avg365d?: number;
  high7d?: number;
  high30d?: number;
  high180d?: number;
  high365d?: number;
  low7d?: number;
  low30d?: number;
  low180d?: number;
  low365d?: number;
  volatility30d?: number;
  volatility90d?: number;
  dataCoverageStart?: string;
  dataCoverageEnd?: string;
  coverageDays?: number;
};

export const HISTORY_INSUFFICIENT_DAYS = 30;
export const HISTORY_LIMITED_DAYS = 90;

export type HistoryCoverage = 'insufficient' | 'limited' | 'adequate';

export function historyCoverageDays(metrics?: RateHistoryMetrics | null): number {
  if (!metrics) return 0;
  if (typeof metrics.coverageDays === 'number' && Number.isFinite(metrics.coverageDays) && metrics.coverageDays >= 0) {
    return metrics.coverageDays;
  }
  if (metrics.dataCoverageStart && metrics.dataCoverageEnd) {
    const start = Date.parse(metrics.dataCoverageStart);
    const end = Date.parse(metrics.dataCoverageEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return (end - start) / 86_400_000;
    }
  }
  if (metrics.avg365d !== undefined || metrics.high365d !== undefined || metrics.low365d !== undefined) return 365;
  if (metrics.avg180d !== undefined || metrics.high180d !== undefined || metrics.low180d !== undefined) return 180;
  if (metrics.avg90d !== undefined || metrics.volatility90d !== undefined) return 90;
  if (metrics.avg30d !== undefined || metrics.volatility30d !== undefined) return 30;
  if (metrics.avg7d !== undefined) return 7;
  if (metrics.avg24h !== undefined) return 1;
  return 0;
}

export function historyCoverage(metrics?: RateHistoryMetrics | null): HistoryCoverage {
  const days = historyCoverageDays(metrics);
  if (days < HISTORY_INSUFFICIENT_DAYS) return 'insufficient';
  if (days < HISTORY_LIMITED_DAYS) return 'limited';
  return 'adequate';
}

export function historyCoverageLabel(coverage: HistoryCoverage): string {
  if (coverage === 'insufficient') return 'Insufficient history';
  if (coverage === 'limited') return 'Limited history';
  return 'Adequate history';
}

const WINDOWS = {
  avg24h: 1,
  avg7d: 7,
  avg30d: 30,
  avg90d: 90,
  avg180d: 180,
  avg365d: 365,
  high7d: 7,
  high30d: 30,
  high180d: 180,
  high365d: 365,
  low7d: 7,
  low30d: 30,
  low180d: 180,
  low365d: 365,
  volatility30d: 30,
  volatility90d: 90,
} as const;

function inWindow(points: RateHistoryPoint[], days: number, now: number): RateHistoryPoint[] {
  const start = now - days * 86_400;
  const windowPoints = points.filter((point) => point.t >= start && Number.isFinite(point.value));
  if (windowPoints.length < 2) return [];
  const span = now - Math.min(...windowPoints.map((point) => point.t));
  if (span < days * 86_400 * 0.5) return [];
  return windowPoints;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const avg = mean(values);
  if (avg === undefined) return undefined;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Builds metrics only for windows that have at least two real observations. */
export function historyMetrics(points: RateHistoryPoint[], now = Math.floor(Date.now() / 1000)): RateHistoryMetrics {
  const usable = points.filter((point) => Number.isFinite(point.t) && Number.isFinite(point.value) && point.value >= 0);
  if (usable.length === 0) return {};
  const sorted = usable.slice().sort((left, right) => left.t - right.t);
  const metrics: RateHistoryMetrics = {
    dataCoverageStart: new Date(sorted[0].t * 1000).toISOString(),
    dataCoverageEnd: new Date(sorted[sorted.length - 1].t * 1000).toISOString(),
    coverageDays: (sorted[sorted.length - 1].t - sorted[0].t) / 86_400,
  };
  for (const [key, days] of Object.entries(WINDOWS)) {
    const windowPoints = inWindow(sorted, days, now);
    const values = windowPoints.map((point) => point.value);
    if (key.startsWith('avg')) {
      if (values.length >= 2) metrics[key as keyof RateHistoryMetrics] = mean(values) as never;
    } else if (key.startsWith('high')) {
      if (values.length >= 2) metrics[key as keyof RateHistoryMetrics] = Math.max(...values) as never;
    } else if (key.startsWith('low')) {
      if (values.length >= 2) metrics[key as keyof RateHistoryMetrics] = Math.min(...values) as never;
    } else if (key.startsWith('volatility')) {
      const vol = stdev(values);
      if (vol !== undefined) metrics[key as keyof RateHistoryMetrics] = vol as never;
    }
  }
  return metrics;
}
