import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PositionSnapshot } from '../adapters';
import { positionCacheKey } from './positionCache';
import {
  chooseAuthoritativeRead,
  positionEffectObserved,
  reconcileConfirmedTransaction,
  type OnChainPositionRead,
} from './reconcile';
import { expectedFromTx } from './txSync';

function snapshot(collateral: bigint, debt: bigint, shares?: bigint): PositionSnapshot {
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
    extra: shares === undefined ? undefined : { shares },
  };
}

function onChain(collateral: bigint, blockNumber: bigint, enrichmentPending = false): OnChainPositionRead {
  return {
    snapshot: snapshot(collateral, 0n),
    blockNumber,
    source: 'on-chain:morpho@base.example',
    enrichmentPending,
  };
}

const venue = {
  protocol: 'morpho' as const,
  chainId: 8453 as const,
  assetAddress: '0x0000000000000000000000000000000000000001' as const,
  morpho: { marketId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
};

const supply = expectedFromTx({ action: 'supply', amount: 10_000n, priorCollateral: 0n, priorDebt: 0n });

test('stale indexed read loses to the direct position at the receipt block', async () => {
  assert.ok(supply);
  let indexedCalls = 0;
  const indexedPosition = async () => {
    indexedCalls += 1;
    return snapshot(0n, 0n);
  };
  const cachedSnapshot = snapshot(0n, 0n);
  const blocks: bigint[] = [];
  const result = await reconcileConfirmedTransaction({
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho.marketId,
    wallet: '0xabc',
    action: 'supply',
    preCollateral: 0n,
    preDebt: 0n,
    expected: supply,
    receiptBlock: 100n,
    indexedPosition,
    cachedSnapshot,
    getBlockNumber: async () => 101n,
    readOnChain: async (blockNumber) => {
      blocks.push(blockNumber);
      return onChain(10_000n, blockNumber);
    },
  });
  assert.equal(indexedCalls, 0);
  assert.equal(result.phase, 'SUCCESS');
  assert.equal(result.snapshot?.collateral, 10_000n);
  assert.notEqual(result.snapshot, cachedSnapshot);
  assert.equal(blocks[0], 100n);
  assert.equal(result.blockNumber !== undefined && result.blockNumber >= 100n, true);
});

test('a later block is observed after the receipt block is still stale', async () => {
  assert.ok(supply);
  let head = 100n;
  const seen: bigint[] = [];
  const result = await reconcileConfirmedTransaction({
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho.marketId,
    wallet: '0xabc',
    action: 'supply',
    preCollateral: 0n,
    preDebt: 0n,
    expected: supply,
    receiptBlock: 100n,
    getBlockNumber: async () => head,
    waitForBlockAbove: async (minimum) => {
      head = minimum;
      return head;
    },
    readOnChain: async (blockNumber) => {
      seen.push(blockNumber);
      return onChain(blockNumber >= 101n ? 10_000n : 0n, blockNumber);
    },
  });
  assert.equal(result.phase, 'SUCCESS');
  assert.equal(result.snapshot?.collateral, 10_000n);
  assert.deepEqual(seen, [100n, 101n]);
});

test('manual retry performs a new direct read and does not return the cached position', async () => {
  assert.ok(supply);
  const cachedSnapshot = snapshot(0n, 0n);
  let calls = 0;
  const readOnChain = async (blockNumber: bigint) => {
    calls += 1;
    return onChain(calls === 1 ? 0n : 10_000n, blockNumber);
  };
  const first = await reconcileConfirmedTransaction({
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho.marketId,
    wallet: '0xabc',
    action: 'supply',
    preCollateral: 0n,
    preDebt: 0n,
    expected: supply,
    receiptBlock: 100n,
    maxAttempts: 1,
    cachedSnapshot,
    getBlockNumber: async () => 100n,
    readOnChain,
  });
  assert.equal(first.phase, 'POSITION_SYNC_DELAYED');
  assert.equal(first.snapshot, null);
  assert.equal(calls, 1);
  const retry = await reconcileConfirmedTransaction({
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho.marketId,
    wallet: '0xabc',
    action: 'supply',
    preCollateral: 0n,
    preDebt: 0n,
    expected: supply,
    receiptBlock: 100n,
    maxAttempts: 1,
    cachedSnapshot,
    getBlockNumber: async () => 102n,
    readOnChain,
  });
  assert.equal(calls, 2);
  assert.equal(retry.phase, 'SUCCESS');
  assert.equal(retry.snapshot?.collateral, 10_000n);
  assert.notEqual(retry.snapshot, cachedSnapshot);
});

test('a read from before the receipt block cannot verify the position', async () => {
  assert.ok(supply);
  const result = await reconcileConfirmedTransaction({
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho.marketId,
    wallet: '0xabc',
    action: 'supply',
    preCollateral: 0n,
    preDebt: 0n,
    expected: supply,
    receiptBlock: 100n,
    maxAttempts: 1,
    getBlockNumber: async () => 100n,
    readOnChain: async () => onChain(10_000n, 99n),
  });
  assert.equal(result.phase, 'POSITION_SYNC_DELAYED');
  assert.equal(result.snapshot, null);
});

test('oracle enrichment can lag without blocking a verified core position', async () => {
  assert.ok(supply);
  const result = await reconcileConfirmedTransaction({
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho.marketId,
    wallet: '0xabc',
    action: 'supply',
    preCollateral: 0n,
    preDebt: 0n,
    expected: supply,
    receiptBlock: 100n,
    getBlockNumber: async () => 100n,
    readOnChain: async (blockNumber) => onChain(10_000n, blockNumber, true),
  });
  assert.equal(result.phase, 'SUCCESS');
  assert.equal(result.enrichmentPending, true);
  assert.equal(result.snapshot?.collateral, 10_000n);
});

test('direct read selection prefers the node that already shows the supply', () => {
  const stale = onChain(0n, 100n);
  stale.source = 'on-chain:morpho@lagging.example';
  const fresh = onChain(10_000n, 100n);
  const chosen = chooseAuthoritativeRead([stale, fresh], (next) => positionEffectObserved(next, supply!));
  assert.equal(chosen, fresh);
});

test('position cache key includes chain, protocol, market, and wallet', () => {
  assert.equal(
    positionCacheKey(venue, '0xAbC'),
    `position:8453:morpho:${venue.morpho.marketId}:0x0000000000000000000000000000000000000001:0xabc`,
  );
});
