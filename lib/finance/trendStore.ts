import { appendTrendSample, type TrendSample } from '@/lib/finance/earlyWarning';

export const TREND_STORAGE_KEY = 'boro:risk-trend:v1';

type TrendMap = Record<string, TrendSample[]>;

function readMap(storage: { getItem(key: string): string | null }): TrendMap {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TREND_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as TrendMap;
  } catch {
    return {};
  }
}

export function readTrendSamples(storage: { getItem(key: string): string | null }, id: string): TrendSample[] {
  const rows = readMap(storage)[id];
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.t === 'number') : [];
}

export function sameTrendSamples(left: TrendSample[], right: TrendSample[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((sample, index) => sample.t === right[index]?.t);
}

export function writeTrendSample(
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
  id: string,
  sample: TrendSample,
  now = sample.t,
) {
  const map = readMap(storage);
  const next = appendTrendSample(map[id] ?? [], sample, now);
  if (next === (map[id] ?? [])) return next;
  map[id] = next;
  storage.setItem(TREND_STORAGE_KEY, JSON.stringify(map));
  return next;
}

export function serverTrendKey(wallet: string, marketId: string) {
  return `risk-trend:${wallet.toLowerCase()}:${marketId}`;
}
