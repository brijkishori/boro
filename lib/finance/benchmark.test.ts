import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annualInterestDifference, benchmarkSpread, rateAlertLevel, stressRows } from './benchmark';

test('spread is benchmark minus crypto APR', () => {
  assert.ok(Math.abs((benchmarkSpread(0.0749, 0.0491) ?? 0) - 0.0258) < 1e-10);
  assert.equal(benchmarkSpread(Number.NaN, 0.05), null);
});

test('annual difference uses the user balance', () => {
  assert.ok(Math.abs((annualInterestDifference(21_080, 0.0258) ?? 0) - 543.864) < 1e-6);
  assert.equal(annualInterestDifference(0, 0.02), null);
});

test('alert thresholds use configurable buffers', () => {
  assert.equal(rateAlertLevel(0.05, 0.0749, { warningBufferBps: 100, criticalBufferBps: 0 }), 'green');
  assert.equal(rateAlertLevel(0.07, 0.0749, { warningBufferBps: 100, criticalBufferBps: 0 }), 'yellow');
  assert.equal(rateAlertLevel(0.075, 0.0749, { warningBufferBps: 100, criticalBufferBps: 0 }), 'red');
});

test('stress rows compare each APR to the optional benchmark and insert the break-even rate', () => {
  const rows = stressRows(10_000, [0.05, 0.1], 0.08);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].yearOneInterest, 500);
  assert.ok(rows[0].spread && Math.abs(rows[0].spread - 0.03) < 1e-10);
  const breakEven = rows.find((row) => row.breakEven);
  assert.ok(breakEven);
  assert.equal(breakEven.rate, 0.08);
  assert.equal(breakEven.spread, 0);
  assert.ok(rows[2].spread && rows[2].spread < 0);
});

test('stress rows use declining principal when a monthly payment is provided', () => {
  const rows = stressRows(10_000, [0.12], 0.12, 400);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].declining, true);
  assert.equal(rows[0].breakEven, true);
  assert.ok(rows[0].yearOneInterest < 1_200);
  assert.ok(rows[0].months && rows[0].months > 0);
  assert.ok(rows[0].totalInterest && rows[0].totalInterest > 0);
});
