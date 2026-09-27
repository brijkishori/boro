import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactHistoryRows, formatFreshness, formatPercentPoints, formatSpreadShort, historyRows, yearOneInterestLabel } from './display';

test('freshness stays empty without a timestamp', () => {
  assert.equal(formatFreshness(undefined), null);
});

test('freshness uses seconds for recent updates', () => {
  assert.equal(formatFreshness(1_000, 33_000), 'Updated 32 sec ago');
});

test('history rows omit missing windows', () => {
  const rows = historyRows({ currentApr: 0.05, avg7d: 0.048 });
  assert.deepEqual(rows.map((row) => row.label), ['Current', '7-day avg']);
});

test('spread wording is generic', () => {
  assert.equal(formatPercentPoints(0.0258), '+2.58 percentage points');
  assert.equal(formatSpreadShort(0.0258), '2.58 pp lower');
  assert.equal(formatSpreadShort(-0.01), '1.00 pp higher');
});

test('interest labels distinguish declining next-12-month from annualized', () => {
  assert.equal(yearOneInterestLabel(true), 'Estimated next-12-month interest');
  assert.equal(yearOneInterestLabel(false), 'Annualized interest at current balance');
});

test('compact history keeps only headline windows', () => {
  const rows = compactHistoryRows({
    currentApr: 0.05,
    avg24h: 0.049,
    avg7d: 0.048,
    avg30d: 0.047,
    high365d: 0.09,
    low7d: 0.04,
  });
  assert.deepEqual(rows.map((row) => row.label), ['Current', '7-day avg', '30-day avg', '1-year high']);
});
