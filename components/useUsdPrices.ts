'use client';

import { useEffect, useState } from 'react';
import { fetchUsdPrices, type UsdPrices } from '@/lib/prices';

let last: UsdPrices = { ethUsd: 0, btcUsd: 0 };
const listeners = new Set<(prices: UsdPrices) => void>();
let inflight: Promise<void> | null = null;

async function refresh() {
  if (inflight) return inflight;
  inflight = fetchUsdPrices()
    .then((next) => {
      const merged = {
        ethUsd: next.ethUsd || last.ethUsd,
        btcUsd: next.btcUsd || last.btcUsd,
      };
      if (merged.ethUsd === last.ethUsd && merged.btcUsd === last.btcUsd) return;
      last = merged;
      listeners.forEach((listener) => listener(merged));
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useUsdPrices(): UsdPrices {
  const [prices, setPrices] = useState<UsdPrices>(last);
  useEffect(() => {
    listeners.add(setPrices);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      listeners.delete(setPrices);
      window.clearInterval(timer);
    };
  }, []);
  return prices;
}
