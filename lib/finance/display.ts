import type { RateHistoryMetrics } from '@/lib/finance/history';
import { formatApr } from '@/lib/amount';
import { formatSpreadPoints } from '@/lib/finance/format';

export const RATE_UNCHANGED_NOTE = 'Assumes the current variable rate remains unchanged.';
export const PAYOFF_RATE_NOTE = 'Estimate assuming current variable rate remains unchanged.';

export function yearOneInterestLabel(declining: boolean): string {
  return declining ? 'Estimated next-12-month interest' : 'Annualized interest at current balance';
}

export function formatFreshness(fetchedAt?: number, now = Date.now()): string | null {
  if (!fetchedAt || fetchedAt <= 0) return null;
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (seconds < 60) return `Updated ${seconds} sec ago`;
  if (seconds < 3600) return `Updated ${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `Updated ${Math.round(seconds / 3600)} hr ago`;
  return `Updated ${Math.round(seconds / 86_400)}d ago`;
}

export function formatSpreadShort(spread: number): string {
  return formatSpreadPoints(spread);
}

export function formatPercentPoints(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const points = value * 100;
  const sign = points > 0 ? '+' : '';
  return `${sign}${points.toFixed(2)} percentage points`;
}

export function compactHistoryRows(metrics?: RateHistoryMetrics | null): Array<{ label: string; value: string }> {
  if (!metrics) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value?: number) => {
    if (value !== undefined) rows.push({ label, value: formatApr(value) });
  };
  add('Current', metrics.currentApr);
  add('7-day avg', metrics.avg7d);
  add('30-day avg', metrics.avg30d);
  add('1-year high', metrics.high365d);
  return rows;
}

export function historyRows(metrics?: RateHistoryMetrics | null): Array<{ label: string; value: string }> {
  if (!metrics) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value?: number) => {
    if (value !== undefined) rows.push({ label, value: formatApr(value) });
  };
  add('Current', metrics.currentApr);
  add('24h avg', metrics.avg24h);
  add('7-day avg', metrics.avg7d);
  add('30-day avg', metrics.avg30d);
  add('90-day avg', metrics.avg90d);
  add('6-month avg', metrics.avg180d);
  add('1-year avg', metrics.avg365d);
  add('7-day high', metrics.high7d);
  add('30-day high', metrics.high30d);
  add('6-month high', metrics.high180d);
  add('1-year high', metrics.high365d);
  add('7-day low', metrics.low7d);
  add('30-day low', metrics.low30d);
  add('6-month low', metrics.low180d);
  add('1-year low', metrics.low365d);
  if (metrics.volatility30d !== undefined) rows.push({ label: '30-day volatility', value: formatApr(metrics.volatility30d) });
  if (metrics.volatility90d !== undefined) rows.push({ label: '90-day volatility', value: formatApr(metrics.volatility90d) });
  return rows;
}
