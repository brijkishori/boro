import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABOVE_TARGET_MESSAGE,
  clearCompletedDraft,
  collateralShortfallBlocks,
  emptyTransactionDraft,
  manualBorrowDraft,
  planningDeltas,
  positiveRawDelta,
  projectDraft,
  restoreAfterRefresh,
  walletCollateralRequirement,
} from './transactionDraft';

test('A. a manual $1 borrow does not copy the 1 BTC planning target', () => {
  const draft = manualBorrowDraft(1);
  const projected = projectDraft(0.0001, 0, draft);
  assert.equal(draft.collateralDelta, 0);
  assert.equal(draft.borrowDelta, 1);
  assert.equal(projected.collateral, 0.0001);
  assert.equal(projected.debt, 1);
  assert.equal(collateralShortfallBlocks(draft.collateralDelta, 0), false);
});

test('B. Use planning scenario loads only the gap from the current position', () => {
  const deltas = planningDeltas({
    targetCollateral: 1,
    targetDebt: 21_100,
    currentCollateral: 0.0001,
    currentDebt: 0,
  });
  assert.ok(Math.abs(deltas.collateralDelta - 0.9999) < 1e-9);
  assert.equal(deltas.borrowDelta, 21_100);
  assert.equal(deltas.repayDelta, 0);
  assert.equal(deltas.withdrawDelta, 0);
  assert.equal(positiveRawDelta(100_000_000n, 10_000n), 99_990_000n);
});

test('C. a confirmed supply clears only that delta and leaves the planning scenario', () => {
  const planning = { collateral: 1, debt: 21_100 };
  const next = clearCompletedDraft({
    collateralDelta: 0.0001,
    borrowDelta: 1,
    repayDelta: 0,
    withdrawDelta: 0,
  }, 'supply');
  assert.equal(next.collateralDelta, 0);
  assert.equal(next.borrowDelta, 1);
  assert.deepEqual(planning, { collateral: 1, debt: 21_100 });
});

test('D. refresh restores the planning scenario and a zero transaction draft', () => {
  const saved = { collateralAmount: 1, borrowAmount: 21_100 };
  const restored = restoreAfterRefresh(saved);
  assert.equal(restored.scenario, saved);
  assert.deepEqual(restored.draft, emptyTransactionDraft());
});

test('E. a position above the planning target does not create a withdraw or repay', () => {
  const deltas = planningDeltas({
    targetCollateral: 1,
    targetDebt: 21_100,
    currentCollateral: 1.2,
    currentDebt: 25_000,
  });
  assert.equal(deltas.collateralDelta, 0);
  assert.equal(deltas.borrowDelta, 0);
  assert.equal(deltas.withdrawDelta, 0);
  assert.equal(deltas.repayDelta, 0);
  assert.equal(deltas.aboveTarget, true);
  assert.match(ABOVE_TARGET_MESSAGE, /above the planning target/);
});

test('F. wallet collateral validation uses the collateral delta only', () => {
  assert.equal(walletCollateralRequirement(manualBorrowDraft(1)), 0);
  assert.equal(walletCollateralRequirement({ collateralDelta: 0.9999 }), 0.9999);
  assert.equal(collateralShortfallBlocks(0, 0), false);
  assert.equal(collateralShortfallBlocks(1, 0.0001), true);
});
