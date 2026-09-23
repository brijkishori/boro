import { formatUnits, maxUint256 } from 'viem';
import { moonwellComptrollerAbi, moonwellTokenAbi } from '@/lib/abi';
import { applySafetyBuffer } from '@/lib/risk';
import { asBigint, emptyPosition, healthFromUsd, liquidationFromTokens, ltvFromUsd } from './position';
import type { ProtocolAdapter } from './types';

export const moonwellAdapter: ProtocolAdapter = {
  positionReads(venue, user) {
    const market = venue.moonwell;
    if (!market) return [];
    return [
      { address: market.mCollateral, abi: moonwellTokenAbi, functionName: 'balanceOf', args: [user], chainId: venue.chainId },
      { address: market.mCollateral, abi: moonwellTokenAbi, functionName: 'exchangeRateStored', chainId: venue.chainId },
      { address: market.mLoan, abi: moonwellTokenAbi, functionName: 'borrowBalanceStored', args: [user], chainId: venue.chainId },
      { address: market.comptroller, abi: moonwellComptrollerAbi, functionName: 'getAccountLiquidity', args: [user], chainId: venue.chainId },
      { address: market.comptroller, abi: moonwellComptrollerAbi, functionName: 'checkMembership', args: [user, market.mCollateral], chainId: venue.chainId },
    ];
  },
  parsePosition(venue, results) {
    if (!venue.moonwell) return emptyPosition();
    const mTokens = asBigint(results[0]);
    const exchangeRate = asBigint(results[1]);
    const debt = asBigint(results[2]);
    const liquidity = results[3] as readonly [bigint, bigint, bigint] | undefined;
    const entered = results[4] === true;
    const collateral = exchangeRate > 0n ? (mTokens * exchangeRate) / 10n ** 18n : 0n;
    const liquidityUsd = Number(formatUnits(liquidity?.[1] ?? 0n, 18));
    const shortfallUsd = Number(formatUnits(liquidity?.[2] ?? 0n, 18));
    const collateralUsd = Number(formatUnits(collateral, venue.assetDecimals)) * venue.priceUsd;
    const debtUsd = Number(formatUnits(debt, venue.loanDecimals));
    const borrowRoomUsd = Math.max(0, liquidityUsd) * 0.9;
    const borrowRoom = BigInt(Math.floor(borrowRoomUsd * 1e6));
    const withdrawUsd = debtUsd > 0 ? Math.max(0, collateralUsd - (debtUsd / (venue.maxLtv * 0.9))) : collateralUsd;
    const withdrawTokens = venue.priceUsd > 0 ? withdrawUsd / venue.priceUsd : 0;
    const withdrawMax = BigInt(Math.max(0, Math.floor(withdrawTokens * 10 ** venue.assetDecimals)));
    return {
      collateral,
      debt,
      maxBorrow: applySafetyBuffer(borrowRoom),
      borrowRoom: applySafetyBuffer(borrowRoom),
      withdrawMax: withdrawMax > collateral ? collateral : withdrawMax,
      healthFactor: shortfallUsd > 0 ? 0.9 : healthFromUsd(collateralUsd, debtUsd, venue.maxLtv),
      ltv: ltvFromUsd(collateralUsd, debtUsd),
      liquidationPrice: liquidationFromTokens(Number(formatUnits(collateral, venue.assetDecimals)), debtUsd, venue.maxLtv),
      ready: true,
      extra: { enteredMarket: entered },
    };
  },
  buildSupply(venue, _user, amount) {
    const market = venue.moonwell;
    if (!market) return null;
    return { address: market.mCollateral, abi: moonwellTokenAbi, functionName: 'mint', args: [amount], chainId: venue.chainId };
  },
  buildBorrow(venue, _user, amount) {
    const market = venue.moonwell;
    if (!market) return null;
    return { address: market.mLoan, abi: moonwellTokenAbi, functionName: 'borrow', args: [amount], chainId: venue.chainId };
  },
  buildRepay(venue, _user, amount, full) {
    const market = venue.moonwell;
    if (!market) return null;
    return { address: market.mLoan, abi: moonwellTokenAbi, functionName: 'repayBorrow', args: [full ? maxUint256 : amount], chainId: venue.chainId };
  },
  buildWithdraw(venue, _user, amount) {
    const market = venue.moonwell;
    if (!market) return null;
    return { address: market.mCollateral, abi: moonwellTokenAbi, functionName: 'redeemUnderlying', args: [amount], chainId: venue.chainId };
  },
  buildEnterMarket(venue) {
    const market = venue.moonwell;
    if (!market) return null;
    return { address: market.comptroller, abi: moonwellComptrollerAbi, functionName: 'enterMarkets', args: [[market.mCollateral]], chainId: venue.chainId };
  },
};
