import { formatUnits } from 'viem';
import { applySafetyBuffer, aaveSafeWithdraw, morphoSafeWithdraw } from '@/lib/risk';
import { aaveHealthFactor } from '@/lib/finance/liquidation';
import type { Venue } from '@/lib/protocol';
import type { PositionSnapshot } from './types';

export function emptyPosition(): PositionSnapshot {
  return { collateral: 0n, debt: 0n, maxBorrow: 0n, borrowRoom: 0n, withdrawMax: 0n, healthFactor: null, ltv: 0, liquidationPrice: 0, ready: false };
}

export function asBigint(value: unknown): bigint {
  return typeof value === 'bigint' ? value : 0n;
}

/** viem returns named structs as objects; wagmi sometimes returns array-like tuples. */
export function fieldAt(value: unknown, index: number, name?: string): bigint {
  if (typeof value === 'bigint') return index === 0 ? value : 0n;
  if (!value || typeof value !== 'object') return 0n;
  const record = value as Record<string | number, unknown>;
  if (name && typeof record[name] === 'bigint') return record[name];
  if (typeof record[index] === 'bigint') return record[index];
  return 0n;
}

export function healthFromUsd(collateralUsd: number, debtUsd: number, liqThreshold: number): number | null {
  return aaveHealthFactor(collateralUsd, debtUsd, liqThreshold);
}

export function liquidationFromTokens(collateralTokens: number, debtUsd: number, maxLtv: number): number {
  if (!(collateralTokens > 0) || !(debtUsd > 0) || !(maxLtv > 0)) return 0;
  return debtUsd / (collateralTokens * maxLtv);
}

export function ltvFromUsd(collateralUsd: number, debtUsd: number): number {
  if (!(collateralUsd > 0)) return 0;
  return debtUsd / collateralUsd;
}

export function aaveLikeSnapshot(venue: Venue, collateral: bigint, account: unknown): PositionSnapshot {
  const debtBase = fieldAt(account, 1, 'totalDebtBase');
  const availableBase = fieldAt(account, 2, 'availableBorrowsBase');
  const ltvBps = fieldAt(account, 4, 'ltv');
  const hfRaw = fieldAt(account, 5, 'healthFactor');
  const collateralBase = fieldAt(account, 0, 'totalCollateralBase');
  const debtUsd = Number(formatUnits(debtBase, 8));
  const collateralTokens = Number(formatUnits(collateral, venue.assetDecimals));
  const maxBorrow = applySafetyBuffer(availableBase / 100n);
  const healthFactor = hfRaw > 0n && debtBase > 0n ? Number(hfRaw / 10n ** 14n) / 10_000 : null;
  return {
    collateral,
    debt: debtBase > 0n ? debtBase / 100n : 0n,
    maxBorrow,
    borrowRoom: maxBorrow,
    withdrawMax: aaveSafeWithdraw(collateral, venue.assetDecimals, venue.priceUsd, collateralBase, debtBase, ltvBps),
    healthFactor,
    ltv: ltvFromUsd(Number(formatUnits(collateralBase, 8)), debtUsd),
    liquidationPrice: liquidationFromTokens(collateralTokens, debtUsd, venue.maxLtv),
    ready: true,
  };
}

export function morphoWithdrawMax(collateral: bigint, debt: bigint, oracle: bigint, lltv: bigint): bigint {
  return morphoSafeWithdraw(collateral, debt, oracle, lltv);
}
