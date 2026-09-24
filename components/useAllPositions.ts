'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { adapterFor, type PositionSnapshot } from '@/lib/adapters';
import type { Venue } from '@/lib/protocol';

export type OpenPosition = {
  venue: Venue;
  snapshot: PositionSnapshot;
};

const lastByAddress = new Map<string, OpenPosition[]>();

function venueKey(venue: Venue) {
  const market = (
    venue.morpho?.marketId
    ?? venue.aave?.pool
    ?? venue.compound?.comet
    ?? venue.moonwell?.mCollateral
    ?? ''
  ).toLowerCase();
  return `${venue.protocol}:${venue.chainId}:${venue.assetAddress.toLowerCase()}:${market}`;
}

function isOpenPosition(venue: Venue, snapshot: PositionSnapshot) {
  if ((venue.protocol === 'aave' || venue.protocol === 'spark') && snapshot.collateral === 0n) return false;
  return snapshot.collateral > 0n || snapshot.debt > 0n;
}

function callFingerprint(venues: Venue[], address: Address) {
  return venues
    .flatMap((venue) => adapterFor(venue).positionReads(venue, address))
    .map((call) => `${call.chainId}:${call.address}:${call.functionName}:${JSON.stringify(call.args ?? [])}`)
    .join('|');
}

export function useAllPositions(venues: Venue[], address: Address | undefined) {
  const [heldAddress, setHeldAddress] = useState(address);
  useEffect(() => {
    if (address) {
      setHeldAddress(address);
      return;
    }
    const timer = window.setTimeout(() => setHeldAddress(undefined), 2_000);
    return () => window.clearTimeout(timer);
  }, [address]);

  const unique = useMemo(() => {
    const map = new Map<string, Venue>();
    for (const venue of venues) {
      const key = venueKey(venue);
      const existing = map.get(key);
      if (!existing || (existing.action === 'lend' && venue.action === 'borrow')) {
        map.set(key, venue);
      }
    }
    return [...map.values()].sort((left, right) => venueKey(left).localeCompare(venueKey(right)));
  }, [venues]);

  const fingerprint = heldAddress && unique.length > 0 ? callFingerprint(unique, heldAddress) : '';
  const stable = useRef({ unique, fingerprint, address: heldAddress });
  if (fingerprint !== stable.current.fingerprint || heldAddress !== stable.current.address) {
    stable.current = { unique, fingerprint, address: heldAddress };
  }
  const stableUnique = stable.current.unique;
  const stableAddress = stable.current.address;

  const calls = useMemo(() => {
    if (!stableAddress) return [];
    return stableUnique.flatMap((venue) => adapterFor(venue).positionReads(venue, stableAddress));
  }, [stableAddress, stableUnique]);

  const { data, isLoading, isFetching, refetch } = useReadContracts({
    contracts: calls.map((call) => ({
      address: call.address,
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
      chainId: call.chainId,
    })),
    query: {
      enabled: calls.length > 0,
      refetchInterval: 20_000,
      placeholderData: (previous) => previous,
      retry: 2,
    },
  });

  const parsed = useMemo(() => {
    const cacheKey = stableAddress?.toLowerCase();
    const previous = cacheKey ? lastByAddress.get(cacheKey) ?? [] : [];
    if (!data || !stableAddress) return { positions: previous, complete: false };

    const open: OpenPosition[] = [];
    let index = 0;
    let complete = true;
    for (const venue of stableUnique) {
      const reads = adapterFor(venue).positionReads(venue, stableAddress);
      const slice = data.slice(index, index + reads.length);
      index += reads.length;
      if (slice.length !== reads.length || slice.some((row) => row.status !== 'success')) {
        complete = false;
        const kept = previous.find((item) => venueKey(item.venue) === venueKey(venue));
        if (kept && isOpenPosition(venue, kept.snapshot)) open.push({ ...kept, venue });
        continue;
      }
      const snapshot = adapterFor(venue).parsePosition(venue, slice.map((row) => row.result));
      if (isOpenPosition(venue, snapshot)) open.push({ venue, snapshot });
    }
    if (index !== data.length) complete = false;

    if (complete && cacheKey) lastByAddress.set(cacheKey, open);
    if (!complete && open.length === 0 && previous.length > 0) return { positions: previous, complete: false };
    return { positions: open.length > 0 || complete ? open : previous, complete };
  }, [data, stableAddress, stableUnique]);

  return { positions: parsed.positions, isLoading: isLoading && parsed.positions.length === 0, isFetching, refetch };
}
