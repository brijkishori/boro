import { formatUnits } from 'viem';
import { liveSplit, type LoanEpisode } from '@/lib/audit';
import type { ChainId, ProtocolId } from '@/lib/protocol';
import { distanceToLiquidation } from '@/lib/finance/ltv';
import { aprChangeVisual, aprMovement, type AprChangeVisual, type AprMovement } from '@/lib/finance/openingApr';
import { classifyPositionRisk, currentRiskDecision, positionIsFresh, resolveRiskThresholds, type CurrentRiskDecision, type RiskSeverity } from '@/lib/finance/riskMonitor';

export const METRIC_HINTS = {
  healthFactor: 'Higher is safer. HF 1.0 is the liquidation boundary.',
  liquidationDecline: 'Approximate collateral-price decline from the current oracle before the protocol liquidation boundary, assuming debt and collateral remain unchanged.',
  liquidationPrice: "Approximate collateral price where this position reaches the protocol's liquidation threshold.",
  ltv: 'Debt divided by collateral value.',
  openingPrincipal: 'Principal when this continuous debt lifecycle first opened.',
  borrowedAfterOpening: 'Additional principal borrowed later while the loan remained open. It is historical borrowing, not remaining borrow capacity.',
  currentPrincipal: 'Opening principal plus later borrowing, minus principal repayments.',
} as const;

export type LoanRateStatus = {
  currentApr: number | null;
  openingApr: number | null;
  deltaApr: number | null;
  deltaBps: number | null;
  direction: AprChangeVisual['direction'];
  icon: AprChangeVisual['icon'];
  statusText: string;
  semanticState: AprChangeVisual['semanticState'];
  compactText: string;
  benchmarkApr: number | null;
  benchmarkDeltaBps: number | null;
  lifecycleId: string | null;
  fresh: boolean;
  movement: AprMovement;
};

export type ActiveLoanView = {
  id: string;
  lifecycleId: string | null;
  protocol: ProtocolId;
  chainId: ChainId;
  assetSymbol: string;
  loanSymbol: string;
  assetDecimals: number;
  loanDecimals: number;
  collateralAmount: number;
  collateralUsd: number;
  totalDebtUsd: number;
  principalUsd: number | null;
  accruedUnpaidUsd: number | null;
  ltv: number;
  healthFactor: number | null;
  liquidationPriceUsd: number;
  liquidationCushion: number | null;
  rate: LoanRateStatus;
  riskState: RiskSeverity;
  fresh: boolean;
  decision?: CurrentRiskDecision;
};

export function buildLoanRateStatus(input: {
  currentApr: number | null;
  openingApr: number | null;
  benchmarkApr?: number | null;
  debtUsd?: number;
  lifecycleId?: string | null;
  fresh?: boolean;
}): LoanRateStatus {
  const movement = aprMovement(input.openingApr, input.currentApr, input.debtUsd ?? 0);
  const visual = aprChangeVisual(movement);
  const benchmark = input.benchmarkApr;
  const benchmarkDeltaBps = movement.currentApr !== null
    && typeof benchmark === 'number'
    && Number.isFinite(benchmark)
    ? (movement.currentApr - benchmark) * 10_000
    : null;
  return {
    currentApr: movement.currentApr,
    openingApr: movement.openingApr,
    deltaApr: movement.changeApr,
    deltaBps: movement.changeBps,
    direction: visual.direction,
    icon: visual.icon,
    statusText: visual.statusText,
    semanticState: visual.semanticState,
    compactText: visual.compactText,
    benchmarkApr: typeof benchmark === 'number' && Number.isFinite(benchmark) ? benchmark : null,
    benchmarkDeltaBps,
    lifecycleId: input.lifecycleId ?? null,
    fresh: input.fresh ?? true,
    movement,
  };
}

export function portfolioSummaryLabels(openDebtCount: number) {
  if (openDebtCount === 1) {
    return {
      collateral: 'Collateral',
      debt: 'Total debt',
      apr: 'Current APR',
      health: 'Health Factor',
      ltv: 'LTV',
      liquidation: 'Liquidation BTC',
      cushion: 'BTC decline to liquidation',
      monthly: 'Estimated monthly interest',
      accrued: 'Accrued unpaid interest',
    };
  }
  return {
    collateral: 'Total collateral',
    debt: 'Total debt',
    apr: 'Weighted current APR',
    health: 'Lowest Health Factor',
    ltv: 'Highest LTV',
    liquidation: 'Closest liquidation BTC',
    cushion: 'Smallest liquidation cushion',
    monthly: 'Estimated monthly interest',
    accrued: 'Accrued unpaid interest',
  };
}

function units(value: bigint | null, decimals: number): number | null {
  if (value === null) return null;
  return Number(formatUnits(value, decimals));
}

export function buildActiveLoanView(input: {
  id: string;
  lifecycleId: string | null;
  protocol: ProtocolId;
  chainId: ChainId;
  assetSymbol: string;
  loanSymbol: string;
  assetDecimals: number;
  loanDecimals: number;
  collateral: bigint;
  debt: bigint;
  priceUsd: number;
  ltv: number;
  healthFactor: number | null;
  liquidationPrice: number;
  currentApr: number | null;
  openingApr: number | null;
  benchmarkApr?: number | null;
  episode?: LoanEpisode | null;
  fetchedAt?: number | null;
  positionReadFailed?: boolean;
  liquidationThreshold?: number;
}): ActiveLoanView {
  const collateralAmount = Number(formatUnits(input.collateral, input.assetDecimals));
  const totalDebtUsd = Number(formatUnits(input.debt, input.loanDecimals));
  const collateralUsd = collateralAmount > 0 && input.priceUsd > 0 ? collateralAmount * input.priceUsd : 0;
  const split = liveSplit(input.episode, input.debt);
  const principalUsd = split.tracked ? units(split.principalRemaining, input.loanDecimals) : null;
  const accruedUnpaidUsd = split.tracked ? units(split.interestRemaining, input.loanDecimals) : null;
  const fresh = positionIsFresh({
    fetchedAt: input.fetchedAt,
    oraclePrice: input.priceUsd,
    positionReadFailed: input.positionReadFailed,
  });
  const rate = buildLoanRateStatus({
    currentApr: input.currentApr,
    openingApr: input.openingApr,
    benchmarkApr: input.benchmarkApr,
    debtUsd: totalDebtUsd,
    lifecycleId: input.lifecycleId,
    fresh,
  });
  const thresholds = resolveRiskThresholds({});
  const liquidationThreshold = input.liquidationThreshold ?? (
    totalDebtUsd > 0 && collateralAmount > 0 && input.liquidationPrice > 0
      ? totalDebtUsd / (collateralAmount * input.liquidationPrice)
      : 0
  );
  const decision = currentRiskDecision({
    healthFactor: input.healthFactor,
    debt: totalDebtUsd,
    collateralAmount,
    oraclePrice: input.priceUsd > 0 ? input.priceUsd : null,
    liquidationThreshold,
    thresholds,
    safetyFresh: fresh,
  });
  return {
    id: input.id,
    lifecycleId: input.lifecycleId,
    protocol: input.protocol,
    chainId: input.chainId,
    assetSymbol: input.assetSymbol,
    loanSymbol: input.loanSymbol,
    assetDecimals: input.assetDecimals,
    loanDecimals: input.loanDecimals,
    collateralAmount,
    collateralUsd,
    totalDebtUsd,
    principalUsd,
    accruedUnpaidUsd,
    ltv: input.ltv,
    healthFactor: input.healthFactor,
    liquidationPriceUsd: input.liquidationPrice,
    liquidationCushion: distanceToLiquidation(input.priceUsd, input.liquidationPrice),
    rate,
    riskState: decision.currentState,
    fresh,
    decision,
  };
}
