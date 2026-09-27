import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUnits } from 'viem';
import { compareBorrowVsLend } from './opportunities';
import { EXAMPLE_CARRY_PRINCIPAL, grossAnnualCarry } from './finance/carry';
import { AAVE_POOLS, CHAINS, COMETS, type Venue } from './protocol';
import type { PositionSnapshot } from './adapters';

const BASE_CBBTC = CHAINS[8453].btc.find((token) => token.symbol === 'cbBTC')!;
const BASE_USDC = CHAINS[8453].usdc;

function compound(id: string, borrowApr: number, loanSupplyApr: number): Venue {
  return {
    id,
    protocol: 'compound',
    action: 'borrow',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    assetKind: BASE_CBBTC.kind,
    assetAddress: BASE_CBBTC.address,
    assetDecimals: BASE_CBBTC.decimals,
    loanSymbol: 'USDC',
    loanAddress: BASE_USDC.address,
    loanDecimals: 6,
    borrowApr,
    supplyApr: 0.02,
    loanSupplyApr,
    maxLtv: 0.8,
    liquidityUsd: 20_000_000,
    priceUsd: 84_000,
    freshness: { source: 'test', fetchedAt: Date.now() },
    compound: { comet: COMETS[8453]!, minBorrow: '1' },
  };
}

function aave(id: string, borrowApr: number, loanSupplyApr: number): Venue {
  return {
    id,
    protocol: 'aave',
    action: 'borrow',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    assetKind: BASE_CBBTC.kind,
    assetAddress: BASE_CBBTC.address,
    assetDecimals: BASE_CBBTC.decimals,
    loanSymbol: 'USDC',
    loanAddress: BASE_USDC.address,
    loanDecimals: 6,
    borrowApr,
    supplyApr: 0.02,
    loanSupplyApr,
    maxLtv: 0.73,
    liquidityUsd: 20_000_000,
    priceUsd: 84_000,
    freshness: { source: 'test', fetchedAt: Date.now() },
    aave: {
      pool: AAVE_POOLS[8453],
      aToken: '0x00000000000000000000000000000000000000a1',
      variableDebtToken: '0x00000000000000000000000000000000000000a2',
    },
  };
}

const empty: PositionSnapshot = {
  collateral: 0n,
  debt: 0n,
  maxBorrow: 0n,
  borrowRoom: 0n,
  withdrawMax: 0n,
  healthFactor: null,
  ltv: 0,
  liquidationPrice: 0,
  ready: true,
};

test('example carry uses a 1000 principal so 9.91pp is $99.10 not $9.91', () => {
  const market = compound('borrow', 0.0478, 0.1469);
  const view = compareBorrowVsLend([], [market]);
  assert.ok(view);
  assert.equal(view.debtUsd, EXAMPLE_CARRY_PRINCIPAL);
  assert.equal(view.debtUsd, 1_000);
  const expected = grossAnnualCarry(1_000, 0.0478, 0.1469);
  assert.ok(expected);
  assert.ok(Math.abs(view.loopNetYear - expected) < 1e-10);
  assert.ok(Math.abs(view.loopNetYear - 99.1) < 1e-10);
});

test('flagged yield-disagreement markets do not win best lend', () => {
  const trusted = aave('aave-base', 0.05, 0.04);
  const disagreedHigh = compound('comp-high', 0.06, 0.14);
  const disagreedLow = compound('comp-low', 0.06, 0.04);
  const view = compareBorrowVsLend([], [trusted, disagreedHigh, disagreedLow]);
  assert.ok(view);
  assert.ok(view.lendUsdc);
  assert.equal(view.lendUsdc.venue.protocol, 'aave');
});

test('open debt uses the actual principal for carry dollars', () => {
  const market = compound('borrow', 0.0478, 0.1469);
  const view = compareBorrowVsLend([{
    venue: market,
    snapshot: { ...empty, debt: parseUnits('10000', 6), collateral: parseUnits('1', 8) },
  }], [market]);
  assert.ok(view);
  assert.equal(view.debtUsd, 10_000);
  assert.ok(Math.abs(view.loopNetYear - 991) < 1e-8);
});
