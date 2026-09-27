import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountFieldLabel, marketQuality, scenarioFit } from './labels';
import type { Venue } from '../protocol';
import type { MarketAssessment } from './riskAssessment';

function venue(partial: Partial<Venue>): Venue {
  return {
    id: 'borrow:test:1:0x1',
    action: 'borrow',
    protocol: 'morpho',
    chainId: 1,
    assetSymbol: 'cbBTC',
    assetKind: 'custodial',
    assetAddress: '0x0000000000000000000000000000000000000001',
    assetDecimals: 8,
    loanSymbol: 'USDC',
    loanAddress: '0x0000000000000000000000000000000000000002',
    loanDecimals: 6,
    borrowApr: 0.05,
    supplyApr: 0.03,
    maxLtv: 0.86,
    liquidityUsd: 10_000_000,
    priceUsd: 100_000,
    ...partial,
  };
}

const assessment = (overall = 80): MarketAssessment => ({
  overallScore: overall,
  liquidityScore: 80,
  reasons: ['Deep available liquidity'],
  cautions: [],
});

test('market quality uses existing liquidity fields only', () => {
  assert.equal(marketQuality(venue({ liquidityUsd: 10_000 })).label, 'Limited depth');
  assert.equal(marketQuality(venue({ liquidityUsd: 20_000_000, utilization: 0.95 })).label, 'High utilization');
  assert.equal(marketQuality(venue({ liquidityUsd: 20_000_000, utilization: 0.4 })).label, 'Deep liquidity');
});

test('scenario fit stays empty without a borrow amount', () => {
  assert.equal(scenarioFit(venue({}), assessment(), null, null), null);
});

test('amount labels follow the selected asset or USD unit', () => {
  assert.equal(amountFieldLabel('collateral', 'token', 'cbBTC'), 'Supply cbBTC');
  assert.equal(amountFieldLabel('collateral', 'usd', 'cbBTC'), 'Collateral value (USD)');
  assert.equal(amountFieldLabel('borrow', 'token', 'USDC'), 'Borrow USDC');
  assert.equal(amountFieldLabel('borrow', 'usd', 'USDC'), 'Borrow value (USD)');
});

test('scenario fit flags size against available liquidity', () => {
  const fit = scenarioFit(
    venue({ liquidityUsd: 100_000 }),
    assessment(),
    { borrowAmount: 40_000, collateralAsset: 'cbBTC', loanAsset: 'USDC' },
    null,
  );
  assert.equal(fit?.label, 'Insufficient liquidity');
});
