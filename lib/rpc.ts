import { createPublicClient, fallback, http, type Chain, type Hash, type PublicClient, type TransactionReceipt, type Transport } from 'viem';
import { base, mainnet } from 'viem/chains';
import type { ChainId } from '@/lib/protocol';

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY?.trim();

function urls(alchemyHost: string, rest: string[]) {
  return alchemyKey ? [`https://${alchemyHost}/v2/${alchemyKey}`, ...rest] : rest;
}

export function rpcUrls(chainId: ChainId): string[] {
  return chainId === 1
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
}

export function chainTransport(chainId: ChainId): Transport {
  return fallback(rpcUrls(chainId).map((url) => http(url, { timeout: 8_000 })));
}

/** Ask each RPC. A "not found" from the first node must not hide a receipt on the next. */
export async function findReceipt(chainId: ChainId, hash: Hash): Promise<TransactionReceipt | null> {
  const chain = chainId === 1 ? mainnet : base;
  let notFound = false;
  for (const url of rpcUrls(chainId)) {
    const client = createPublicClient({ chain, transport: http(url, { timeout: 8_000 }) });
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/could not be found|not be processed/i.test(message)) notFound = true;
    }
  }
  if (notFound) return null;
  throw new Error('receipt-unavailable');
}

export function rpcClient(chainId: ChainId, url: string): PublicClient {
  const chain: Chain = chainId === 1 ? mainnet : base;
  return createPublicClient({ chain, transport: http(url, { timeout: 8_000 }) });
}

/** Highest head across RPCs. A sticky fallback node can lag the receipt. */
export async function highestObservedBlock(chainId: ChainId): Promise<bigint> {
  let best = 0n;
  let saw = false;
  for (const url of rpcUrls(chainId)) {
    try {
      const blockNumber = await rpcClient(chainId, url).getBlockNumber();
      if (blockNumber > best) best = blockNumber;
      saw = true;
    } catch {
      // Try the next URL. One lagging or rate-limited node is not the chain head.
    }
  }
  if (!saw) throw new Error('block-unavailable');
  return best;
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
