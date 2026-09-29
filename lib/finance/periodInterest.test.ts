import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuditEvent } from '../audit';
import { formatUsdExact } from '../amount';
import { sampleAlertEmails } from '../alertEmail';
import {
  actualInterestDuringPeriod,
  countEmailPositions,
  digestLines,
  liveLikeOpenLoan,
  projectedInterestCost,
  summarizeEpisodePeriod,
  type DigestPosition,
} from './periodInterest';

const DEBT = 21_101.62;
const APR = 0.0467;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 28, 13, 0, 0);

function usdc(usd: number) {
  return BigInt(Math.round(usd * 1_000_000));
}

function event(partial: Partial<AuditEvent> & Pick<AuditEvent, 'hash' | 'at' | 'action' | 'amount'>): AuditEvent {
  return {
    wallet: '0xabc',
    chainId: 8453,
    protocol: 'morpho',
    venueId: 'market-1',
    episodeKey: 'episode-1',
    assetSymbol: 'cbBTC',
    loanSymbol: 'USDC',
    amountUsd: null,
    decimals: 6,
    borrowApr: APR,
    supplyApr: null,
    priceUsd: null,
    healthFactor: null,
    collateral: '0',
    debt: '0',
    feeWei: '0',
    ethUsd: null,
    ...partial,
  };
}

function position(partial: Partial<DigestPosition> & Pick<DigestPosition, 'debtUsd' | 'apr' | 'actualUsd' | 'actualStatus'>): DigestPosition {
  return {
    name: 'Morpho Blue · cbBTC · Base',
    principalRemainingUsd: partial.debtUsd,
    accruedUnpaidUsd: null,
    ltv: 0.23,
    healthFactor: 3.42,
    liquidationPriceUsd: 49_000,
    interestPaidUsd: 0,
    principalRepaidUsd: 0,
    additionalBorrowingUsd: 0,
    networkFeesUsd: 0,
    ...partial,
  };
}

test('A. debt times current APR times 7/365 is a next-7-day estimate, not accrued interest', () => {
  const projected = projectedInterestCost(DEBT, APR);
  const expected = DEBT * APR * 7 / 365;
  assert.ok(projected.next7Days !== null && Math.abs(projected.next7Days - expected) < 1e-9);
  assert.ok(Math.abs(projected.next7Days - DEBT * APR / 52) > 0.01);
  assert.ok(projected.month !== null && Math.abs(projected.month - 82.13) < 0.02);
  const week = digestLines('week', [
    position({ debtUsd: DEBT, apr: APR, actualUsd: null, actualStatus: 'unavailable' }),
  ], []);
  const month = digestLines('month', [
    position({ debtUsd: DEBT, apr: APR, actualUsd: null, actualStatus: 'unavailable' }),
  ], []);
  const estimate = formatUsdExact(projected.next7Days);
  const monthlyEstimate = formatUsdExact(projected.month ?? 0);
  assert.equal(week.find((line) => line.startsWith('Actual weekly') || line.startsWith('Interest accrued this week')), 'Actual weekly interest unavailable');
  assert.ok(week.some((line) => line === `Estimated next-7-day interest at current balance and APR: ${estimate}`));
  assert.equal(week.some((line) => line === `Interest accrued this week: ${estimate}`), false);
  assert.equal(week.some((line) => line.includes('interest accrued this week') && line.includes(estimate)), false);
  assert.equal(month.find((line) => line.startsWith('Actual monthly') || line.startsWith('Interest accrued this month')), 'Actual monthly interest unavailable');
  assert.ok(month.some((line) => line === `Estimated monthly interest at current balance and APR: ${monthlyEstimate}`));
  assert.equal(month.some((line) => line === `Interest accrued this month: ${monthlyEstimate}`), false);
  assert.equal(month.some((line) => line === `Interest paid this month: ${monthlyEstimate}`), false);
});

test('B. a loan opened one day ago accrues only since opening', () => {
  const openedAt = NOW - DAY;
  const principal = usdc(DEBT);
  const accrued = usdc(2.7);
  const summary = summarizeEpisodePeriod({
    events: [event({ hash: '0xopen', at: openedAt, action: 'borrow', amount: principal.toString(), borrowApr: 0.03 })],
    episodeKey: 'episode-1',
    periodStart: NOW - 7 * DAY,
    periodEnd: NOW,
    endingDebt: principal + accrued,
    decimals: 6,
  });
  assert.equal(summary.actual.status, 'since-opening');
  assert.ok(summary.actual.usd !== null && Math.abs(summary.actual.usd - 2.7) < 0.001);
  const projected = projectedInterestCost(DEBT + 2.7, APR);
  assert.ok(projected.next7Days !== null && summary.actual.usd < projected.next7Days / 2);
  const lines = digestLines('week', [
    position({
      debtUsd: DEBT + 2.7,
      apr: APR,
      actualUsd: summary.actual.usd,
      actualStatus: summary.actual.status,
      accruedUnpaidUsd: summary.accruedUnpaidUsd,
    }),
  ], []);
  assert.ok(lines.some((line) => line.startsWith('Interest accrued this week:') && line.includes(formatUsdExact(2.7)) && line.includes('since this loan opened during the period')));
  assert.equal(lines.some((line) => line.startsWith('Interest accrued this week:') && line.includes(formatUsdExact(projected.next7Days ?? 0))), false);
});

test('C. a later APR is not applied to the earlier part of the week', () => {
  const periodStart = NOW - 7 * DAY;
  const principal = usdc(DEBT);
  const withoutBoundary = summarizeEpisodePeriod({
    events: [event({ hash: '0xopen', at: NOW - 30 * DAY, action: 'borrow', amount: principal.toString(), borrowApr: 0.03 })],
    episodeKey: 'episode-1',
    periodStart,
    periodEnd: NOW,
    endingDebt: principal + usdc(40),
    decimals: 6,
  });
  const currentProjection = projectedInterestCost(DEBT + 40, 0.1).next7Days;
  const openingProjection = projectedInterestCost(DEBT + 40, 0.03).next7Days;
  assert.equal(withoutBoundary.actual.status, 'unavailable');
  assert.equal(withoutBoundary.actual.usd, null);
  assert.ok(withoutBoundary.accruedUnpaidUsd !== null && Math.abs(withoutBoundary.accruedUnpaidUsd - 40) < 0.001);
  assert.notEqual(withoutBoundary.actual.usd, currentProjection);
  assert.notEqual(withoutBoundary.actual.usd, openingProjection);

  const withBoundary = summarizeEpisodePeriod({
    events: [
      event({ hash: '0xopen', at: NOW - 30 * DAY, action: 'borrow', amount: principal.toString(), borrowApr: 0.03 }),
      event({
        hash: '0xboundary',
        at: periodStart,
        action: 'repay',
        amount: '0',
        interestPaid: '0',
        principalPaid: '0',
        principalRemaining: principal.toString(),
        interestRemaining: usdc(10).toString(),
      }),
      event({
        hash: '0xpay',
        at: NOW - DAY,
        action: 'repay',
        amount: usdc(3).toString(),
        debt: (principal + usdc(11)).toString(),
        interestPaid: usdc(1).toString(),
        principalPaid: usdc(2).toString(),
        principalRemaining: (principal - usdc(2)).toString(),
        interestRemaining: usdc(10).toString(),
      }),
    ],
    episodeKey: 'episode-1',
    periodStart,
    periodEnd: NOW,
    endingDebt: principal - usdc(2) + usdc(12),
    decimals: 6,
  });
  assert.equal(withBoundary.actual.status, 'measured');
  assert.ok(withBoundary.actual.usd !== null && Math.abs(withBoundary.actual.usd - 3) < 0.001);
  assert.notEqual(withBoundary.actual.usd, currentProjection);
  assert.ok(withBoundary.periodStartSnapshot && Math.abs(withBoundary.periodStartSnapshot.accruedUnpaidUsd - 10) < 0.001);
  assert.ok(withBoundary.periodEndSnapshot && Math.abs(withBoundary.periodEndSnapshot.accruedUnpaidUsd - 12) < 0.001);
});

test('D. a repayment splits interest and principal', () => {
  const summary = summarizeEpisodePeriod({
    events: [
      event({ hash: '0xopen', at: NOW - 2 * DAY, action: 'borrow', amount: usdc(100).toString() }),
      event({
        hash: '0xrepay',
        at: NOW - DAY,
        action: 'repay',
        amount: usdc(13).toString(),
        debt: usdc(105).toString(),
        interestPaid: usdc(3).toString(),
        principalPaid: usdc(10).toString(),
        principalRemaining: usdc(90).toString(),
        interestRemaining: usdc(2).toString(),
      }),
    ],
    episodeKey: 'episode-1',
    periodStart: NOW - 7 * DAY,
    periodEnd: NOW,
    endingDebt: usdc(92),
    decimals: 6,
  });
  assert.equal(summary.actual.status, 'since-opening');
  assert.ok(summary.actual.usd !== null && Math.abs(summary.actual.usd - 5) < 0.001);
  assert.ok(summary.interestPaidUsd !== null && Math.abs(summary.interestPaidUsd - 3) < 0.001);
  assert.ok(summary.principalRepaidUsd !== null && Math.abs(summary.principalRepaidUsd - 10) < 0.001);
  assert.notEqual(summary.actual.usd, summary.principalRepaidUsd);
});

test('E. additional borrowing is not interest', () => {
  const summary = summarizeEpisodePeriod({
    events: [
      event({ hash: '0xopen', at: NOW - 2 * DAY, action: 'borrow', amount: usdc(100).toString() }),
      event({ hash: '0xmore', at: NOW - DAY, action: 'borrow', amount: usdc(50).toString(), borrowApr: 0.08 }),
    ],
    episodeKey: 'episode-1',
    periodStart: NOW - 7 * DAY,
    periodEnd: NOW,
    endingDebt: usdc(154),
    decimals: 6,
  });
  assert.ok(summary.actual.usd !== null && Math.abs(summary.actual.usd - 4) < 0.001);
  assert.ok(summary.additionalBorrowingUsd !== null && Math.abs(summary.additionalBorrowingUsd - 150) < 0.001);
  assert.notEqual(summary.actual.usd, 50);
  assert.notEqual(summary.actual.usd, summary.additionalBorrowingUsd);
  const formula = actualInterestDuringPeriod({
    periodStart: NOW - 7 * DAY,
    periodEnd: NOW,
    openedAt: NOW - 2 * DAY,
    openedByBorrow: true,
    beginningAccruedUsd: 0,
    endingAccruedUsd: 4,
    interestPaidUsd: 0,
  });
  assert.equal(formula.usd, 4);
});

test('a loan that closes during the period keeps repaid principal out of interest', () => {
  const summary = summarizeEpisodePeriod({
    events: [
      event({ hash: '0xopen', at: NOW - 2 * DAY, action: 'borrow', amount: usdc(100).toString() }),
      event({
        hash: '0xclose',
        at: NOW - DAY,
        action: 'repay',
        amount: usdc(103).toString(),
        closing: true,
        interestPaid: usdc(3).toString(),
        principalPaid: usdc(100).toString(),
        principalRemaining: '0',
        interestRemaining: '0',
      }),
    ],
    episodeKey: 'episode-1',
    periodStart: NOW - 7 * DAY,
    periodEnd: NOW,
    endingDebt: 0n,
    decimals: 6,
  });
  assert.equal(summary.actual.status, 'since-opening');
  assert.ok(summary.actual.usd !== null && Math.abs(summary.actual.usd - 3) < 0.001);
  assert.ok(summary.principalRepaidUsd !== null && Math.abs(summary.principalRepaidUsd - 100) < 0.001);
  assert.equal(summary.accruedUnpaidUsd, 0);
  assert.notEqual(summary.actual.usd, summary.principalRepaidUsd);
});

test('a loan opened yesterday reports unpaid interest as this week and a high-teens forward estimate', () => {
  const fixture = liveLikeOpenLoan();
  assert.ok(fixture.summary.periodEndSnapshot);
  assert.ok(Math.abs(fixture.summary.periodEndSnapshot.principalUsd - 21_100) < 0.001);
  assert.ok(Math.abs(fixture.summary.periodEndSnapshot.totalDebtUsd - 21_102.79) < 0.001);
  assert.ok(Math.abs(fixture.summary.periodEndSnapshot.accruedUnpaidUsd - 2.79) < 0.001);
  assert.equal(fixture.summary.periodStartSnapshot?.accruedUnpaidUsd, 0);
  assert.equal(fixture.summary.actual.status, 'since-opening');
  assert.ok(fixture.summary.actual.usd !== null && Math.abs(fixture.summary.actual.usd - 2.79) < 0.001);
  assert.equal(fixture.summary.interestPaidUsd, 0);
  assert.equal(fixture.summary.principalRepaidUsd, 0);
  const projected = projectedInterestCost(21_102.79, fixture.apr);
  assert.ok(projected.next7Days !== null && projected.next7Days > 15 && projected.next7Days < 25);
  assert.ok(Math.abs(projected.next7Days - 21_102.79 * 0.047 * 7 / 365) < 1e-9);
  const weekly = sampleAlertEmails('0x0000000000000000000000000000000000000001').find((sample) => sample.kind === 'weekly');
  assert.ok(weekly);
  assert.equal(weekly.text.includes('$0.21'), false);
  assert.equal(weekly.text.includes('$0.10'), false);
  assert.ok(weekly.text.includes('WEEKLY LOAN DIGEST'));
  assert.ok(weekly.text.includes('Interest accrued this week: $2.79'));
  assert.ok(weekly.text.includes('Interest paid this week: $0.00'));
  assert.ok(weekly.text.includes('Principal repaid this week: $0.00'));
  assert.ok(weekly.text.includes(`Estimated next-7-day interest at current balance and APR: ${formatUsdExact(projected.next7Days)}`));
});

test('F. only outstanding debt counts as an open loan', () => {
  const counts = countEmailPositions([
    { debtUsd: DEBT, supplied: true },
    { debtUsd: 0, supplied: true },
    { debtUsd: 0, supplied: true },
    { debtUsd: 0, supplied: true },
  ]);
  assert.equal(counts.openDebt, 1);
  assert.equal(counts.suppliedWithoutDebt, 3);
  const lines = digestLines('week', [
    position({ debtUsd: DEBT, apr: APR, actualUsd: null, actualStatus: 'unavailable' }),
  ], ['Aave V3 WETH on Base', 'Aave V3 cbBTC on Ethereum', 'Compound USDC on Base']);
  assert.ok(lines.includes('Open debt positions: 1'));
  assert.ok(lines.includes('Supplied positions with no debt: 3'));
  assert.ok(lines.includes('Supplied / watched positions with no debt'));
  assert.equal(lines.some((line) => line.includes('No debt') || line.includes('$0.00/mo')), false);
  assert.equal(lines.filter((line) => line.startsWith('Total debt:')).length, 1);
});

test('G. missing history does not invent accrued interest', () => {
  const summary = summarizeEpisodePeriod({
    events: [],
    episodeKey: 'episode-1',
    periodStart: NOW - 7 * DAY,
    periodEnd: NOW,
    endingDebt: usdc(DEBT),
    decimals: 6,
  });
  assert.equal(summary.actual.status, 'unavailable');
  assert.equal(summary.actual.usd, null);
  const seeded = summarizeEpisodePeriod({
    events: [event({ hash: '0xseed', at: NOW - DAY, action: 'seed', amount: usdc(DEBT).toString(), borrowApr: null })],
    episodeKey: 'episode-1',
    periodStart: NOW - 7 * DAY,
    periodEnd: NOW,
    endingDebt: usdc(DEBT) + usdc(2.7),
    decimals: 6,
  });
  assert.equal(seeded.actual.status, 'unavailable');
  assert.equal(seeded.actual.usd, null);
  const lines = digestLines('week', [
    position({ debtUsd: DEBT, apr: APR, actualUsd: null, actualStatus: 'unavailable', accruedUnpaidUsd: null, principalRemainingUsd: null, interestPaidUsd: null, principalRepaidUsd: null, additionalBorrowingUsd: null, networkFeesUsd: null }),
  ], []);
  const projected = projectedInterestCost(DEBT, APR);
  assert.ok(lines.includes('Actual weekly interest unavailable'));
  assert.ok(lines.includes(`Estimated next-7-day interest at current balance and APR: ${formatUsdExact(projected.next7Days ?? 0)}`));
});
