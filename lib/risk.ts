export const ORACLE_SCALE = 10n ** 36n;
export const WAD = 10n ** 18n;
export const SAFETY_NUMERATOR = 90n;
export const SAFETY_DENOMINATOR = 100n;
const VIRTUAL_AMOUNT = 1_000_000n;

export function applySafetyBuffer(amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  return (amount * SAFETY_NUMERATOR) / SAFETY_DENOMINATOR;
}

export function morphoCollateralToLoan(collateral: bigint, oraclePrice: bigint): bigint {
  if (collateral <= 0n || oraclePrice <= 0n) return 0n;
  return (collateral * oraclePrice) / ORACLE_SCALE;
}

export function morphoMaxBorrowAssets(collateral: bigint, oraclePrice: bigint, lltv: bigint): bigint {
  if (lltv <= 0n) return 0n;
  return (morphoCollateralToLoan(collateral, oraclePrice) * lltv) / WAD;
}

export function morphoDebtAssets(
  borrowShares: bigint,
  totalBorrowAssets: bigint,
  totalBorrowShares: bigint,
): bigint {
  if (borrowShares <= 0n || totalBorrowShares <= 0n) return 0n;
  const numerator = borrowShares * (totalBorrowAssets + VIRTUAL_AMOUNT);
  const denominator = totalBorrowShares + VIRTUAL_AMOUNT;
  return (numerator + denominator - 1n) / denominator;
}

export function morphoSafeWithdraw(collateral: bigint, debt: bigint, oraclePrice: bigint, lltv: bigint): bigint {
  if (collateral <= 0n) return 0n;
  if (debt <= 0n) return collateral;
  if (oraclePrice <= 0n || lltv <= 0n) return 0n;
  const denominator = oraclePrice * lltv * SAFETY_NUMERATOR;
  const required = (debt * ORACLE_SCALE * WAD * SAFETY_DENOMINATOR + denominator - 1n) / denominator;
  return collateral > required ? collateral - required : 0n;
}

export function aaveSafeWithdraw(
  assetBalance: bigint,
  assetDecimals: number,
  priceUsd: number,
  collateralBase: bigint,
  debtBase: bigint,
  ltvBps: bigint,
): bigint {
  if (assetBalance <= 0n) return 0n;
  if (debtBase <= 0n) return assetBalance;
  if (ltvBps <= 0n || !(priceUsd > 0)) return 0n;
  const denominator = ltvBps * SAFETY_NUMERATOR;
  const requiredBase = (debtBase * 10_000n * SAFETY_DENOMINATOR + denominator - 1n) / denominator;
  if (collateralBase <= requiredBase) return 0n;
  const priceBase = BigInt(Math.ceil(priceUsd * 1e8));
  const tokens = ((collateralBase - requiredBase) * 10n ** BigInt(assetDecimals)) / priceBase;
  return tokens < assetBalance ? tokens : assetBalance;
}

export function withRepayBuffer(amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  return (amount * 101n) / 100n;
}
