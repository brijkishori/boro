import { formatUnits, getAddress, type Address } from 'viem';
import { aaveDataProviderAbi, cometAbi, moonwellComptrollerAbi, moonwellTokenAbi } from '@/lib/abi';
import {
  CHAINS,
  COMETS,
  MOONWELL,
  SPARK_DATA_PROVIDER,
  SPARK_POOL,
  findBtcToken,
  isVenueSafe,
  type ChainId,
  type Venue,
} from '@/lib/protocol';
import { publicClient } from '@/lib/rpc';

const RAY = 1e27;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

function rayApr(rate: bigint): number {
  return Number(rate) / RAY;
}

function perSecondApr(rate: bigint): number {
  return (Number(rate) / 1e18) * SECONDS_PER_YEAR;
}

function perTimestampApr(rate: bigint): number {
  return (Number(rate) / 1e18) * SECONDS_PER_YEAR;
}

export async function fetchCompoundVenues(btcPriceUsd: number): Promise<Venue[]> {
  const venues: Venue[] = [];
  for (const chainId of [1, 8453] as ChainId[]) {
    const comet = COMETS[chainId];
    if (!comet) continue;
    const client = publicClient(chainId);
    try {
      const [baseToken, utilization, totalSupply, totalBorrow, minBorrow, numAssets] = await Promise.all([
        client.readContract({ address: comet, abi: cometAbi, functionName: 'baseToken' }),
        client.readContract({ address: comet, abi: cometAbi, functionName: 'getUtilization' }),
        client.readContract({ address: comet, abi: cometAbi, functionName: 'totalSupply' }),
        client.readContract({ address: comet, abi: cometAbi, functionName: 'totalBorrow' }),
        client.readContract({ address: comet, abi: cometAbi, functionName: 'baseBorrowMin' }),
        client.readContract({ address: comet, abi: cometAbi, functionName: 'numAssets' }),
      ]);
      if (getAddress(baseToken) !== CHAINS[chainId].usdc.address) continue;
      const [borrowRate, supplyRate] = await Promise.all([
        client.readContract({ address: comet, abi: cometAbi, functionName: 'getBorrowRate', args: [utilization] }),
        client.readContract({ address: comet, abi: cometAbi, functionName: 'getSupplyRate', args: [utilization] }),
      ]);
      const borrowApr = perSecondApr(borrowRate);
      const supplyApr = perSecondApr(supplyRate);
      const liquidityUsd = Number(formatUnits(totalSupply > totalBorrow ? totalSupply - totalBorrow : 0n, 6));
      const utilizationRatio = totalSupply > 0n ? Number(totalBorrow) / Number(totalSupply) : 0;
      const infos = await Promise.all(
        Array.from({ length: Number(numAssets) }, (_, index) =>
          client.readContract({ address: comet, abi: cometAbi, functionName: 'getAssetInfo', args: [index] }),
        ),
      );
      for (const info of infos) {
        const asset = findBtcToken(chainId, info.asset);
        if (!asset) continue;
        const maxLtv = Number(info.borrowCollateralFactor) / 1e18;
        const venue: Venue = {
          id: `borrow:compound:${chainId}:${asset.address}`,
          protocol: 'compound',
          action: 'borrow',
          chainId,
          assetSymbol: asset.symbol,
          assetKind: asset.kind,
          assetAddress: asset.address,
          assetDecimals: asset.decimals,
          loanSymbol: 'USDC',
          loanAddress: CHAINS[chainId].usdc.address,
          loanDecimals: 6,
          borrowApr,
          supplyApr,
          loanSupplyApr: supplyApr,
          maxLtv,
          liquidityUsd,
          priceUsd: btcPriceUsd,
          utilization: utilizationRatio,
          compound: { comet, minBorrow: minBorrow.toString() },
        };
        if (isVenueSafe(venue)) venues.push(venue);
      }
    } catch {
      // One chain failing should not hide the others.
    }
  }
  return venues;
}

export async function fetchSparkVenues(btcPriceUsd: number): Promise<Venue[]> {
  const chainId = 1 as const;
  const client = publicClient(chainId);
  const usdc = CHAINS[1].usdc.address;
  const venues: Venue[] = [];
  try {
    const usdcConfig = await client.readContract({ address: SPARK_DATA_PROVIDER, abi: aaveDataProviderAbi, functionName: 'getReserveConfigurationData', args: [usdc] });
    const usdcData = await client.readContract({ address: SPARK_DATA_PROVIDER, abi: aaveDataProviderAbi, functionName: 'getReserveData', args: [usdc] });
    const usdcTokens = await client.readContract({ address: SPARK_DATA_PROVIDER, abi: aaveDataProviderAbi, functionName: 'getReserveTokensAddresses', args: [usdc] });
    if (!usdcConfig[6] || usdcConfig[8] !== true || usdcConfig[9] === true) return [];
    const borrowApr = rayApr(usdcData[6]);
    const usdcSupplyApr = rayApr(usdcData[5]);
    const liquidityUsd = Number(formatUnits(usdcData[2] > usdcData[4] ? usdcData[2] - usdcData[4] : 0n, 6));
    for (const token of CHAINS[1].btc) {
      const [config, data, tokens] = await Promise.all([
        client.readContract({ address: SPARK_DATA_PROVIDER, abi: aaveDataProviderAbi, functionName: 'getReserveConfigurationData', args: [token.address] }),
        client.readContract({ address: SPARK_DATA_PROVIDER, abi: aaveDataProviderAbi, functionName: 'getReserveData', args: [token.address] }),
        client.readContract({ address: SPARK_DATA_PROVIDER, abi: aaveDataProviderAbi, functionName: 'getReserveTokensAddresses', args: [token.address] }),
      ]);
      const [decimals, ltvBps, , , , asCollateral, , , active, frozen] = config;
      if (!active || frozen || !asCollateral || ltvBps === 0n || decimals === 0n) continue;
      const maxLtv = Number(ltvBps) / 10_000;
      const aave = { pool: SPARK_POOL, aToken: tokens[0], variableDebtToken: usdcTokens[2] };
      const borrowVenue: Venue = {
        id: `borrow:spark:${chainId}:${token.address}`,
        protocol: 'spark',
        action: 'borrow',
        chainId,
        assetSymbol: token.symbol,
        assetKind: token.kind,
        assetAddress: token.address,
        assetDecimals: token.decimals,
        loanSymbol: 'USDC',
        loanAddress: usdc,
        loanDecimals: 6,
        borrowApr,
        supplyApr: rayApr(data[5]),
        loanSupplyApr: usdcSupplyApr,
        maxLtv,
        liquidityUsd,
        priceUsd: btcPriceUsd,
        aave,
      };
      if (isVenueSafe(borrowVenue)) venues.push(borrowVenue);
      const suppliedUsd = Number(formatUnits(data[2], token.decimals)) * btcPriceUsd;
      const lendVenue: Venue = {
        ...borrowVenue,
        id: `lend:spark:${chainId}:${token.address}`,
        action: 'lend',
        loanSymbol: token.symbol,
        loanAddress: token.address,
        loanDecimals: token.decimals,
        liquidityUsd: Math.max(suppliedUsd, 0),
        aave: { pool: SPARK_POOL, aToken: tokens[0], variableDebtToken: tokens[2] },
      };
      if (isVenueSafe(lendVenue)) venues.push(lendVenue);
    }
  } catch {
    // Spark is optional if the data provider is unreachable.
  }
  return venues;
}

export async function fetchMoonwellVenues(btcPriceUsd: number): Promise<Venue[]> {
  const chainId = MOONWELL.chainId;
  const client = publicClient(chainId);
  const venues: Venue[] = [];
  try {
    const [mUsdcUnderlying, borrowRate, usdcSupplyRate, cash, totalBorrows] = await Promise.all([
      client.readContract({ address: MOONWELL.mUsdc, abi: moonwellTokenAbi, functionName: 'underlying' }),
      client.readContract({ address: MOONWELL.mUsdc, abi: moonwellTokenAbi, functionName: 'borrowRatePerTimestamp' }),
      client.readContract({ address: MOONWELL.mUsdc, abi: moonwellTokenAbi, functionName: 'supplyRatePerTimestamp' }),
      client.readContract({ address: MOONWELL.mUsdc, abi: moonwellTokenAbi, functionName: 'getCash' }),
      client.readContract({ address: MOONWELL.mUsdc, abi: moonwellTokenAbi, functionName: 'totalBorrows' }),
    ]);
    if (getAddress(mUsdcUnderlying) !== CHAINS[chainId].usdc.address) return [];
    const borrowApr = perTimestampApr(borrowRate);
    const usdcSupplyApr = perTimestampApr(usdcSupplyRate);
    const usdcLiquidity = Number(formatUnits(cash, 6));
    for (const [symbol, mCollateral] of Object.entries(MOONWELL.markets)) {
      const token = CHAINS[chainId].btc.find((item) => item.symbol === symbol);
      if (!token) continue;
      const [underlying, listed, mCash, exchangeRate] = await Promise.all([
        client.readContract({ address: mCollateral, abi: moonwellTokenAbi, functionName: 'underlying' }),
        client.readContract({ address: MOONWELL.comptroller, abi: moonwellComptrollerAbi, functionName: 'markets', args: [mCollateral] }),
        client.readContract({ address: mCollateral, abi: moonwellTokenAbi, functionName: 'getCash' }),
        client.readContract({ address: mCollateral, abi: moonwellTokenAbi, functionName: 'exchangeRateStored' }),
      ]);
      if (getAddress(underlying) !== token.address || !listed[0]) continue;
      const maxLtv = Number(listed[1]) / 1e18;
      const moonwell = { comptroller: MOONWELL.comptroller, mCollateral, mLoan: MOONWELL.mUsdc };
      const borrowVenue: Venue = {
        id: `borrow:moonwell:${chainId}:${token.address}`,
        protocol: 'moonwell',
        action: 'borrow',
        chainId,
        assetSymbol: token.symbol,
        assetKind: token.kind,
        assetAddress: token.address,
        assetDecimals: token.decimals,
        loanSymbol: 'USDC',
        loanAddress: CHAINS[chainId].usdc.address,
        loanDecimals: 6,
        borrowApr,
        supplyApr: perTimestampApr(await client.readContract({ address: mCollateral, abi: moonwellTokenAbi, functionName: 'supplyRatePerTimestamp' })),
        loanSupplyApr: usdcSupplyApr,
        maxLtv,
        liquidityUsd: usdcLiquidity,
        priceUsd: btcPriceUsd,
        utilization: cash + totalBorrows > 0n ? Number(totalBorrows) / Number(cash + totalBorrows) : 0,
        moonwell,
      };
      if (isVenueSafe(borrowVenue)) venues.push(borrowVenue);
      const suppliedUsd = Number(formatUnits((mCash * exchangeRate) / 10n ** 18n, token.decimals)) * btcPriceUsd;
      const lendVenue: Venue = {
        ...borrowVenue,
        id: `lend:moonwell:${chainId}:${token.address}`,
        action: 'lend',
        loanSymbol: token.symbol,
        loanAddress: token.address,
        loanDecimals: token.decimals,
        supplyApr: borrowVenue.supplyApr,
        borrowApr: perTimestampApr(await client.readContract({ address: mCollateral, abi: moonwellTokenAbi, functionName: 'borrowRatePerTimestamp' })),
        liquidityUsd: Math.max(suppliedUsd, Number(formatUnits(mCash, token.decimals)) * btcPriceUsd),
      };
      if (isVenueSafe(lendVenue)) venues.push(lendVenue);
    }
  } catch {
    // Moonwell is optional if Base RPC is down.
  }
  return venues;
}
