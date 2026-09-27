import type { PositionSnapshot } from '@/lib/adapters';

export const POSITION_EVENT = 'boro:position';
export const BALANCE_EVENT = 'boro:balance';

type CacheVenue = {
  protocol: string;
  chainId: number;
  assetAddress: string;
  morpho?: { marketId?: string };
  aave?: { pool?: string };
  compound?: { comet?: string };
  moonwell?: { mCollateral?: string };
};

export type CachedPosition = {
  key: string;
  user: string;
  snapshot: PositionSnapshot;
  at: number;
  blockNumber?: bigint;
};

type CachedBalance = {
  key: string;
  amount: bigint;
  at: number;
};

const positions = new Map<string, CachedPosition>();
const balances = new Map<string, CachedBalance>();
let positionVersion = 0;
let balanceVersion = 0;

export function canonicalMarketId(venue: CacheVenue) {
  return (
    venue.morpho?.marketId
    ?? venue.aave?.pool
    ?? venue.compound?.comet
    ?? venue.moonwell?.mCollateral
    ?? venue.assetAddress
  ).toLowerCase();
}

export function positionCacheKey(venue: CacheVenue, user: string) {
  return `position:${venue.chainId}:${venue.protocol}:${canonicalMarketId(venue)}:${venue.assetAddress.toLowerCase()}:${user.toLowerCase()}`;
}

export function balanceCacheKey(token: string, chainId: number, user: string) {
  return `${user.toLowerCase()}:${chainId}:${token.toLowerCase()}`;
}

function emit(name: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(name));
}

export function writeFreshPosition(input: {
  venue: CacheVenue;
  user: string;
  snapshot: PositionSnapshot;
  blockNumber?: bigint;
}): CachedPosition {
  const key = positionCacheKey(input.venue, input.user);
  const entry: CachedPosition = {
    key,
    user: input.user.toLowerCase(),
    snapshot: input.snapshot,
    at: Date.now(),
    blockNumber: input.blockNumber,
  };
  positions.set(key, entry);
  positionVersion += 1;
  emit(POSITION_EVENT);
  return entry;
}

export function readFreshPosition(venue: CacheVenue | null, user: string | undefined): CachedPosition | null {
  if (!venue || !user) return null;
  return positions.get(positionCacheKey(venue, user)) ?? null;
}

export function writeFreshBalance(token: string, chainId: number, user: string, amount: bigint): CachedBalance {
  const key = balanceCacheKey(token, chainId, user);
  const entry: CachedBalance = { key, amount, at: Date.now() };
  balances.set(key, entry);
  balanceVersion += 1;
  emit(BALANCE_EVENT);
  return entry;
}

export function readFreshBalance(token: string | undefined, chainId: number | undefined, user: string | undefined): bigint | null {
  if (!token || !chainId || !user) return null;
  return balances.get(balanceCacheKey(token, chainId, user))?.amount ?? null;
}

export function positionCacheVersion() {
  return positionVersion;
}

export function balanceCacheVersion() {
  return balanceVersion;
}

export function subscribeFreshPosition(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(POSITION_EVENT, onStoreChange);
  return () => window.removeEventListener(POSITION_EVENT, onStoreChange);
}

export function subscribeFreshBalance(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(BALANCE_EVENT, onStoreChange);
  return () => window.removeEventListener(BALANCE_EVENT, onStoreChange);
}

export function preferFreshPosition(live: PositionSnapshot, cached: CachedPosition | null): PositionSnapshot {
  if (!cached) return live;
  if (live.collateral === cached.snapshot.collateral && live.debt === cached.snapshot.debt) return live;
  if (Date.now() - cached.at > 120_000) return live;
  return cached.snapshot;
}

export function overlayCachedPosition(venue: CacheVenue, user: string | undefined, live: PositionSnapshot) {
  return preferFreshPosition(live, readFreshPosition(venue, user));
}
