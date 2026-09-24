'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { erc20Abi } from '@/lib/abi';
import { formatToken, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import { HOLDING_SPECS, type HoldingSpec } from '@/lib/holdings';
import { chainLabel, type ChainId } from '@/lib/protocol';
import { publicClient } from '@/lib/rpc';
import { useUsdPrices } from '@/components/useUsdPrices';

export type WalletHolding = HoldingSpec & {
  amount: bigint;
  usd: number | null;
  amountText: string;
  usdText: string;
  network: string;
};

async function readHolding(spec: HoldingSpec, address: `0x${string}`) {
  const client = publicClient(spec.chainId);
  if (spec.kind === 'native') return client.getBalance({ address });
  if (!spec.address) return 0n;
  return client.readContract({
    address: spec.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

export function useWalletHoldings() {
  const { address, isConnected } = useAccount();
  const { ethUsd, btcUsd } = useUsdPrices();
  const [amounts, setAmounts] = useState<Map<string, bigint>>(() => new Map());
  const [ready, setReady] = useState(false);
  const lastAmounts = useRef<Map<string, bigint>>(new Map());

  const load = useCallback(async () => {
    if (!address) {
      lastAmounts.current.clear();
      setAmounts(new Map());
      setReady(false);
      return;
    }
    const next = new Map<string, bigint>();
    const rows = await Promise.all(HOLDING_SPECS.map(async (spec) => {
      try {
        return [spec.key, await readHolding(spec, address)] as const;
      } catch {
        return [spec.key, lastAmounts.current.get(spec.key)] as const;
      }
    }));
    for (const [key, value] of rows) {
      if (typeof value !== 'bigint') continue;
      next.set(key, value);
      lastAmounts.current.set(key, value);
    }
    setAmounts(new Map(next));
    setReady(true);
  }, [address]);

  useEffect(() => {
    lastAmounts.current.clear();
    setAmounts(new Map());
    setReady(false);
  }, [address]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8_000);
    const onTx = () => void load();
    window.addEventListener('boro:tx', onTx);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('boro:tx', onTx);
    };
  }, [load]);

  const priceFor = useCallback((spec: HoldingSpec) => {
    if (spec.kind === 'stable') return 1;
    if (spec.kind === 'native') return ethUsd;
    return btcUsd;
  }, [btcUsd, ethUsd]);

  const rows: WalletHolding[] = useMemo(() => {
    if (!address) return [];
    return HOLDING_SPECS.map((spec) => {
      const amount = amounts.get(spec.key) ?? lastAmounts.current.get(spec.key) ?? 0n;
      const usd = tokenAmountUsd(amount, spec.decimals, priceFor(spec));
      return {
        ...spec,
        amount,
        usd,
        amountText: formatToken(amount, spec.decimals),
        usdText: usd === null ? '—' : formatUsdExact(usd),
        network: chainLabel(spec.chainId),
      };
    });
  }, [address, amounts, priceFor]);

  const amountOf = useCallback((chainId: ChainId, symbol: string) => {
    return rows.find((row) => row.chainId === chainId && row.symbol === symbol)?.amount ?? 0n;
  }, [rows]);

  return {
    isConnected,
    ready: Boolean(address) && ready,
    rows,
    amountOf,
    refetch: load,
    btcUsd,
    ethUsd,
  };
}
