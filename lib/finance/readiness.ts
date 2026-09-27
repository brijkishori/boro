import { historyCoverage, historyCoverageLabel } from '@/lib/finance/history';
import { protocolMarketId, type Venue } from '@/lib/protocol';

export const DEFAULT_MATERIAL_USD = 250;
export const MATERIAL_RECENT_MULTIPLE = 5;

export type PreviewSnapshot = {
  borrowApr?: number;
  priceUsd?: number;
  ltv?: number | null;
  liquidationPrice?: number | null;
  liquidityUsd?: number;
  debt?: number;
  collateral?: number;
};

export type LoanReadiness = {
  protocol: Venue['protocol'];
  chainId: Venue['chainId'];
  market: string;
  marketId: string;
  collateralWrapper: string;
  borrowAsset: string;
  collateralAmount: number;
  collateralUsd: number | null;
  borrowAmount: number;
  startingLtv: number | null;
  liquidationBound: number | null;
  liquidationPrice: number | null;
  cushion: number | null;
  healthFactor: number | null;
  healthFactorKind: 'native' | 'app-derived' | null;
  currentApr: number;
  avg7d?: number;
  avg30d?: number;
  historyConfidence: string;
  availableLiquidityUsd: number;
  utilization?: number;
  benchmarkApr?: number;
  spread?: number | null;
  walletCollateral: number;
  repaymentAvailable?: number;
  estimatedFeeUsd?: number;
  fetchedAt?: number;
  acknowledgments: string[];
};

export function isMaterialTransaction(amountUsd: number, recentMaxUsd?: number, floorUsd = DEFAULT_MATERIAL_USD): boolean {
  if (!(amountUsd > 0) || !Number.isFinite(amountUsd)) return false;
  const threshold = recentMaxUsd && recentMaxUsd > 0
    ? recentMaxUsd * MATERIAL_RECENT_MULTIPLE
    : floorUsd;
  return amountUsd >= threshold;
}

const REL_RATE = 0.0005;
const REL_PRICE = 0.0025;
const REL_LTV = 0.0025;
const REL_LIQ = 0.0025;
const REL_LIQ_USD = 0.02;

export function materialPreviewChanged(before: PreviewSnapshot, after: PreviewSnapshot): boolean {
  if (changedRel(before.borrowApr, after.borrowApr, REL_RATE)) return true;
  if (changedRel(before.priceUsd, after.priceUsd, REL_PRICE)) return true;
  if (changedRel(before.ltv ?? undefined, after.ltv ?? undefined, REL_LTV)) return true;
  if (changedRel(before.liquidationPrice ?? undefined, after.liquidationPrice ?? undefined, REL_LIQ)) return true;
  if (changedRel(before.liquidityUsd, after.liquidityUsd, REL_LIQ_USD)) return true;
  if (changedRel(before.debt, after.debt, REL_LTV)) return true;
  if (changedRel(before.collateral, after.collateral, REL_LTV)) return true;
  return false;
}

function changedRel(left?: number, right?: number, rel = 0): boolean {
  if (left === undefined || right === undefined || !Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (left === 0 && right === 0) return false;
  const denom = Math.max(Math.abs(left), Math.abs(right), 1e-12);
  return Math.abs(left - right) / denom >= rel;
}

export const READINESS_ACKNOWLEDGMENTS = [
  'The borrowing rate is variable and can change after confirmation.',
  'BTC collateral can be liquidated if the position becomes undercollateralized.',
  'Wrapped BTC adds wrapper, custody, and bridge risk beyond bitcoin itself.',
  'Smart-contract and protocol risk exists for the selected market.',
  'Quoted values can change between preview and execution because interest and oracles update continuously.',
] as const;

export function buildLoanReadiness(input: {
  venue: Venue;
  collateralAmount: number;
  collateralUsd: number | null;
  borrowAmount: number;
  startingLtv: number | null;
  liquidationBound?: number | null;
  liquidationPrice: number | null;
  cushion: number | null;
  healthFactor: number | null;
  healthFactorKind: 'native' | 'app-derived' | null;
  walletCollateral: number;
  repaymentAvailable?: number;
  estimatedFeeUsd?: number;
  benchmarkApr?: number;
}): LoanReadiness {
  const venue = input.venue;
  const spread = input.benchmarkApr !== undefined ? input.benchmarkApr - venue.borrowApr : null;
  return {
    protocol: venue.protocol,
    chainId: venue.chainId,
    market: `${venue.assetSymbol} / ${venue.loanSymbol}`,
    marketId: protocolMarketId(venue),
    collateralWrapper: venue.assetSymbol,
    borrowAsset: venue.loanSymbol,
    collateralAmount: input.collateralAmount,
    collateralUsd: input.collateralUsd,
    borrowAmount: input.borrowAmount,
    startingLtv: input.startingLtv,
    liquidationBound: input.liquidationBound ?? venue.maxLtv,
    liquidationPrice: input.liquidationPrice,
    cushion: input.cushion,
    healthFactor: input.healthFactor,
    healthFactorKind: input.healthFactorKind,
    currentApr: venue.borrowApr,
    avg7d: venue.rateHistory?.avg7d,
    avg30d: venue.rateHistory?.avg30d,
    historyConfidence: historyCoverageLabel(historyCoverage(venue.rateHistory)),
    availableLiquidityUsd: venue.liquidity?.availableToBorrow ?? venue.liquidityUsd,
    utilization: venue.liquidity?.utilization ?? venue.utilization,
    benchmarkApr: input.benchmarkApr,
    spread,
    walletCollateral: input.walletCollateral,
    repaymentAvailable: input.repaymentAvailable,
    estimatedFeeUsd: input.estimatedFeeUsd,
    fetchedAt: venue.freshness?.fetchedAt,
    acknowledgments: [...READINESS_ACKNOWLEDGMENTS],
  };
}
