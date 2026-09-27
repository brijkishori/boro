import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparableLendApr, isRateStale, materialYieldDisagreement, venueYield, yieldNeedsVerification } from './yield';
import { aprFromApy, normalizeBorrowRate } from './rates';
import type { Venue } from '../protocol';

function venue(partial: Partial<Venue> = {}): Venue {
  return {
    id: 'lend:test:8453:1',
    protocol: 'aave',
    action: 'lend',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    assetKind: 'custodial',
    assetAddress: '0x0000000000000000000000000000000000000001',
    assetDecimals: 8,
    loanSymbol: 'USDC',
    loanAddress: '0x0000000000000000000000000000000000000002',
    loanDecimals: 6,
    borrowApr: 0.05,
    supplyApr: 0.04,
    maxLtv: 0.75,
    liquidityUsd: 10_000_000,
    priceUsd: 84_000,
    ...partial,
  };
}

test('APY-to-APR conversion stays on the finance helpers', () => {
  const apy = 0.049;
  const apr = aprFromApy(apy);
  assert.ok(apr < apy);
  const normalized = normalizeBorrowRate('APY', apy);
  assert.ok(normalized);
  assert.equal(normalized.sourceRateType, 'APY');
  assert.ok(Math.abs(normalized.apr - apr) < 1e-12);
});

test('base yield is not combined with reward yield', () => {
  const quote = venueYield(venue({
    supplyApr: 0.04,
    supplyRate: normalizeBorrowRate('APR', 0.04) ?? undefined,
    rewardApr: 0.1,
    rewardTokens: ['WELL'],
    freshness: { source: 'test', fetchedAt: Date.now() },
  }));
  assert.equal(quote.baseSupplyApr, 0.04);
  assert.equal(quote.rewardApy, 0.1);
  assert.equal(quote.totalDisplayedApy, undefined);
  assert.deepEqual(quote.rewardTokens, ['WELL']);
});

test('stale or missing rates are not treated as zero', () => {
  assert.equal(isRateStale(undefined), true);
  assert.equal(isRateStale(Date.now() - 10 * 60_000), true);
  assert.equal(isRateStale(Date.now() - 30_000), false);
  const stale = venueYield(venue({
    supplyApr: 0.12,
    freshness: { source: 'test', fetchedAt: Date.now() - 10 * 60_000 },
  }));
  assert.equal(stale.isStale, true);
  assert.equal(comparableLendApr(stale), undefined);
  const missing = venueYield(venue({ supplyApr: 0, freshness: { source: 'test', fetchedAt: Date.now() } }));
  assert.equal(missing.baseSupplyApr, undefined);
});

test('material yield disagreement is flagged at 100 bps', () => {
  assert.equal(materialYieldDisagreement(0.04, 0.041), false);
  assert.equal(materialYieldDisagreement(0.04, 0.055), true);
  assert.equal(materialYieldDisagreement(undefined, 0.05), false);
});

test('a yield far from the chain median needs verification and is not trusted as stable', () => {
  const now = Date.now();
  const aave = venue({
    id: 'aave',
    protocol: 'aave',
    loanSupplyApr: 0.04,
    freshness: { source: 'aave', fetchedAt: now },
  });
  const compound = venue({
    id: 'compound',
    protocol: 'compound',
    loanSupplyApr: 0.045,
    freshness: { source: 'compound', fetchedAt: now },
  });
  const outlier = venue({
    id: 'outlier',
    protocol: 'moonwell',
    loanSupplyApr: 0.1469,
    freshness: { source: 'moonwell-musdc', fetchedAt: now },
  });
  assert.equal(yieldNeedsVerification([aave, compound, outlier], outlier), true);
  assert.equal(yieldNeedsVerification([aave, compound, outlier], aave), false);
});

test('stale yields need verification even when the printed rate looks ordinary', () => {
  const fresh = venue({
    id: 'fresh',
    protocol: 'aave',
    loanSupplyApr: 0.04,
    freshness: { source: 'aave', fetchedAt: Date.now() },
  });
  const stale = venue({
    id: 'stale',
    protocol: 'compound',
    loanSupplyApr: 0.041,
    freshness: { source: 'compound', fetchedAt: Date.now() - 10 * 60_000 },
  });
  assert.equal(yieldNeedsVerification([fresh, stale], stale), true);
});
