import { erc20Abi } from '@/lib/abi';
import { adapterFor, type PositionSnapshot } from '@/lib/adapters';
import { CONFIRM_DRIFT, CONFIRM_FAIL_MESSAGE, buildConfirmSnapshot, confirmSourceStale, type ConfirmSnapshot } from '@/lib/finance/confirmSafety';
import { buildProposedPositionChange, type PositionChangeAction, type PositionChangeInput } from '@/lib/finance/positionChange';
import { canonicalMarketKey, isVenueSafe, type RatesPayload, type Venue } from '@/lib/protocol';
import { publicClient } from '@/lib/rpc';
import type { Address } from 'viem';

export { CONFIRM_FAIL_MESSAGE };

export async function withConfirmTimeout<T>(work: Promise<T>, ms = CONFIRM_DRIFT.FETCH_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('confirm-timeout')), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchFreshRates(): Promise<RatesPayload> {
  const response = await fetch('/api/rates?fresh=1', { cache: 'no-store', signal: AbortSignal.timeout(CONFIRM_DRIFT.FETCH_TIMEOUT_MS) });
  const body: unknown = await response.json();
  if (!response.ok || !body || typeof body !== 'object' || !('venues' in body) || !Array.isArray((body as RatesPayload).venues)) {
    throw new Error('rates-unavailable');
  }
  return body as RatesPayload;
}

export function venueFromPayload(payload: RatesPayload, current: Venue): Venue | null {
  const key = canonicalMarketKey(current);
  const match = payload.venues.find((venue) => isVenueSafe(venue) && canonicalMarketKey(venue) === key);
  return match ?? null;
}

export async function fetchFreshPosition(
  venue: Venue,
  user: Address,
  blockNumber?: bigint,
): Promise<{ snapshot: PositionSnapshot; blockNumber: bigint }> {
  const client = publicClient(venue.chainId);
  const adapter = adapterFor(venue);
  const reads = adapter.positionReads(venue, user);
  const read = (at?: bigint) => Promise.all(reads.map((call) => client.readContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName as never,
    args: (call.args ?? []) as never,
    ...(at !== undefined ? { blockNumber: at } : {}),
  })));
  if (blockNumber !== undefined) {
    try {
      return { snapshot: adapter.parsePosition(venue, await read(blockNumber)), blockNumber };
    } catch {
      // Some RPCs cannot serve historical state; fall through to the latest block.
    }
  }
  const [latest, results] = await Promise.all([client.getBlockNumber(), read()]);
  return { snapshot: adapter.parsePosition(venue, results), blockNumber: latest };
}

export async function fetchFreshTokenBalance(token: Address, chainId: Venue['chainId'], user: Address): Promise<bigint> {
  const client = publicClient(chainId);
  const value = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  });
  return typeof value === 'bigint' ? value : 0n;
}

export type FreshConfirmReads = {
  venue: Venue;
  position: PositionSnapshot;
  walletBalance: bigint;
  blockNumber: bigint;
  fetchedAt: number;
};

export async function fetchFreshConfirmReads(input: {
  venue: Venue;
  user: Address;
  action: PositionChangeAction;
}): Promise<FreshConfirmReads> {
  const payload = await fetchFreshRates();
  const venue = venueFromPayload(payload, input.venue);
  if (!venue) throw new Error('market-missing');
  if (confirmSourceStale(payload.fetchedAt) || confirmSourceStale(venue.freshness?.fetchedAt)) {
    throw new Error('stale');
  }
  const token = input.action === 'REPAY' ? venue.loanAddress : venue.assetAddress;
  const [positionRead, walletBalance] = await Promise.all([
    fetchFreshPosition(venue, input.user),
    fetchFreshTokenBalance(token, venue.chainId, input.user),
  ]);
  return {
    venue,
    position: positionRead.snapshot,
    walletBalance,
    blockNumber: positionRead.blockNumber,
    fetchedAt: payload.fetchedAt,
  };
}

export function snapshotFromFreshReads(
  reads: FreshConfirmReads,
  changeInput: PositionChangeInput,
): { change: ReturnType<typeof buildProposedPositionChange>; snapshot: ConfirmSnapshot } {
  const change = buildProposedPositionChange({
    ...changeInput,
    venue: reads.venue,
    currentCollateral: reads.position.collateral,
    currentDebt: reads.position.debt,
    spendableBalance: reads.walletBalance,
    priceUsd: reads.venue.priceUsd,
    borrowRoom: reads.position.borrowRoom,
    withdrawMax: reads.position.withdrawMax,
    minBorrow: reads.position.extra?.minBorrow,
    fetchedAt: reads.fetchedAt,
  });
  return {
    change,
    snapshot: buildConfirmSnapshot({
      action: changeInput.action,
      venue: reads.venue,
      change,
      currentCollateral: reads.position.collateral,
      currentDebt: reads.position.debt,
      walletBalance: reads.walletBalance,
      plannedAmount: BigInt(changeInput.amount),
      fetchedAt: reads.fetchedAt,
      blockNumber: reads.blockNumber,
    }),
  };
}
