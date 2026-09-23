import { formatUnits } from 'viem';
import { isVenueSafe, protocolLabel, venueConfidence, type ChainId, type ProtocolId, type Venue } from '@/lib/protocol';
import type { PositionSnapshot } from '@/lib/adapters';

export type RefinanceHint = {
  from: Venue;
  to: Venue;
  yearlyUsd: number;
  monthlyUsd: number;
};

export function refinanceHint(position: { venue: Venue; snapshot: PositionSnapshot }, venues: Venue[]): RefinanceHint | null {
  if (position.venue.action !== 'borrow' || position.snapshot.debt <= 0n) return null;
  const debtUsd = Number(formatUnits(position.snapshot.debt, position.venue.loanDecimals));
  if (!(debtUsd > 0)) return null;
  const alternatives = venues.filter((venue) =>
    venue.action === 'borrow'
    && venue.chainId === position.venue.chainId
    && venue.id !== position.venue.id
    && isVenueSafe(venue)
    && venueConfidence(venue).level !== 'cautious'
    && venue.borrowApr + 0.001 < position.venue.borrowApr,
  );
  alternatives.sort((left, right) => left.borrowApr - right.borrowApr);
  const to = alternatives[0];
  if (!to) return null;
  const yearlyUsd = debtUsd * (position.venue.borrowApr - to.borrowApr);
  if (yearlyUsd < 5) return null;
  return { from: position.venue, to, yearlyUsd, monthlyUsd: yearlyUsd / 12 };
}

export function projectedInterest(debtUsd: number, apr: number) {
  return {
    month: debtUsd * apr / 12,
    quarter: debtUsd * apr / 4,
    year: debtUsd * apr,
  };
}

export type CarrySide = {
  venue: Venue;
  apr: number;
  month: number;
  year: number;
};

export type ComparedPool = {
  protocol: ProtocolId;
  chainId: ChainId;
  label: string;
  apr: number;
  kind: 'borrow' | 'usdc' | 'btc';
};

export type MarketPair = {
  borrow: ComparedPool;
  lend: ComparedPool;
  spread: number;
  month: number;
  year: number;
};

export type BorrowVsLend = {
  debtUsd: number;
  collateralUsd: number;
  assetSymbol: string;
  chainId: ChainId;
  personalized: boolean;
  borrow: CarrySide;
  lendUsdc: CarrySide | null;
  lendBtc: CarrySide | null;
  usdcPools: ComparedPool[];
  btcPools: ComparedPool[];
  borrowPools: ComparedPool[];
  bestPair: MarketPair | null;
  collateralEarnApr: number;
  collateralEarnYear: number;
  positionNetYear: number;
  loopSpread: number;
  loopNetYear: number;
  loopPays: boolean;
};

function usdcSupplyApr(venue: Venue): number | null {
  if (typeof venue.loanSupplyApr === 'number' && Number.isFinite(venue.loanSupplyApr)) return venue.loanSupplyApr;
  if (venue.protocol === 'morpho' || venue.protocol === 'compound') return venue.supplyApr;
  return null;
}

function collateralEarnsSupply(venue: Venue): boolean {
  return venue.protocol === 'aave' || venue.protocol === 'spark' || venue.protocol === 'moonwell';
}

function trusted(venues: Venue[]) {
  return venues.filter((venue) => isVenueSafe(venue) && venueConfidence(venue).level !== 'cautious');
}

function bestBy<T>(items: T[], rate: (item: T) => number): T | null {
  return items.slice().sort((left, right) => rate(right) - rate(left))[0] ?? null;
}

function side(venue: Venue, apr: number, notionalUsd: number): CarrySide {
  const interest = projectedInterest(notionalUsd, apr);
  return { venue, apr, month: interest.month, year: interest.year };
}

function bestUsdcLend(venues: Venue[], chainId: ChainId): Venue | null {
  const pool = trusted(venues).filter((venue) => venue.chainId === chainId && usdcSupplyApr(venue) !== null);
  return bestBy(pool, (venue) => usdcSupplyApr(venue) ?? 0);
}

function bestBtcLend(venues: Venue[], chainId: ChainId, symbol: string): Venue | null {
  const same = trusted(venues).filter((venue) => venue.action === 'lend' && venue.chainId === chainId && venue.assetSymbol === symbol);
  return bestBy(same, (venue) => venue.supplyApr)
    ?? bestBy(trusted(venues).filter((venue) => venue.action === 'lend' && venue.chainId === chainId), (venue) => venue.supplyApr);
}

function cheapestBorrow(venues: Venue[], chainId: ChainId): Venue | null {
  const pool = trusted(venues).filter((venue) => venue.action === 'borrow' && venue.chainId === chainId);
  return pool.slice().sort((left, right) => left.borrowApr - right.borrowApr)[0] ?? null;
}

function poolKey(protocol: ProtocolId, chainId: ChainId, kind: ComparedPool['kind']) {
  return `${kind}:${protocol}:${chainId}`;
}

function collectPools(venues: Venue[], kind: ComparedPool['kind'], rateOf: (venue: Venue) => number | null): ComparedPool[] {
  const best = new Map<string, ComparedPool>();
  for (const venue of trusted(venues)) {
    const apr = rateOf(venue);
    if (apr === null) continue;
    const key = poolKey(venue.protocol, venue.chainId, kind);
    const current = best.get(key);
    if (current && current.apr >= apr) continue;
    best.set(key, {
      protocol: venue.protocol,
      chainId: venue.chainId,
      label: `${protocolLabel(venue.protocol)} · ${venue.chainId === 1 ? 'Ethereum' : 'Base'}`,
      apr,
      kind,
    });
  }
  return [...best.values()].sort((left, right) => (kind === 'borrow' ? left.apr - right.apr : right.apr - left.apr));
}

function bestSameChainPair(borrowPools: ComparedPool[], usdcPools: ComparedPool[], debtUsd: number): MarketPair | null {
  let winner: MarketPair | null = null;
  for (const borrow of borrowPools) {
    for (const lend of usdcPools) {
      if (lend.chainId !== borrow.chainId) continue;
      const spread = lend.apr - borrow.apr;
      if (!winner || spread > winner.spread) {
        winner = {
          borrow,
          lend,
          spread,
          month: debtUsd * spread / 12,
          year: debtUsd * spread,
        };
      }
    }
  }
  return winner;
}

function finishCompare(input: {
  debtUsd: number;
  collateralUsd: number;
  assetSymbol: string;
  chainId: ChainId;
  personalized: boolean;
  borrowVenue: Venue;
  borrowApr: number;
  collateralEarnApr: number;
  venues: Venue[];
}): BorrowVsLend {
  const lendUsdcVenue = bestUsdcLend(input.venues, input.chainId);
  const lendBtcVenue = bestBtcLend(input.venues, input.chainId, input.assetSymbol);
  const usdcApr = lendUsdcVenue ? usdcSupplyApr(lendUsdcVenue) : null;
  const loopSpread = usdcApr === null ? Number.NaN : usdcApr - input.borrowApr;
  const loopNetYear = Number.isFinite(loopSpread) ? input.debtUsd * loopSpread : 0;
  const collateralEarnYear = input.collateralUsd * input.collateralEarnApr;
  const usdcPools = collectPools(input.venues, 'usdc', usdcSupplyApr);
  const borrowPools = collectPools(input.venues, 'borrow', (venue) => venue.action === 'borrow' ? venue.borrowApr : null);
  return {
    debtUsd: input.debtUsd,
    collateralUsd: input.collateralUsd,
    assetSymbol: input.assetSymbol,
    chainId: input.chainId,
    personalized: input.personalized,
    borrow: side(input.borrowVenue, input.borrowApr, input.debtUsd),
    lendUsdc: lendUsdcVenue && usdcApr !== null ? side(lendUsdcVenue, usdcApr, input.debtUsd) : null,
    lendBtc: lendBtcVenue ? side(lendBtcVenue, lendBtcVenue.supplyApr, input.collateralUsd) : null,
    usdcPools,
    btcPools: collectPools(input.venues, 'btc', (venue) => venue.action === 'lend' ? venue.supplyApr : null),
    borrowPools,
    bestPair: bestSameChainPair(borrowPools, usdcPools, input.debtUsd),
    collateralEarnApr: input.collateralEarnApr,
    collateralEarnYear,
    positionNetYear: collateralEarnYear - input.debtUsd * input.borrowApr,
    loopSpread: Number.isFinite(loopSpread) ? loopSpread : 0,
    loopNetYear,
    loopPays: Number.isFinite(loopSpread) && loopSpread >= 0.001 && loopNetYear >= 5,
  };
}

export function compareBorrowVsLend(
  positions: { venue: Venue; snapshot: PositionSnapshot }[],
  venues: Venue[],
): BorrowVsLend | null {
  const open = positions.filter((item) => item.venue.action === 'borrow' && item.snapshot.debt > 0n);
  if (open.length > 0) {
    let debtUsd = 0;
    let collateralUsd = 0;
    let borrowWeight = 0;
    let earnWeight = 0;
    for (const item of open) {
      const debt = Number(formatUnits(item.snapshot.debt, item.venue.loanDecimals));
      const collateral = Number(formatUnits(item.snapshot.collateral, item.venue.assetDecimals)) * item.venue.priceUsd;
      if (!(debt > 0)) continue;
      debtUsd += debt;
      collateralUsd += collateral;
      borrowWeight += debt * item.venue.borrowApr;
      earnWeight += collateral * (collateralEarnsSupply(item.venue) ? item.venue.supplyApr : 0);
    }
    if (!(debtUsd > 0)) return null;
    const primary = open.slice().sort((left, right) => {
      const leftDebt = Number(formatUnits(left.snapshot.debt, left.venue.loanDecimals));
      const rightDebt = Number(formatUnits(right.snapshot.debt, right.venue.loanDecimals));
      return rightDebt - leftDebt;
    })[0];
    return finishCompare({
      debtUsd,
      collateralUsd,
      assetSymbol: primary.venue.assetSymbol,
      chainId: primary.venue.chainId,
      personalized: true,
      borrowVenue: primary.venue,
      borrowApr: borrowWeight / debtUsd,
      collateralEarnApr: collateralUsd > 0 ? earnWeight / collateralUsd : 0,
      venues,
    });
  }

  const chainId = cheapestBorrow(venues, 8453) ? 8453 : 1;
  const borrowVenue = cheapestBorrow(venues, chainId);
  if (!borrowVenue) return null;
  return finishCompare({
    debtUsd: 100,
    collateralUsd: 0,
    assetSymbol: borrowVenue.assetSymbol,
    chainId,
    personalized: false,
    borrowVenue,
    borrowApr: borrowVenue.borrowApr,
    collateralEarnApr: 0,
    venues,
  });
}
