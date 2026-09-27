import type { Address, Hex } from 'viem';

export const TX_WATCH_INTERVAL_MS = 1_500;
export const TX_WATCH_MAX_MS = 90_000;
export const TX_SUBMITTED_COPY = 'If you already confirmed, we are checking the network for your transaction…';

export type RecoveredTx = {
  hash: Hex;
  submittedWithoutWalletHash: boolean;
};

export function nonceShowsSubmission(startNonce: number, latestNonce: number, pendingNonce?: number) {
  if (latestNonce > startNonce) return true;
  return typeof pendingNonce === 'number' && pendingNonce > startNonce;
}

export async function watchSubmittedTransaction(input: {
  readNonces: () => Promise<{ latest: number; pending?: number }>;
  findHash: () => Promise<Hex | null>;
  onSubmitted?: () => void;
  isCancelled: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxMs?: number;
  startNonce: number;
}): Promise<Hex | null> {
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const interval = input.intervalMs ?? TX_WATCH_INTERVAL_MS;
  const deadline = Date.now() + (input.maxMs ?? TX_WATCH_MAX_MS);
  let announced = false;
  while (!input.isCancelled() && Date.now() < deadline) {
    try {
      const nonces = await input.readNonces();
      if (nonceShowsSubmission(input.startNonce, nonces.latest, nonces.pending)) {
        if (!announced) {
          announced = true;
          input.onSubmitted?.();
        }
        const hash = await input.findHash();
        if (hash) return hash;
      }
    } catch {
      // RPC lag should not keep the UI on the wallet prompt.
    }
    await sleep(interval);
  }
  return null;
}

export async function findTxByNonce(input: {
  getBlockNumber: () => Promise<bigint>;
  getBlock: (blockNumber: bigint) => Promise<{ transactions: readonly { hash: Hex; from: string; to?: string | null; nonce: number }[] | readonly Hex[] }>;
  account: Address;
  startNonce: number;
  to?: Address;
  lookback?: number;
}): Promise<Hex | null> {
  const latest = await input.getBlockNumber();
  const lookback = BigInt(input.lookback ?? 16);
  const from = latest > lookback ? latest - lookback : 0n;
  const account = input.account.toLowerCase();
  const to = input.to?.toLowerCase();
  for (let blockNumber = latest; blockNumber >= from; blockNumber--) {
    const block = await input.getBlock(blockNumber);
    for (const tx of block.transactions) {
      if (typeof tx === 'string') continue;
      if (tx.from.toLowerCase() !== account) continue;
      if (tx.nonce !== input.startNonce) continue;
      if (to && tx.to && tx.to.toLowerCase() !== to) continue;
      return tx.hash;
    }
  }
  return null;
}
