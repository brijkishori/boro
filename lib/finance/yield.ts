import { apyFromApr, type RateSourceType } from '@/lib/finance/rates';
import { isAprDecimal } from '@/lib/finance/carry';
import type { Venue } from '@/lib/protocol';

export const RATE_STALE_MS = 3 * 60_000;
export const YIELD_DISAGREE_BPS = 100;

export type YieldQuote = {
  baseSupplyApr?: number;
  baseSupplyApy?: number;
  rewardApy?: number;
  totalDisplayedApy?: number;
  rewardTokens?: string[];
  source?: string;
  fetchedAt?: number;
  isStale: boolean;
};

export type DisplayedRate = {
  value: number;
  rateType: RateSourceType;
  base?: number;
  incentive?: number;
  source?: string;
  fetchedAt?: number;
  isStale: boolean;
};

export function isRateStale(fetchedAt?: number, now = Date.now(), maxAgeMs = RATE_STALE_MS): boolean {
  if (!fetchedAt || fetchedAt <= 0) return true;
  return now - fetchedAt > maxAgeMs;
}

export function finitePositiveRate(value: number | undefined): number | undefined {
  if (value === undefined || !isAprDecimal(value) || value === 0) return undefined;
  return value;
}

/** Base USDC supply APR only. Rewards are never folded in. Missing is undefined, not zero. */
export function usdcBaseSupplyApr(venue: Venue): number | undefined {
  if (typeof venue.loanSupplyApr === 'number') return finitePositiveRate(venue.loanSupplyApr);
  if (venue.protocol === 'morpho' || venue.protocol === 'compound') return finitePositiveRate(venue.supplyApr);
  return undefined;
}

export function venueYield(venue: Venue, now = Date.now()): YieldQuote {
  const fetchedAt = venue.freshness?.fetchedAt;
  const baseSupplyApr = finitePositiveRate(venue.supplyRate?.apr ?? venue.supplyApr);
  const baseSupplyApy = venue.supplyRate?.apy !== undefined
    ? finitePositiveRate(venue.supplyRate.apy)
    : baseSupplyApr !== undefined
      ? apyFromApr(baseSupplyApr)
      : undefined;
  const rewardApy = finitePositiveRate(venue.rewardApr);
  return {
    baseSupplyApr,
    baseSupplyApy: Number.isFinite(baseSupplyApy) ? baseSupplyApy : undefined,
    rewardApy,
    totalDisplayedApy: undefined,
    rewardTokens: venue.rewardTokens,
    source: venue.freshness?.source,
    fetchedAt,
    isStale: isRateStale(fetchedAt, now),
  };
}

export function venueBorrowDisplay(venue: Venue, now = Date.now()): DisplayedRate | null {
  const value = finitePositiveRate(venue.borrowRate?.apr ?? venue.borrowApr);
  if (value === undefined) return null;
  return {
    value,
    rateType: 'APR',
    base: value,
    incentive: undefined,
    source: venue.freshness?.source,
    fetchedAt: venue.freshness?.fetchedAt,
    isStale: isRateStale(venue.freshness?.fetchedAt, now),
  };
}

export function comparableLendApr(quote: YieldQuote): number | undefined {
  if (quote.isStale) return undefined;
  return quote.baseSupplyApr;
}

export function materialYieldDisagreement(left?: number, right?: number, bps = YIELD_DISAGREE_BPS): boolean {
  if (left === undefined || right === undefined) return false;
  return Math.abs(left - right) * 10_000 >= bps;
}

export function usdcYieldDisagreement(venues: Venue[], protocol: Venue['protocol'], chainId: Venue['chainId']): boolean {
  const rates = venues
    .filter((venue) => venue.protocol === protocol && venue.chainId === chainId)
    .map((venue) => usdcBaseSupplyApr(venue))
    .filter((rate): rate is number => rate !== undefined);
  if (rates.length < 2) return false;
  return materialYieldDisagreement(Math.min(...rates), Math.max(...rates));
}

export const YIELD_VERIFY_BPS = 300;

export function chainMedianUsdcSupplyApr(venues: Venue[], chainId: Venue['chainId'], excludeProtocol?: Venue['protocol']): number | undefined {
  const rates = venues
    .filter((venue) => venue.chainId === chainId && (excludeProtocol === undefined || venue.protocol !== excludeProtocol))
    .map((venue) => usdcBaseSupplyApr(venue))
    .filter((rate): rate is number => rate !== undefined)
    .sort((left, right) => left - right);
  if (rates.length === 0) return undefined;
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 0 ? ((rates[mid - 1] ?? 0) + (rates[mid] ?? 0)) / 2 : rates[mid];
}

/** Generic: a yield that is far from other sources on the same chain needs verification. */
export function yieldNeedsVerification(venues: Venue[], candidate: Venue, bps = YIELD_VERIFY_BPS): boolean {
  const own = usdcBaseSupplyApr(candidate);
  if (own === undefined) return false;
  if (isRateStale(candidate.freshness?.fetchedAt)) return true;
  const median = chainMedianUsdcSupplyApr(venues, candidate.chainId);
  if (median === undefined) return usdcYieldDisagreement(venues, candidate.protocol, candidate.chainId);
  return materialYieldDisagreement(own, median, bps);
}
