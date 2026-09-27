import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amortizationEstimate, simulateDecliningBalance } from './amortization';

test('warns when payment does not cover interest', () => {
  const estimate = amortizationEstimate(20_000, 0.12, 100);
  assert.ok(estimate);
  assert.equal(estimate.coversInterest, false);
  assert.equal(estimate.months, null);
  assert.ok(estimate.firstInterest > 100);
});

test('amortizes when payment covers interest', () => {
  const estimate = amortizationEstimate(10_000, 0.12, 400);
  assert.ok(estimate);
  assert.equal(estimate.coversInterest, true);
  assert.ok(estimate.months && estimate.months > 20 && estimate.months < 40);
  assert.ok(estimate.totalInterest && estimate.totalInterest > 0);
  assert.ok(estimate.firstPrincipal > 0);
});

test('declining-balance next-12-month interest is below a flat annualized charge', () => {
  const estimate = simulateDecliningBalance(10_000, 0.12, 400);
  assert.ok(estimate?.coversInterest);
  const annualized = 10_000 * 0.12;
  assert.ok(estimate.next12MonthInterest < annualized);
  assert.ok(estimate.next12MonthInterest > 0);
  let remaining = 10_000;
  let year = 0;
  let total = 0;
  let months = 0;
  while (remaining > 1e-8 && months < 12_000) {
    const interest = remaining * 0.01;
    const payment = Math.min(400, remaining + interest);
    remaining -= payment - interest;
    total += interest;
    months += 1;
    if (months <= 12) year += interest;
  }
  assert.ok(Math.abs(estimate.next12MonthInterest - year) < 1e-6);
  assert.ok(Math.abs((estimate.totalInterest ?? 0) - total) < 1e-6);
  assert.equal(estimate.months, months);
});

test('declining-balance total interest is less than payment times months minus a shortcut last-period overcharge', () => {
  const estimate = simulateDecliningBalance(21_100, 0.05, 400);
  assert.ok(estimate?.coversInterest);
  assert.ok(estimate.totalInterest !== null && estimate.months !== null);
  const closedForm = 400 * estimate.months - 21_100;
  assert.ok(estimate.totalInterest <= closedForm + 1e-6);
  assert.ok(estimate.next12MonthInterest < 21_100 * 0.05);
});
