import { DEEP_LIQUIDITY_USD, RECOMMENDED_LIQUIDITY_USD, venueConfidence, type Venue, type VenueAction } from '@/lib/protocol';
import type { FinancingBenchmark } from '@/lib/finance/benchmark';
import { historyCoverage, type RateHistoryMetrics } from '@/lib/finance/history';
import type { BorrowScenario } from '@/lib/finance/persist';

export type MarketAssessment = {
  costScore?: number;
  liquidityScore?: number;
  rateStabilityScore?: number;
  collateralRiskScore?: number;
  operationalScore?: number;
  overallScore?: number;
  reasons: string[];
  cautions: string[];
};

export type AssessmentContext = {
  action: VenueAction;
  peers: Venue[];
  scenario?: BorrowScenario | null;
  benchmark?: FinancingBenchmark | null;
  history?: RateHistoryMetrics | null;
};

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function average(values: Array<number | undefined>): number | undefined {
  const usable = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (usable.length === 0) return undefined;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function costScore(venue: Venue, action: VenueAction, peers: Venue[]): number | undefined {
  const rate = action === 'lend' ? venue.supplyApr : venue.borrowApr;
  const rates = peers.map((item) => (action === 'lend' ? item.supplyApr : item.borrowApr)).filter((item) => Number.isFinite(item));
  if (rates.length === 0) return undefined;
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  if (max === min) return 70;
  const better = action === 'lend' ? (rate - min) / (max - min) : (max - rate) / (max - min);
  return clamp(better * 100);
}

function liquidityScore(venue: Venue, scenario?: BorrowScenario | null): number {
  const available = venue.liquidity?.availableToBorrow ?? venue.liquidityUsd;
  let score = 20;
  if (available >= RECOMMENDED_LIQUIDITY_USD) score = 60;
  if (available >= DEEP_LIQUIDITY_USD) score = 85;
  if (available >= DEEP_LIQUIDITY_USD * 5) score = 95;
  if (scenario && scenario.borrowAmount > 0) {
    const share = scenario.borrowAmount / Math.max(available, 1);
    if (share > 0.25) score -= 40;
    else if (share > 0.05) score -= 15;
  }
  const utilization = venue.liquidity?.utilization ?? venue.utilization;
  if (utilization !== undefined && utilization > 0.9) score -= 20;
  else if (utilization !== undefined && utilization > 0.75) score -= 8;
  return clamp(score);
}

function stabilityScore(history?: RateHistoryMetrics | null): number | undefined {
  const coverage = historyCoverage(history);
  if (coverage === 'insufficient') return undefined;
  const vol = history?.volatility30d ?? history?.volatility90d;
  if (vol === undefined) return undefined;
  let score = 25;
  if (vol <= 0.0025) score = 90;
  else if (vol <= 0.0075) score = 70;
  else if (vol <= 0.015) score = 50;
  if (coverage === 'limited') score = Math.min(score, 50);
  return score;
}

function collateralScore(venue: Venue): number {
  const risk = venue.collateralRisk;
  const threshold = risk?.liquidationThreshold ?? risk?.liquidationLtv ?? venue.maxLtv;
  let score = clamp((threshold - 0.5) / 0.4 * 70 + 20);
  if (venue.protocol === 'morpho') score += 8;
  if (venue.protocol === 'aave' || venue.protocol === 'compound') score += 4;
  return clamp(score);
}

function operationalScore(venue: Venue): number {
  const confidence = venueConfidence(venue);
  if (confidence.level === 'high') return venue.liquidityUsd >= DEEP_LIQUIDITY_USD ? 90 : 75;
  if (confidence.level === 'standard') return 60;
  return 35;
}

export function assessMarket(venue: Venue, context: AssessmentContext): MarketAssessment {
  const cost = costScore(venue, context.action, context.peers);
  const liquidity = liquidityScore(venue, context.scenario);
  const stability = stabilityScore(context.history ?? venue.rateHistory);
  const collateral = collateralScore(venue);
  const operational = operationalScore(venue);
  const overall = average([cost, liquidity, stability, collateral, operational]);
  const reasons: string[] = [];
  const cautions: string[] = [];
  const available = venue.liquidity?.availableToBorrow ?? venue.liquidityUsd;
  const confidence = venueConfidence(venue);
  const rate = context.action === 'lend' ? venue.supplyApr : venue.borrowApr;

  if (available >= DEEP_LIQUIDITY_USD) reasons.push('Deep available liquidity');
  if (cost !== undefined && cost >= 70) {
    reasons.push(context.action === 'lend' ? 'Competitive supply rate versus this set' : 'Competitive current borrow rate versus this set');
  }
  if (stability !== undefined && stability >= 70) reasons.push('Recent rate history is relatively stable');
  if (confidence.level === 'high') reasons.push(confidence.label);
  if (venue.protocol === 'morpho') reasons.push('Isolated market: a loss stays in this market');
  if (context.scenario && context.scenario.borrowAmount > 0 && available > context.scenario.borrowAmount * 20) {
    reasons.push('Intended borrow is small relative to available liquidity');
  }
  if (context.benchmark && Number.isFinite(rate) && rate < context.benchmark.annualRate) {
    reasons.push('Current rate is below the saved benchmark financing APR');
  }

  if (available < RECOMMENDED_LIQUIDITY_USD) cautions.push('Available liquidity is thin; a larger borrow can move the rate');
  if (stability !== undefined && stability < 50) cautions.push('Recent borrow cost has been volatile');
  const coverage = historyCoverage(context.history ?? venue.rateHistory);
  if (coverage === 'insufficient') cautions.push('Insufficient history to judge rate stability');
  else if (coverage === 'limited') cautions.push('Limited history — stability is only a short-window view');
  if (confidence.level === 'cautious') cautions.push(confidence.detail);
  if (context.benchmark && Number.isFinite(rate) && rate >= context.benchmark.annualRate) {
    cautions.push('Current rate is at or above the saved benchmark financing APR');
  }
  if (reasons.length === 0) reasons.push(confidence.detail);

  return {
    costScore: cost,
    liquidityScore: liquidity,
    rateStabilityScore: stability,
    collateralRiskScore: collateral,
    operationalScore: operational,
    overallScore: overall,
    reasons,
    cautions,
  };
}
