import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Hex } from 'viem';
import { isAwaitingWalletPhase } from './txSync';
import { findTxByNonce, nonceShowsSubmission, watchSubmittedTransaction } from './txWatch';

test('G. a recovered hash leaves AWAITING_WALLET even if the wallet hook is still pending', () => {
  assert.equal(isAwaitingWalletPhase('awaiting_wallet'), true);
  assert.equal(isAwaitingWalletPhase('submitted'), false);
  assert.equal(isAwaitingWalletPhase('submitted', '0xabc'), false);
});

test('nonce increase means the wallet already submitted', () => {
  assert.equal(nonceShowsSubmission(5, 5), false);
  assert.equal(nonceShowsSubmission(5, 6), true);
  assert.equal(nonceShowsSubmission(5, 5, 6), true);
});

test('watch recovers a hash after the first stale nonce read', async () => {
  const nonces = [
    { latest: 4, pending: 4 },
    { latest: 4, pending: 5 },
    { latest: 5, pending: 5 },
  ];
  const hashes: Array<Hex | null> = [null, null, '0xdeadbeef'];
  let submitted = false;
  const found = await watchSubmittedTransaction({
    startNonce: 4,
    readNonces: async () => nonces.shift() ?? { latest: 5, pending: 5 },
    findHash: async () => hashes.shift() ?? '0xdeadbeef',
    onSubmitted: () => {
      submitted = true;
    },
    isCancelled: () => false,
    sleep: async () => {},
    intervalMs: 1,
    maxMs: 1_000,
  });
  assert.equal(found, '0xdeadbeef');
  assert.equal(submitted, true);
});

test('findTxByNonce matches the account nonce and target', async () => {
  const hash = await findTxByNonce({
    getBlockNumber: async () => 10n,
    getBlock: async (blockNumber) => ({
      transactions: blockNumber === 10n
        ? [{ hash: '0xabc', from: '0xAAA', to: '0xBBB', nonce: 4 }]
        : [],
    }),
    account: '0xaaa',
    startNonce: 4,
    to: '0xbbb',
  });
  assert.equal(hash, '0xabc');
});
