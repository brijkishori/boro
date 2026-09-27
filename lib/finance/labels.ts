import { DEEP_LIQUIDITY_USD, RECOMMENDED_LIQUIDITY_USD, availableToBorrowUsd, venueConfidence, type Venue } from '@/lib/protocol';
import type { MarketAssessment } from '@/lib/finance/riskAssessment';
import type { BorrowScenario } from '@/lib/finance/persist';
import type { FinancingBenchmark } from '@/lib/finance/benchmark';

export type QualityBadge = {
  label: 'Deep liquidity' | 'Established pool' | 'Limited depth' | 'High utilization';
  level: 'high' | 'standard' | 'caution';
};

export type FitBadge = {
  label: 'Strong fit' | 'Reasonable fit' | 'Higher rate risk' | 'Insufficient liquidity';
  level: 'high' | 'standard' | 'caution';
};

/** Presentation labels only. Uses existing venue fields; does not change scores. */
export function marketQuality(venue: Venue): QualityBadge {
  const available = availableToBorrowUsd(venue);
  const utilization = venue.liquidity?.utilization ?? venue.utilization;
  if (available < RECOMMENDED_LIQUIDITY_USD) return { label: 'Limited depth', level: 'caution' };
  if (utilization !== undefined && utilization > 0.9) return { label: 'High utilization', level: 'caution' };
  if (venueConfidence(venue).level === 'high' && available >= DEEP_LIQUIDITY_USD) {
    return { label: 'Deep liquidity', level: 'high' };
  }
  return { label: 'Established pool', level: 'standard' };
}

export function scenarioFit(
  venue: Venue,
  assessment: MarketAssessment,
  scenario?: BorrowScenario | null,
  benchmark?: FinancingBenchmark | null,
): FitBadge | null {
  if (!scenario) return null;
  const available = availableToBorrowUsd(venue);
  if (scenario.borrowAmount > available * 0.25) return { label: 'Insufficient liquidity', level: 'caution' };
  if (benchmark && venue.borrowApr >= benchmark.annualRate) return { label: 'Higher rate risk', level: 'caution' };
  if ((assessment.overallScore ?? 0) >= 70 && (assessment.cautions.length === 0 || (assessment.liquidityScore ?? 0) >= 70)) {
    return { label: 'Strong fit', level: 'high' };
  }
  return { label: 'Reasonable fit', level: 'standard' };
}

export function amountFieldLabel(
  kind: 'collateral' | 'borrow',
  unit: 'token' | 'usd',
  symbol: string,
  delta = false,
): string {
  if (kind === 'collateral') {
    if (delta) return unit === 'usd' ? 'Additional collateral (USD)' : `Supply additional ${symbol}`;
    return unit === 'usd' ? 'Collateral value (USD)' : `Supply ${symbol}`;
  }
  if (delta) return unit === 'usd' ? 'Additional borrow (USD)' : `Borrow additional ${symbol}`;
  return unit === 'usd' ? 'Borrow value (USD)' : `Borrow ${symbol}`;
}

export function badgeClass(level: 'high' | 'standard' | 'caution'): string {
  if (level === 'high') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
  if (level === 'caution') return 'bg-orange-500/15 text-orange-700 dark:text-orange-400';
  return 'bg-muted text-muted-foreground';
}
