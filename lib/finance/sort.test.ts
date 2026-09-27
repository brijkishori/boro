import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortVenuesByMode } from './sort';
import { CHAINS, COMETS, AAVE_POOLS, recommendVenue, type Venue } from '../protocol';

const BASE_CBBTC = CHAINS[8453].btc.find((token) => token.symbol === 'cbBTC')!;
const BASE_USDC = CHAINS[8453].usdc;

function compound(id: string, borrowApr: number, liquidityUsd: number): Venue {
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
    maxLtv: 0.8,
    liquidityUsd,
    priceUsd: 84_000,
    compound: { comet: COMETS[8453]!, minBorrow: '1' },
  };
}

function aave(id: string, borrowApr: number, liquidityUsd: number): Venue {
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
    maxLtv: 0.73,
    liquidityUsd,
    priceUsd: 84_000,
    aave: {
      pool: AAVE_POOLS[8453],
      aToken: '0x00000000000000000000000000000000000000a1',
      variableDebtToken: '0x00000000000000000000000000000000000000a2',
    },
  };
}

test('best fit puts the suggested market first even when another APR is lower', () => {
  const cheapThin = compound('cheap', 0.03, 80_000);
  const stronger = aave('strong', 0.035, 20_000_000);
  const venues = [cheapThin, stronger];
  const suggested = recommendVenue(venues, 'borrow');
  const ordered = sortVenuesByMode(venues, 'borrow', 'best-fit');
  assert.ok(suggested);
  assert.equal(ordered[0]?.id, suggested!.id);
  assert.notEqual(ordered[0]?.id, cheapThin.id);
});

test('most-stable ranking puts insufficient history below adequate history', () => {
  const insufficient = compound('short', 0.03, 20_000_000);
  insufficient.rateHistory = { coverageDays: 10, volatility30d: 0.001 };
  const adequate = aave('long', 0.04, 20_000_000);
  adequate.rateHistory = { coverageDays: 120, volatility30d: 0.01 };
  const ordered = sortVenuesByMode([insufficient, adequate], 'borrow', 'most-stable');
  assert.equal(ordered[0]?.id, adequate.id);
});

test('most-stable ranking does not treat missing volatility as zero', () => {
  const missing = compound('missing', 0.03, 20_000_000);
  missing.rateHistory = { coverageDays: 120 };
  const known = aave('known', 0.04, 20_000_000);
  known.rateHistory = { coverageDays: 120, volatility30d: 0.01 };
  const ordered = sortVenuesByMode([missing, known], 'borrow', 'most-stable');
  assert.equal(ordered[0]?.id, known.id);
});

test('every ranking mode collapses duplicate Compound cards to one market', () => {
  const first = compound('borrow:compound:8453:cbbtc', 0.0449, 952_584);
  const duplicate = compound('borrow:compound:8453:cbbtc-dup', 0.0449, 100);
  duplicate.compound = undefined;
  const peer = aave('borrow:aave:8453:cbbtc', 0.05, 5_000_000);
  for (const mode of ['best-fit', 'lowest-rate', 'deepest-liquidity', 'most-stable'] as const) {
    const ordered = sortVenuesByMode([first, duplicate, peer], 'borrow', mode);
    assert.equal(ordered.filter((item) => item.protocol === 'compound').length, 1, mode);
    assert.equal(ordered.length, 2, mode);
  }
});

test('lowest current rate sorts by spot APR only', () => {
  const cheap = compound('cheap', 0.03, 80_000);
  const deeper = aave('deep', 0.035, 20_000_000);
  const ordered = sortVenuesByMode([deeper, cheap], 'borrow', 'lowest-rate');
  assert.equal(ordered[0]?.id, cheap.id);
});
