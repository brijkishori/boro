import { collateralUsdValue, distanceToLiquidation, loanToValue } from '@/lib/finance/ltv';
import { healthFromUsd } from '@/lib/adapters/position';
import {
  HEALTH_FACTOR_LEVELS,
  aaveHealthFactor,
  aaveLiquidationPrice,
  morphoLiquidationPrice,
  priceAtHealthFactor,
} from '@/lib/finance/liquidation';
import type { CollateralRiskParameters, Venue } from '@/lib/protocol';

export type LiveRiskParameters = {
  maxLtv?: number;
  liquidationThreshold?: number;
  liquidationLtv?: number;
};

export type PositionView = {
  collateralAmount: number;
  collateralUsd: number | null;
  debtUsd: number;
  ltv: number | null;
  healthFactor: number | null;
  healthFactorKind: HealthFactorKind | null;
  liquidationPrice: number | null;
  distanceToLiquidation: number | null;
};

export type TransactionProjection = {
  current: PositionView;
  projected: PositionView;
};

export type TokenShortfall = {
  required: number;
  available: number;
  shortfall: number;
};

function usesNativeHealthFactor(protocol: Venue['protocol']): boolean {
  return protocol === 'aave' || protocol === 'spark';
}

function usesAppDerivedHealth(protocol: Venue['protocol']): boolean {
  return protocol === 'compound' || protocol === 'moonwell' || protocol === 'morpho';
}

export type HealthFactorKind = 'native' | 'app-derived';

/** Live on-chain/current parameters only. Proposed governance values are ignored. */
export function liveRiskParameters(
  venue: Pick<Venue, 'collateralRisk' | 'proposedCollateralRisk' | 'maxLtv'>,
): LiveRiskParameters {
  const risk = venue.collateralRisk;
  if (!risk || risk.parameterSource === 'proposed') {
    return { maxLtv: venue.maxLtv };
  }
  const eMode = risk.eMode;
  const useEMode = Boolean(eMode?.available && (eMode.liquidationThreshold || eMode.maxLtv));
  return {
    maxLtv: useEMode && eMode?.maxLtv ? eMode.maxLtv : (risk.maxLtv ?? venue.maxLtv),
    liquidationThreshold: useEMode && eMode?.liquidationThreshold
      ? eMode.liquidationThreshold
      : risk.liquidationThreshold,
    liquidationLtv: risk.liquidationLtv,
  };
}

export function proposedRiskParameters(
  venue: Pick<Venue, 'proposedCollateralRisk'>,
): CollateralRiskParameters | undefined {
  return venue.proposedCollateralRisk;
}

export function assessPosition(
  venue: Pick<Venue, 'protocol' | 'collateralRisk' | 'proposedCollateralRisk' | 'maxLtv'>,
  collateralAmount: number,
  debtUsd: number,
  priceUsd: number,
): PositionView {
  const risk = liveRiskParameters(venue);
  const collateralUsd = collateralAmount > 0 ? collateralUsdValue(collateralAmount, priceUsd) : null;
  const ltv = collateralUsd === null ? null : loanToValue(collateralUsd, debtUsd);
  const threshold = risk.liquidationThreshold;
  const lltv = risk.liquidationLtv;
  const liquidationFactor = threshold ?? lltv ?? risk.maxLtv ?? venue.maxLtv;
  const liquidationPrice = collateralAmount > 0
    ? venue.protocol === 'morpho' && lltv
      ? morphoLiquidationPrice(collateralAmount, debtUsd, lltv)
      : aaveLiquidationPrice(collateralAmount, debtUsd, liquidationFactor)
    : null;
  const native = usesNativeHealthFactor(venue.protocol);
  const derived = usesAppDerivedHealth(venue.protocol);
  const healthInput = native ? threshold : liquidationFactor;
  const healthFactor = native && collateralUsd !== null && threshold
    ? aaveHealthFactor(collateralUsd, debtUsd, threshold)
    : derived && collateralUsd !== null && healthInput
      ? healthFromUsd(collateralUsd, debtUsd, healthInput)
      : null;
  return {
    collateralAmount,
    collateralUsd,
    debtUsd,
    ltv,
    healthFactor,
    healthFactorKind: healthFactor === null ? null : native ? 'native' : 'app-derived',
    liquidationPrice,
    distanceToLiquidation: liquidationPrice === null ? null : distanceToLiquidation(priceUsd, liquidationPrice),
  };
}

export function healthFactorPrices(
  venue: Pick<Venue, 'protocol' | 'collateralRisk' | 'proposedCollateralRisk' | 'maxLtv'>,
  collateralAmount: number,
  debtUsd: number,
): Array<{ healthFactor: number; price: number | null }> {
  const risk = liveRiskParameters(venue);
  if (!usesNativeHealthFactor(venue.protocol) || !(collateralAmount > 0) || !risk.liquidationThreshold) return [];
  return HEALTH_FACTOR_LEVELS.map((level) => ({
    healthFactor: level,
    price: priceAtHealthFactor(collateralAmount, debtUsd, risk.liquidationThreshold!, level),
  }));
}

export function projectAfterTransaction(input: {
  venue: Pick<Venue, 'protocol' | 'collateralRisk' | 'proposedCollateralRisk' | 'maxLtv'>;
  priceUsd: number;
  currentCollateralAmount: number;
  currentDebtUsd: number;
  supplyAmount?: number;
  withdrawAmount?: number;
  borrowUsd?: number;
  repayUsd?: number;
}): TransactionProjection {
  const supply = Math.max(0, input.supplyAmount ?? 0);
  const withdraw = Math.max(0, input.withdrawAmount ?? 0);
  const borrow = Math.max(0, input.borrowUsd ?? 0);
  const repay = Math.max(0, input.repayUsd ?? 0);
  const nextCollateral = Math.max(0, input.currentCollateralAmount + supply - withdraw);
  const nextDebt = Math.max(0, input.currentDebtUsd + borrow - repay);
  return {
    current: assessPosition(input.venue, input.currentCollateralAmount, input.currentDebtUsd, input.priceUsd),
    projected: assessPosition(input.venue, nextCollateral, nextDebt, input.priceUsd),
  };
}

export function tokenShortfall(required: number, available: number): TokenShortfall | null {
  if (!(required > 0) || !Number.isFinite(available)) return null;
  const shortfall = required - Math.max(0, available);
  if (shortfall <= 1e-12) return null;
  return { required, available: Math.max(0, available), shortfall };
}
