import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collateralUsdValue, distanceToLiquidation, loanToValue } from './ltv';

test('LTV is debt over collateral', () => {
  assert.equal(loanToValue(100_000, 40_000), 0.4);
  assert.equal(loanToValue(0, 40_000), null);
});

test('21100 on 84385 collateral is about 25% LTV', () => {
  const ltv = loanToValue(84_385, 21_100);
  assert.ok(ltv);
  assert.ok(Math.abs(ltv - 0.25) < 0.001);
});

test('distance to liquidation is the remaining price drop', () => {
  assert.equal(distanceToLiquidation(100_000, 80_000), 0.2);
  assert.equal(distanceToLiquidation(0, 80_000), null);
});

test('collateral USD needs both amount and price', () => {
  assert.equal(collateralUsdValue(0.5, 80_000), 40_000);
  assert.equal(collateralUsdValue(0.5, 0), null);
});
