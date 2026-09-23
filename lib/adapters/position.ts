import { formatUnits } from 'viem';
import { applySafetyBuffer, aaveSafeWithdraw, morphoSafeWithdraw } from '@/lib/risk';
import type { Venue } from '@/lib/protocol';
import type { PositionSnapshot } from './types';

export function emptyPosition(): PositionSnapshot {
  return { collateral: 0n, debt: 0n, maxBorrow: 0n, borrowRoom: 0n, withdrawMax: 0n, healthFactor: null, ltv: 0, liquidationPrice: 0, ready: false };
}

export function asBigint(value: unknown): bigint {
  return typeof value === 'bigint' ? value : 0n;
}

export function healthFromUsd(collateralUsd: number, debtUsd: number, liqThreshold: number): number | null {
  if (!(debtUsd > 0) || !(liqThreshold > 0)) return null;
  return (collateralUsd * liqThreshold) / debtUsd;
}

export function liquidationFromTokens(collateralTokens: number, debtUsd: number, maxLtv: number): number {
  if (!(collateralTokens > 0) || !(debtUsd > 0) || !(maxLtv > 0)) return 0;
  return debtUsd / (collateralTokens * maxLtv);
}

export function ltvFromUsd(collateralUsd: number, debtUsd: number): number {
  if (!(collateralUsd > 0)) return 0;
  return debtUsd / collateralUsd;
}

export function aaveLikeSnapshot(venue: Venue, collateral: bigint, account: readonly bigint[] | undefined): PositionSnapshot {
  const debtBase = account?.[1] ?? 0n;
  const availableBase = account?.[2] ?? 0n;
  const ltvBps = account?.[4] ?? 0n;
  const hfRaw = account?.[5] ?? 0n;
  const debtUsd = Number(formatUnits(debtBase, 8));
  const collateralTokens = Number(formatUnits(collateral, venue.assetDecimals));
  const maxBorrow = applySafetyBuffer(availableBase / 100n);
  const healthFactor = hfRaw > 0n && debtBase > 0n ? Number(hfRaw / 10n ** 14n) / 10_000 : null;
  return {
    collateral,
    debt: BigInt(Math.max(0, Math.round(debtUsd * 1e6))),
    maxBorrow,
    borrowRoom: maxBorrow,
    withdrawMax: aaveSafeWithdraw(collateral, venue.assetDecimals, venue.priceUsd, account?.[0] ?? 0n, debtBase, ltvBps),
    healthFactor,
    ltv: ltvFromUsd(Number(formatUnits(account?.[0] ?? 0n, 8)), debtUsd),
    liquidationPrice: liquidationFromTokens(collateralTokens, debtUsd, venue.maxLtv),
    ready: true,
  };
}

export function morphoWithdrawMax(collateral: bigint, debt: bigint, oracle: bigint, lltv: bigint): bigint {
  return morphoSafeWithdraw(collateral, debt, oracle, lltv);
}
