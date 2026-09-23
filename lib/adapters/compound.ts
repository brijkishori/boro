import { formatUnits, maxUint256 } from 'viem';
import { cometAbi } from '@/lib/abi';
import { applySafetyBuffer } from '@/lib/risk';
import { asBigint, emptyPosition, healthFromUsd, liquidationFromTokens, ltvFromUsd } from './position';
import type { ProtocolAdapter } from './types';

export const compoundAdapter: ProtocolAdapter = {
  positionReads(venue, user) {
    const comet = venue.compound?.comet;
    if (!comet) return [];
    return [
      { address: comet, abi: cometAbi, functionName: 'collateralBalanceOf', args: [user, venue.assetAddress], chainId: venue.chainId },
      { address: comet, abi: cometAbi, functionName: 'borrowBalanceOf', args: [user], chainId: venue.chainId },
      { address: comet, abi: cometAbi, functionName: 'isBorrowCollateralized', args: [user], chainId: venue.chainId },
    ];
  },
  parsePosition(venue, results) {
    if (!venue.compound) return emptyPosition();
    const collateral = asBigint(results[0]);
    const debt = asBigint(results[1]);
    const collateralUsd = Number(formatUnits(collateral, venue.assetDecimals)) * venue.priceUsd;
    const debtUsd = Number(formatUnits(debt, venue.loanDecimals));
    const maxBorrowUsd = collateralUsd * venue.maxLtv * 0.9;
    const maxBorrow = BigInt(Math.max(0, Math.floor(maxBorrowUsd * 1e6)));
    const borrowRoom = maxBorrow > debt ? maxBorrow - debt : 0n;
    const withdrawUsd = debtUsd > 0 ? Math.max(0, collateralUsd - (debtUsd / (venue.maxLtv * 0.9))) : collateralUsd;
    const withdrawTokens = venue.priceUsd > 0 ? withdrawUsd / venue.priceUsd : 0;
    const withdrawMax = BigInt(Math.max(0, Math.floor(withdrawTokens * 10 ** venue.assetDecimals)));
    return {
      collateral,
      debt,
      maxBorrow: applySafetyBuffer(maxBorrow),
      borrowRoom: applySafetyBuffer(borrowRoom),
      withdrawMax: withdrawMax > collateral ? collateral : withdrawMax,
      healthFactor: healthFromUsd(collateralUsd, debtUsd, venue.maxLtv),
      ltv: ltvFromUsd(collateralUsd, debtUsd),
      liquidationPrice: liquidationFromTokens(Number(formatUnits(collateral, venue.assetDecimals)), debtUsd, venue.maxLtv),
      ready: true,
      extra: { minBorrow: BigInt(venue.compound.minBorrow || '0') },
    };
  },
  buildSupply(venue, _user, amount) {
    const comet = venue.compound?.comet;
    if (!comet) return null;
    return { address: comet, abi: cometAbi, functionName: 'supply', args: [venue.assetAddress, amount], chainId: venue.chainId };
  },
  buildBorrow(venue, _user, amount) {
    const comet = venue.compound?.comet;
    if (!comet) return null;
    return { address: comet, abi: cometAbi, functionName: 'withdraw', args: [venue.loanAddress, amount], chainId: venue.chainId };
  },
  buildRepay(venue, _user, amount, full) {
    const comet = venue.compound?.comet;
    if (!comet) return null;
    return { address: comet, abi: cometAbi, functionName: 'supply', args: [venue.loanAddress, full ? maxUint256 : amount], chainId: venue.chainId };
  },
  buildWithdraw(venue, _user, amount) {
    const comet = venue.compound?.comet;
    if (!comet) return null;
    return { address: comet, abi: cometAbi, functionName: 'withdraw', args: [venue.assetAddress, amount], chainId: venue.chainId };
  },
};
