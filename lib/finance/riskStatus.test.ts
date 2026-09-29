import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aprMovement } from './openingApr';
import {
  aprMovementStatus,
  feasibilityStatus,
  freshnessStatus,
  marketStressPresentation,
  readinessStatus,
  riskSeverityStatus,
} from './riskStatus';

test('risk statuses pair a mark, a label, and a meaning', () => {
  const normal = riskSeverityStatus('NORMAL');
  assert.equal(normal.tone, 'normal');
  assert.equal(normal.mark, '●');
  assert.equal(normal.detail, 'No action required');
  const watch = riskSeverityStatus('WATCH');
  assert.equal(watch.tone, 'watch');
  assert.equal(watch.detail, 'Conditions changed — monitor');
  const prepare = riskSeverityStatus('PREPARE');
  assert.equal(prepare.tone, 'prepare');
  assert.equal(prepare.detail, 'Prepare repayment/collateral resources');
  const act = riskSeverityStatus('ACT');
  assert.equal(act.tone, 'act');
  assert.equal(act.detail, 'Corrective action recommended');
  const urgent = riskSeverityStatus('URGENT');
  assert.equal(urgent.tone, 'urgent');
  assert.equal(urgent.detail, 'Immediate action recommended');
  const data = riskSeverityStatus('DATA_WARNING');
  assert.equal(data.tone, 'data');
  assert.match(data.detail ?? '', /Fresh data unavailable/);
  assert.notEqual(normal.mark, watch.mark);
  assert.notEqual(prepare.mark, act.mark);
  assert.notEqual(act.mark, urgent.mark);
});

test('a healthy rate move stays gray and a cheaper rate stays green', () => {
  const unchanged = aprMovementStatus(aprMovement(0.048, 0.0481, 21_000));
  assert.equal(unchanged.tone, 'neutral');
  assert.equal(unchanged.mark, '→');
  assert.match(unchanged.label, /approximately unchanged/);
  const cheaper = aprMovementStatus(aprMovement(0.05, 0.046, 21_000));
  assert.equal(cheaper.tone, 'normal');
  assert.equal(cheaper.mark, '↓');
  assert.match(cheaper.label, /cheaper/);
  const expensive = aprMovementStatus(aprMovement(0.046, 0.05, 21_000));
  assert.equal(expensive.tone, 'act');
  assert.equal(expensive.mark, '↑');
  assert.match(expensive.label, /more expensive/);
});

test('readiness, market stress, freshness, and feasibility keep text with the tone', () => {
  assert.equal(readinessStatus('READY').tone, 'normal');
  assert.equal(readinessStatus('PARTIALLY_READY').tone, 'prepare');
  assert.equal(readinessStatus('NOT_READY').tone, 'urgent');
  assert.equal(readinessStatus('DATA_UNKNOWN').tone, 'data');
  assert.equal(marketStressPresentation('CALM').tone, 'normal');
  assert.equal(marketStressPresentation('CALM').detail, 'No action required');
  assert.equal(marketStressPresentation('HIGH').tone, 'act');
  assert.equal(freshnessStatus(false).label, 'FRESH');
  assert.equal(freshnessStatus(true).tone, 'data');
  assert.equal(feasibilityStatus('AVAILABLE').tone, 'normal');
  assert.equal(feasibilityStatus('NOT_CURRENTLY_AVAILABLE').tone, 'urgent');
  assert.match(feasibilityStatus('UNKNOWN').label, /BALANCE NOT LOADED/);
});
