import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { fetchCompoundVenues, fetchMoonwellVenues, fetchSparkVenues } from '@/lib/adapters/fetchVenues';
import { normalizeBorrowRate } from '@/lib/finance/rates';
import {
  AAVE_POOLS,
  CHAINS,
  MIN_LIQUIDITY_USD,
  dedupeVenues,
  type AaveMarket,
  type RatesPayload,
  type Venue,
  findBtcToken,
  isChainId,
  isVenueSafe,
  morphoMarketId,
} from './protocol';

const MORPHO_URL = 'https://api.morpho.org/graphql';
const AAVE_URL = 'https://api.v3.aave.com/graphql';
const FRESH_MS = 15_000;
const STALE_MS = 5 * 60_000;
const GRAPHQL_MS = 8_000;
const EXTRAS_MS = 8_000;
const LOAD_MS = 18_000;

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
      state { borrowApy supplyApy liquidityAssetsUsd borrowAssetsUsd supplyAssetsUsd utilization }
    }
  }
}`;

const morphoQueryBasic = `query Markets($where: MarketFilters) {
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

async function fetchMorphoMarkets(where: unknown): Promise<unknown> {
  try {
    return await graphql(MORPHO_URL, morphoQuery, { where });
  } catch {
    return graphql(MORPHO_URL, morphoQueryBasic, { where });
  }
}

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
      supplyInfo { apy { value } maxLTV { value } liquidationThreshold { value } liquidationBonus { value } canBeCollateral total { value } }
      borrowInfo { apy { value } availableLiquidity { amount { value } } }
    }
  }
}`;

const aaveQueryBasic = `query Markets($request: MarketsRequest!) {
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

async function graphql(url: string, query: string, variables: unknown): Promise<unknown> {
  const body = await postJson(url, { query, variables }) as { errors?: unknown };
  if (body && typeof body === 'object' && Array.isArray(body.errors) && body.errors.length > 0) {
    throw new Error('graphql fields unavailable');
  }
  return body;
}

async function fetchAaveMarkets(): Promise<unknown> {
  const request = { request: { chainIds: [1, 8453] } };
  try {
    return await graphql(AAVE_URL, aaveQuery, request);
  } catch {
    return graphql(AAVE_URL, aaveQueryBasic, request);
  }
}

function sourceRates(kind: 'APR' | 'APY', borrow: number | null, supply: number | null) {
  const borrowRate = borrow === null ? null : normalizeBorrowRate(kind, borrow);
  const supplyRate = supply === null ? null : normalizeBorrowRate(kind, supply);
  return {
    borrowApr: borrowRate?.apr ?? 0,
    supplyApr: supplyRate?.apr ?? 0,
    borrowRate: borrowRate ?? undefined,
    supplyRate: supplyRate ?? undefined,
  };
}

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

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GRAPHQL_MS),
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
      state?: { borrowApy?: unknown; supplyApy?: unknown; liquidityAssetsUsd?: unknown; borrowAssetsUsd?: unknown; supplyAssetsUsd?: unknown; utilization?: unknown };
    };
    const chainId = asNumber(row.chain?.id);
    if (!chainId || !isChainId(chainId)) continue;
    const loan = asAddress(row.loanAsset?.address);
    const collateral = asAddress(row.collateralAsset?.address);
    const oracle = asAddress(row.oracle?.address);
    const irm = asAddress(row.irmAddress);
    const marketId = typeof row.marketId === 'string' ? row.marketId : '';
    const lltv = typeof row.lltv === 'string' ? row.lltv : '';
    const borrowApy = asNumber(row.state?.borrowApy);
    const supplyApy = asNumber(row.state?.supplyApy);
    const rates = sourceRates('APY', borrowApy, supplyApy);
    const liquidityUsd = asNumber(row.state?.liquidityAssetsUsd);
    const suppliedUsd = asNumber(row.state?.supplyAssetsUsd);
    const borrowedUsd = asNumber(row.state?.borrowAssetsUsd);
    const utilization = asNumber(row.state?.utilization);
    if (!loan || !collateral || !oracle || !irm || !rates.borrowRate || !rates.supplyRate || liquidityUsd === null) continue;
    if (liquidityUsd < MIN_LIQUIDITY_USD || rates.borrowApr < 0 || rates.borrowApr >= 1 || rates.supplyApr < 0 || rates.supplyApr >= 1) continue;
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
    const liquidationLtv = Number(BigInt(lltv)) / 1e18;
    const usdc = CHAINS[chainId].usdc;
    const fetchedAt = Date.now();
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
      ...rates,
      loanSupplyApr: action === 'borrow' ? rates.supplyApr : undefined,
      maxLtv: liquidationLtv,
      liquidityUsd,
      liquidity: {
        availableToBorrow: liquidityUsd,
        totalSupplied: suppliedUsd ?? undefined,
        totalBorrowed: borrowedUsd ?? undefined,
        utilization: utilization ?? undefined,
      },
      collateralRisk: { liquidationLtv, parameterSource: 'live' },
      freshness: { source: 'Morpho GraphQL', fetchedAt },
      utilization: utilization ?? undefined,
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
  supplyInfo?: {
    apy?: { value?: unknown };
    maxLTV?: { value?: unknown };
    liquidationThreshold?: { value?: unknown };
    liquidationBonus?: { value?: unknown };
    canBeCollateral?: unknown;
    total?: { value?: unknown };
  };
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
    const usdcRates = sourceRates('APY', asNumber(usdc?.borrowInfo?.apy?.value), asNumber(usdc?.supplyInfo?.apy?.value) ?? 0);
    const usdcLiquidity = asNumber(usdc?.borrowInfo?.availableLiquidity?.amount?.value);
    const usdcPrice = asNumber(usdc?.usdExchangeRate) ?? 1;
    const usdcLiquidityUsd = usdcLiquidity === null ? 0 : usdcLiquidity * usdcPrice;
    const usdcDebtToken = asAddress(usdc?.vToken?.address);
    const fetchedAt = Date.now();

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
      const assetRates = sourceRates('APY', asNumber(reserve.borrowInfo?.apy?.value) ?? 0, asNumber(reserve.supplyInfo?.apy?.value) ?? 0);
      const maxLtv = asNumber(reserve.supplyInfo?.maxLTV?.value) ?? 0;
      const liquidationThreshold = asNumber(reserve.supplyInfo?.liquidationThreshold?.value) ?? undefined;
      const liquidationBonus = asNumber(reserve.supplyInfo?.liquidationBonus?.value) ?? undefined;
      const supplied = asNumber(reserve.supplyInfo?.total?.value) ?? 0;
      const canBorrowCollateral = reserve.supplyInfo?.canBeCollateral === true && !paused && !frozen && maxLtv > 0;
      const collateralRisk = {
        maxLtv,
        liquidationThreshold,
        liquidationBonus,
        liquidationPenalty: liquidationBonus !== undefined && liquidationBonus > 1 ? liquidationBonus - 1 : liquidationBonus,
        parameterSource: 'live' as const,
        eMode: { available: false },
      };

      if (canBorrowCollateral && usdc && usdcDebtToken && usdcRates.borrowRate && usdcLiquidityUsd >= MIN_LIQUIDITY_USD) {
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
          ...usdcRates,
          supplyApr: assetRates.supplyApr,
          supplyRate: assetRates.supplyRate,
          loanSupplyApr: usdcRates.supplyApr,
          maxLtv,
          liquidityUsd: usdcLiquidityUsd,
          liquidity: { availableToBorrow: usdcLiquidityUsd, totalSupplied: supplied * priceUsd },
          collateralRisk,
          freshness: { source: 'Aave GraphQL', fetchedAt },
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
          ...assetRates,
          maxLtv,
          liquidityUsd: lendLiquidity,
          liquidity: { availableToBorrow: available * priceUsd, totalSupplied: supplied * priceUsd },
          collateralRisk,
          freshness: { source: 'Aave GraphQL', fetchedAt },
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

  const [morphoBorrow, morphoLend, aave, spot] = await Promise.allSettled([
    fetchMorphoMarkets(borrowWhere),
    fetchMorphoMarkets(lendWhere),
    fetchAaveMarkets(),
    fetchBtcSpot(),
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
  if (btcPriceUsd === 0 && spot.status === 'fulfilled') btcPriceUsd = spot.value;
  if (btcPriceUsd === 0) btcPriceUsd = await fetchBtcSpot();

  const extras = await Promise.allSettled([
    withTimeout(fetchCompoundVenues(btcPriceUsd), EXTRAS_MS, 'compound-timeout'),
    withTimeout(fetchSparkVenues(btcPriceUsd), EXTRAS_MS, 'spark-timeout'),
    withTimeout(fetchMoonwellVenues(btcPriceUsd), EXTRAS_MS, 'moonwell-timeout'),
  ]);
  if (extras[0].status === 'fulfilled') venues = venues.concat(extras[0].value);
  else warnings.push('Compound V3 rates are unavailable.');
  if (extras[1].status === 'fulfilled') venues = venues.concat(extras[1].value);
  else warnings.push('Spark rates are unavailable.');
  if (extras[2].status === 'fulfilled') venues = venues.concat(extras[2].value);
  else warnings.push('Moonwell rates are unavailable.');

  venues = dedupeVenues(applyPrice(venues, btcPriceUsd));
  if (venues.length === 0) throw new Error('no safe venues');

  return { fetchedAt: Date.now(), btcPriceUsd, venues, warnings };
}

export function getRates(opts?: { bypassCache?: boolean }): Promise<RatesPayload> {
  const bypass = Boolean(opts?.bypassCache);
  if (!bypass && cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.payload);
  if (!bypass && inflight) return inflight;
  const request = withTimeout(loadRates(), LOAD_MS, 'rates-timeout')
    .then((payload) => {
      cache = { at: Date.now(), payload };
      return payload;
    })
    .catch((error: unknown) => {
      if (cache && Date.now() - cache.at < STALE_MS) return cache.payload;
      throw error;
    })
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  if (!bypass) inflight = request;
  return request;
}
