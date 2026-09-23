'use client';

import { useMemo, useRef } from 'react';
import { useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { adapterFor, type PositionSnapshot } from '@/lib/adapters';
import { emptyPosition } from '@/lib/adapters/position';
import type { Venue } from '@/lib/protocol';

function venueKey(venue: Venue | null, user: Address | undefined) {
  return venue && user ? `${venue.id}:${user.toLowerCase()}` : '';
}

export function usePosition(venue: Venue | null, user: Address | undefined, enabled: boolean) {
  const adapter = venue ? adapterFor(venue) : null;
  const key = venueKey(venue, user);
  const reads = useMemo(
    () => (venue && user && adapter ? adapter.positionReads(venue, user) : []),
    [adapter, key, user, venue],
  );
  const last = useRef<{ key: string; snapshot: PositionSnapshot }>({ key: '', snapshot: emptyPosition() });
  const { data, refetch, isFetching } = useReadContracts({
    contracts: reads.map((call) => ({
      address: call.address,
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
      chainId: call.chainId,
    })),
    query: {
      enabled: enabled && reads.length > 0,
      refetchInterval: 20_000,
      placeholderData: (previous) => previous,
    },
  });
  const snapshot: PositionSnapshot = useMemo(() => {
    if (!venue || !adapter) return last.current.key === key ? last.current.snapshot : emptyPosition();
    const results = (data ?? []).map((row) => row.result);
    if (results.length === 0 || results.some((value) => value === undefined)) {
      return last.current.key === key ? last.current.snapshot : emptyPosition();
    }
    const next = adapter.parsePosition(venue, results);
    last.current = { key, snapshot: next };
    return next;
  }, [adapter, data, key, venue]);
  return { snapshot, refetch, isFetching };
}
