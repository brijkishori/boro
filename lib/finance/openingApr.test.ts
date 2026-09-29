import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AuditEvent } from '../audit';
import { aprMovement, loanRateHistory, OPENING_APR_NEUTRAL_BPS } from './openingApr';

function borrow(partial: Partial<AuditEvent> & Pick<AuditEvent, 'hash' | 'at' | 'amount'>): AuditEvent {
  return {
    wallet: '0xabc',
    chainId: 8453,
    action: 'borrow',
    protocol: 'morpho',
    venueId: 'market-1',
    episodeKey: 'episode-1',
    assetSymbol: 'cbBTC',
    loanSymbol: 'USDC',
    amountUsd: null,
    decimals: 6,
    borrowApr: 0.0481,
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

function repay(partial: Partial<AuditEvent> & Pick<AuditEvent, 'hash' | 'at' | 'amount'>): AuditEvent {
  return borrow({ action: 'repay', borrowApr: null, closing: true, principalRemaining: '0', ...partial });
}

test('a 2 bp decline stays inside the neutral band and still reports the basis points', () => {
  const movement = aprMovement(0.0481, 0.0479, 21_000);
  assert.equal(movement.status, 'NEAR_OPENING_RATE');
  assert.ok(Math.abs((movement.changeBps ?? 0) - (-2)) < 1e-6);
  assert.ok(Math.abs((movement.annualAtCurrent ?? 0) - 21_000 * 0.0479) < 1e-8);
  assert.ok(Math.abs((movement.annualDifference ?? 0) - 21_000 * (0.0479 - 0.0481)) < 1e-8);
});

test('a 19 bp decline is cheaper than the opening APR', () => {
  const movement = aprMovement(0.0481, 0.0462, 21_000);
  assert.equal(movement.status, 'CHEAPER_THAN_OPENING');
  assert.ok(Math.abs((movement.changeBps ?? 0) - (-19)) < 1e-6);
  assert.ok((movement.annualDifference ?? 0) < 0);
});

test('a 50 bp increase is more expensive and priced on current debt', () => {
  const movement = aprMovement(0.0481, 0.0531, 21_000);
  assert.equal(movement.status, 'MORE_EXPENSIVE_THAN_OPENING');
  assert.ok(Math.abs((movement.changeBps ?? 0) - 50) < 1e-6);
  assert.ok(Math.abs((movement.annualDifference ?? 0) - 21_000 * 0.005) < 1e-6);
  assert.ok(Math.abs((movement.monthlyDifference ?? 0) - (21_000 * 0.005) / 12) < 1e-6);
});

test('a change inside the neutral band is approximately unchanged', () => {
  const inside = aprMovement(0.0481, 0.0481 + (OPENING_APR_NEUTRAL_BPS - 0.1) / 10_000, 10_000);
  assert.equal(inside.status, 'NEAR_OPENING_RATE');
  const outside = aprMovement(0.0481, 0.0481 + OPENING_APR_NEUTRAL_BPS / 10_000, 10_000);
  assert.equal(outside.status, 'MORE_EXPENSIVE_THAN_OPENING');
});

test('a missing opening APR is not invented', () => {
  const movement = aprMovement(null, 0.0479, 21_000);
  assert.equal(movement.status, 'NOT_CAPTURED');
  assert.equal(movement.openingApr, null);
  assert.equal(movement.changeBps, null);
  assert.equal(movement.annualDifference, null);
});

test('closing and reopening stores a new opening APR', () => {
  const events = [
    borrow({ hash: '0x1', at: 1, amount: '100', borrowApr: 0.0481 }),
    repay({ hash: '0x2', at: 2, amount: '100' }),
    borrow({ hash: '0x3', at: 3, amount: '50', borrowApr: 0.051 }),
  ];
  const history = loanRateHistory(events, 'episode-1');
  assert.equal(history.opening?.normalizedBorrowApr, 0.051);
  assert.equal(history.opening?.txHash, '0x3');
  assert.equal(history.latestBorrow, null);
});

test('an additional borrow does not overwrite the opening APR', () => {
  const events = [
    borrow({ hash: '0x1', at: 1, amount: '100', borrowApr: 0.0481, sourceRate: 0.049, sourceRateType: 'APY', blockNumber: '10', marketId: 'market-1' }),
    borrow({ hash: '0x2', at: 2, amount: '40', borrowApr: 0.05 }),
  ];
  const history = loanRateHistory(events, 'episode-1');
  assert.equal(history.opening?.normalizedBorrowApr, 0.0481);
  assert.equal(history.opening?.rawSourceRate, 0.049);
  assert.equal(history.opening?.sourceRateType, 'APY');
  assert.equal(history.latestBorrow?.normalizedBorrowApr, 0.05);
});

test('a seed row is not treated as the opening APR', () => {
  const events = [
    borrow({ hash: 'seed:episode-1', at: 1, amount: '100', action: 'seed', borrowApr: 0.06 }),
  ];
  assert.equal(loanRateHistory(events, 'episode-1').opening, null);
});

test('the risk monitor does not invoke a wallet', () => {
  const source = readFileSync(new URL('../../components/RiskMonitor.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('useSendTx'), false);
  assert.equal(source.includes('sendTransaction'), false);
  assert.equal(source.includes('writeContract'), false);
  assert.equal(source.includes('startSimulation(\'repay\')'), true);
  assert.equal(source.includes('startSimulation(\'collateral\')'), true);
  assert.equal(source.includes('Opening APR'), true);
});
