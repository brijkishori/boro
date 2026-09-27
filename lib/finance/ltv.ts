export function loanToValue(collateralUsd: number, debtUsd: number): number | null {
  if (!(collateralUsd > 0) || !Number.isFinite(debtUsd) || debtUsd < 0) return null;
  return debtUsd / collateralUsd;
}

export function collateralUsdValue(collateralAmount: number, priceUsd: number): number | null {
  if (!(collateralAmount > 0) || !(priceUsd > 0)) return null;
  return collateralAmount * priceUsd;
}

export function distanceToLiquidation(
  currentCollateralPrice: number,
  liquidationPrice: number,
): number | null {
  if (!(currentCollateralPrice > 0) || !(liquidationPrice > 0)) return null;
  return (currentCollateralPrice - liquidationPrice) / currentCollateralPrice;
}
