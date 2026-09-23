import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import { base, mainnet } from 'viem/chains';
import type { ChainId } from '@/lib/protocol';

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY?.trim();

function transport(fallback: string, alchemyHost: string) {
  return http(alchemyKey ? `https://${alchemyHost}/v2/${alchemyKey}` : fallback);
}

const clients: Partial<Record<ChainId, PublicClient>> = {};

export function publicClient(chainId: ChainId): PublicClient {
  const existing = clients[chainId];
  if (existing) return existing;
  const chain: Chain = chainId === 1 ? mainnet : base;
  const client = createPublicClient({
    chain,
    transport: chainId === 1
      ? transport('https://ethereum.publicnode.com', 'eth-mainnet.g.alchemy.com')
      : transport('https://mainnet.base.org', 'base-mainnet.g.alchemy.com'),
  });
  clients[chainId] = client;
  return client;
}
