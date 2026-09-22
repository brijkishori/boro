'use client';

import { useAccount, useBalance, useEstimateFeesPerGas } from 'wagmi';
import { formatEther } from 'viem';
import type { ChainId } from '@/lib/protocol';

export const GAS_UNITS = {
  approve: 70_000n,
  write: 400_000n,
} as const;

export function useGasCheck(chainId: ChainId | undefined, gasUnits: bigint) {
  const { address } = useAccount();
  const enabled = Boolean(address && chainId);
  const { data: balance } = useBalance({ address, chainId, query: { enabled, refetchInterval: 20_000 } });
  const { data: fees } = useEstimateFeesPerGas({ chainId, query: { enabled, refetchInterval: 20_000 } });
  const feePerGas = fees?.maxFeePerGas ?? fees?.gasPrice;
  const needed = feePerGas ? gasUnits * feePerGas : null;
  const known = balance !== undefined && needed !== null;
  return {
    enough: !known || balance.value >= needed,
    balanceEth: balance ? formatEther(balance.value) : null,
    neededEth: needed !== null ? formatEther(needed) : null,
  };
}

export function shortEth(value: string | null) {
  if (value === null) return '—';
  const number = Number(value);
  if (number === 0) return '0';
  return number < 0.000001 ? '<0.000001' : number.toPrecision(2);
}
