'use client';

import { useEffect, useState } from 'react';
import type { RateHistoryMetrics } from '@/lib/finance/history';

export function useVenueHistory(venueId: string | null, enabled: boolean) {
  const [metrics, setMetrics] = useState<RateHistoryMetrics | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !venueId) return;
    let cancelled = false;
    fetch(`/api/rates/history?venue=${encodeURIComponent(venueId)}&range=365d`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { metrics?: RateHistoryMetrics } | null) => {
        if (cancelled) return;
        setMetrics(body?.metrics ?? null);
        setVersion((value) => value + 1);
      })
      .catch(() => {
        if (cancelled) return;
        setMetrics(null);
        setVersion((value) => value + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [venueId, enabled]);

  return { metrics, loading: enabled && version === 0 && !metrics };
}
