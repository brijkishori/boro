import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { METRIC_HINTS } from './loanView';
import { RATE_STALE_MS } from './yield';
import {
  buildRiskMonitor,
  collateralToTargetHF,
  evaluateSimulation,
  mixedRemedyToTargetHF,
  openSimulation,
  priceAtTargetHf,
  rateEconomicStatus,
  rateScenarios,
  repayToTargetHF,
  resetSimulation,
  resolveRiskThresholds,
  simulateApr,
  simulateBtcPrice,
  stressReadiness,
  type RiskMonitorInput,
} from './riskMonitor';

function position(overrides: Partial<RiskMonitorInput> = {}): RiskMonitorInput {
  return {
    wallet: '0xabc',
    protocol: 'morpho',
    chainId: 8453,
    marketId: '0xmarket',
    collateralAsset: 'cbBTC',
    debtAsset: 'USDC',
    collateralAmount: 2,
    totalDebt: 10_000,
    liquidationThreshold: 0.8,
    oraclePrice: 10_000,
    currentBorrowApr: 0.04,
    fetchedAt: 1_000_000,
    now: 1_000_000,
    walletDebtAssetBalance: 0,
    walletCollateralBalance: 0,
    nativeGasBalance: 0.01,
    gasRequired: 0.001,
    benchmarkApr: 0.05,
    benchmarkType: 'fixed',
    ...overrides,
  };
}

test('price at a health-factor threshold uses debt, collateral, and the liquidation threshold', () => {
  const price = priceAtTargetHf(10_000, 2, 0.8, 2.5);
  assert.equal(price, (2.5 * 10_000) / (2 * 0.8));
});

test('repay-to-target and collateral-to-target restore the requested health factor', () => {
  const shared = { collateralAmount: 2, debt: 10_000, oraclePrice: 10_000, liquidationThreshold: 0.8, targetHf: 2.5 };
  const repay = repayToTargetHF(shared);
  const collateral = collateralToTargetHF(shared);
  assert.equal(repay.repayAmount, 10_000 - (2 * 10_000 * 0.8) / 2.5);
  assert.ok(repay.projected);
  assert.ok(Math.abs((repay.projected.healthFactor ?? 0) - 2.5) < 1e-9);
  assert.equal(collateral.collateralAmount, (10_000 * 2.5) / (10_000 * 0.8) - 2);
  assert.ok(collateral.projected);
  assert.ok(Math.abs((collateral.projected.healthFactor ?? 0) - 2.5) < 1e-9);
});

test('a mixed remedy uses both repayment and collateral and is labeled as a suggestion', () => {
  const mixed = mixedRemedyToTargetHF({
    collateralAmount: 2,
    debt: 10_000,
    oraclePrice: 10_000,
    liquidationThreshold: 0.8,
    currentHf: 1.6,
    targetHf: 2.5,
  });
  const repayOnly = repayToTargetHF({ collateralAmount: 2, debt: 10_000, oraclePrice: 10_000, liquidationThreshold: 0.8, targetHf: 2.5 });
  const collateralOnly = collateralToTargetHF({ collateralAmount: 2, debt: 10_000, oraclePrice: 10_000, liquidationThreshold: 0.8, targetHf: 2.5 });
  assert.ok(mixed.repayAmount > 0 && mixed.repayAmount < repayOnly.repayAmount);
  assert.ok(mixed.collateralAmount > 0 && mixed.collateralAmount < collateralOnly.collateralAmount);
  assert.ok(mixed.projected);
  assert.ok(Math.abs((mixed.projected.healthFactor ?? 0) - 2.5) < 1e-8);
});

test('no remedy is required when the position is already above the target', () => {
  const report = buildRiskMonitor(position({ oraclePrice: 80_000, healthFactor: 12 }));
  assert.equal(report.severity, 'NORMAL');
  assert.equal(report.remedies.length, 0);
  assert.equal(repayToTargetHF({ collateralAmount: 2, debt: 10_000, oraclePrice: 80_000, liquidationThreshold: 0.8, targetHf: 2.5 }).repayAmount, 0);
});

test('repayment and added collateral each lower the liquidation price', () => {
  const before = 10_000 / (2 * 0.8);
  const repay = repayToTargetHF({ collateralAmount: 2, debt: 10_000, oraclePrice: 10_000, liquidationThreshold: 0.8, targetHf: 2.5 });
  const added = collateralToTargetHF({ collateralAmount: 2, debt: 10_000, oraclePrice: 10_000, liquidationThreshold: 0.8, targetHf: 2.5 });
  const repayPrice = repay.projected?.liquidationPrice ?? null;
  const addedPrice = added.projected?.liquidationPrice ?? null;
  assert.ok(repayPrice !== null && repayPrice < before);
  assert.ok(addedPrice !== null && addedPrice < before);
});

test('emergency readiness is ready only when same-chain funds and gas can reach the target', () => {
  const ready = buildRiskMonitor(position({ walletDebtAssetBalance: 20_000 }));
  assert.equal(ready.readiness.status, 'READY');
  const short = buildRiskMonitor(position({ walletDebtAssetBalance: 0, walletCollateralBalance: 0 }));
  assert.equal(short.readiness.status, 'NOT_READY');
  assert.equal(short.remedies.find((item) => item.type === 'REPAY')?.feasibility, 'NOT_CURRENTLY_AVAILABLE');
  const partial = buildRiskMonitor(position({ walletDebtAssetBalance: 100, walletCollateralBalance: 0 }));
  assert.equal(partial.remedies.find((item) => item.type === 'REPAY')?.feasibility, 'PARTIALLY_AVAILABLE');
  assert.equal(partial.readiness.status, 'PARTIALLY_READY');
});

test('a stale oracle does not produce an actionable remedy', () => {
  const report = buildRiskMonitor(position({ fetchedAt: 1_000_000 - RATE_STALE_MS - 1 }));
  assert.equal(report.severity, 'DATA_WARNING');
  assert.equal(report.remedies.length, 0);
  assert.match(report.remedyMessage ?? '', /Fresh position data required/);
  assert.equal(report.readiness.status, 'DATA_UNKNOWN');
});

test('zero debt does not create a liquidation remedy', () => {
  const report = buildRiskMonitor(position({ totalDebt: 0, healthFactor: null, oraclePrice: 80_000 }));
  assert.equal(report.severity, 'NO_DEBT');
  assert.equal(report.remedies.length, 0);
  assert.equal(report.ladder.every((step) => step.oraclePrice === null), true);
});

test('a BTC what-if changes the simulated health factor and leaves the live input unchanged', () => {
  const live = position({ oraclePrice: 80_000, healthFactor: 12 });
  const before = live.oraclePrice;
  const simulated = simulateBtcPrice(live, 20_000);
  assert.equal(live.oraclePrice, before);
  assert.ok((simulated.snapshot.position.healthFactor ?? 0) < 12);
  assert.notEqual(simulated.snapshot.position.healthFactor, live.healthFactor);
});

test('an APR what-if changes interest and not the health factor', () => {
  const live = position({ oraclePrice: 80_000, healthFactor: 12, currentBorrowApr: 0.04 });
  const simulated = simulateApr(live, 0.1);
  assert.equal(simulated.snapshot.position.healthFactor, 12);
  assert.equal(simulated.monthlyInterest, (10_000 * 0.1) / 12);
  assert.equal(live.currentBorrowApr, 0.04);
});

test('a missing benchmark does not invent an economic status', () => {
  const report = buildRiskMonitor(position({ benchmarkApr: null }));
  assert.equal(report.rateStatus, 'NO_BENCHMARK');
  assert.equal(rateEconomicStatus(0.04, null), 'NO_BENCHMARK');
  assert.equal(report.spreadToBenchmark, null);
});

test('repay fraction and collateral multiplier match the stress health-factor ratio', () => {
  const debt = 10_000;
  const collateral = 2;
  const threshold = 0.8;
  const stressHf = 2;
  const targetHf = 2.5;
  const price = priceAtTargetHf(debt, collateral, threshold, stressHf);
  assert.ok(price);
  const repay = repayToTargetHF({ collateralAmount: collateral, debt, oraclePrice: price, liquidationThreshold: threshold, targetHf });
  const added = collateralToTargetHF({ collateralAmount: collateral, debt, oraclePrice: price, liquidationThreshold: threshold, targetHf });
  assert.ok(Math.abs(repay.repayAmount / debt - (1 - stressHf / targetHf)) < 1e-12);
  assert.ok(Math.abs((collateral + added.collateralAmount) / collateral - targetHf / stressHf) < 1e-12);
});

test('stress readiness is not ready merely because the live health factor is high', () => {
  const healthy = buildRiskMonitor(position({ oraclePrice: 80_000, walletDebtAssetBalance: 0, walletCollateralBalance: 0 }));
  assert.equal(healthy.severity, 'NORMAL');
  assert.equal(healthy.stressSummary, 'NOT_READY');
  const prepare = healthy.stress.find((level) => level.severity === 'PREPARE');
  assert.ok(prepare);
  assert.ok((prepare.repayRequired ?? 0) > 0);
  const partial = buildRiskMonitor(position({ oraclePrice: 80_000, walletDebtAssetBalance: 1, walletCollateralBalance: 0 }));
  assert.equal(partial.stressSummary, 'PARTIALLY_READY');
});

test('stale data does not publish stress remedy amounts', () => {
  const levels = stressReadiness({
    debt: 10_000,
    collateralAmount: 2,
    liquidationThreshold: 0.8,
    targetHf: 2.5,
    watchHf: 2.5,
    prepareHf: 2,
    actHf: 1.5,
    walletDebtAsset: 100,
    walletCollateral: 1,
    fresh: false,
  });
  assert.equal(levels.every((level) => level.status === 'DATA_UNKNOWN' && level.repayRequired === null), true);
});

test('simulation opens while the position is healthier than the preferred target', () => {
  const live = position({ oraclePrice: 80_000, healthFactor: 12 });
  const opened = openSimulation('repay', live.oraclePrice, 2.5);
  assert.equal(opened.mode, 'repay');
  assert.equal(opened.scenarioPrice, '80000');
  const collateral = openSimulation('collateral', live.oraclePrice, 2.5);
  assert.equal(collateral.mode, 'collateral');
  const stressed = { ...opened, scenarioPrice: '10000' };
  const view = evaluateSimulation(stressed, live);
  assert.ok(view.actionAmount > 0);
  assert.equal(view.liquidationUnchangedByPrice, true);
  assert.ok(view.after && view.before && (view.after.liquidationPrice ?? 0) < (view.before.liquidationPrice ?? 0));
  const before = JSON.stringify(live);
  evaluateSimulation(stressed, live);
  assert.equal(JSON.stringify(live), before);
});

test('reset restores the live oracle and close drops the simulation', () => {
  const live = position({ oraclePrice: 80_000 });
  const edited = { ...openSimulation('collateral', 80_000, 2.5), scenarioPrice: '1000', preset: 'custom' as const, amount: '3' };
  const reset = resetSimulation(edited, live.oraclePrice, 2.5);
  assert.equal(reset.scenarioPrice, '80000');
  assert.equal(reset.preset, 'restore');
  assert.equal(reset.targetHf, '2.5');
  assert.equal(resetSimulation(edited, live.oraclePrice, 2.5).mode, 'collateral');
});

test('opening APR is a selectable what-if scenario and does not change health factor', () => {
  const rows = rateScenarios(10_000, 0.04, 0.05, 0.0481);
  assert.equal(rows.some((row) => row.label === 'Opening APR' && row.apr === 0.0481), true);
  const live = position({ oraclePrice: 80_000, healthFactor: 12, currentBorrowApr: 0.04 });
  const simulated = simulateApr(live, 0.0481);
  assert.equal(simulated.snapshot.position.healthFactor, 12);
  assert.equal(live.currentBorrowApr, 0.04);
});

test('configured thresholds override the defaults when the ladder still descends', () => {
  const defaults = resolveRiskThresholds();
  assert.equal(defaults.watch, 2.5);
  assert.equal(defaults.preferredHealthFactor, 2.5);
  const raised = resolveRiskThresholds({ watch: 4, prepare: 3, act: 2, urgent: 1.5, liquidation: 1, preferredHealthFactor: 4 });
  assert.equal(raised.watch, 4);
  const report = buildRiskMonitor(position({
    oraclePrice: 80_000,
    healthFactor: 3.2,
    thresholds: { watch: 4, prepare: 3, act: 2, urgent: 1.5, liquidation: 1 },
  }));
  assert.equal(report.severity, 'WATCH');
  assert.equal(resolveRiskThresholds({ preferredHealthFactor: 1 }).preferredHealthFactor, 2.5);
});

test('HF 3.40 is NORMAL and the next safety level is WATCH', () => {
  const report = buildRiskMonitor(position({ oraclePrice: 80_000, healthFactor: 3.4 }));
  assert.equal(report.decision.currentState, 'NORMAL');
  assert.equal(report.decision.guidance, 'No action required. Continue monitoring.');
  assert.equal(report.decision.nextRiskState, 'WATCH');
  assert.equal(report.decision.nextHf, 2.5);
  assert.equal(report.severity, 'NORMAL');
});

test('HF 1.90 is PREPARE and shows that guidance', () => {
  const report = buildRiskMonitor(position({ healthFactor: 1.9 }));
  assert.equal(report.decision.currentState, 'PREPARE');
  assert.equal(report.decision.guidance, 'Prepare repayment/collateral resources.');
  assert.equal(report.decision.nextRiskState, 'ACT');
});

test('a healthy position can still be unprepared for the PREPARE contingency', () => {
  const healthy = buildRiskMonitor(position({ oraclePrice: 80_000, healthFactor: 3.4, walletDebtAssetBalance: 0, walletCollateralBalance: 0 }));
  assert.equal(healthy.readinessDecision.currentActionRequired, false);
  assert.equal(healthy.readinessDecision.explanation, 'No corrective transaction is currently required.');
  assert.equal(healthy.readinessDecision.currentSafetyState, 'NORMAL');
  assert.equal(healthy.readinessDecision.contingencyScenario, 'PREPARE');
  assert.equal(healthy.readinessDecision.readinessState, 'NOT_READY');
  const partial = buildRiskMonitor(position({ oraclePrice: 80_000, healthFactor: 3.4, walletDebtAssetBalance: 1, walletCollateralBalance: 0 }));
  assert.equal(partial.readinessDecision.currentActionRequired, false);
  assert.equal(partial.readinessDecision.readinessState, 'PARTIALLY_READY');
});

test('missing rate history does not block safety or the action planner', () => {
  const report = buildRiskMonitor(position({
    avg24h: 0.04,
    avg7d: null,
    utilization: 0.5,
    availableLiquidity: 1_000_000,
  }));
  assert.equal(report.domains.position, 'fresh');
  assert.equal(report.domains.oracle, 'fresh');
  assert.equal(report.domains.borrowRate, 'fresh');
  assert.equal(report.domains.rateHistory, 'unavailable');
  assert.equal(report.snapshot.market.currentBorrowApr, 0.04);
  assert.equal(report.snapshot.market.avg7d, null);
  assert.notEqual(report.severity, 'DATA_WARNING');
  assert.equal(report.remedyMessage, null);
  assert.ok(report.remedies.length > 0);
  assert.equal(report.overall, 'PARTIAL');
});

test('a stale oracle blocks safety while a fresh position stays identifiable', () => {
  const report = buildRiskMonitor(position({
    positionFetchedAt: 1_000_000,
    oracleFetchedAt: 1_000_000 - RATE_STALE_MS - 1,
  }));
  assert.equal(report.domains.position, 'fresh');
  assert.equal(report.domains.oracle, 'stale');
  assert.equal(report.severity, 'DATA_WARNING');
  assert.equal(report.overall, 'STALE');
  assert.equal(report.remedies.length, 0);
  assert.match(report.remedyMessage ?? '', /Fresh oracle data is required/);
});

test('a stale wallet balance does not invalidate safety or remedy math', () => {
  const report = buildRiskMonitor(position({
    walletDebtAssetBalance: 5_000,
    walletFetchedAt: 1_000_000 - RATE_STALE_MS - 1,
  }));
  assert.notEqual(report.severity, 'DATA_WARNING');
  assert.equal(report.remedyMessage, null);
  assert.ok(report.remedies.length > 0);
  assert.equal(report.remedies.find((item) => item.type === 'REPAY')?.feasibility, 'UNKNOWN');
  assert.equal(report.readinessDecision.availableUSDC, null);
  assert.equal(report.domains.walletBalance, 'stale');
  assert.equal(report.domains.position, 'fresh');
});

test('safety leads with the current decision and refresh uses a direct live read', () => {
  const source = readFileSync(new URL('../../components/RiskMonitor.tsx', import.meta.url), 'utf8');
  const thresholds = source.indexOf('View all thresholds');
  const ladder = source.indexOf('report.ladder.map');
  assert.ok(thresholds > 0 && ladder > thresholds);
  assert.equal(source.includes('Refresh live data'), true);
  assert.equal(source.includes('fetchFreshPosition'), true);
  assert.equal(source.includes('writeFreshPosition'), true);
  assert.equal(source.includes('No corrective action required'), true);
  assert.equal(source.includes('useSendTx'), false);
  const loans = readFileSync(new URL('../../app/loans/page.tsx', import.meta.url), 'utf8');
  assert.equal(loans.includes('Borrowed after opening'), true);
  assert.equal(loans.includes('Opening principal'), true);
  assert.equal(loans.includes('Additional borrowing'), false);
  assert.equal(loans.includes('borrow capacity'), false);
  assert.match(METRIC_HINTS.borrowedAfterOpening, /not remaining borrow capacity/);
  assert.match(METRIC_HINTS.openingPrincipal, /first opened/);
  assert.match(METRIC_HINTS.currentPrincipal, /principal repayments/);
});
