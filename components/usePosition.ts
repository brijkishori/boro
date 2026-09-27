'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { adapterFor, type PositionSnapshot } from '@/lib/adapters';
import { emptyPosition } from '@/lib/adapters/position';
import { overlayCachedPosition, positionCacheVersion, readFreshBalance, subscribeFreshBalance, subscribeFreshPosition } from '@/lib/finance/positionCache';
import type { Venue } from '@/lib/protocol';

export function useFreshTokenBalance(token: Address | undefined, chainId: number | undefined, user: Address | undefined) {
  return useSyncExternalStore(subscribeFreshBalance, () => readFreshBalance(token, chainId, user), () => null);
}

export function usePosition(venue: Venue | null, user: Address | undefined, enabled: boolean) {
  const adapter = venue ? adapterFor(venue) : null;
  const cacheEpoch = useSyncExternalStore(subscribeFreshPosition, positionCacheVersion, () => 0);
  const reads = useMemo(
    () => (venue && user && adapter ? adapter.positionReads(venue, user) : []),
    [adapter, user, venue],
  );
  const refreshedEpoch = useRef(0);
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
  useEffect(() => {
    if (!enabled || cacheEpoch === 0 || refreshedEpoch.current === cacheEpoch) return;
    refreshedEpoch.current = cacheEpoch;
    void refetch();
  }, [cacheEpoch, enabled, refetch]);
  const snapshot: PositionSnapshot = useMemo(() => {
    if (!venue || !adapter) return emptyPosition();
    const results = (data ?? []).map((row) => row.result);
    const parsed = results.length === 0 || results.some((value) => value === undefined)
      ? emptyPosition()
      : adapter.parsePosition(venue, results);
    return cacheEpoch >= 0 ? overlayCachedPosition(venue, user, parsed) : parsed;
  }, [adapter, cacheEpoch, data, user, venue]);
  return { snapshot, refetch, isFetching };
}
