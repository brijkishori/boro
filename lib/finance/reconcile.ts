import type { Address } from 'viem';
import { erc20Abi } from '@/lib/abi';
import { adapterFor, type PositionSnapshot, type ReadCall } from '@/lib/adapters';
import type { ChainId, Venue } from '@/lib/protocol';
import { highestObservedBlock, rpcClient, rpcUrls } from '@/lib/rpc';
import { canonicalMarketId } from './positionCache';
import {
  positionMatchesExpected,
  positionMoved,
  snapshotIsReadable,
  type ExpectedPositionChange,
  type PositionTxAction,
} from './txSync';

export type ReconcilePhase =
  | 'CONFIRMED_ON_CHAIN'
  | 'RECONCILING_POSITION'
  | 'POSITION_VERIFIED'
  | 'REFRESHING_ENRICHMENT'
  | 'SUCCESS'
  | 'POSITION_SYNC_DELAYED';

export type OnChainPositionRead = {
  snapshot: PositionSnapshot;
  blockNumber: bigint;
  source: string;
  enrichmentPending: boolean;
};

export type ReconcileDiagnostics = {
  receiptBlock: string;
  latestBlock: string;
  readBlock: string;
  marketId: string;
  wallet: string;
  preCollateral: string;
  preDebt: string;
  expectedCollateral: string;
  expectedDebt: string;
  actualCollateral: string;
  actualDebt: string;
  source: string;
};

export type ReconcileResult = {
  phase: ReconcilePhase;
  snapshot: PositionSnapshot | null;
  blockNumber?: bigint;
  source?: string;
  enrichmentPending: boolean;
  attempts: number;
  diagnostics?: ReconcileDiagnostics;
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return 'rpc';
  }
}

export function positionEffectObserved(
  next: Pick<PositionSnapshot, 'collateral' | 'debt' | 'extra'>,
  expected: ExpectedPositionChange,
  priorShares?: bigint,
): boolean {
  if (!snapshotIsReadable(next, expected)) return false;
  if (positionMatchesExpected(next, expected) || positionMoved(next, expected)) return true;
  const shares = next.extra?.shares;
  if (shares === undefined || priorShares === undefined) return false;
  if (expected.action === 'borrow') return shares > priorShares;
  if (expected.action === 'repay') return expected.full ? shares === 0n : shares < priorShares;
  return false;
}

export function chooseAuthoritativeRead<T extends { snapshot: PositionSnapshot }>(
  reads: readonly T[],
  accept: (snapshot: PositionSnapshot) => boolean,
): T | null {
  return reads.find((read) => accept(read.snapshot)) ?? null;
}

function assembleResults(reads: ReadCall[], coreResults: unknown[], enrichmentResults: unknown[]) {
  let coreIndex = 0;
  let enrichmentIndex = 0;
  return reads.map((call) => (
    call.functionName === 'price' ? enrichmentResults[enrichmentIndex++] : coreResults[coreIndex++]
  ));
}

async function readContractAt(client: ReturnType<typeof rpcClient>, call: ReadCall, blockNumber: bigint) {
  return client.readContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName as never,
    args: (call.args ?? []) as never,
    blockNumber,
  });
}

/** Direct contract read at one block. Oracle failure does not discard collateral or debt. */
export async function readDirectPosition(
  venue: Venue,
  user: Address,
  blockNumber: bigint,
  accept?: (snapshot: PositionSnapshot) => boolean,
): Promise<OnChainPositionRead> {
  const adapter = adapterFor(venue);
  const reads = adapter.positionReads(venue, user);
  const groups = adapter.authoritativeReads?.(venue, user) ?? { core: reads, enrichment: [] as ReadCall[] };
  if (groups.core.length === 0) throw new Error('position-unavailable');
  const chainId = venue.chainId;
  const candidates: OnChainPositionRead[] = [];
  let lastError: unknown;
  for (const url of rpcUrls(chainId)) {
    const client = rpcClient(chainId, url);
    try {
      const head = await client.getBlockNumber();
      if (head < blockNumber) continue;
      const coreResults = await Promise.all(groups.core.map((call) => readContractAt(client, call, blockNumber)));
      const enrichmentResults: unknown[] = [];
      let enrichmentPending = false;
      for (const call of groups.enrichment) {
        try {
          enrichmentResults.push(await readContractAt(client, call, blockNumber));
        } catch {
          enrichmentResults.push(0n);
          enrichmentPending = true;
        }
      }
      const results = assembleResults(reads, coreResults, enrichmentResults);
      const snapshot = adapter.parsePosition(venue, results);
      candidates.push({
        snapshot,
        blockNumber,
        source: `on-chain:${venue.protocol}@${hostOf(url)}`,
        enrichmentPending,
      });
    } catch (error) {
      lastError = error;
    }
  }
  const chosen = accept ? chooseAuthoritativeRead(candidates, accept) : candidates[0];
  if (chosen) return chosen;
  if (candidates.length > 0) return candidates[candidates.length - 1];
  throw lastError instanceof Error ? lastError : new Error('position-unavailable');
}

export async function readDirectTokenBalance(
  token: Address,
  chainId: ChainId,
  user: Address,
  blockNumber?: bigint,
): Promise<bigint> {
  let lastError: unknown;
  for (const url of rpcUrls(chainId)) {
    try {
      const client = rpcClient(chainId, url);
      const head = await client.getBlockNumber();
      if (blockNumber !== undefined && head < blockNumber) continue;
      const value = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [user],
        ...(blockNumber !== undefined ? { blockNumber } : {}),
      });
      return typeof value === 'bigint' ? value : 0n;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('balance-unavailable');
}

function expectedCores(expected: ExpectedPositionChange) {
  const reducedDebt = expected.priorDebt > expected.amount ? expected.priorDebt - expected.amount : 0n;
  const reducedCollateral = expected.priorCollateral > expected.amount ? expected.priorCollateral - expected.amount : 0n;
  switch (expected.action) {
    case 'supply':
      return { collateral: expected.priorCollateral + expected.amount, debt: expected.priorDebt };
    case 'borrow':
      return { collateral: expected.priorCollateral, debt: expected.priorDebt + expected.amount };
    case 'repay':
      return { collateral: expected.priorCollateral, debt: expected.full ? 0n : reducedDebt };
    case 'withdraw':
      return { collateral: expected.full ? 0n : reducedCollateral, debt: expected.priorDebt };
  }
}

function diagnostics(input: {
  receiptBlock: bigint;
  latestBlock: bigint;
  readBlock: bigint;
  marketId: string;
  wallet: string;
  preCollateral: bigint;
  preDebt: bigint;
  expected: ExpectedPositionChange;
  actual?: Pick<PositionSnapshot, 'collateral' | 'debt'> | null;
  source: string;
}): ReconcileDiagnostics {
  const target = expectedCores(input.expected);
  return {
    receiptBlock: input.receiptBlock.toString(),
    latestBlock: input.latestBlock.toString(),
    readBlock: input.readBlock.toString(),
    marketId: input.marketId,
    wallet: input.wallet,
    preCollateral: input.preCollateral.toString(),
    preDebt: input.preDebt.toString(),
    expectedCollateral: target.collateral.toString(),
    expectedDebt: target.debt.toString(),
    actualCollateral: input.actual ? input.actual.collateral.toString() : '',
    actualDebt: input.actual ? input.actual.debt.toString() : '',
    source: input.source,
  };
}

function logReconcile(row: ReconcileDiagnostics) {
  if (process.env.NODE_ENV !== 'development') return;
  console.info('[boro:reconcile]', row);
}

async function blockAtOrAbove(
  minimum: bigint,
  getBlockNumber: () => Promise<bigint>,
  waitForBlockAbove?: (minimum: bigint) => Promise<bigint>,
  sleep?: (ms: number) => Promise<void>,
) {
  if (waitForBlockAbove) return waitForBlockAbove(minimum);
  const pause = sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const started = Date.now();
  let latest = await getBlockNumber();
  while (latest < minimum && Date.now() - started < 12_000) {
    await pause(400);
    latest = await getBlockNumber();
  }
  return latest;
}

export async function reconcileConfirmedTransaction(input: {
  protocol: string;
  chainId: number;
  marketId: string;
  wallet: string;
  action: PositionTxAction;
  preCollateral: bigint;
  preDebt: bigint;
  preShares?: bigint;
  expected: ExpectedPositionChange;
  receiptBlock: bigint;
  readOnChain: (blockNumber: bigint) => Promise<OnChainPositionRead>;
  getBlockNumber: () => Promise<bigint>;
  waitForBlockAbove?: (minimum: bigint) => Promise<bigint>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /** Present only so tests can prove an indexer/cache reader is never consulted. */
  indexedPosition?: () => Promise<PositionSnapshot>;
  /** Present only so tests can prove a cached snapshot is not returned. */
  cachedSnapshot?: PositionSnapshot;
  onPhase?: (phase: ReconcilePhase) => void;
}): Promise<ReconcileResult> {
  const indexedIgnored = typeof input.indexedPosition === 'function';
  void input.cachedSnapshot;
  void indexedIgnored;
  input.onPhase?.('CONFIRMED_ON_CHAIN');
  input.onPhase?.('RECONCILING_POSITION');
  const maxAttempts = input.maxAttempts ?? 3;
  let minimum = input.receiptBlock;
  let attempts = 0;
  let last = diagnostics({
    receiptBlock: input.receiptBlock,
    latestBlock: 0n,
    readBlock: 0n,
    marketId: input.marketId,
    wallet: input.wallet,
    preCollateral: input.preCollateral,
    preDebt: input.preDebt,
    expected: input.expected,
    source: 'unread',
  });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let latest = 0n;
    try {
      latest = await input.getBlockNumber();
    } catch {
      latest = 0n;
    }
    if (latest < minimum) {
      try {
        latest = await blockAtOrAbove(minimum, input.getBlockNumber, input.waitForBlockAbove, input.sleep);
      } catch {
        latest = 0n;
      }
    }
    if (latest < input.receiptBlock) {
      last = diagnostics({
        receiptBlock: input.receiptBlock,
        latestBlock: latest,
        readBlock: latest,
        marketId: input.marketId,
        wallet: input.wallet,
        preCollateral: input.preCollateral,
        preDebt: input.preDebt,
        expected: input.expected,
        source: 'behind-head',
      });
      logReconcile(last);
      minimum = input.receiptBlock;
      continue;
    }

    const blocks = attempt === 0 && latest !== input.receiptBlock
      ? [input.receiptBlock, latest]
      : [latest >= input.receiptBlock ? latest : input.receiptBlock];
    for (const block of blocks) {
      if (block < input.receiptBlock) continue;
      attempts += 1;
      try {
        const read = await input.readOnChain(block);
        if (read.blockNumber < input.receiptBlock) continue;
        last = diagnostics({
          receiptBlock: input.receiptBlock,
          latestBlock: latest,
          readBlock: read.blockNumber,
          marketId: input.marketId,
          wallet: input.wallet,
          preCollateral: input.preCollateral,
          preDebt: input.preDebt,
          expected: input.expected,
          actual: read.snapshot,
          source: read.source,
        });
        logReconcile(last);
        if (!positionEffectObserved(read.snapshot, input.expected, input.preShares)) continue;
        input.onPhase?.('POSITION_VERIFIED');
        if (read.enrichmentPending) input.onPhase?.('REFRESHING_ENRICHMENT');
        input.onPhase?.('SUCCESS');
        return {
          phase: 'SUCCESS',
          snapshot: read.snapshot,
          blockNumber: read.blockNumber,
          source: read.source,
          enrichmentPending: read.enrichmentPending,
          attempts,
          diagnostics: last,
        };
      } catch {
        last = diagnostics({
          receiptBlock: input.receiptBlock,
          latestBlock: latest,
          readBlock: block,
          marketId: input.marketId,
          wallet: input.wallet,
          preCollateral: input.preCollateral,
          preDebt: input.preDebt,
          expected: input.expected,
          source: 'on-chain-error',
        });
        logReconcile(last);
      }
    }
    minimum = latest + 1n;
  }

  input.onPhase?.('POSITION_SYNC_DELAYED');
  return {
    phase: 'POSITION_SYNC_DELAYED',
    snapshot: null,
    enrichmentPending: false,
    attempts,
    diagnostics: last,
  };
}

export function marketIdForVenue(venue: Venue) {
  return canonicalMarketId(venue);
}

export function observedHead(chainId: ChainId) {
  return highestObservedBlock(chainId);
}
