import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { digestLines } from './periodInterest';
import { buildActiveLoanView, buildLoanRateStatus, portfolioSummaryLabels } from './loanView';

test('one active loan uses simple portfolio labels', () => {
  const labels = portfolioSummaryLabels(1);
  assert.equal(labels.apr, 'Current APR');
  assert.equal(labels.health, 'Health Factor');
  assert.equal(labels.liquidation, 'Liquidation BTC');
  assert.equal(labels.cushion, 'BTC decline to liquidation');
  assert.equal(JSON.stringify(labels).includes('Worst'), false);
  assert.equal(JSON.stringify(labels).includes('Weighted'), false);
});

test('multiple loans use aggregate labels', () => {
  const labels = portfolioSummaryLabels(3);
  assert.equal(labels.apr, 'Weighted current APR');
  assert.equal(labels.health, 'Lowest Health Factor');
  assert.equal(labels.ltv, 'Highest LTV');
  assert.equal(labels.liquidation, 'Closest liquidation BTC');
  assert.equal(labels.cushion, 'Smallest liquidation cushion');
});

test('APR delta uses basis points from the decimal rate and the neutral band', () => {
  const cheaper = buildLoanRateStatus({ currentApr: 0.0467, openingApr: 0.0481, debtUsd: 21_100, lifecycleId: 'loan-1' });
  assert.ok(cheaper.deltaApr !== null && Math.abs(cheaper.deltaApr - (0.0467 - 0.0481)) < 1e-12);
  assert.ok(cheaper.deltaBps !== null && Math.abs(cheaper.deltaBps - cheaper.deltaApr * 10_000) < 1e-8);
  assert.equal(cheaper.direction, 'DOWN');
  assert.equal(cheaper.statusText, 'cheaper');
  const unchanged = buildLoanRateStatus({ currentApr: 0.0482, openingApr: 0.0481, debtUsd: 21_100 });
  assert.equal(unchanged.direction, 'NEUTRAL');
  assert.equal(unchanged.statusText, 'approximately unchanged');
  const expensive = buildLoanRateStatus({ currentApr: 0.0542, openingApr: 0.0481, debtUsd: 21_100 });
  assert.equal(expensive.direction, 'UP');
  assert.equal(expensive.statusText, 'more expensive');
});

test('APR change shows an arrow, plain words, and a semantic state', () => {
  const cheaper = buildLoanRateStatus({ currentApr: 0.0467, openingApr: 0.0481 });
  assert.equal(cheaper.compactText, '↓ 14 bps cheaper');
  assert.equal(cheaper.icon, '↓');
  assert.equal(cheaper.direction, 'DOWN');
  assert.equal(cheaper.semanticState, 'positive');
  assert.ok(cheaper.deltaBps !== null && Math.abs(cheaper.deltaBps - (-14)) < 1e-6);
  const expensive = buildLoanRateStatus({ currentApr: 0.0542, openingApr: 0.0481 });
  assert.equal(expensive.compactText, '↑ 61 bps more expensive');
  assert.equal(expensive.icon, '↑');
  assert.equal(expensive.direction, 'UP');
  assert.equal(expensive.semanticState, 'warning');
  assert.ok(expensive.deltaBps !== null && Math.abs(expensive.deltaBps - 61) < 1e-6);
  const unchanged = buildLoanRateStatus({ currentApr: 0.0479, openingApr: 0.0481 });
  assert.equal(unchanged.compactText, '→ 2 bps approximately unchanged');
  assert.equal(unchanged.icon, '→');
  assert.equal(unchanged.direction, 'NEUTRAL');
  assert.equal(unchanged.semanticState, 'neutral');
  assert.ok(unchanged.deltaBps !== null && Math.abs(unchanged.deltaBps - (-2)) < 1e-6);
});

test('the shared loan view keeps the same HF, APR, and liquidation for every surface', () => {
  const input = {
    id: 'morpho-base',
    lifecycleId: 'episode-1',
    protocol: 'morpho' as const,
    chainId: 8453 as const,
    assetSymbol: 'cbBTC',
    loanSymbol: 'USDC',
    assetDecimals: 8,
    loanDecimals: 6,
    collateral: 100_000_000n,
    debt: 21_102_810_000n,
    priceUsd: 83_419,
    ltv: 0.2527,
    healthFactor: 3.4,
    liquidationPrice: 24_538.16,
    currentApr: 0.0482,
    openingApr: 0.0481,
    fetchedAt: Date.now(),
  };
  const summary = buildActiveLoanView(input);
  const card = buildActiveLoanView(input);
  const monitor = buildActiveLoanView(input);
  assert.equal(summary.healthFactor, card.healthFactor);
  assert.equal(card.healthFactor, monitor.healthFactor);
  assert.equal(summary.ltv, monitor.ltv);
  assert.equal(summary.liquidationPriceUsd, card.liquidationPriceUsd);
  assert.equal(summary.rate.currentApr, card.rate.currentApr);
  assert.equal(summary.rate.deltaBps, monitor.rate.deltaBps);
  assert.equal(summary.totalDebtUsd, card.totalDebtUsd);
});

test('the loans page does not embed the risk monitor, and generic market cards omit opening APR', () => {
  const loans = readFileSync(new URL('../../app/loans/page.tsx', import.meta.url), 'utf8');
  const opportunities = readFileSync(new URL('../../components/Opportunities.tsx', import.meta.url), 'utf8');
  const quotes = readFileSync(new URL('../../components/QuoteBoard.tsx', import.meta.url), 'utf8');
  assert.equal(loans.includes('RiskMonitor'), false);
  assert.equal(loans.includes('Worst health factor'), false);
  assert.equal(loans.includes('Smallest BTC cushion'), false);
  assert.equal(loans.includes('Open Risk Monitor'), true);
  assert.equal(opportunities.includes('Opening APR'), false);
  assert.equal(quotes.includes('Opening APR'), false);
  assert.equal(loans.includes('LoanRateStatus'), true);
  assert.equal(loans.includes('AprChangeLine') || loans.includes('openingRate'), true);
  const monitor = readFileSync(new URL('../../components/RiskMonitor.tsx', import.meta.url), 'utf8');
  const carry = readFileSync(new URL('../../components/BorrowVsLend.tsx', import.meta.url), 'utf8');
  const digest = readFileSync(new URL('./periodInterest.ts', import.meta.url), 'utf8');
  assert.equal(monitor.includes('LoanRateStatus'), true);
  assert.equal(monitor.includes('AprChangeLine'), true);
  assert.equal(monitor.includes('AprMovementBadge'), false);
  assert.equal(carry.includes('AprChangeLine'), true);
  assert.equal(digest.includes('buildLoanRateStatus'), true);
  const emailed = digestLines('week', [{
    name: 'Morpho',
    debtUsd: 21_100,
    principalRemainingUsd: 21_100,
    accruedUnpaidUsd: 2.79,
    apr: 0.0467,
    openingApr: 0.0481,
    ltv: 0.25,
    healthFactor: 3.4,
    liquidationPriceUsd: 24_000,
    actualUsd: 2.79,
    actualStatus: 'measured',
    interestPaidUsd: 0,
    principalRepaidUsd: 0,
    additionalBorrowingUsd: 0,
    networkFeesUsd: 0,
  }], []);
  assert.equal(emailed.includes('APR since opening: ↓ 14 bps cheaper'), true);
  const summary = buildLoanRateStatus({ currentApr: 0.0467, openingApr: 0.0481 });
  const card = buildLoanRateStatus({ currentApr: 0.0467, openingApr: 0.0481 });
  const header = buildLoanRateStatus({ currentApr: 0.0467, openingApr: 0.0481 });
  assert.equal(summary.compactText, card.compactText);
  assert.equal(card.compactText, header.compactText);
  assert.equal(summary.semanticState, header.semanticState);
});
