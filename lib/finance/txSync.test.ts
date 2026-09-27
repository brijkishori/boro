import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PositionSnapshot } from '../adapters';
import {
  overlayCachedPosition,
  preferFreshPosition,
  readFreshPosition,
  writeFreshBalance,
  writeFreshPosition,
} from './positionCache';
import { morphoAdapter } from '../adapters/morpho';
import type { Venue } from '../protocol';
import {
  canSubmitTransaction,
  createSubmissionGate,
  expectedFromTx,
  isAwaitingWalletPhase,
  refreshStatusMessage,
  phaseAfterHashReturned,
  positionMatchesExpected,
  positionMoved,
  refreshPositionAfterReceipt,
  snapshotIsReadable,
  TX_NOT_MINED_COPY,
  TX_REFRESH_FAILED_COPY,
} from './txSync';

function snapshot(collateral: bigint, debt: bigint): PositionSnapshot {
  return {
    collateral,
    debt,
    maxBorrow: 0n,
    borrowRoom: 0n,
    withdrawMax: collateral,
    healthFactor: debt > 0n ? 2 : null,
    ltv: 0,
    liquidationPrice: 0,
    ready: true,
  };
}

const venue = {
  protocol: 'morpho' as const,
  chainId: 8453 as const,
  assetAddress: '0x0000000000000000000000000000000000000001' as const,
  morpho: { marketId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
};

test('A. successful supply receipt automatically reflects new collateral', async () => {
  const prior = snapshot(1_000n, 0n);
  const expected = expectedFromTx({ action: 'supply', amount: 250n, priorCollateral: prior.collateral, priorDebt: prior.debt });
  const fresh = snapshot(1_250n, 0n);
  const result = await refreshPositionAfterReceipt({
    fetch: async () => fresh,
    expected,
    sleep: async () => {},
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.snapshot.collateral, 1_250n);
  writeFreshPosition({ venue, user: '0xabc', snapshot: result.snapshot });
  const shown = overlayCachedPosition(venue, '0xabc', prior);
  assert.equal(shown.collateral, 1_250n);
});

test('B. successful borrow shows fresh debt without a page reload', async () => {
  const prior = snapshot(1_000n, 0n);
  const expected = expectedFromTx({ action: 'borrow', amount: 400n, priorCollateral: prior.collateral, priorDebt: prior.debt });
  const result = await refreshPositionAfterReceipt({
    fetch: async () => snapshot(1_000n, 400n),
    expected,
    sleep: async () => {},
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.snapshot.debt, 400n);
  writeFreshPosition({ venue, user: '0xborrow', snapshot: result.snapshot });
  assert.equal(overlayCachedPosition(venue, '0xborrow', prior).debt, 400n);
});

test('C. successful repay shows the reduced debt', async () => {
  const prior = snapshot(1_000n, 500n);
  const expected = expectedFromTx({ action: 'repay', amount: 200n, priorCollateral: prior.collateral, priorDebt: prior.debt });
  const result = await refreshPositionAfterReceipt({
    fetch: async () => snapshot(1_000n, 300n),
    expected,
    sleep: async () => {},
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.snapshot.debt, 300n);
});

test('D. successful withdraw shows the reduced collateral', async () => {
  const prior = snapshot(1_000n, 0n);
  const expected = expectedFromTx({ action: 'withdraw', amount: 400n, priorCollateral: prior.collateral, priorDebt: prior.debt });
  const result = await refreshPositionAfterReceipt({
    fetch: async () => snapshot(600n, 0n),
    expected,
    sleep: async () => {},
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.snapshot.collateral, 600n);
});

test('E. stale first position read retries with bounded backoff and then updates', async () => {
  const expected = expectedFromTx({ action: 'supply', amount: 100n, priorCollateral: 1_000n, priorDebt: 0n });
  const reads = [snapshot(1_000n, 0n), snapshot(1_000n, 0n), snapshot(1_100n, 0n)];
  const delays: number[] = [];
  const result = await refreshPositionAfterReceipt({
    fetch: async () => reads.shift() ?? snapshot(1_100n, 0n),
    expected,
    delays: [0, 1_000, 2_000, 4_000],
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
  assert.equal(result.snapshot.collateral, 1_100n);
});

test('F. receipt success with failed position refresh stays confirmed-on-chain and blocks a duplicate send', async () => {
  const expected = expectedFromTx({ action: 'supply', amount: 100n, priorCollateral: 1_000n, priorDebt: 0n });
  const result = await refreshPositionAfterReceipt({
    fetch: async () => {
      throw new Error('rpc-lag');
    },
    expected,
    delays: [0, 1_000],
    sleep: async () => {},
  });
  assert.equal(result.status, 'failed');
  assert.equal(canSubmitTransaction('refresh_failed', '0xhash'), false);
  assert.equal(canSubmitTransaction('success'), true);
});

test('G. a returned tx hash leaves the AWAITING_WALLET phase', () => {
  assert.equal(isAwaitingWalletPhase('awaiting_wallet'), true);
  assert.equal(isAwaitingWalletPhase('awaiting_wallet', '0xabc'), false);
  assert.equal(phaseAfterHashReturned(), 'submitted');
  assert.equal(isAwaitingWalletPhase(phaseAfterHashReturned(), '0xabc'), false);
  assert.equal(isAwaitingWalletPhase('submitted'), false);
  assert.equal(canSubmitTransaction('submitted'), false);
  assert.equal(canSubmitTransaction('awaiting_wallet'), false);
});

test('H. duplicate confirm while unresolved only allows one send', () => {
  const gate = createSubmissionGate();
  assert.equal(gate.tryBegin(), true);
  assert.equal(gate.tryBegin(), false);
  gate.setHash('0xabc');
  assert.equal(gate.tryBegin(), false);
  gate.unlockIfNoHash();
  assert.equal(gate.tryBegin(), false);
  gate.resolve();
  assert.equal(gate.tryBegin(), true);
});

test('full repay and full withdraw accept protocol-safe zero', () => {
  assert.equal(positionMatchesExpected(snapshot(1_000n, 1n), {
    action: 'repay',
    priorCollateral: 1_000n,
    priorDebt: 500n,
    amount: 500n,
    full: true,
  }), true);
  assert.equal(positionMatchesExpected(snapshot(1n, 0n), {
    action: 'withdraw',
    priorCollateral: 800n,
    priorDebt: 0n,
    amount: 800n,
    full: true,
  }), true);
});

test('named Morpho position struct supplies collateral and debt', () => {
  const market = {
    id: 'borrow:morpho:8453:cbbtc',
    protocol: 'morpho' as const,
    action: 'borrow' as const,
    chainId: 8453 as const,
    assetSymbol: 'cbBTC',
    assetKind: 'custodial' as const,
    assetAddress: '0x0000000000000000000000000000000000000001' as const,
    assetDecimals: 8,
    loanSymbol: 'USDC',
    loanAddress: '0x0000000000000000000000000000000000000002' as const,
    loanDecimals: 6,
    borrowApr: 0.05,
    supplyApr: 0.03,
    maxLtv: 0.86,
    liquidityUsd: 1,
    priceUsd: 84_000,
    morpho: {
      marketId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
      loanToken: '0x0000000000000000000000000000000000000002' as const,
      collateralToken: '0x0000000000000000000000000000000000000001' as const,
      oracle: '0x0000000000000000000000000000000000000003' as const,
      irm: '0x0000000000000000000000000000000000000004' as const,
      lltv: '860000000000000000',
    },
  } satisfies Venue;
  const named = morphoAdapter.parsePosition(market, [
    { supplyShares: 0n, borrowShares: 1_000n, collateral: 1_259_343n },
    { totalSupplyAssets: 1n, totalSupplyShares: 1n, totalBorrowAssets: 2_000_000n, totalBorrowShares: 1_000n, lastUpdate: 0n, fee: 0n },
    10n ** 36n,
  ]);
  assert.equal(named.collateral, 1_259_343n);
  assert.ok(named.debt > 0n);
  const indexed = morphoAdapter.parsePosition(market, [
    [0n, 1_000n, 1_259_343n],
    [1n, 1n, 2_000_000n, 1_000n, 0n, 0n],
    10n ** 36n,
  ]);
  assert.equal(indexed.collateral, named.collateral);
  assert.equal(indexed.debt, named.debt);
});

test('retry can replace the generic refresh failure with a specific notice', () => {
  assert.equal(refreshStatusMessage('refresh_failed'), TX_REFRESH_FAILED_COPY);
  assert.equal(refreshStatusMessage('refresh_failed', TX_NOT_MINED_COPY), TX_NOT_MINED_COPY);
  assert.equal(refreshStatusMessage('success', 'ignored'), undefined);
});

test('full withdraw counts once collateral has decreased', () => {
  const expected = expectedFromTx({ action: 'withdraw', amount: 10_000n, priorCollateral: 10_000n, priorDebt: 0n, full: true });
  assert.ok(expected);
  assert.equal(positionMoved(snapshot(0n, 0n), expected), true);
  assert.equal(positionMoved(snapshot(10_000n, 0n), expected), false);
});

test('a zeroed struct is not treated as a loaded supply position', async () => {
  const expected = expectedFromTx({ action: 'supply', amount: 100_000n, priorCollateral: 1_159_343n, priorDebt: 2_792_415n });
  assert.ok(expected);
  assert.equal(snapshotIsReadable(snapshot(0n, 0n), expected), false);
  assert.equal(positionMoved(snapshot(1_259_343n, 2_792_415n), expected), true);
  const result = await refreshPositionAfterReceipt({
    fetch: async () => snapshot(0n, 0n),
    expected,
    delays: [0, 1],
    sleep: async () => {},
  });
  assert.equal(result.status, 'failed');
});

test('cached position is preferred over a stale live read', () => {
  const live = snapshot(1_000n, 0n);
  const fresh = snapshot(1_400n, 0n);
  writeFreshPosition({ venue, user: '0xcache', snapshot: fresh });
  const cached = readFreshPosition(venue, '0xcache');
  assert.equal(preferFreshPosition(live, cached).collateral, 1_400n);
  writeFreshBalance('0x0000000000000000000000000000000000000001', 8453, '0xcache', 55n);
});
