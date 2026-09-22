import { getAddress, isAddress, type Address, type Hex } from 'viem';
import {
  AAVE_POOLS,
  CHAINS,
  MIN_LIQUIDITY_USD,
  type AaveMarket,
  type ChainId,
  type RatesPayload,
  type Venue,
  findBtcToken,
  isChainId,
  isVenueSafe,
  morphoMarketId,
} from './protocol';

const MORPHO_URL = 'https://api.morpho.org/graphql';
const AAVE_URL = 'https://api.v3.aave.com/graphql';
const FRESH_MS = 30_000;
const STALE_MS = 5 * 60_000;

type CacheEntry = { at: number; payload: RatesPayload };

let cache: CacheEntry | null = null;
let inflight: Promise<RatesPayload> | null = null;

const morphoQuery = `query Markets($where: MarketFilters) {
  markets(first: 100, orderBy: SupplyAssetsUsd, orderDirection: Desc, where: $where) {
    items {
      marketId
      lltv
      irmAddress
      chain { id }
      oracle { address }
      loanAsset { symbol address decimals }
      collateralAsset { symbol address decimals }
      state { borrowApy supplyApy liquidityAssetsUsd }
    }
  }
}`;

const aaveQuery = `query Markets($request: MarketsRequest!) {
  markets(request: $request) {
    name
    address
    chain { chainId }
    reserves {
      underlyingToken { symbol address decimals }
      usdExchangeRate
      isFrozen
      isPaused
      aToken { address }
      vToken { address }
      supplyInfo { apy { value } maxLTV { value } canBeCollateral total { value } }
      borrowInfo { apy { value } availableLiquidity { amount { value } } }
    }
  }
}`;

function asNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function asAddress(value: unknown): Address | null {
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

function btcAddresses(): string[] {
  return [...CHAINS[1].btc, ...CHAINS[8453].btc].map((token) => token.address);
}

function usdcAddresses(): string[] {
  return [CHAINS[1].usdc.address, CHAINS[8453].usdc.address];
}

function readMorphoVenues(payload: unknown, action: 'borrow' | 'lend'): Venue[] {
  const items = (payload as { data?: { markets?: { items?: unknown[] } } })?.data?.markets?.items;
  if (!Array.isArray(items)) return [];
  const venues: Venue[] = [];
  for (const item of items) {
    const row = item as {
      marketId?: unknown;
      lltv?: unknown;
      irmAddress?: unknown;
      chain?: { id?: unknown };
      oracle?: { address?: unknown };
      loanAsset?: { symbol?: unknown; address?: unknown; decimals?: unknown };
      collateralAsset?: { symbol?: unknown; address?: unknown; decimals?: unknown };
      state?: { borrowApy?: unknown; supplyApy?: unknown; liquidityAssetsUsd?: unknown };
    };
    const chainId = asNumber(row.chain?.id);
    if (!chainId || !isChainId(chainId)) continue;
    const loan = asAddress(row.loanAsset?.address);
    const collateral = asAddress(row.collateralAsset?.address);
    const oracle = asAddress(row.oracle?.address);
    const irm = asAddress(row.irmAddress);
    const marketId = typeof row.marketId === 'string' ? row.marketId : '';
    const lltv = typeof row.lltv === 'string' ? row.lltv : '';
    const borrowApr = asNumber(row.state?.borrowApy);
    const supplyApr = asNumber(row.state?.supplyApy);
    const liquidityUsd = asNumber(row.state?.liquidityAssetsUsd);
    if (!loan || !collateral || !oracle || !irm || borrowApr === null || supplyApr === null || liquidityUsd === null) continue;
    if (liquidityUsd < MIN_LIQUIDITY_USD || borrowApr < 0 || borrowApr >= 1 || supplyApr < 0 || supplyApr >= 1) continue;
    if (!/^0x[0-9a-fA-F]{64}$/.test(marketId) || !/^\d+$/.test(lltv)) continue;
    const assetAddress = action === 'borrow' ? collateral : loan;
    const asset = findBtcToken(chainId, assetAddress);
    if (!asset) continue;
    const market = {
      marketId: marketId as Hex,
      loanToken: loan,
      collateralToken: collateral,
      oracle,
      irm,
      lltv,
    };
    if (morphoMarketId(market).toLowerCase() !== market.marketId.toLowerCase()) continue;
    const maxLtv = Number(BigInt(lltv)) / 1e18;
    const usdc = CHAINS[chainId].usdc;
    const venue: Venue = {
      id: `${action}:morpho:${chainId}:${market.marketId}`,
      protocol: 'morpho',
      action,
      chainId,
      assetSymbol: asset.symbol,
      assetKind: asset.kind,
      assetAddress: asset.address,
      assetDecimals: asset.decimals,
      loanSymbol: action === 'borrow' ? 'USDC' : String(row.collateralAsset?.symbol ?? 'Collateral'),
      loanAddress: action === 'borrow' ? usdc.address : collateral,
      loanDecimals: action === 'borrow' ? usdc.decimals : Number(row.collateralAsset?.decimals ?? 18),
      borrowApr: borrowApr ?? 0,
      supplyApr: supplyApr ?? 0,
      maxLtv,
      liquidityUsd,
      priceUsd: 0,
      morpho: market,
    };
    venues.push(venue);
  }
  return venues;
}

type AaveReserve = {
  underlyingToken?: { symbol?: unknown; address?: unknown; decimals?: unknown };
  usdExchangeRate?: unknown;
  isFrozen?: unknown;
  isPaused?: unknown;
  aToken?: { address?: unknown };
  vToken?: { address?: unknown };
  supplyInfo?: { apy?: { value?: unknown }; maxLTV?: { value?: unknown }; canBeCollateral?: unknown; total?: { value?: unknown } };
  borrowInfo?: { apy?: { value?: unknown }; availableLiquidity?: { amount?: { value?: unknown } } };
};

function readAaveVenues(payload: unknown): { venues: Venue[]; prices: number[] } {
  const markets = (payload as { data?: { markets?: unknown[] } })?.data?.markets;
  if (!Array.isArray(markets)) return { venues: [], prices: [] };
  const venues: Venue[] = [];
  const prices: number[] = [];

  for (const market of markets) {
    const row = market as { name?: unknown; address?: unknown; chain?: { chainId?: unknown }; reserves?: unknown[] };
    const chainId = asNumber(row.chain?.chainId);
    const pool = asAddress(row.address);
    if (!chainId || !isChainId(chainId) || !pool || pool !== AAVE_POOLS[chainId]) continue;
    if (row.name !== (chainId === 1 ? 'AaveV3Ethereum' : 'AaveV3Base')) continue;
    const reserves = Array.isArray(row.reserves) ? (row.reserves as AaveReserve[]) : [];
    const usdc = reserves.find((reserve) => {
      const address = asAddress(reserve.underlyingToken?.address);
      return address !== null && address === CHAINS[chainId].usdc.address;
    });
    const usdcBorrowApr = asNumber(usdc?.borrowInfo?.apy?.value);
    const usdcLiquidity = asNumber(usdc?.borrowInfo?.availableLiquidity?.amount?.value);
    const usdcPrice = asNumber(usdc?.usdExchangeRate) ?? 1;
    const usdcLiquidityUsd = usdcLiquidity === null ? 0 : usdcLiquidity * usdcPrice;
    const usdcDebtToken = asAddress(usdc?.vToken?.address);

    for (const reserve of reserves) {
      const address = asAddress(reserve.underlyingToken?.address);
      if (!address) continue;
      const asset = findBtcToken(chainId, address);
      if (!asset) continue;
      const priceUsd = asNumber(reserve.usdExchangeRate);
      if (priceUsd === null) continue;
      prices.push(priceUsd);
      const aToken = asAddress(reserve.aToken?.address);
      const variableDebtToken = asAddress(reserve.vToken?.address);
      if (!aToken || !variableDebtToken) continue;
      const aave: AaveMarket = { pool, aToken, variableDebtToken };
      const paused = reserve.isPaused === true;
      const frozen = reserve.isFrozen === true;
      const supplyApr = asNumber(reserve.supplyInfo?.apy?.value) ?? 0;
      const assetBorrowApr = asNumber(reserve.borrowInfo?.apy?.value) ?? 0;
      const maxLtv = asNumber(reserve.supplyInfo?.maxLTV?.value) ?? 0;
      const supplied = asNumber(reserve.supplyInfo?.total?.value) ?? 0;
      const canBorrowCollateral = reserve.supplyInfo?.canBeCollateral === true && !paused && !frozen && maxLtv > 0;

      if (canBorrowCollateral && usdc && usdcDebtToken && usdcBorrowApr !== null && usdcLiquidityUsd >= MIN_LIQUIDITY_USD) {
        const venue: Venue = {
          id: `borrow:aave:${chainId}:${asset.address}`,
          protocol: 'aave',
          action: 'borrow',
          chainId,
          assetSymbol: asset.symbol,
          assetKind: asset.kind,
          assetAddress: asset.address,
          assetDecimals: asset.decimals,
          loanSymbol: 'USDC',
          loanAddress: CHAINS[chainId].usdc.address,
          loanDecimals: CHAINS[chainId].usdc.decimals,
          borrowApr: usdcBorrowApr,
          supplyApr,
          maxLtv,
          liquidityUsd: usdcLiquidityUsd,
          priceUsd,
          aave: { ...aave, variableDebtToken: usdcDebtToken },
        };
        if (isVenueSafe(venue)) venues.push(venue);
      }

      const available = asNumber(reserve.borrowInfo?.availableLiquidity?.amount?.value) ?? 0;
      const lendLiquidity = Math.max(supplied * priceUsd, available * priceUsd);
      if (!paused && !frozen && lendLiquidity >= MIN_LIQUIDITY_USD) {
        const venue: Venue = {
          id: `lend:aave:${chainId}:${asset.address}`,
          protocol: 'aave',
          action: 'lend',
          chainId,
          assetSymbol: asset.symbol,
          assetKind: asset.kind,
          assetAddress: asset.address,
          assetDecimals: asset.decimals,
          loanSymbol: asset.symbol,
          loanAddress: asset.address,
          loanDecimals: asset.decimals,
          borrowApr: assetBorrowApr,
          supplyApr,
          maxLtv,
          liquidityUsd: lendLiquidity,
          priceUsd,
          aave,
        };
        if (isVenueSafe(venue)) venues.push(venue);
      }
    }
  }
  return { venues, prices };
}

function applyPrice(venues: Venue[], btcPriceUsd: number): Venue[] {
  return venues
    .map((venue) => ({ ...venue, priceUsd: venue.priceUsd > 0 ? venue.priceUsd : btcPriceUsd }))
    .filter((venue) => isVenueSafe(venue));
}

async function fetchBtcSpot(): Promise<number> {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { signal: AbortSignal.timeout(8_000), cache: 'no-store' },
    );
    if (!response.ok) return 0;
    const body = (await response.json()) as { bitcoin?: { usd?: unknown } };
    return asNumber(body.bitcoin?.usd) ?? 0;
  } catch {
    return 0;
  }
}

async function loadRates(): Promise<RatesPayload> {
  const warnings: string[] = [];
  const borrowWhere = {
    chainId_in: [1, 8453],
    collateralAssetAddress_in: btcAddresses(),
    loanAssetAddress_in: usdcAddresses(),
  };
  const lendWhere = {
    chainId_in: [1, 8453],
    loanAssetAddress_in: btcAddresses(),
    collateralAssetAddress_in: [...CHAINS[1].lendCollateral, ...CHAINS[8453].lendCollateral],
  };

  const [morphoBorrow, morphoLend, aave] = await Promise.allSettled([
    postJson(MORPHO_URL, { query: morphoQuery, variables: { where: borrowWhere } }),
    postJson(MORPHO_URL, { query: morphoQuery, variables: { where: lendWhere } }),
    postJson(AAVE_URL, { query: aaveQuery, variables: { request: { chainIds: [1, 8453] } } }),
  ]);

  let venues: Venue[] = [];
  if (morphoBorrow.status === 'fulfilled') venues = venues.concat(readMorphoVenues(morphoBorrow.value, 'borrow'));
  else warnings.push('Morpho borrow rates are unavailable.');
  if (morphoLend.status === 'fulfilled') venues = venues.concat(readMorphoVenues(morphoLend.value, 'lend'));
  else warnings.push('Morpho lend rates are unavailable.');

  let prices: number[] = [];
  if (aave.status === 'fulfilled') {
    const parsed = readAaveVenues(aave.value);
    venues = venues.concat(parsed.venues);
    prices = parsed.prices;
  } else warnings.push('Aave rates are unavailable.');

  let btcPriceUsd = median(prices.filter((price) => price >= 1_000 && price <= 2_000_000));
  if (btcPriceUsd === 0) btcPriceUsd = await fetchBtcSpot();
  venues = applyPrice(venues, btcPriceUsd);
  if (venues.length === 0) throw new Error('no safe venues');

  return { fetchedAt: Date.now(), btcPriceUsd, venues, warnings };
}

export function getRates(): Promise<RatesPayload> {
  if (cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.payload);
  if (inflight) return inflight;
  inflight = loadRates()
    .then((payload) => {
      cache = { at: Date.now(), payload };
      return payload;
    })
    .catch((error: unknown) => {
      if (cache && Date.now() - cache.at < STALE_MS) return cache.payload;
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
