import type { PositionSnapshot } from '@/lib/adapters';

export const POSITION_RETRY_DELAYS_MS = [0, 1_000, 2_000, 4_000] as const;
export const POSITION_SYNC_TOLERANCE = 2n;

export const TX_REFRESHING_COPY = 'Transaction confirmed on-chain. Refreshing your position...';
export const TX_REFRESH_FAILED_COPY = 'Transaction confirmed, but the latest position could not yet be loaded.';
export const TX_RETRY_CHECKING_COPY = 'Checking Base again for your updated position…';
export const TX_NOT_MINED_COPY = 'This transaction is not on Base, so the position cannot update. Dismiss, then review the withdrawal again. Nothing was withdrawn.';
export const TX_POSITION_SYNC_DELAYED_COPY = 'Transaction confirmed on-chain, but SimpleBTC has not yet observed the updated protocol position.';
export const TX_POSITION_UNCHANGED_COPY = TX_POSITION_SYNC_DELAYED_COPY;
export const TX_ENRICHMENT_COPY = 'Position confirmed on-chain. Updating market data...';

export type TxPhase =
  | 'idle'
  | 'awaiting_wallet'
  | 'submitted'
  | 'awaiting_receipt'
  | 'confirmed'
  | 'refreshing_position'
  | 'success'
  | 'refresh_failed'
  | 'error';

export type PositionTxAction = 'supply' | 'borrow' | 'repay' | 'withdraw';

export type ExpectedPositionChange = {
  action: PositionTxAction;
  priorCollateral: bigint;
  priorDebt: bigint;
  amount: bigint;
  full?: boolean;
};

export type PositionRefreshResult =
  | { status: 'updated'; snapshot: PositionSnapshot; attempts: number }
  | { status: 'stale'; snapshot: PositionSnapshot | null; attempts: number }
  | { status: 'failed'; snapshot: null; attempts: number };

export function isPositionTxAction(action: string): action is PositionTxAction {
  return action === 'supply' || action === 'borrow' || action === 'repay' || action === 'withdraw';
}

export function isAwaitingWalletPhase(phase: TxPhase, hash?: string): boolean {
  return phase === 'awaiting_wallet' && !hash;
}

export function phaseAfterHashReturned(): TxPhase {
  return 'submitted';
}

export function refreshStatusMessage(phase: TxPhase, notice?: string) {
  if (notice === TX_ENRICHMENT_COPY) return notice;
  if (phase !== 'refreshing_position' && phase !== 'refresh_failed') return undefined;
  if (notice) return notice;
  return phase === 'refreshing_position' ? TX_REFRESHING_COPY : TX_REFRESH_FAILED_COPY;
}

export function canSubmitTransaction(phase: TxPhase, hash?: string): boolean {
  if (phase === 'submitted' || phase === 'awaiting_receipt' || phase === 'confirmed' || phase === 'refreshing_position' || phase === 'refresh_failed' || phase === 'awaiting_wallet') {
    return false;
  }
  if (hash && phase !== 'success' && phase !== 'error' && phase !== 'idle') return false;
  return phase === 'idle' || phase === 'success' || phase === 'error';
}

export function createSubmissionGate() {
  let locked = false;
  let hash: string | undefined;
  return {
    tryBegin(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    setHash(next: string) {
      hash = next;
      locked = true;
    },
    hasHash() {
      return Boolean(hash);
    },
    unlockIfNoHash() {
      if (!hash) locked = false;
    },
    resolve() {
      locked = false;
      hash = undefined;
    },
    isLocked() {
      return locked;
    },
  };
}

function toleranceFor(amount: bigint) {
  const relative = amount / 10_000n;
  return relative > POSITION_SYNC_TOLERANCE ? relative : POSITION_SYNC_TOLERANCE;
}

export function snapshotIsReadable(
  next: Pick<PositionSnapshot, 'collateral' | 'debt'>,
  expected: ExpectedPositionChange,
): boolean {
  if (expected.action === 'supply' && expected.priorCollateral > 0n && next.collateral === 0n) return false;
  if (expected.action === 'borrow' && expected.priorCollateral > 0n && next.collateral === 0n && next.debt === 0n) return false;
  if (expected.action === 'repay' && expected.priorCollateral > 0n && next.collateral === 0n && next.debt === 0n && !expected.full) return false;
  if (expected.action === 'withdraw' && expected.priorDebt > 0n && next.collateral === 0n && next.debt === 0n && !expected.full) return false;
  return true;
}

export function positionMoved(
  next: Pick<PositionSnapshot, 'collateral' | 'debt'>,
  expected: ExpectedPositionChange,
): boolean {
  switch (expected.action) {
    case 'supply':
      return next.collateral > expected.priorCollateral;
    case 'borrow':
      return next.debt > expected.priorDebt;
    case 'repay':
      if (next.debt < expected.priorDebt) return true;
      return Boolean(expected.full) && next.debt <= toleranceFor(expected.priorDebt || expected.amount);
    case 'withdraw':
      if (next.collateral < expected.priorCollateral) return true;
      return Boolean(expected.full) && next.collateral <= toleranceFor(expected.priorCollateral || expected.amount);
  }
}

export function positionMatchesExpected(
  next: Pick<PositionSnapshot, 'collateral' | 'debt'>,
  expected: ExpectedPositionChange,
): boolean {
  const tol = toleranceFor(expected.amount);
  switch (expected.action) {
    case 'supply':
      return next.collateral + tol >= expected.priorCollateral + expected.amount;
    case 'borrow':
      return next.debt + tol >= expected.priorDebt + expected.amount;
    case 'repay': {
      if (expected.full) return next.debt <= tol;
      const reduced = expected.priorDebt > expected.amount ? expected.priorDebt - expected.amount : 0n;
      return next.debt <= reduced + tol;
    }
    case 'withdraw': {
      if (expected.full) return next.collateral <= tol;
      const reduced = expected.priorCollateral > expected.amount ? expected.priorCollateral - expected.amount : 0n;
      return next.collateral <= reduced + tol;
    }
  }
}

export function expectedFromTx(input: {
  action: string;
  amount: bigint;
  priorCollateral?: bigint;
  priorDebt?: bigint;
  full?: boolean;
}): ExpectedPositionChange | undefined {
  if (!isPositionTxAction(input.action)) return undefined;
  return {
    action: input.action,
    priorCollateral: input.priorCollateral ?? 0n,
    priorDebt: input.priorDebt ?? 0n,
    amount: input.amount,
    full: input.full,
  };
}

export async function refreshPositionAfterReceipt(input: {
  fetch: () => Promise<PositionSnapshot>;
  expected?: ExpectedPositionChange;
  sleep?: (ms: number) => Promise<void>;
  delays?: readonly number[];
}): Promise<PositionRefreshResult> {
  const delays = input.delays ?? POSITION_RETRY_DELAYS_MS;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }));
  let last: PositionSnapshot | null = null;
  let attempts = 0;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    attempts += 1;
    try {
      const snapshot = await input.fetch();
      if (input.expected && !snapshotIsReadable(snapshot, input.expected)) {
        throw new Error('position-unparsed');
      }
      last = snapshot;
      if (!input.expected || positionMatchesExpected(snapshot, input.expected) || positionMoved(snapshot, input.expected)) {
        return { status: 'updated', snapshot, attempts };
      }
    } catch {
      // Indexers and RPC nodes can lag; try the remaining backoff windows.
    }
  }
  if (last) return { status: 'stale', snapshot: last, attempts };
  return { status: 'failed', snapshot: null, attempts };
}
