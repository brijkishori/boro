import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameTrendSamples } from './trendStore';
import {
  PACE_DISCLAIMER,
  PACE_LABEL,
  TREND_UNAVAILABLE,
  alertForDriver,
  appendTrendSample,
  buildEarlyWarning,
  classifyAprAcceleration,
  classifyHfDirection,
  classifyLiquidity,
  earlyWarningEmailLines,
  hasPredictiveClaim,
  reachesBoundaryCopy,
  type EarlyWarningInput,
  type TrendSample,
} from './earlyWarning';
import { resolveRiskThresholds } from './riskMonitor';

const now = Date.parse('2026-09-28T16:00:00Z');
const thresholds = resolveRiskThresholds(null);

function hours(ago: number, fields: Omit<TrendSample, 't'>): TrendSample {
  return { t: now - ago * 3_600_000, ...fields };
}

function input(overrides: Partial<EarlyWarningInput> = {}): EarlyWarningInput {
  return {
    now,
    healthFactor: 3.4,
    ltv: 0.25,
    cushion: 0.7,
    debt: 21_247,
    collateralAmount: 1,
    liquidationThreshold: 0.86,
    oraclePrice: 84_000,
    borrowApr: 0.048,
    utilization: 0.5,
    availableLiquidity: 120_000_000,
    safetyFresh: true,
    positionFreshness: 'fresh',
    oracleFreshness: 'fresh',
    rateFreshness: 'fresh',
    marketFreshness: 'fresh',
    thresholds,
    samples: [],
    ...overrides,
  };
}

test('a material HF decline is deteriorating', () => {
  const warning = buildEarlyWarning(input({
    samples: [hours(6, { hf: 3.6, oracle: 88_000 })],
  }));
  assert.equal(classifyHfDirection(undefined, -0.2, undefined), 'DETERIORATING');
  assert.equal(warning.hfDirection, 'DETERIORATING');
  assert.ok(Math.abs((warning.snapshot.position.hfChange6h ?? 0) + 0.2) < 1e-9);
});

test('insignificant HF noise stays stable', () => {
  const warning = buildEarlyWarning(input({
    healthFactor: 3.4,
    samples: [hours(6, { hf: 3.39 })],
  }));
  assert.equal(warning.hfDirection, 'STABLE');
  assert.equal(warning.pace.shown, false);
});

test('an improving HF is not treated as deterioration', () => {
  const warning = buildEarlyWarning(input({
    samples: [hours(6, { hf: 3.2, oracle: 80_000 })],
  }));
  assert.equal(warning.hfDirection, 'IMPROVING');
  assert.equal(warning.pace.shown, false);
});

test('the next configured boundary is the only promoted threshold', () => {
  const warning = buildEarlyWarning(input());
  assert.equal(warning.next?.state, 'WATCH');
  assert.equal(warning.next?.hf, 2.5);
  assert.ok(Math.abs((warning.next?.hfDistance ?? 0) - 0.9) < 1e-9);
  assert.ok((warning.next?.btc ?? 0) > 0);
  assert.ok((warning.next?.priceDistance ?? 0) > 0);
  assert.equal(hasPredictiveClaim(reachesBoundaryCopy('WATCH', warning.next?.btc)), false);
  assert.match(reachesBoundaryCopy('WATCH', warning.next?.btc), /The position reaches WATCH at BTC/);
});

test('a valid observed decline produces a rounded mechanical pace', () => {
  const warning = buildEarlyWarning(input({
    samples: [hours(6, { hf: 3.6, oracle: 88_000 }), hours(3, { hf: 3.5, oracle: 86_000 })],
  }));
  assert.equal(warning.pace.shown, true);
  assert.equal(warning.pace.text, '~27h');
  assert.equal(warning.pace.label, PACE_LABEL);
  assert.equal(warning.pace.disclaimer, PACE_DISCLAIMER);
  assert.equal(hasPredictiveClaim(warning.summary.join(' ')), false);
});

test('noisy, opposing, or thin history does not invent a time to boundary', () => {
  const noisy = buildEarlyWarning(input({ samples: [hours(6, { hf: 3.39 })] }));
  const opposing = buildEarlyWarning(input({
    samples: [hours(6, { hf: 3.6 }), hours(24, { hf: 3.1 }), hours(12, { hf: 3.3 })],
  }));
  const thin = buildEarlyWarning(input({ samples: [hours(0.3, { hf: 3.1 })] }));
  assert.equal(noisy.pace.shown, false);
  assert.equal(opposing.pace.shown, false);
  assert.equal(thin.pace.shown, false);
  assert.equal(thin.snapshot.position.hfChange24h, undefined);
  assert.equal(TREND_UNAVAILABLE.includes('insufficient history'), true);
});

test('APR acceleration uses the configured jump thresholds', () => {
  assert.equal(classifyAprAcceleration(25, 20), 'RISING');
  assert.equal(classifyAprAcceleration(50, 20), 'RISING QUICKLY');
  assert.equal(classifyAprAcceleration(10, 100), 'RISING QUICKLY');
  assert.equal(classifyAprAcceleration(-25, -10), 'FALLING');
  assert.equal(classifyAprAcceleration(2, 4), 'STABLE');
  assert.equal(classifyAprAcceleration(undefined, undefined, 40), undefined);
  const warning = buildEarlyWarning(input({
    borrowApr: 0.048,
    samples: [hours(6, { apr: 0.0455 })],
    marketSamples: [hours(6, { apr: 0.0455, utilization: 0.5, liquidity: 120_000_000 })],
  }));
  assert.ok(Math.abs((warning.snapshot.rate.change6hBps ?? 0) - 25) < 0.01);
  assert.equal(warning.apr, 'RISING');
});

test('utilization near the configured watch level is elevated, not a liquidation call', () => {
  const warning = buildEarlyWarning(input({
    utilization: 0.94,
    marketSamples: [hours(6, { utilization: 0.88, apr: 0.048, liquidity: 120_000_000 })],
  }));
  assert.equal(warning.utilization, 'ELEVATED');
  assert.equal(warning.utilizationNote, 'Utilization is approaching the configured warning level.');
  assert.equal(hasPredictiveClaim(warning.utilizationNote ?? ''), false);
  assert.notEqual(warning.attention, 'URGENT');
});

test('a large liquidity decline stays deep when it still covers the position many times', () => {
  const warning = buildEarlyWarning(input({
    availableLiquidity: 120_000_000,
    marketSamples: [hours(24, { liquidity: 120_000_000 / 0.65, utilization: 0.5, apr: 0.048 }), hours(12, { liquidity: 150_000_000, utilization: 0.5, apr: 0.048 })],
  }));
  assert.equal(classifyLiquidity(120_000_000, 21_000), 'DEEP');
  assert.equal(warning.liquidity, 'DEEP');
  assert.equal(warning.liquidityNote, 'still ample for this position');
  assert.ok((warning.snapshot.market.liquidityChange24hPct ?? 0) < -0.3);
  assert.equal(warning.attention, 'NONE');
  assert.equal(warning.positionState, 'NORMAL');
});

test('NORMAL position + mild HF decline remains NORMAL with MONITOR attention and slightly deteriorating trend', () => {
  // Example from specification: HF ~3.39 (from 3.44), WATCH boundary 2.50
  // Position: NORMAL, Trend: DETERIORATING SLIGHTLY, Attention: MONITOR
  const warning = buildEarlyWarning(input({
    healthFactor: 3.39,
    samples: [hours(6, { hf: 3.44 })],
  }));
  assert.equal(warning.positionState, 'NORMAL');
  assert.equal(warning.hfDirection, 'DETERIORATING SLIGHTLY');
  assert.equal(warning.trend, 'DETERIORATING SLIGHTLY');
  assert.equal(warning.attention, 'MONITOR');
  assert.notEqual(warning.positionState, 'WATCH');
});

test('NORMAL position + severe HF decline remains NORMAL with PREPARE attention and DETERIORATING trend', () => {
  const warning = buildEarlyWarning(input({
    healthFactor: 2.60,
    samples: [hours(6, { hf: 3.44 })],
  }));
  assert.equal(warning.positionState, 'NORMAL');
  assert.equal(warning.hfDirection, 'DETERIORATING');
  assert.equal(warning.trend, 'DETERIORATING');
  assert.equal(warning.attention, 'PREPARE');
});

test('reference divergence is banded and does not call the oracle wrong', () => {
  const watch = buildEarlyWarning(input({ oraclePrice: 84_600, referenceBtc: 84_000 }));
  const warning = buildEarlyWarning(input({ oraclePrice: 85_200, referenceBtc: 84_000 }));
  const normal = buildEarlyWarning(input({ oraclePrice: 84_200, referenceBtc: 84_000 }));
  assert.equal(watch.reference?.band, 'WATCH');
  assert.equal(warning.reference?.band, 'WARNING');
  assert.equal(normal.reference?.band, 'NORMAL');
  assert.equal(warning.summary.join(' ').toLowerCase().includes('oracle is wrong'), false);
});

test('missing history stays undefined', () => {
  const warning = buildEarlyWarning(input());
  assert.equal(warning.snapshot.position.hf1hAgo, undefined);
  assert.equal(warning.snapshot.position.hfChange24h, undefined);
  assert.equal(warning.snapshot.collateral.priceChange24hPct, undefined);
  assert.equal(warning.snapshot.rate.change24hBps, undefined);
  assert.equal(warning.snapshot.market.utilization24hAgo, undefined);
  assert.equal(warning.hfDirection, undefined);
  assert.notEqual(warning.snapshot.position.hfChange24h, 0);
});

test('the composite warning names the primary driver without a score', () => {
  const warning = buildEarlyWarning(input({
    healthFactor: 3.12,
    oraclePrice: 77_000,
    samples: [
      hours(24, { hf: 3.4, oracle: 84_000 }),
      hours(12, { hf: 3.25, oracle: 80_000 }),
    ],
  }));
  assert.equal(warning.driver, 'BTC/collateral decline');
  assert.match(warning.reason, /HF has fallen/);
  assert.match(warning.reason, /WATCH boundary/);
  assert.equal(hasPredictiveClaim(warning.reason), false);
  assert.equal(JSON.stringify(warning).includes('riskScore'), false);
});

test('generated decision text does not make a prediction', () => {
  const warning = buildEarlyWarning(input({
    samples: [hours(6, { hf: 3.6, oracle: 90_000 })],
  }));
  const text = [
    ...warning.summary,
    warning.reason,
    ...earlyWarningEmailLines(warning),
    reachesBoundaryCopy(warning.next?.state ?? 'WATCH', warning.next?.btc),
    PACE_LABEL,
    PACE_DISCLAIMER,
  ].join('\n');
  assert.equal(hasPredictiveClaim(text), false);
  assert.match(text, /Not a forecast/);
});

test('an unchanged trend log does not count as a new sample', () => {
  const stored = [{ t: now, hf: 3.4 }];
  assert.equal(sameTrendSamples(stored, [{ t: now, hf: 3.4 }]), true);
  assert.equal(sameTrendSamples(stored, [{ t: now + 1, hf: 3.4 }]), false);
});

test('trend sampling keeps a reading and does not turn a skipped poll into zeros', () => {
  const first = appendTrendSample([], { t: now, hf: 3.4, oracle: 84_000 }, now);
  const skipped = appendTrendSample(first, { t: now + 60_000, hf: 1 }, now + 60_000);
  assert.equal(skipped, first);
  assert.equal(first[0].ltv, undefined);
  const later = appendTrendSample(first, { t: now + 11 * 60_000, hf: 3.3 }, now + 11 * 60_000);
  assert.equal(later.length, 2);
  assert.equal(later[1].oracle, undefined);
});

test('building a warning does not mutate the live samples', () => {
  const samples = [hours(6, { hf: 3.6, oracle: 88_000 })];
  const before = JSON.stringify(samples);
  buildEarlyWarning(input({ samples }));
  assert.equal(JSON.stringify(samples), before);
});

test('alert status follows an existing rule and does not enable one', () => {
  assert.equal(alertForDriver('HF deterioration', [{ id: 'hf-watch', enabled: true }]).label, 'Alert enabled');
  assert.equal(alertForDriver('Borrow APR acceleration', [{ id: 'rate-velocity', enabled: false }]).label, 'Alert not configured');
  assert.equal(alertForDriver('Utilization pressure', []).label, 'Alert not configured');
});
