import { encodeAbiParameters, getAddress, isAddress, keccak256, type Address, type Hex } from 'viem';
import type { BorrowRate } from '@/lib/finance/rates';
import type { RateHistoryMetrics } from '@/lib/finance/history';

export const MORPHO_BLUE = getAddress('0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb');
export const MIN_LIQUIDITY_USD = 25_000;
export const RECOMMENDED_LIQUIDITY_USD = 100_000;
export const DEEP_LIQUIDITY_USD = 10_000_000;
const COINBASE_MORPHO_MARKET = '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836';
export const MAX_APR = 1;
export const MIN_BTC_PRICE_USD = 1_000;
export const MAX_BTC_PRICE_USD = 2_000_000;
export const ZERO_ADDRESS = getAddress('0x0000000000000000000000000000000000000000');

export type ChainId = 1 | 8453;
export type ProtocolId = 'morpho' | 'aave' | 'compound' | 'spark' | 'moonwell';
export type VenueAction = 'borrow' | 'lend';
export type AssetKind = 'direct' | 'wrapped' | 'custodial';
export type AssetFilter = 'all' | 'direct' | 'tBTC' | 'WBTC' | 'cbBTC';

export type TokenInfo = {
  symbol: string;
  address: Address;
  decimals: number;
  kind: AssetKind;
};

type ChainTokens = {
  usdc: TokenInfo;
  btc: TokenInfo[];
  lendCollateral: Address[];
};

export const AAVE_POOLS: Record<ChainId, Address> = {
  1: getAddress('0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'),
  8453: getAddress('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'),
};

export const SPARK_POOL = getAddress('0xC13e21B648A5Ee794902342038FF3aDAB66BE987');
export const SPARK_DATA_PROVIDER = getAddress('0xFc21d6d146E6086B8359705C8b28512a983db0cb');

export const COMETS: Partial<Record<ChainId, Address>> = {
  1: getAddress('0xc3d688B66703497DAA19211EEdff47f25384cdc3'),
  8453: getAddress('0xb125E6687d4313864e53df431d5425969c15Eb2F'),
};

export const MOONWELL = {
  chainId: 8453 as ChainId,
  comptroller: getAddress('0xfBb21d0380beE3312B33c4353c8936a0F13EF26C'),
  mUsdc: getAddress('0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22'),
  markets: {
    cbBTC: getAddress('0xF877ACaFA28c19b96727966690b2f44d35aD5976'),
  } as Record<string, Address>,
};

const WETH: Record<ChainId, Address> = {
  1: getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  8453: getAddress('0x4200000000000000000000000000000000000006'),
};

export const CHAINS: Record<ChainId, ChainTokens> = {
  1: {
    usdc: { symbol: 'USDC', address: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'), decimals: 6, kind: 'custodial' },
    btc: [
      { symbol: 'tBTC', address: getAddress('0x18084fbA666a33d37592fA2633fD49a74DD93a88'), decimals: 18, kind: 'direct' },
      { symbol: 'WBTC', address: getAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'), decimals: 8, kind: 'wrapped' },
      { symbol: 'cbBTC', address: getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'), decimals: 8, kind: 'custodial' },
    ],
    lendCollateral: [],
  },
  8453: {
    usdc: { symbol: 'USDC', address: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), decimals: 6, kind: 'custodial' },
    btc: [
      { symbol: 'tBTC', address: getAddress('0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b'), decimals: 18, kind: 'direct' },
      { symbol: 'cbBTC', address: getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'), decimals: 8, kind: 'custodial' },
    ],
    lendCollateral: [],
  },
};

CHAINS[1].lendCollateral = [CHAINS[1].usdc.address, WETH[1]];
CHAINS[8453].lendCollateral = [CHAINS[8453].usdc.address, WETH[8453]];

export type MorphoMarket = {
  marketId: Hex;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: string;
};

export type AaveMarket = {
  pool: Address;
  aToken: Address;
  variableDebtToken: Address;
};

export type CollateralRiskParameters = {
  maxLtv?: number;
  liquidationThreshold?: number;
  liquidationLtv?: number;
  liquidationPenalty?: number;
  liquidationBonus?: number;
  /** Live on-chain/current configuration. Proposed governance values must not be used for risk. */
  parameterSource?: 'live' | 'proposed';
  eMode?: {
    available: boolean;
    category?: string;
    maxLtv?: number;
    liquidationThreshold?: number;
    liquidationBonus?: number;
  };
};

export type MarketLiquidity = {
  availableToBorrow?: number;
  totalSupplied?: number;
  totalBorrowed?: number;
  utilization?: number;
  targetUtilization?: number;
};

export type MarketFreshness = {
  source: string;
  fetchedAt: number;
  blockNumber?: number;
};

export type CompoundMarket = {
  comet: Address;
  minBorrow: string;
};

export type MoonwellMarket = {
  comptroller: Address;
  mCollateral: Address;
  mLoan: Address;
};

export type RatesPayload = {
  fetchedAt: number;
  btcPriceUsd: number;
  venues: Venue[];
  warnings: string[];
};

export type Venue = {
  id: string;
  protocol: ProtocolId;
  action: VenueAction;
  chainId: ChainId;
  assetSymbol: string;
  assetKind: AssetKind;
  assetAddress: Address;
  assetDecimals: number;
  loanSymbol: string;
  loanAddress: Address;
  loanDecimals: number;
  borrowApr: number;
  supplyApr: number;
  /** USDC supply APY on the same market, when the venue is a BTC/USDC borrow pool. */
  loanSupplyApr?: number;
  borrowRate?: BorrowRate;
  supplyRate?: BorrowRate;
  maxLtv: number;
  liquidityUsd: number;
  liquidity?: MarketLiquidity;
  collateralRisk?: CollateralRiskParameters;
  proposedCollateralRisk?: CollateralRiskParameters;
  rateHistory?: RateHistoryMetrics;
  freshness?: MarketFreshness;
  priceUsd: number;
  utilization?: number;
  rewardApr?: number;
  rewardTokens?: string[];
  morpho?: MorphoMarket;
  aave?: AaveMarket;
  compound?: CompoundMarket;
  moonwell?: MoonwellMarket;
};

export function venueOnChain(venues: Venue[], quote: Venue, chainId: ChainId): Venue | null {
  const matches = venues.filter((venue) =>
    venue.id !== quote.id
    && venue.action === quote.action
    && venue.assetSymbol === quote.assetSymbol
    && venue.chainId === chainId
    && isVenueSafe(venue),
  );
  return matches.find((venue) => venue.protocol === quote.protocol) ?? matches[0] ?? null;
}

export function sameAssetOnOtherChain(chainId: ChainId, symbol: string): { chainId: ChainId; address: Address; decimals: number } | null {
  const other: ChainId = chainId === 1 ? 8453 : 1;
  const token = CHAINS[other].btc.find((item) => item.symbol === symbol);
  if (!token) return null;
  return { chainId: other, address: token.address, decimals: token.decimals };
}

export function isChainId(value: number): value is ChainId {
  return value === 1 || value === 8453;
}

export function chainLabel(chainId: ChainId): string {
  return chainId === 1 ? 'Ethereum' : 'Base';
}

export function protocolLabel(protocol: ProtocolId): string {
  if (protocol === 'morpho') return 'Morpho Blue';
  if (protocol === 'aave') return 'Aave V3';
  if (protocol === 'compound') return 'Compound V3';
  if (protocol === 'spark') return 'Spark';
  return 'Moonwell';
}

export function protocolAppUrl(venue: Venue): string {
  if (venue.protocol === 'morpho') return `https://app.morpho.org/${venue.chainId === 8453 ? 'base' : 'ethereum'}/borrow`;
  if (venue.protocol === 'aave') return 'https://app.aave.com';
  if (venue.protocol === 'spark') return 'https://app.spark.fi';
  if (venue.protocol === 'compound') return 'https://app.compound.finance';
  return 'https://moonwell.fi';
}

export function assetRouteLabel(kind: AssetKind): string {
  if (kind === 'direct') return 'Native BTC via tBTC';
  if (kind === 'wrapped') return 'WBTC';
  return 'cbBTC, Coinbase custody';
}

export function wrapperCategories(kind: AssetKind): { simplicity: string; custody: string; depth: string } {
  if (kind === 'direct') {
    return {
      simplicity: 'Extra mint/reveal steps',
      custody: 'Decentralized threshold custody',
      depth: 'Direct BTC markets vary by pool',
    };
  }
  if (kind === 'wrapped') {
    return {
      simplicity: 'Standard ERC-20 wrapper',
      custody: 'Custodial wrapped BTC',
      depth: 'Often deep on Ethereum',
    };
  }
  return {
    simplicity: 'Operational simplicity',
    custody: 'Centralized Coinbase custody',
    depth: 'Often deep on Base and Ethereum',
  };
}

export function shortMarketId(id: string): string {
  if (id.length < 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function availableToBorrowUsd(venue: Venue): number {
  return venue.liquidity?.availableToBorrow ?? venue.liquidityUsd;
}

export function collateralLimitLabel(venue: Venue): { label: string; value: number } {
  if (venue.protocol === 'morpho') {
    return { label: 'LLTV', value: venue.collateralRisk?.liquidationLtv ?? venue.maxLtv };
  }
  return { label: 'Max LTV', value: venue.collateralRisk?.maxLtv ?? venue.maxLtv };
}

export type ConfidenceLevel = 'high' | 'standard' | 'cautious';

export type VenueConfidence = {
  level: ConfidenceLevel;
  label: string;
  detail: string;
};

function wrapperNote(kind: AssetKind): string {
  if (kind === 'direct') return 'tBTC is minted by Threshold from native Bitcoin.';
  if (kind === 'wrapped') return 'WBTC is backed by BTC held with BitGo.';
  return 'cbBTC is backed 1:1 by BTC held at Coinbase.';
}

export function venueConfidence(venue: Venue): VenueConfidence {
  const wrapper = wrapperNote(venue.assetKind);
  const coinbaseMarket = venue.protocol === 'morpho'
    && venue.chainId === 8453
    && venue.morpho?.marketId.toLowerCase() === COINBASE_MORPHO_MARKET;
  const deep = venue.liquidityUsd >= DEEP_LIQUIDITY_USD;

  if (venue.liquidityUsd < RECOMMENDED_LIQUIDITY_USD) {
    return {
      level: 'cautious',
      label: 'Smaller market',
      detail: `The contracts are the same, but this pool is small. A larger borrow can fail and the rate can jump. ${wrapper}`,
    };
  }
  if (coinbaseMarket) {
    return {
      level: 'high',
      label: 'Used by Coinbase',
      detail: `Isolated Morpho Blue market. Coinbase uses this Base cbBTC/USDC market for bitcoin-backed loans, so a loss stays in this market. ${wrapper}`,
    };
  }
  if (venue.protocol === 'morpho' && deep) {
    return {
      level: 'high',
      label: 'Deep Morpho market',
      detail: `Isolated Morpho Blue market with deep liquidity. A loss stays in this market. ${wrapper}`,
    };
  }
  if (venue.protocol === 'aave' && deep) {
    return {
      level: 'high',
      label: 'Aave core pool',
      detail: `Aave V3 is a long-running shared pool. Aave governance sets the LTV and liquidation rules, and USDC liquidity is shared across the pool. ${wrapper}`,
    };
  }
  if (venue.protocol === 'compound') {
    return {
      level: 'high',
      label: 'Compound V3',
      detail: `Compound V3 is a conservative single-borrow market. Only USDC is borrowed, and each collateral asset has its own cap. ${wrapper}`,
    };
  }
  if (venue.protocol === 'spark' && deep) {
    return {
      level: 'high',
      label: 'Spark core pool',
      detail: `Spark is Sky/Maker's Aave V3 fork on Ethereum. Frozen or zero-LTV reserves are hidden. ${wrapper}`,
    };
  }
  if (venue.protocol === 'morpho') {
    return {
      level: 'standard',
      label: 'Morpho market',
      detail: `Isolated Morpho Blue market with enough liquidity for a moderate borrow. ${wrapper}`,
    };
  }
  if (venue.protocol === 'moonwell') {
    return {
      level: 'standard',
      label: 'Moonwell on Base',
      detail: `Moonwell is a Compound-style pool on Base. Used by Coinbase for some Base listings, but smaller than Aave or Compound. ${wrapper}`,
    };
  }
  if (venue.protocol === 'spark') {
    return {
      level: 'standard',
      label: 'Spark pool',
      detail: `Spark is Sky/Maker's Aave V3 fork. Governance sets the collateral limits. ${wrapper}`,
    };
  }
  return {
    level: 'standard',
    label: 'Aave pool',
    detail: `Aave V3 shared pool. Governance sets the collateral limits. ${wrapper}`,
  };
}

function confidenceRank(venue: Venue): number {
  const confidence = venueConfidence(venue);
  const coinbase = confidence.label === 'Used by Coinbase' ? 1 : 0;
  const level = confidence.level === 'high' ? 2 : confidence.level === 'standard' ? 1 : 0;
  return level + coinbase;
}

export function sameAddress(left: string, right: string): boolean {
  return isAddress(left) && isAddress(right) && getAddress(left) === getAddress(right);
}

export function findBtcToken(chainId: ChainId, address: string): TokenInfo | null {
  return CHAINS[chainId].btc.find((token) => sameAddress(token.address, address)) ?? null;
}

export function morphoMarketId(market: Omit<MorphoMarket, 'marketId'>): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [market.loanToken, market.collateralToken, market.oracle, market.irm, BigInt(market.lltv)],
    ),
  );
}

function sanePrice(priceUsd: number): boolean {
  return Number.isFinite(priceUsd) && priceUsd >= MIN_BTC_PRICE_USD && priceUsd <= MAX_BTC_PRICE_USD;
}

function saneApr(apr: number): boolean {
  return Number.isFinite(apr) && apr >= 0 && apr < MAX_APR;
}

function exclusiveProtocolFields(venue: Venue, kind: ProtocolId): boolean {
  const morpho = Boolean(venue.morpho);
  const aave = Boolean(venue.aave);
  const compound = Boolean(venue.compound);
  const moonwell = Boolean(venue.moonwell);
  if (kind === 'morpho') return morpho && !aave && !compound && !moonwell;
  if (kind === 'aave' || kind === 'spark') return aave && !morpho && !compound && !moonwell;
  if (kind === 'compound') return compound && !morpho && !aave && !moonwell;
  return moonwell && !morpho && !aave && !compound;
}

function aaveLikeSafe(venue: Venue, asset: TokenInfo, pool: Address): boolean {
  const aave = venue.aave;
  if (!aave || !exclusiveProtocolFields(venue, venue.protocol)) return false;
  if (!sameAddress(aave.pool, pool)) return false;
  if (!isAddress(aave.aToken) || !isAddress(aave.variableDebtToken)) return false;
  if (sameAddress(aave.aToken, ZERO_ADDRESS) || sameAddress(aave.variableDebtToken, ZERO_ADDRESS)) return false;
  if (venue.action === 'lend' && (venue.maxLtv < 0 || venue.maxLtv > 0.9)) return false;
  return Boolean(asset);
}

export function isVenueSafe(venue: Venue): boolean {
  if (!isChainId(venue.chainId)) return false;
  if (!['morpho', 'aave', 'compound', 'spark', 'moonwell'].includes(venue.protocol)) return false;
  if (venue.action !== 'borrow' && venue.action !== 'lend') return false;
  if (!sanePrice(venue.priceUsd) || venue.liquidityUsd < MIN_LIQUIDITY_USD) return false;
  if (!saneApr(venue.borrowApr) || !saneApr(venue.supplyApr)) return false;
  if (venue.loanSupplyApr !== undefined && !saneApr(venue.loanSupplyApr)) return false;

  const asset = findBtcToken(venue.chainId, venue.assetAddress);
  if (!asset || asset.symbol !== venue.assetSymbol || asset.decimals !== venue.assetDecimals || asset.kind !== venue.assetKind) {
    return false;
  }

  const usdc = CHAINS[venue.chainId].usdc;
  if (venue.action === 'borrow') {
    if (venue.maxLtv < 0.5 || venue.maxLtv > 0.9) return false;
    if (!sameAddress(venue.loanAddress, usdc.address) || venue.loanDecimals !== usdc.decimals || venue.loanSymbol !== 'USDC') {
      return false;
    }
  }

  if (venue.protocol === 'morpho') {
    const market = venue.morpho;
    if (!market || !exclusiveProtocolFields(venue, 'morpho')) return false;
    if (!/^\d+$/.test(market.lltv)) return false;
    let lltv: bigint;
    try {
      lltv = BigInt(market.lltv);
    } catch {
      return false;
    }
    if (lltv <= 0n) return false;
    const lltvRatio = Number(lltv) / 1e18;
    if (lltvRatio < 0.5 || lltvRatio > 0.9) return false;
    if (venue.action === 'borrow' && Math.abs(lltvRatio - venue.maxLtv) > 0.000001) return false;
    if (sameAddress(market.oracle, ZERO_ADDRESS) || sameAddress(market.irm, ZERO_ADDRESS)) return false;
    const computed = morphoMarketId(market);
    if (computed.toLowerCase() !== market.marketId.toLowerCase()) return false;
    if (venue.action === 'borrow') {
      return sameAddress(market.collateralToken, asset.address) && sameAddress(market.loanToken, usdc.address);
    }
    const collateralAllowed = CHAINS[venue.chainId].lendCollateral.some((token) => sameAddress(token, market.collateralToken));
    return collateralAllowed && sameAddress(market.loanToken, asset.address);
  }

  if (venue.protocol === 'aave') return aaveLikeSafe(venue, asset, AAVE_POOLS[venue.chainId]);
  if (venue.protocol === 'spark') return venue.chainId === 1 && aaveLikeSafe(venue, asset, SPARK_POOL);

  if (venue.protocol === 'compound') {
    const comet = COMETS[venue.chainId];
    if (!comet || !venue.compound || !exclusiveProtocolFields(venue, 'compound')) return false;
    if (venue.action !== 'borrow') return false;
    if (!sameAddress(venue.compound.comet, comet)) return false;
    return /^\d+$/.test(venue.compound.minBorrow);
  }

  if (venue.protocol !== 'moonwell' || venue.chainId !== MOONWELL.chainId) return false;
  const moonwell = venue.moonwell;
  if (!moonwell || !exclusiveProtocolFields(venue, 'moonwell')) return false;
  if (!sameAddress(moonwell.comptroller, MOONWELL.comptroller) || !sameAddress(moonwell.mLoan, MOONWELL.mUsdc)) return false;
  const expected = MOONWELL.markets[venue.assetSymbol];
  return Boolean(expected && sameAddress(moonwell.mCollateral, expected));
}

export function venueSpender(venue: Venue, kind: 'asset' | 'loan' = 'asset'): Address | null {
  if (!isVenueSafe(venue)) return null;
  if (venue.protocol === 'morpho') return MORPHO_BLUE;
  if (venue.protocol === 'compound') return venue.compound?.comet ?? null;
  if (venue.protocol === 'moonwell') return kind === 'loan' ? (venue.moonwell?.mLoan ?? null) : (venue.moonwell?.mCollateral ?? null);
  return venue.aave?.pool ?? null;
}

export function matchesAssetFilter(venue: Venue, filter: AssetFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'direct') return venue.assetKind === 'direct';
  return venue.assetSymbol === filter;
}

export function comparableVenues(venues: Venue[]): Venue[] {
  const deep = venues.filter((venue) => venue.liquidityUsd >= DEEP_LIQUIDITY_USD);
  if (deep.length > 0) return deep;
  const usable = venues.filter((venue) => venue.liquidityUsd >= RECOMMENDED_LIQUIDITY_USD);
  return usable.length > 0 ? usable : venues;
}

export type Suggestion = {
  venue: Venue | null;
  anchor: Venue | null;
  thresholdUsd: number;
  gap: number;
  pickedForConfidence: boolean;
  reasons: string[];
  cautions: string[];
};

export type AssetRating = {
  symbol: string;
  venue: Venue;
  rate: number;
  rank: number;
  gap: number;
};

function poolThreshold(pool: Venue[]): number {
  if (pool.length > 0 && pool.every((venue) => venue.liquidityUsd >= DEEP_LIQUIDITY_USD)) return DEEP_LIQUIDITY_USD;
  if (pool.length > 0 && pool.every((venue) => venue.liquidityUsd >= RECOMMENDED_LIQUIDITY_USD)) return RECOMMENDED_LIQUIDITY_USD;
  return MIN_LIQUIDITY_USD;
}

function borrowSuitability(venue: Venue, pool: Venue[]): number {
  const rates = pool.map((item) => item.borrowApr);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const cost = max === min ? 70 : ((max - venue.borrowApr) / (max - min)) * 100;
  const available = availableToBorrowUsd(venue);
  const liquidity = available >= DEEP_LIQUIDITY_USD ? 90 : available >= RECOMMENDED_LIQUIDITY_USD ? 65 : 30;
  const utilization = venue.liquidity?.utilization ?? venue.utilization;
  const utilizationPenalty = utilization !== undefined && utilization > 0.9 ? 20 : utilization !== undefined && utilization > 0.75 ? 8 : 0;
  const operational = confidenceRank(venue) * 18;
  const isolated = venue.protocol === 'morpho' ? 8 : 0;
  const history = venue.rateHistory ? 8 : 0;
  const chainCost = venue.chainId === 8453 ? 6 : 2;
  return cost * 0.32 + liquidity * 0.24 + operational + isolated + history + chainCost - utilizationPenalty;
}

function suggestionNotes(venue: Venue): { reasons: string[]; cautions: string[] } {
  const reasons: string[] = [];
  const cautions: string[] = [];
  const confidence = venueConfidence(venue);
  const available = availableToBorrowUsd(venue);
  if (available >= DEEP_LIQUIDITY_USD) reasons.push('Deep available liquidity');
  if (confidence.level === 'high') reasons.push(confidence.label);
  if (venue.protocol === 'morpho') reasons.push('Isolated market: a loss stays in this market');
  if (venue.chainId === 8453) reasons.push('Lower typical transaction costs on Base');
  const limit = collateralLimitLabel(venue);
  if (limit.value > 0 && limit.value <= 0.86) reasons.push(`Conservative ${limit.label} for this market`);
  if (venue.rateHistory?.avg30d !== undefined) reasons.push('Enough history to compare a 30-day average');
  if (reasons.length === 0) reasons.push(confidence.detail);
  if (available < RECOMMENDED_LIQUIDITY_USD) cautions.push('Available liquidity is thinner than larger pools');
  if (!venue.rateHistory) cautions.push('Not enough history to judge rate stability');
  if (confidence.level === 'cautious') cautions.push(confidence.detail);
  return { reasons, cautions };
}

export function suggestionFor(venues: Venue[], action: VenueAction): Suggestion {
  const ranked = rankVenues(venues, action);
  const pool = comparableVenues(ranked);
  const anchor = pool[0] ?? null;
  const venue = recommendVenue(venues, action);
  const gap = venue && anchor ? Math.max(0, (action === 'lend' ? anchor.supplyApr - venue.supplyApr : venue.borrowApr - anchor.borrowApr)) : 0;
  const notes = venue ? suggestionNotes(venue) : { reasons: [], cautions: [] };
  return {
    venue,
    anchor,
    thresholdUsd: poolThreshold(pool),
    gap,
    pickedForConfidence: Boolean(venue && anchor && venue.id !== anchor.id),
    reasons: notes.reasons,
    cautions: notes.cautions,
  };
}

export function rateAssets(venues: Venue[], action: VenueAction): AssetRating[] {
  const symbols = [...new Set(venues.map((venue) => venue.assetSymbol))];
  const picked = symbols.flatMap((symbol) => {
    const venue = recommendVenue(venues.filter((item) => item.assetSymbol === symbol), action);
    if (!venue) return [];
    return [{ symbol, venue, rate: action === 'lend' ? venue.supplyApr : venue.borrowApr }];
  });
  picked.sort((left, right) => action === 'lend' ? right.rate - left.rate : left.rate - right.rate);
  const leader = picked[0]?.rate ?? 0;
  return picked.map((item, index) => ({
    ...item,
    rank: index + 1,
    gap: Math.abs(item.rate - leader),
  }));
}

export function recommendVenue(venues: Venue[], action: VenueAction): Venue | null {
  const ranked = rankVenues(venues, action);
  const pool = comparableVenues(ranked);
  if (action === 'lend') return pool[0] ?? null;
  if (pool.length === 0) return null;
  return pool.slice().sort((left, right) => borrowSuitability(right, pool) - borrowSuitability(left, pool) || left.borrowApr - right.borrowApr)[0] ?? null;
}

export function protocolMarketId(venue: Venue): string {
  if (venue.morpho?.marketId) return venue.morpho.marketId.toLowerCase();
  if (venue.protocol === 'compound') {
    const comet = venue.compound?.comet && isAddress(venue.compound.comet)
      ? venue.compound.comet
      : COMETS[venue.chainId];
    return comet && isAddress(comet) ? getAddress(comet) : `compound:${venue.chainId}`;
  }
  if (venue.protocol === 'aave' || venue.protocol === 'spark') {
    const known = venue.protocol === 'spark' ? SPARK_POOL : AAVE_POOLS[venue.chainId];
    const pool = venue.aave?.pool && isAddress(venue.aave.pool) ? venue.aave.pool : known;
    return pool && isAddress(pool) ? getAddress(pool) : `${venue.protocol}:${venue.chainId}`;
  }
  if (venue.moonwell?.mCollateral && isAddress(venue.moonwell.mCollateral)) return getAddress(venue.moonwell.mCollateral);
  return `${venue.protocol}:${venue.chainId}`;
}

function checksummed(value: string): string {
  return isAddress(value) ? getAddress(value) : value.toLowerCase();
}

/** Stable identity: protocol + chain + collateral + debt + protocol market id. Not the display name. */
export function canonicalMarketKey(venue: Venue): string {
  return [
    venue.action,
    venue.protocol,
    venue.chainId,
    checksummed(venue.assetAddress),
    checksummed(venue.loanAddress),
    protocolMarketId(venue),
  ].join(':').toLowerCase();
}

function hasProtocolId(venue: Venue): boolean {
  return Boolean(venue.morpho || venue.compound || venue.aave || venue.moonwell);
}

function preferDuplicate(left: Venue, right: Venue, action: VenueAction): Venue {
  if (hasProtocolId(left) !== hasProtocolId(right)) return hasProtocolId(left) ? left : right;
  const liquidityDelta = availableToBorrowUsd(left) - availableToBorrowUsd(right);
  if (liquidityDelta !== 0) return liquidityDelta > 0 ? left : right;
  if (Boolean(left.rateHistory) !== Boolean(right.rateHistory)) return left.rateHistory ? left : right;
  if (left.borrowApr !== right.borrowApr || left.supplyApr !== right.supplyApr) {
    return action === 'lend'
      ? (left.supplyApr >= right.supplyApr ? left : right)
      : (left.borrowApr <= right.borrowApr ? left : right);
  }
  return left.id <= right.id ? left : right;
}

export function dedupeVenues(venues: Venue[], action?: VenueAction): Venue[] {
  const chosen = new Map<string, Venue>();
  for (const venue of venues) {
    const key = canonicalMarketKey(venue);
    const current = chosen.get(key);
    chosen.set(key, current ? preferDuplicate(current, venue, action ?? venue.action) : venue);
  }
  return [...chosen.values()];
}

export function rankVenues(venues: Venue[], action: VenueAction): Venue[] {
  const ranked = dedupeVenues(
    venues.filter((venue) => venue.action === action && isVenueSafe(venue)),
    action,
  );
  ranked.sort((left, right) => {
    const rateDelta = action === 'lend' ? right.supplyApr - left.supplyApr : left.borrowApr - right.borrowApr;
    if (rateDelta !== 0) return rateDelta;
    if (left.maxLtv !== right.maxLtv) return right.maxLtv - left.maxLtv;
    return right.liquidityUsd - left.liquidityUsd;
  });
  return ranked;
}

export function morphoParams(venue: Venue) {
  const market = venue.morpho;
  if (!market) return null;
  return {
    loanToken: market.loanToken,
    collateralToken: market.collateralToken,
    oracle: market.oracle,
    irm: market.irm,
    lltv: BigInt(market.lltv),
  } as const;
}
