'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAccount, useBalance, useReadContract, useReadContracts } from 'wagmi';
import { erc20Abi } from '@/lib/abi';
import { formatToken, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import { HOLDING_SPECS, TOKEN_HOLDINGS, type HoldingSpec } from '@/lib/holdings';
import { chainLabel, type ChainId } from '@/lib/protocol';
import { useEthUsd } from '@/components/useNetworkFee';

const BTC_USD_FEED = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c' as const;
const FEED_MAX_AGE_SECONDS = 86_400n;

const feedAbi = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

export type WalletHolding = HoldingSpec & {
  amount: bigint;
  usd: number | null;
  amountText: string;
  usdText: string;
  network: string;
};

function feedUsd(data: readonly [bigint, bigint, bigint, bigint, bigint] | undefined) {
  if (!data) return 0;
  const [, answer, , updatedAt] = data;
  if (answer <= 0n) return 0;
  const age = BigInt(Math.floor(Date.now() / 1000)) - updatedAt;
  if (age < 0n || age > FEED_MAX_AGE_SECONDS) return 0;
  return Number(answer) / 1e8;
}

export function useWalletHoldings() {
  const { address, isConnected } = useAccount();
  const ethUsd = useEthUsd();
  const { data: btcFeed } = useReadContract({
    address: BTC_USD_FEED,
    chainId: 1,
    abi: feedAbi,
    functionName: 'latestRoundData',
    query: { refetchInterval: 30_000, staleTime: 15_000 },
  });
  const btcUsd = feedUsd(btcFeed);
  const lastAmounts = useRef<Map<string, bigint>>(new Map());
  useEffect(() => {
    lastAmounts.current.clear();
  }, [address]);
  const query = {
    enabled: Boolean(address),
    refetchInterval: 8_000,
    staleTime: 4_000,
  } as const;
  const ethBase = useBalance({ address, chainId: 8453, query });
  const ethMain = useBalance({ address, chainId: 1, query });
  const tokens = useReadContracts({
    contracts: address
      ? TOKEN_HOLDINGS.map((item) => ({
          address: item.address,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [address] as const,
          chainId: item.chainId,
        }))
      : [],
    query,
  });

  const priceFor = (spec: HoldingSpec) => {
    if (spec.kind === 'stable') return 1;
    if (spec.kind === 'native') return ethUsd ?? 0;
    return btcUsd;
  };

  const rows: WalletHolding[] = useMemo(() => {
    if (!address) return [];
    let tokenIndex = 0;
    return HOLDING_SPECS.map((spec) => {
      const live = spec.kind === 'native'
        ? (spec.chainId === 8453 ? ethBase.data?.value : ethMain.data?.value)
        : tokens.data?.[tokenIndex++]?.result;
      if (typeof live === 'bigint') lastAmounts.current.set(spec.key, live);
      const amount = typeof live === 'bigint' ? live : lastAmounts.current.get(spec.key) ?? 0n;
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
  }, [address, btcUsd, ethUsd, ethBase.data?.value, ethMain.data?.value, tokens.data]);

  const amountOf = useCallback((chainId: ChainId, symbol: string) => {
    return rows.find((row) => row.chainId === chainId && row.symbol === symbol)?.amount ?? 0n;
  }, [rows]);

  const refetch = useCallback(() => {
    void ethBase.refetch();
    void ethMain.refetch();
    void tokens.refetch();
  }, [ethBase, ethMain, tokens]);

  useEffect(() => {
    const onTx = () => refetch();
    window.addEventListener('boro:tx', onTx);
    return () => window.removeEventListener('boro:tx', onTx);
  }, [refetch]);

  return {
    isConnected,
    ready: Boolean(address) && (ethBase.isFetched || tokens.isFetched),
    rows,
    amountOf,
    refetch,
    btcUsd,
  };
}
