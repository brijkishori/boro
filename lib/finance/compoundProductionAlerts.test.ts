import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import type { Venue } from '@/lib/protocol';
import { normalizeCompoundLoanBookPositions } from './compoundPositions';

const COMET = '0x1111111111111111111111111111111111111111' as Address;
const USDC = '0x2222222222222222222222222222222222222222' as Address;
const CBBTC = '0x3333333333333333333333333333333333333333' as Address;
const TBTC = '0x4444444444444444444444444444444444444444' as Address;

function venue(id: string, assetSymbol: string, assetAddress: Address, assetDecimals: number): Venue {
  return {
    id,
    protocol: 'compound',
    action: 'borrow',
    chainId: 8453,
    assetSymbol,
    assetKind: 'custodial',
    assetAddress,
    assetDecimals,
    loanSymbol: 'USDC',
    loanAddress: USDC,
    loanDecimals: 6,
    borrowApr: 0.055,
    supplyApr: 0,
    maxLtv: 0.8,
    liquidityUsd: 1_000_000,
    priceUsd: 85_000,
    compound: { comet: COMET, minBorrow: '0' },
  };
}

function snapshot(collateral: bigint, debt = 2_000_138n): PositionSnapshot {
  return {
    collateral,
    debt,
    maxBorrow: 5_000_000n,
    borrowRoom: 0n,
    withdrawMax: 0n,
    healthFactor: 0,
    ltv: 2349.4147,
    liquidationPrice: 250_017_250,
    ready: true,
  };
}

test('production alert normalization removes repeated Compound account debt from a dust sibling', () => {
  const real = {
    venue: venue('compound-cbbtc', 'cbBTC', CBBTC, 8),
    snapshot: snapshot(10_000n),
    verified: true,
  };
  const dust = {
    venue: venue('compound-tbtc', 'tBTC', TBTC, 18),
    snapshot: snapshot(10_000_000_000n),
    verified: true,
  };

  const normalized = normalizeCompoundLoanBookPositions([real, dust]);
  const primary = normalized.find((item) => item.venue.id === 'compound-cbbtc')!;
  const sibling = normalized.find((item) => item.venue.id === 'compound-tbtc')!;

  assert.equal(primary.snapshot.debt, 2_000_138n);
  assert.equal(sibling.snapshot.debt, 0n);
  assert.equal(sibling.snapshot.healthFactor, null);
  assert.equal(sibling.snapshot.ltv, 0);
  assert.equal(sibling.snapshot.liquidationPrice, 0);
});

test('production alert route batches fresh position reads before Compound normalization', () => {
  const route = readFileSync('app/api/alerts/check/route.ts', 'utf8');
  assert.match(route, /normalizeCompoundLoanBookPositions/);
  assert.match(route, /rawPositionReads/);
  assert.match(route, /normalizedByVenueId/);
});

test('fallback HF, liquidation, and APR alerts require actual open debt', () => {
  const route = readFileSync('app/api/alerts/check/route.ts', 'utf8');
  assert.match(route, /if \(openDebt && !coversSafety && snapshot\.healthFactor/);
  assert.match(route, /if \(openDebt && !coversSafety && drop <=/);
  assert.match(route, /if \(openDebt && !coversRate && venue\.borrowApr >=/);
});

test('recommended per-loan notifications are not emitted for zero-debt sibling rows', () => {
  const route = readFileSync('app/api/alerts/check/route.ts', 'utf8');
  assert.match(route, /if \(openDebt\) \{\s*const trendLines = await observedTrendLines/);
});
