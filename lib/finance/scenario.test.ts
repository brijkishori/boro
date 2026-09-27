import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenarioForVenue } from './scenario';
import type { Venue } from '../protocol';

function venue(partial: Partial<Venue> & Pick<Venue, 'protocol'>): Venue {
  return {
    id: 'borrow:test:1:0x1',
    action: 'borrow',
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
    maxLtv: 0.75,
    liquidityUsd: 10_000_000,
    priceUsd: 100_000,
    ...partial,
  };
}

test('Aave scenario uses health factor and liquidation threshold', () => {
  const view = scenarioForVenue(
    venue({
      protocol: 'aave',
      collateralRisk: { maxLtv: 0.75, liquidationThreshold: 0.8 },
    }),
    { borrowAmount: 40_000, collateralAmount: 1, collateralAsset: 'cbBTC', loanAsset: 'USDC' },
    100_000,
  );
  assert.equal(view.startingLtv, 0.4);
  assert.ok(view.healthFactor && Math.abs(view.healthFactor - 2) < 1e-10);
  assert.equal(view.liquidationPrice, 50_000);
  assert.ok(view.distanceToLiquidation && Math.abs(view.distanceToLiquidation - 0.5) < 1e-10);
});

test('Morpho scenario uses LLTV and an app-derived health factor', () => {
  const view = scenarioForVenue(
    venue({
      protocol: 'morpho',
      maxLtv: 0.86,
      collateralRisk: { liquidationLtv: 0.86 },
    }),
    { borrowAmount: 43_000, collateralAmount: 1, collateralAsset: 'cbBTC', loanAsset: 'USDC' },
    100_000,
  );
  assert.equal(view.healthFactorKind, 'app-derived');
  assert.ok(view.healthFactor && Math.abs(view.healthFactor - 2) < 1e-10);
  assert.ok(view.liquidationPrice);
  assert.ok(Math.abs((view.liquidationPrice ?? 0) - 43_000 / 0.86) < 1e-8);
});

test('benchmark dollar comparison uses the planned borrow, not a different payoff balance', () => {
  const view = scenarioForVenue(
    venue({ protocol: 'aave', borrowApr: 0.05, collateralRisk: { liquidationThreshold: 0.8 } }),
    { borrowAmount: 10_000, collateralAsset: 'cbBTC', loanAsset: 'USDC' },
    100_000,
    { id: 'b', name: 'Personal Loan', annualRate: 0.08, rateType: 'fixed', balance: 20_000 },
  );
  assert.ok(view.spread && Math.abs(view.spread - 0.03) < 1e-10);
  assert.equal(view.comparisonPrincipal, 10_000);
  assert.equal(view.benchmarkPayoffBalance, 20_000);
  assert.ok(view.annualDifference && Math.abs(view.annualDifference - 300) < 1e-8);
});

test('monthly payment switches first-year interest to declining next-12-month interest', () => {
  const annualized = scenarioForVenue(
    venue({ protocol: 'aave', borrowApr: 0.12, collateralRisk: { liquidationThreshold: 0.8 } }),
    { borrowAmount: 10_000, collateralAsset: 'cbBTC', loanAsset: 'USDC' },
    100_000,
  );
  const declining = scenarioForVenue(
    venue({ protocol: 'aave', borrowApr: 0.12, collateralRisk: { liquidationThreshold: 0.8 } }),
    { borrowAmount: 10_000, monthlyPayment: 400, collateralAsset: 'cbBTC', loanAsset: 'USDC' },
    100_000,
  );
  assert.equal(annualized.interestDeclining, false);
  assert.equal(annualized.yearOneInterest, 1_200);
  assert.equal(declining.interestDeclining, true);
  assert.ok(declining.yearOneInterest < annualized.yearOneInterest);
  assert.ok(declining.amortization?.totalInterest && declining.amortization.totalInterest > 0);
});
