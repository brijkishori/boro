import { getAddress, type Address } from 'viem';
import { CHAINS, type ChainId } from '@/lib/protocol';

export type HoldingKind = 'native' | 'stable' | 'btc';

export type HoldingSpec = {
  key: string;
  chainId: ChainId;
  symbol: string;
  decimals: number;
  kind: HoldingKind;
  address?: Address;
};

export const HOLDING_CHAINS: ChainId[] = [8453, 1];

export const HOLDING_SPECS: HoldingSpec[] = HOLDING_CHAINS.flatMap((chainId) => {
  const tokens = CHAINS[chainId];
  const native: HoldingSpec = {
    key: `${chainId}:ETH`,
    chainId,
    symbol: 'ETH',
    decimals: 18,
    kind: 'native',
  };
  const usdc: HoldingSpec = {
    key: `${chainId}:USDC`,
    chainId,
    symbol: 'USDC',
    decimals: tokens.usdc.decimals,
    kind: 'stable',
    address: tokens.usdc.address,
  };
  const btc = tokens.btc.map((token) => ({
    key: `${chainId}:${token.symbol}`,
    chainId,
    symbol: token.symbol,
    decimals: token.decimals,
    kind: 'btc' as const,
    address: getAddress(token.address),
  }));
  return [native, usdc, ...btc];
});

export const TOKEN_HOLDINGS = HOLDING_SPECS.filter((item): item is HoldingSpec & { address: Address } => Boolean(item.address));
