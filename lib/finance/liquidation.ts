export function aaveHealthFactor(
  collateralUsd: number,
  debtUsd: number,
  liquidationThreshold: number,
): number | null {
  if (!(debtUsd > 0) || !(liquidationThreshold > 0) || !(collateralUsd > 0)) return null;
  return (collateralUsd * liquidationThreshold) / debtUsd;
}

export function aaveLiquidationPrice(
  collateralAmount: number,
  debtUsd: number,
  liquidationThreshold: number,
): number | null {
  if (!(collateralAmount > 0) || !(debtUsd > 0) || !(liquidationThreshold > 0)) return null;
  return debtUsd / (collateralAmount * liquidationThreshold);
}

/** Morpho liquidates when LTV reaches LLTV. This is not an Aave health factor. */
export function morphoLiquidationPrice(
  collateralAmount: number,
  debtUsd: number,
  liquidationLtv: number,
): number | null {
  if (!(collateralAmount > 0) || !(debtUsd > 0) || !(liquidationLtv > 0)) return null;
  return debtUsd / (collateralAmount * liquidationLtv);
}

export function priceAtHealthFactor(
  collateralAmount: number,
  debtUsd: number,
  liquidationThreshold: number,
  healthFactor: number,
): number | null {
  if (!(collateralAmount > 0) || !(debtUsd > 0) || !(liquidationThreshold > 0) || !(healthFactor > 0)) {
    return null;
  }
  return (healthFactor * debtUsd) / (collateralAmount * liquidationThreshold);
}

export const HEALTH_FACTOR_LEVELS = [3, 2, 1.5, 1.25, 1] as const;
