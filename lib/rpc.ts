import { createPublicClient, fallback, http, type Chain, type PublicClient, type Transport } from 'viem';
import { base, mainnet } from 'viem/chains';
import type { ChainId } from '@/lib/protocol';

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY?.trim();

function urls(alchemyHost: string, rest: string[]) {
  return alchemyKey ? [`https://${alchemyHost}/v2/${alchemyKey}`, ...rest] : rest;
}

export function chainTransport(chainId: ChainId): Transport {
  const list = chainId === 1
    ? urls('eth-mainnet.g.alchemy.com', [
        'https://ethereum-rpc.publicnode.com',
        'https://eth.llamarpc.com',
        'https://cloudflare-eth.com',
      ])
    : urls('base-mainnet.g.alchemy.com', [
        'https://mainnet.base.org',
        'https://base.llamarpc.com',
        'https://base-rpc.publicnode.com',
      ]);
  return fallback(list.map((url) => http(url, { timeout: 8_000 })));
}

const clients: Partial<Record<ChainId, PublicClient>> = {};

export function publicClient(chainId: ChainId): PublicClient {
  const existing = clients[chainId];
  if (existing) return existing;
  const chain: Chain = chainId === 1 ? mainnet : base;
  const client = createPublicClient({
    chain,
    transport: chainTransport(chainId),
  });
  clients[chainId] = client;
  return client;
}
