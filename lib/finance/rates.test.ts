import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annualInterest, aprFromApy, apyFromApr, monthlyInterest, normalizeBorrowRate } from './rates';

test('APR and APY convert both ways under per-second compounding', () => {
  const apr = 0.05;
  const apy = apyFromApr(apr);
  assert.ok(apy > apr);
  assert.ok(Math.abs(aprFromApy(apy) - apr) < 1e-9);
});

test('APY-to-APR conversion keeps the source APY and a lower normalized APR', () => {
  const sourceApy = 0.049;
  const normalized = normalizeBorrowRate('APY', sourceApy);
  assert.ok(normalized);
  assert.equal(normalized.sourceRateType, 'APY');
  assert.equal(normalized.sourceValue, sourceApy);
  assert.ok(normalized.apr < sourceApy);
  assert.equal(normalized.apy, sourceApy);
  assert.ok(Math.abs(aprFromApy(sourceApy) - normalized.apr) < 1e-12);
});

test('normalize keeps the source value and fills the other representation', () => {
  const fromApy = normalizeBorrowRate('APY', 0.05127);
  assert.ok(fromApy);
  assert.equal(fromApy.sourceRateType, 'APY');
  assert.equal(fromApy.sourceValue, 0.05127);
  assert.ok(fromApy.apr < fromApy.apy);
  const fromApr = normalizeBorrowRate('APR', fromApy.apr);
  assert.ok(fromApr);
  assert.ok(Math.abs(fromApr.apy - fromApy.apy) < 1e-9);
});

test('rejects missing or out-of-range rates', () => {
  assert.equal(normalizeBorrowRate('APR', Number.NaN), null);
  assert.equal(normalizeBorrowRate('APY', -0.01), null);
  assert.equal(normalizeBorrowRate('APR', 1), null);
});

test('interest helpers scale with balance', () => {
  assert.equal(annualInterest(10_000, 0.05), 500);
  assert.ok(Math.abs(monthlyInterest(12_000, 0.12) - 120) < 1e-10);
  assert.equal(annualInterest(0, 0.05), 0);
});
