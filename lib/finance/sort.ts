import { assessMarket } from '@/lib/finance/riskAssessment';
import { scenarioFit } from '@/lib/finance/labels';
import { historyCoverage } from '@/lib/finance/history';
import type { FinancingBenchmark } from '@/lib/finance/benchmark';
import type { BorrowScenario } from '@/lib/finance/persist';
import { availableToBorrowUsd, dedupeVenues, recommendVenue, type Venue, type VenueAction } from '@/lib/protocol';

export type MarketSort = 'best-fit' | 'lowest-rate' | 'deepest-liquidity' | 'most-stable';

export const MARKET_SORTS: Array<{ id: MarketSort; label: string }> = [
  { id: 'best-fit', label: 'Best fit' },
  { id: 'lowest-rate', label: 'Lowest current rate' },
  { id: 'deepest-liquidity', label: 'Deepest liquidity' },
  { id: 'most-stable', label: 'Most stable rate' },
];

function fitRank(label: ReturnType<typeof scenarioFit>): number {
  if (!label) return 0;
  if (label.label === 'Strong fit') return 4;
  if (label.label === 'Reasonable fit') return 3;
  if (label.label === 'Higher rate risk') return 2;
  return 1;
}

function coverageRank(venue: Venue): number {
  const coverage = historyCoverage(venue.rateHistory);
  if (coverage === 'adequate') return 0;
  if (coverage === 'limited') return 1;
  return 2;
}

function stabilityValue(venue: Venue): number {
  const vol = venue.rateHistory?.volatility30d ?? venue.rateHistory?.volatility90d;
  return vol === undefined ? Number.POSITIVE_INFINITY : vol;
}

export function sortVenuesByMode(
  venues: Venue[],
  action: VenueAction,
  mode: MarketSort,
  context?: { scenario?: BorrowScenario | null; benchmark?: FinancingBenchmark | null },
): Venue[] {
  const copy = dedupeVenues(venues, action);
  if (mode === 'lowest-rate') {
    copy.sort((left, right) => (action === 'lend' ? right.supplyApr - left.supplyApr : left.borrowApr - right.borrowApr));
    return copy;
  }
  if (mode === 'deepest-liquidity') {
    copy.sort((left, right) => availableToBorrowUsd(right) - availableToBorrowUsd(left));
    return copy;
  }
  if (mode === 'most-stable') {
    copy.sort((left, right) => (
      coverageRank(left) - coverageRank(right)
      || stabilityValue(left) - stabilityValue(right)
      || left.borrowApr - right.borrowApr
    ));
    return copy;
  }

  const suggested = recommendVenue(copy, action);
  return copy.sort((left, right) => {
    if (suggested) {
      if (left.id === suggested.id) return -1;
      if (right.id === suggested.id) return 1;
    }
    const leftView = assessMarket(left, { action, peers: copy, scenario: context?.scenario, benchmark: context?.benchmark });
    const rightView = assessMarket(right, { action, peers: copy, scenario: context?.scenario, benchmark: context?.benchmark });
    const fitDelta = fitRank(scenarioFit(right, rightView, context?.scenario, context?.benchmark))
      - fitRank(scenarioFit(left, leftView, context?.scenario, context?.benchmark));
    if (fitDelta !== 0) return fitDelta;
    const scoreDelta = (rightView.overallScore ?? 0) - (leftView.overallScore ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return action === 'lend' ? right.supplyApr - left.supplyApr : left.borrowApr - right.borrowApr;
  });
}
