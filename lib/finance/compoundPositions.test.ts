import assert from 'node:assert/strict';
import test from 'node:test';
import type { Address } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import type { Venue } from '@/lib/protocol';
import { activeDebtPositions, zeroDebtMarkets } from './portfolio';
import { normalizeCompoundLoanBookPositions } from './compoundPositions';

const COMET = '0x1111111111111111111111111111111111111111' as Address;
const OTHER_COMET = '0x1111111111111111111111111111111111111112' as Address;
const USDC = '0x2222222222222222222222222222222222222222' as Address;
const CBBTC = '0x3333333333333333333333333333333333333333' as Address;
const TBTC = '0x4444444444444444444444444444444444444444' as Address;

function venue(overrides: Partial<Venue> & Pick<Venue, 'id' | 'assetSymbol' | 'assetAddress'>): Venue {
  const { id, assetSymbol, assetAddress, ...rest } = overrides;
  return {
    id,
    protocol: 'compound',
    action: 'borrow',
    chainId: 8453,
    assetSymbol,
    assetKind: 'custodial',
    assetAddress,
    assetDecimals: assetSymbol === 'tBTC' ? 18 : 8,
    loanSymbol: 'USDC',
    loanAddress: USDC,
    loanDecimals: 6,
    borrowApr: 0.055,
    supplyApr: 0,
    maxLtv: 0.75,
    liquidityUsd: 1_000_000,
    priceUsd: 85_000,
    compound: { comet: COMET, minBorrow: '0' },
    ...rest,
  };
}

function snapshot(collateral: bigint, debt = 2_000_000n): PositionSnapshot {
  return {
    collateral,
    debt,
    maxBorrow: 5_000_000n,
    borrowRoom: 3_000_000n,
    withdrawMax: collateral,
    healthFactor: collateral > 0n ? 3 : null,
    ltv: collateral > 0n ? 0.25 : 0,
    liquidationPrice: collateral > 0n ? 25_000 : 0,
    ready: true,
  };
}

test('Compound account-level debt is assigned to only the supplied collateral venue', () => {
  const cb = { venue: venue({ id: 'compound-cbbtc', assetSymbol: 'cbBTC', assetAddress: CBBTC }), snapshot: snapshot(100_000_000n), verified: true };
  const tb = { venue: venue({ id: 'compound-tbtc', assetSymbol: 'tBTC', assetAddress: TBTC }), snapshot: snapshot(0n), verified: true };
  const normalized = normalizeCompoundLoanBookPositions([cb, tb]);

  assert.equal(normalized.find((item) => item.venue.id === 'compound-cbbtc')?.snapshot.debt, 2_000_000n);
  assert.equal(normalized.find((item) => item.venue.id === 'compound-tbtc')?.snapshot.debt, 0n);
  assert.equal(activeDebtPositions(normalized).length, 1);
});

test('secondary supplied Compound collateral is preserved but does not duplicate the Comet debt', () => {
  const cb = { venue: venue({ id: 'compound-cbbtc', assetSymbol: 'cbBTC', assetAddress: CBBTC }), snapshot: snapshot(100_000_000n), verified: true };
  const tb = { venue: venue({ id: 'compound-tbtc', assetSymbol: 'tBTC', assetAddress: TBTC, assetKind: 'direct' }), snapshot: snapshot(10_000_000_000_000_000n), verified: true };
  const normalized = normalizeCompoundLoanBookPositions([cb, tb]);

  assert.equal(activeDebtPositions(normalized).length, 1);
  assert.equal(zeroDebtMarkets(normalized).length, 1);
  assert.ok(normalized.some((item) => item.venue.id === 'compound-tbtc' && item.snapshot.collateral > 0n));
});

test('single Compound venue is unchanged', () => {
  const only = { venue: venue({ id: 'compound-cbbtc', assetSymbol: 'cbBTC', assetAddress: CBBTC }), snapshot: snapshot(100_000_000n), verified: true };
  const normalized = normalizeCompoundLoanBookPositions([only]);
  assert.equal(normalized[0], only);
});

test('different Compound Comets remain separate debts', () => {
  const first = { venue: venue({ id: 'compound-a', assetSymbol: 'cbBTC', assetAddress: CBBTC }), snapshot: snapshot(100_000_000n), verified: true };
  const second = {
    venue: venue({ id: 'compound-b', assetSymbol: 'tBTC', assetAddress: TBTC, assetKind: 'direct', compound: { comet: OTHER_COMET, minBorrow: '0' } }),
    snapshot: snapshot(10_000_000_000_000_000n),
    verified: true,
  };
  const normalized = normalizeCompoundLoanBookPositions([first, second]);
  assert.equal(activeDebtPositions(normalized).length, 2);
});

test('non-Compound positions are not modified', () => {
  const aaveVenue = { ...venue({ id: 'aave-cbbtc', assetSymbol: 'cbBTC', assetAddress: CBBTC }), protocol: 'aave' as const, compound: undefined, aave: { pool: COMET, aToken: CBBTC, variableDebtToken: TBTC } };
  const position = { venue: aaveVenue, snapshot: snapshot(100_000_000n), verified: true };
  const normalized = normalizeCompoundLoanBookPositions([position]);
  assert.equal(normalized[0], position);
  assert.equal(normalized[0].snapshot.debt, 2_000_000n);
});
