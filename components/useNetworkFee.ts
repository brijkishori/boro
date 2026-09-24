'use client';

import { useSyncExternalStore } from 'react';
import { useGasPrice } from 'wagmi';
import { formatEther, type Hex } from 'viem';
import type { ChainId } from '@/lib/protocol';
import { useUsdPrices } from '@/components/useUsdPrices';

export const TYPICAL_GAS: Record<string, bigint> = {
  approve: 60_000n,
  reset: 40_000n,
  supply: 260_000n,
  borrow: 330_000n,
  repay: 230_000n,
  withdraw: 260_000n,
  isolate: 90_000n,
};

export type FeeRecord = {
  hash: Hex;
  chainId: number;
  action: string;
  feeWei: string;
  ethUsd: number | null;
  at: number;
};

const STORE_KEY = 'boro:fees:v1';
const MAX_RECORDS = 200;
const listeners = new Set<() => void>();
let cached: FeeRecord[] | null = null;

function readStore(): FeeRecord[] {
  if (cached) return cached;
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '[]');
    cached = Array.isArray(parsed)
      ? parsed.filter((row): row is FeeRecord => typeof row?.hash === 'string' && typeof row?.feeWei === 'string' && /^\d+$/.test(row.feeWei))
      : [];
  } catch {
    cached = [];
  }
  return cached;
}

const EMPTY: FeeRecord[] = [];

export function recordFee(record: FeeRecord) {
  const rows = readStore();
  if (rows.some((row) => row.hash === record.hash)) return;
  cached = [record, ...rows].slice(0, MAX_RECORDS);
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(cached));
  } catch {
    // Storage can be full or blocked; the in-memory list still updates.
  }
  listeners.forEach((listener) => listener());
}

export function clearFees() {
  cached = [];
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    // Ignore blocked storage.
  }
  listeners.forEach((listener) => listener());
}

export function useFeeHistory(): FeeRecord[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readStore,
    () => EMPTY,
  );
}

export function useEthUsd(): number | null {
  const { ethUsd } = useUsdPrices();
  return ethUsd > 0 ? ethUsd : null;
}

export function useFeeEstimate(chainId: ChainId | undefined, action: string) {
  const { data: gasPrice } = useGasPrice({ chainId, query: { enabled: Boolean(chainId), refetchInterval: 20_000 } });
  const ethUsd = useEthUsd();
  const units = TYPICAL_GAS[action] ?? TYPICAL_GAS.supply;
  const wei = gasPrice ? units * gasPrice : null;
  return { wei, usd: wei !== null && ethUsd !== null ? weiToUsd(wei, ethUsd) : null };
}

export function weiToUsd(wei: bigint, ethUsd: number): number {
  return Number(formatEther(wei)) * ethUsd;
}

export function formatEth(wei: bigint): string {
  const value = Number(formatEther(wei));
  if (value === 0) return '0 ETH';
  if (value < 0.00000001) return '<0.00000001 ETH';
  return `${value.toFixed(value < 0.001 ? 8 : 6).replace(/0+$/, '').replace(/\.$/, '')} ETH`;
}

export function formatFeeUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return '$—';
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function explorerTx(chainId: number, hash: string): string {
  return chainId === 8453 ? `https://basescan.org/tx/${hash}` : `https://etherscan.io/tx/${hash}`;
}
