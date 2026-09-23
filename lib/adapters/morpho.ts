import { maxUint256, type Address } from 'viem';
import { aavePoolAbi, erc20Abi, morphoAbi, oracleAbi } from '@/lib/abi';
import { MORPHO_BLUE, morphoParams, type Venue } from '@/lib/protocol';
import { applySafetyBuffer, morphoCollateralToLoan, morphoDebtAssets, morphoMaxBorrowAssets } from '@/lib/risk';
import { aaveLikeSnapshot, asBigint, emptyPosition, liquidationFromTokens, ltvFromUsd, morphoWithdrawMax } from './position';
import type { ProtocolAdapter, WriteCall } from './types';
import { formatUnits } from 'viem';

export const morphoAdapter: ProtocolAdapter = {
  positionReads(venue, user) {
    const market = venue.morpho;
    if (!market) return [];
    return [
      { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'position', args: [market.marketId, user], chainId: venue.chainId },
      { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'market', args: [market.marketId], chainId: venue.chainId },
      { address: market.oracle, abi: oracleAbi, functionName: 'price', chainId: venue.chainId },
    ];
  },
  parsePosition(venue, results) {
    const market = venue.morpho;
    if (!market) return emptyPosition();
    const position = results[0] as readonly [bigint, bigint, bigint] | undefined;
    const totals = results[1] as readonly bigint[] | undefined;
    const oracle = asBigint(results[2]);
    const collateral = position?.[2] ?? 0n;
    const shares = position?.[1] ?? 0n;
    const debt = morphoDebtAssets(shares, totals?.[2] ?? 0n, totals?.[3] ?? 0n);
    const maxBorrow = applySafetyBuffer(morphoMaxBorrowAssets(collateral, oracle, BigInt(market.lltv)));
    const borrowRoom = maxBorrow > debt ? maxBorrow - debt : 0n;
    const collateralUsd = Number(formatUnits(morphoCollateralToLoan(collateral, oracle), venue.loanDecimals));
    const debtUsd = Number(formatUnits(debt, venue.loanDecimals));
    return {
      collateral,
      debt,
      maxBorrow,
      borrowRoom,
      withdrawMax: morphoWithdrawMax(collateral, debt, oracle, BigInt(market.lltv)),
      healthFactor: debtUsd > 0 && venue.maxLtv > 0 ? (collateralUsd * venue.maxLtv) / debtUsd : null,
      ltv: ltvFromUsd(collateralUsd, debtUsd),
      liquidationPrice: liquidationFromTokens(Number(formatUnits(collateral, venue.assetDecimals)), debtUsd, venue.maxLtv),
      ready: oracle > 0n || collateral === 0n,
      extra: { shares },
    };
  },
  buildSupply(venue, user, amount, action) {
    const params = morphoParams(venue);
    if (!params) return null;
    if (action === 'borrow') {
      return { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'supplyCollateral', args: [params, amount, user, '0x'], chainId: venue.chainId };
    }
    return { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'supply', args: [params, amount, 0n, user, '0x'], chainId: venue.chainId };
  },
  buildBorrow(venue, user, amount) {
    const params = morphoParams(venue);
    if (!params) return null;
    return { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'borrow', args: [params, amount, 0n, user, user], chainId: venue.chainId };
  },
  buildRepay(venue, user, amount, full, extra) {
    const params = morphoParams(venue);
    if (!params) return null;
    return { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'repay', args: [params, full ? 0n : amount, full ? (extra?.shares ?? 0n) : 0n, user, '0x'], chainId: venue.chainId };
  },
  buildWithdraw(venue, user, amount, action, extra) {
    const params = morphoParams(venue);
    if (!params) return null;
    if (action === 'borrow') {
      return { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'withdrawCollateral', args: [params, amount, user, user], chainId: venue.chainId };
    }
    const shares = extra?.shares ?? 0n;
    const assets = amount > 0n ? amount : 0n;
    return { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'withdraw', args: [params, assets, assets === 0n ? shares : 0n, user, user], chainId: venue.chainId };
  },
};

export const aaveLikeAdapter: ProtocolAdapter = {
  positionReads(venue, user) {
    const aave = venue.aave;
    if (!aave) return [];
    return [
      { address: aave.aToken, abi: erc20Abi, functionName: 'balanceOf', args: [user], chainId: venue.chainId },
      { address: aave.pool, abi: aavePoolAbi, functionName: 'getUserAccountData', args: [user], chainId: venue.chainId },
      { address: aave.variableDebtToken, abi: erc20Abi, functionName: 'balanceOf', args: [user], chainId: venue.chainId },
    ];
  },
  parsePosition(venue, results) {
    const collateral = asBigint(results[0]);
    const account = results[1] as readonly bigint[] | undefined;
    const variableDebt = asBigint(results[2]);
    const snapshot = aaveLikeSnapshot(venue, collateral, account);
    // Aave/Spark USDC debt is account-wide. Only this aToken is this venue's collateral.
    if (collateral === 0n) {
      snapshot.debt = 0n;
      snapshot.healthFactor = null;
      snapshot.liquidationPrice = 0;
      snapshot.ltv = 0;
      return snapshot;
    }
    if (variableDebt > 0n) snapshot.debt = variableDebt;
    return snapshot;
  },
  buildSupply(venue, user, amount) {
    const pool = venue.aave?.pool;
    if (!pool) return null;
    return { address: pool, abi: aavePoolAbi, functionName: 'supply', args: [venue.assetAddress, amount, user, 0], chainId: venue.chainId };
  },
  buildBorrow(venue, user, amount) {
    const pool = venue.aave?.pool;
    if (!pool) return null;
    return { address: pool, abi: aavePoolAbi, functionName: 'borrow', args: [venue.loanAddress, amount, 2n, 0, user], chainId: venue.chainId };
  },
  buildRepay(venue, user, amount, full) {
    const pool = venue.aave?.pool;
    if (!pool) return null;
    return { address: pool, abi: aavePoolAbi, functionName: 'repay', args: [venue.loanAddress, full ? maxUint256 : amount, 2n, user], chainId: venue.chainId };
  },
  buildWithdraw(venue, user, amount) {
    const pool = venue.aave?.pool;
    if (!pool) return null;
    return { address: pool, abi: aavePoolAbi, functionName: 'withdraw', args: [venue.assetAddress, amount, user], chainId: venue.chainId };
  },
};

export function isolateCall(venue: Venue): WriteCall | null {
  const pool = venue.aave?.pool;
  if (!pool) return null;
  return { address: pool, abi: aavePoolAbi, functionName: 'setUserUseReserveAsCollateral', args: [venue.assetAddress, false], chainId: venue.chainId };
}
