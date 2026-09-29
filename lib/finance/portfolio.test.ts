import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUnits } from 'viem';
import { activeDebtPositions, portfolioAprLabel, portfolioDebtSummary, weightedBorrowApr, zeroDebtMarkets } from './portfolio';
import type { Venue } from '../protocol';
import type { PositionSnapshot } from '../adapters';

function venue(id: string, borrowApr: number, priceUsd = 84_385): Venue {
  return {
    id,
    protocol: 'morpho',
    action: 'borrow',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    assetKind: 'custodial',
    assetAddress: '0x0000000000000000000000000000000000000001',
    assetDecimals: 8,
    loanSymbol: 'USDC',
    loanAddress: '0x0000000000000000000000000000000000000002',
    loanDecimals: 6,
    borrowApr,
    supplyApr: 0.02,
    maxLtv: 0.86,
    liquidityUsd: 10_000_000,
    priceUsd,
  };
}

function snapshot(debt: string, collateral: string, extra: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    collateral: parseUnits(collateral, 8),
    debt: parseUnits(debt, 6),
    maxBorrow: 0n,
    borrowRoom: 0n,
    withdrawMax: 0n,
    healthFactor: null,
    ltv: 0,
    liquidationPrice: 0,
    ready: true,
    ...extra,
  };
}

test('weighted portfolio APR uses debt weights and ignores missing rates', () => {
  const positions = [
    { venue: venue('a', 0.04), snapshot: snapshot('1000', '0.1') },
    { venue: venue('b', 0.08), snapshot: snapshot('3000', '0.2') },
    { venue: { ...venue('c', 0), borrowApr: Number.NaN }, snapshot: snapshot('5000', '0.3') },
  ];
  const weighted = weightedBorrowApr(positions);
  assert.ok(weighted);
  assert.ok(Math.abs(weighted - (1000 * 0.04 + 3000 * 0.08) / 4000) < 1e-10);
});

test('zero-debt markets are excluded from active loan aggregation', () => {
  const positions = [
    { venue: venue('debt', 0.05), snapshot: snapshot('21100', '1', { ltv: 0.25, liquidationPrice: 24_535 }) },
    { venue: venue('idle', 0.05), snapshot: snapshot('0', '0.5') },
  ];
  assert.equal(activeDebtPositions(positions).length, 1);
  assert.equal(zeroDebtMarkets(positions).length, 1);
  const summary = portfolioDebtSummary(positions);
  assert.ok(summary);
  assert.ok(Math.abs(summary.totalDebtUsd - 21_100) < 1e-6);
  assert.ok(Math.abs(summary.totalCollateralUsd - 84_385) < 1e-6);
  assert.equal(summary.weightedBorrowApr, 0.05);
  assert.ok(summary.estimatedMonthlyInterest && Math.abs(summary.estimatedMonthlyInterest - 21_100 * 0.05 / 12) < 1e-8);
  assert.ok(summary.highestLtv && Math.abs(summary.highestLtv - 0.25) < 1e-10);
});

test('G. one active loan labels the summary APR as current', () => {
  assert.equal(portfolioAprLabel(1), 'Current APR');
});

test('H. multiple active loans label the summary APR as weighted', () => {
  assert.equal(portfolioAprLabel(2), 'Weighted current APR');
  assert.equal(portfolioAprLabel(4), 'Weighted current APR');
});

test('portfolio summary is empty without open debt', () => {
  const positions = [{ venue: venue('idle', 0.05), snapshot: snapshot('0', '1') }];
  assert.equal(portfolioDebtSummary(positions), null);
});
