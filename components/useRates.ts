'use client';

import { useCallback, useEffect, useState } from 'react';
import { isVenueSafe, type RatesPayload, type Venue } from '@/lib/protocol';

function readPayload(body: unknown): RatesPayload | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Partial<RatesPayload>;
  if (!Array.isArray(row.venues) || typeof row.fetchedAt !== 'number') return null;
  const venues = row.venues.filter((venue): venue is Venue => {
    try {
      return isVenueSafe(venue as Venue);
    } catch {
      return false;
    }
  }).sort((left, right) => left.id.localeCompare(right.id));
  return {
    fetchedAt: row.fetchedAt,
    btcPriceUsd: typeof row.btcPriceUsd === 'number' ? row.btcPriceUsd : 0,
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((item) => typeof item === 'string') : [],
    venues,
  };
}

export function useRates() {
  const [payload, setPayload] = useState<RatesPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/rates', { cache: 'no-store' });
      const body: unknown = await response.json();
      const parsed = readPayload(body);
      if (!response.ok || !parsed) {
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : 'Live rates are unavailable.';
        throw new Error(message);
      }
      setPayload(parsed);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live rates are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { payload, error, loading, refresh };
}
