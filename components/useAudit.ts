'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Address } from 'viem';
import {
  buildSeedEvent,
  episodeKey,
  fetchRemoteEvents,
  findOpenEpisode,
  liveSplit,
  migrateFeeRows,
  persistAuditEvent,
  readLocalEvents,
  rebuildEpisodes,
  subscribeAudit,
  writeLocalEvents,
  type AuditEvent,
  type AuditVenue,
  type LiveSplit,
  type LoanEpisode,
} from '@/lib/audit';
import type { OpenPosition } from '@/components/useAllPositions';

const EMPTY: AuditEvent[] = [];

function useLocalEvents(wallet: string | undefined) {
  return useSyncExternalStore(
    subscribeAudit,
    () => (wallet ? readLocalEvents(wallet) : EMPTY),
    () => EMPTY,
  );
}

export function useAudit(wallet: Address | undefined) {
  const address = wallet?.toLowerCase();
  const local = useLocalEvents(address);
  const [durable, setDurable] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!address) {
      setReady(false);
      return;
    }
    migrateFeeRows(address);
    let cancelled = false;
    void fetchRemoteEvents(address).then((remote) => {
      if (cancelled) return;
      setDurable(remote.durable);
      if (remote.events.length > 0) writeLocalEvents(address, [...readLocalEvents(address), ...remote.events]);
      const leftover = readLocalEvents(address).filter((event) => !remote.events.some((row) => row.hash === event.hash));
      if (leftover.length > 0) {
        void fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, events: leftover }),
        }).catch(() => {});
      }
      setReady(true);
    }).catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const events = local;
  const episodes = useMemo(() => rebuildEpisodes(events), [events]);

  const seedOpen = useCallback((positions: OpenPosition[]) => {
    if (!address || !ready) return;
    const incoming: AuditEvent[] = [];
    const seen = new Set<string>();
    for (const { venue, snapshot } of positions) {
      if (venue.action !== 'borrow' || snapshot.debt <= 0n) continue;
      const key = episodeKey(address, venue);
      if (seen.has(key) || episodes.some((item) => item.key === key)) {
        seen.add(key);
        continue;
      }
      seen.add(key);
      incoming.push(buildSeedEvent(address, venue, snapshot.debt));
    }
    if (incoming.length === 0) return;
    incoming.forEach(persistAuditEvent);
  }, [address, episodes, ready]);

  const splitFor = useCallback((venue: AuditVenue, debt: bigint): LiveSplit => {
    if (!address) return liveSplit(null, debt);
    return liveSplit(findOpenEpisode(episodes, episodeKey(address, venue)), debt);
  }, [address, episodes]);

  return { events, episodes, durable, ready, seedOpen, splitFor };
}

export function episodeForVenue(episodes: LoanEpisode[], wallet: string | undefined, venue: AuditVenue) {
  if (!wallet) return null;
  return findOpenEpisode(episodes, episodeKey(wallet, venue));
}
