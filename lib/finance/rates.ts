/** Per-second compounding, matching Aave / Morpho displayed APY. */
export const RATE_PERIODS_PER_YEAR = 365 * 24 * 60 * 60;

export type RateSourceType = 'APR' | 'APY';

export type BorrowRate = {
  apr: number;
  apy: number;
  sourceRateType: RateSourceType;
  sourceValue: number;
};

export function apyFromApr(apr: number, periods = RATE_PERIODS_PER_YEAR): number {
  if (!Number.isFinite(apr) || apr < 0) return Number.NaN;
  if (apr === 0) return 0;
  return Math.expm1(periods * Math.log1p(apr / periods));
}

export function aprFromApy(apy: number, periods = RATE_PERIODS_PER_YEAR): number {
  if (!Number.isFinite(apy) || apy < 0) return Number.NaN;
  if (apy === 0) return 0;
  return periods * Math.expm1(Math.log1p(apy) / periods);
}

export function normalizeBorrowRate(sourceRateType: RateSourceType, sourceValue: number): BorrowRate | null {
  if (!Number.isFinite(sourceValue) || sourceValue < 0 || sourceValue >= 1) return null;
  const apr = sourceRateType === 'APR' ? sourceValue : aprFromApy(sourceValue);
  const apy = sourceRateType === 'APY' ? sourceValue : apyFromApr(sourceValue);
  if (!Number.isFinite(apr) || !Number.isFinite(apy)) return null;
  return { apr, apy, sourceRateType, sourceValue };
}

export function annualInterest(balance: number, apr: number): number {
  if (!(balance > 0) || !Number.isFinite(apr) || apr < 0) return 0;
  return balance * apr;
}

export function monthlyInterest(balance: number, apr: number): number {
  return annualInterest(balance, apr) / 12;
}
