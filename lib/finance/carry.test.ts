import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXAMPLE_CARRY_PRINCIPAL, grossAnnualCarry, grossMonthlyCarry, rateSpread } from './carry';

test('gross annual carry is principal times APR spread, not percentage points', () => {
  const annual = grossAnnualCarry(1_000, 0.0478, 0.1469);
  assert.ok(annual);
  assert.ok(Math.abs(annual - 99.1) < 1e-10);
  assert.notEqual(Number(annual.toFixed(2)), 9.91);
});

test('carry scales linearly across 100, 1000, and 10000 principals', () => {
  const borrow = 0.0478;
  const lend = 0.1469;
  const perDollar = 0.0991;
  for (const principal of [100, 1_000, 10_000]) {
    const annual = grossAnnualCarry(principal, borrow, lend);
    assert.ok(annual);
    assert.ok(Math.abs(annual - principal * perDollar) < 1e-10);
    const monthly = grossMonthlyCarry(principal, borrow, lend);
    assert.ok(monthly);
    assert.ok(Math.abs(monthly - annual / 12) < 1e-10);
  }
});

test('carry works for arbitrary principal and rate values', () => {
  const annual = grossAnnualCarry(2_500, 0.06, 0.11);
  assert.equal(annual, 125);
  assert.equal(grossMonthlyCarry(2_500, 0.06, 0.11), 125 / 12);
});

test('rejects percentage-point rates and missing principal', () => {
  assert.equal(grossAnnualCarry(1_000, 4.78, 14.69), null);
  assert.equal(grossAnnualCarry(0, 0.05, 0.1), null);
  assert.equal(rateSpread(0.1, 0.05), 0.05);
  assert.equal(EXAMPLE_CARRY_PRINCIPAL, 1_000);
});
