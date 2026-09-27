import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessPosition, liveRiskParameters, projectAfterTransaction, tokenShortfall } from './projection';
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
    priceUsd: 84_385,
    ...partial,
  };
}

test('21100 debt on 84385 collateral is about 25% LTV', () => {
  const position = assessPosition(
    venue({ protocol: 'morpho', maxLtv: 0.86, collateralRisk: { liquidationLtv: 0.86, parameterSource: 'live' } }),
    1,
    21_100,
    84_385,
  );
  assert.ok(position.ltv);
  assert.ok(Math.abs(position.ltv - 0.25) < 0.001);
});

test('projected transaction risk includes proposed supply and borrow', () => {
  const { current, projected } = projectAfterTransaction({
    venue: venue({
      protocol: 'morpho',
      maxLtv: 0.86,
      collateralRisk: { liquidationLtv: 0.86, parameterSource: 'live' },
    }),
    priceUsd: 84_385,
    currentCollateralAmount: 0,
    currentDebtUsd: 0,
    supplyAmount: 1,
    borrowUsd: 21_100,
  });
  assert.equal(current.debtUsd, 0);
  assert.equal(current.liquidationPrice, null);
  assert.equal(projected.debtUsd, 21_100);
  assert.ok(projected.ltv && Math.abs(projected.ltv - 0.25) < 0.001);
  assert.ok(projected.liquidationPrice);
  assert.ok(Math.abs((projected.liquidationPrice ?? 0) - 21_100 / 0.86) < 1e-8);
});

test('zero current debt plus nonzero proposed debt is not treated as no debt', () => {
  const { current, projected } = projectAfterTransaction({
    venue: venue({
      protocol: 'aave',
      collateralRisk: { maxLtv: 0.75, liquidationThreshold: 0.8, parameterSource: 'live' },
    }),
    priceUsd: 100_000,
    currentCollateralAmount: 0,
    currentDebtUsd: 0,
    supplyAmount: 1,
    borrowUsd: 40_000,
  });
  assert.equal(current.debtUsd, 0);
  assert.equal(current.liquidationPrice, null);
  assert.equal(current.healthFactor, null);
  assert.ok(projected.debtUsd > 0);
  assert.equal(projected.liquidationPrice, 50_000);
  assert.ok(projected.healthFactor && Math.abs(projected.healthFactor - 2) < 1e-10);
});

test('risk calculations ignore proposed parameters', () => {
  const market = venue({
    protocol: 'aave',
    collateralRisk: { maxLtv: 0.75, liquidationThreshold: 0.8, parameterSource: 'live' },
    proposedCollateralRisk: { maxLtv: 0.9, liquidationThreshold: 0.95, parameterSource: 'proposed' },
  });
  const live = liveRiskParameters(market);
  assert.equal(live.liquidationThreshold, 0.8);
  const position = assessPosition(market, 1, 40_000, 100_000);
  assert.equal(position.liquidationPrice, 50_000);
});

test('proposed-only risk is not used as live configuration', () => {
  const live = liveRiskParameters({
    maxLtv: 0.73,
    collateralRisk: { maxLtv: 0.9, liquidationThreshold: 0.95, parameterSource: 'proposed' },
  });
  assert.equal(live.liquidationThreshold, undefined);
  assert.equal(live.maxLtv, 0.73);
});

test('Aave live E-Mode threshold is used when the quote applies E-Mode', () => {
  const position = assessPosition(
    venue({
      protocol: 'aave',
      collateralRisk: {
        maxLtv: 0.75,
        liquidationThreshold: 0.8,
        parameterSource: 'live',
        eMode: { available: true, maxLtv: 0.9, liquidationThreshold: 0.93 },
      },
    }),
    1,
    40_000,
    100_000,
  );
  assert.ok(position.liquidationPrice);
  assert.ok(Math.abs((position.liquidationPrice ?? 0) - 40_000 / 0.93) < 1e-8);
});

test('projected repay and withdraw use signed position deltas', () => {
  const market = venue({
    protocol: 'morpho',
    maxLtv: 0.86,
    collateralRisk: { liquidationLtv: 0.86, parameterSource: 'live' },
  });
  const repaid = projectAfterTransaction({
    venue: market,
    priceUsd: 84_385,
    currentCollateralAmount: 0.001,
    currentDebtUsd: 21.1,
    repayUsd: 5,
  });
  assert.ok(Math.abs(repaid.projected.debtUsd - 16.1) < 1e-10);
  const withdrawn = projectAfterTransaction({
    venue: market,
    priceUsd: 84_385,
    currentCollateralAmount: 0.001,
    currentDebtUsd: 21.1,
    withdrawAmount: 0.0002,
  });
  assert.ok((withdrawn.projected.ltv ?? 0) > (withdrawn.current.ltv ?? 0));
});

test('collateral shortfall is required minus available', () => {
  const shortfall = tokenShortfall(0.35, 0.1);
  assert.ok(shortfall);
  assert.equal(shortfall.required, 0.35);
  assert.equal(shortfall.available, 0.1);
  assert.ok(Math.abs(shortfall.shortfall - 0.25) < 1e-12);
  assert.equal(tokenShortfall(0.1, 0.35), null);
  assert.equal(tokenShortfall(0, 0.1), null);
});
