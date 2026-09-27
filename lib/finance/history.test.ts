import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HISTORY_INSUFFICIENT_DAYS, HISTORY_LIMITED_DAYS, historyCoverage, historyCoverageLabel, historyMetrics } from './history';

test('does not invent windows with fewer than two points', () => {
  const now = 1_700_000_000;
  const metrics = historyMetrics([{ t: now - 100, value: 0.05 }], now);
  assert.equal(metrics.avg7d, undefined);
  assert.equal(metrics.high30d, undefined);
});

test('computes averages only from real points in range', () => {
  const now = 1_700_000_000;
  const points = [
    { t: now - 6 * 86_400, value: 0.04 },
    { t: now - 86_400, value: 0.06 },
    { t: now - 40 * 86_400, value: 0.2 },
  ];
  const metrics = historyMetrics(points, now);
  assert.equal(metrics.avg7d, 0.05);
  assert.equal(metrics.high7d, 0.06);
  assert.equal(metrics.low7d, 0.04);
  assert.equal(metrics.avg365d, undefined);
});

test('missing or short history is insufficient, not stable', () => {
  const now = 1_700_000_000;
  const short = historyMetrics([
    { t: now - 10 * 86_400, value: 0.04 },
    { t: now - 86_400, value: 0.041 },
  ], now);
  assert.ok((short.coverageDays ?? 0) < HISTORY_INSUFFICIENT_DAYS);
  assert.equal(historyCoverage(short), 'insufficient');
  assert.equal(historyCoverage(undefined), 'insufficient');
  assert.equal(historyCoverage({ volatility30d: 0 }), 'limited');
  assert.equal(historyCoverageLabel('insufficient'), 'Insufficient history');
  assert.equal(historyCoverageLabel('limited'), 'Limited history');
});

test('coverage thresholds live in constants', () => {
  assert.equal(HISTORY_INSUFFICIENT_DAYS, 30);
  assert.equal(HISTORY_LIMITED_DAYS, 90);
  const now = 1_700_000_000;
  const limited = historyMetrics([
    { t: now - 45 * 86_400, value: 0.04 },
    { t: now - 86_400, value: 0.041 },
  ], now);
  const adequate = historyMetrics([
    { t: now - 120 * 86_400, value: 0.04 },
    { t: now - 86_400, value: 0.041 },
  ], now);
  assert.equal(historyCoverage(limited), 'limited');
  assert.equal(historyCoverage(adequate), 'adequate');
});
