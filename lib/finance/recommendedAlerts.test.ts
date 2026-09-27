import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RECOMMENDED_ALERT_DEFAULTS,
  alertMarketKey,
  approveSelectedRules,
  benchmarkRateThresholds,
  createRecommendedPlan,
  equivalentBtcPrice,
  equivalentLtv,
  evaluateEnabledPlan,
  generateRecommendedRules,
  type AlertRecommendationInput,
} from './recommendedAlerts';

function position(overrides: Partial<AlertRecommendationInput> = {}): AlertRecommendationInput {
  return {
    wallet: '0xabc',
    chainId: 8453,
    protocol: 'morpho',
    marketId: '0xmarket',
    collateralAmount: 2,
    debtUsd: 10_000,
    oraclePriceUsd: 80_000,
    healthFactor: 3,
    ltv: 0.0625,
    liquidationThreshold: 0.8,
    liquidationPriceUsd: 6_250,
    cushion: 0.92,
    borrowApr: 0.04,
    benchmarkApr: 0.05,
    utilization: 0.5,
    liquidityUsd: 1_000_000,
    recentLiquidityUsd: 1_000_000,
    historyAdequate: true,
    freshnessAgeMs: 1_000,
    ...overrides,
  };
}

test('HF threshold converts to LTV and a BTC trigger from the live position', () => {
  const lltv = 0.8;
  const hf = RECOMMENDED_ALERT_DEFAULTS.healthFactor.watch;
  assert.equal(equivalentLtv(lltv, hf), lltv / hf);
  const price = equivalentBtcPrice(10_000, 2, lltv, hf);
  assert.equal(price, (hf * 10_000) / (2 * lltv));
});

test('a lower debt moves the BTC trigger down and more collateral moves it down', () => {
  const hf = 2;
  const lltv = 0.8;
  const before = equivalentBtcPrice(10_000, 2, lltv, hf);
  const afterRepay = equivalentBtcPrice(8_000, 2, lltv, hf);
  const afterSupply = equivalentBtcPrice(10_000, 4, lltv, hf);
  assert.ok(before !== null && afterRepay !== null && afterSupply !== null);
  assert.ok(afterRepay < before);
  assert.ok(afterSupply < before);
});

test('benchmark rate thresholds use the saved APR and buffers', () => {
  const levels = benchmarkRateThresholds(0.05);
  assert.ok(levels);
  assert.equal(levels.watch, 0.05 - 0.01);
  assert.equal(levels.breakEven, 0.05);
  assert.equal(levels.highCost, 0.05 + 0.015);
  assert.equal(benchmarkRateThresholds(null), null);
});

test('recommended rules stay disabled until selected rules are approved', () => {
  const rules = generateRecommendedRules(position());
  assert.ok(rules.length > 0);
  assert.ok(rules.every((rule) => rule.enabled === false));
  const approved = approveSelectedRules(rules, ['hf-watch', 'monthly-statement']);
  assert.equal(approved.find((rule) => rule.id === 'hf-watch')?.enabled, true);
  assert.equal(approved.find((rule) => rule.id === 'hf-prepare')?.enabled, false);
  assert.equal(approved.find((rule) => rule.id === 'monthly-statement')?.enabled, true);
});

test('no benchmark omits derived APR levels and still allows a custom threshold', () => {
  const without = generateRecommendedRules(position({ benchmarkApr: null }));
  assert.equal(without.some((rule) => rule.id === 'rate-break-even'), false);
  const custom = generateRecommendedRules(position({
    benchmarkApr: null,
    customRateThresholds: { breakEven: 0.08 },
  }));
  assert.equal(custom.find((rule) => rule.id === 'rate-break-even')?.threshold, 0.08);
});

test('rate and utilization alerts wait for persistence, then notify once', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['rate-watch', 'utilization-watch']);
  const start = 1_000_000;
  const first = evaluateEnabledPlan({
    rules,
    position: position({ borrowApr: 0.045, utilization: 0.96 }),
    at: start,
  });
  assert.equal(first.notifications.length, 0);
  const later = evaluateEnabledPlan({
    rules,
    position: position({ borrowApr: 0.045, utilization: 0.96 }),
    states: first.states,
    at: start + RECOMMENDED_ALERT_DEFAULTS.ratePersistenceMs.watch,
  });
  assert.ok(later.notifications.some((event) => event.alertType === 'rate-watch'));
  const utilized = evaluateEnabledPlan({
    rules,
    position: position({ borrowApr: 0.03, utilization: 0.96 }),
    states: first.states,
    at: start + RECOMMENDED_ALERT_DEFAULTS.utilization.watchPersistenceMs,
  });
  assert.ok(utilized.notifications.some((event) => event.alertType === 'utilization-watch'));
});

test('a health-factor breach sends only the highest severity', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['hf-watch', 'hf-prepare', 'hf-act', 'hf-urgent', 'btc-cushion']);
  const result = evaluateEnabledPlan({
    rules,
    position: position({ healthFactor: 1.4, cushion: 0.2 }),
    at: 5_000,
  });
  const safety = result.notifications.filter((event) => event.category === 'position-safety');
  assert.equal(safety.length, 1);
  assert.equal(safety[0]?.alertType, 'hf-act');
  assert.ok(safety[0]?.groupedTypes.includes('btc-cushion'));
});

test('the same severity does not notify again until cooldown, escalation, or resolution', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['hf-watch']);
  const first = evaluateEnabledPlan({
    rules,
    position: position({ healthFactor: 2.4 }),
    at: 10_000,
  });
  assert.equal(first.notifications.length, 1);
  const again = evaluateEnabledPlan({
    rules,
    position: position({ healthFactor: 2.4 }),
    states: first.states,
    at: 20_000,
  });
  assert.equal(again.notifications.length, 0);
  const recovered = evaluateEnabledPlan({
    rules,
    position: position({ healthFactor: 3 }),
    states: first.states,
    at: 30_000,
  });
  assert.equal(recovered.notifications.length, 0);
  assert.ok(recovered.decisions.some((decision) => decision.action === 'resolve' && decision.emailResolution === false));
  const returned = evaluateEnabledPlan({
    rules,
    position: position({ healthFactor: 2.2 }),
    states: recovered.states,
    at: 40_000,
  });
  assert.equal(returned.notifications[0]?.alertType, 'hf-watch');
});

test('zero debt pauses position alerts and reopening waits for review', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['hf-watch', 'rate-watch']);
  const paused = evaluateEnabledPlan({
    rules,
    position: position({ debtUsd: 0, healthFactor: null, cushion: null }),
    at: 1,
  });
  assert.equal(paused.notifications.length, 0);
  assert.equal(paused.states.find((state) => state.alertType === 'hf-watch')?.paused, true);
  const reopened = evaluateEnabledPlan({
    rules,
    position: position({ healthFactor: 1.2, borrowApr: 0.2 }),
    states: paused.states,
    at: 2 + RECOMMENDED_ALERT_DEFAULTS.ratePersistenceMs.watch,
  });
  assert.equal(reopened.notifications.some((event) => event.category === 'position-safety'), false);
  assert.equal(reopened.states.find((state) => state.alertType === 'hf-watch')?.resumePending, true);
});

test('a stale position read is a data warning, not a health-factor alert', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['data-stale', 'hf-watch']);
  const result = evaluateEnabledPlan({
    rules,
    position: position({ freshnessAgeMs: RECOMMENDED_ALERT_DEFAULTS.staleDataMs, healthFactor: 3 }),
    at: 9,
  });
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0]?.category, 'data-health');
});

test('a failed position read does not pause health-factor alerts', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['hf-watch', 'data-stale']);
  const result = evaluateEnabledPlan({
    rules,
    position: position({ positionReadFailed: true, healthFactor: 1.1 }),
    at: 4,
  });
  assert.equal(result.notifications.some((event) => event.category === 'position-safety'), false);
  assert.equal(result.notifications[0]?.category, 'data-health');
  assert.notEqual(result.states.find((state) => state.alertType === 'hf-watch')?.paused, true);
});

test('a fast APR move stays separate from the benchmark level', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['rate-watch', 'rate-velocity']);
  const start = 1_000;
  const result = evaluateEnabledPlan({
    rules,
    position: position({ borrowApr: 0.045, aprChange6hBps: 80, historyAdequate: true }),
    states: [{ alertType: 'rate-watch', breachSince: start }],
    at: start + RECOMMENDED_ALERT_DEFAULTS.ratePersistenceMs.watch,
  });
  assert.ok(result.notifications.some((event) => event.alertType === 'rate-watch'));
  assert.ok(result.notifications.some((event) => event.alertType === 'rate-velocity'));
  assert.match(result.notifications.find((event) => event.alertType === 'rate-velocity')?.message ?? '', /increased from/);
});

test('missing rate history is not treated as zero change', () => {
  const rules = approveSelectedRules(generateRecommendedRules(position()), ['rate-velocity']);
  const result = evaluateEnabledPlan({
    rules,
    position: position({ historyAdequate: false, aprChange6hBps: null, aprChange24hBps: null }),
    at: 1,
  });
  assert.equal(result.notifications.length, 0);
});

test('canonical identity includes wallet, chain, protocol, and market', () => {
  const plan = createRecommendedPlan(position());
  assert.equal(plan.approved, false);
  assert.equal(plan.marketKey, alertMarketKey({
    wallet: '0xABC',
    chainId: 8453,
    protocol: 'Morpho',
    marketId: '0xMARKET',
  }));
  assert.equal(plan.rules.every((rule) => rule.enabled === false), true);
});
