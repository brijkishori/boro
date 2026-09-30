import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DRIFT_NOTICE,
  HYPOTHETICAL_NOTICE,
  appendPlannerHistory,
  buildPlannerCards,
  buildRemedyHandoff,
  correctiveCards,
  executableNote,
  materialAmountDrift,
  parseRemedyHandoff,
  plannerGuidance,
  plannerNeedsCorrection,
  projectCustomAction,
  reviewDecision,
  stageRemedyHandoff,
  stressScenario,
  takeRemedyHandoff,
  tokenUnits,
  type PlannerPosition,
} from './actionPlanner';

function position(overrides: Partial<PlannerPosition> = {}): PlannerPosition {
  return {
    collateralAmount: 2,
    debt: 10_000,
    oraclePrice: 10_000,
    liquidationThreshold: 0.8,
    healthFactor: 1.6,
    walletDebt: 0,
    walletCollateral: 0,
    elsewhereDebt: 0,
    elsewhereCollateral: 0,
    ...overrides,
  };
}

test('a healthy position does not require a corrective action', () => {
  const healthy = position({ oraclePrice: 80_000, healthFactor: 3.4, debt: 10_000 });
  assert.equal(plannerNeedsCorrection(3.4, 2.5, true), false);
  assert.equal(plannerGuidance('NORMAL', 3.4, 2.5), 'No corrective action required.');
  assert.equal(correctiveCards(healthy, 2.5, true).length, 0);
});

test('a health factor below the preferred target produces repay and collateral remedies', () => {
  const cards = correctiveCards(position(), 2.5, true);
  assert.equal(cards.some((item) => item.type === 'REPAY' && item.repayAmount > 0), true);
  assert.equal(cards.some((item) => item.type === 'ADD_COLLATERAL' && item.collateralAmount > 0), true);
  assert.equal(cards.some((item) => item.type === 'MIXED'), true);
  assert.equal(plannerGuidance('PREPARE', 1.92, 2.5).includes('Prepare a corrective action'), true);
});

test('exact repay, collateral, and balanced remedies reach the target health factor', () => {
  const cards = buildPlannerCards(position(), 2.5);
  for (const item of cards) {
    assert.ok(item.projected.healthFactor !== null && Math.abs(item.projected.healthFactor - 2.5) < 1e-6);
  }
  const mixed = cards.find((item) => item.type === 'MIXED');
  assert.ok(mixed && mixed.repayAmount > 0 && mixed.collateralAmount > 0);
  assert.equal(mixed?.label, 'Balanced remedy');
});

test('same-chain USDC decides availability and another chain is not immediately available', () => {
  const enough = buildPlannerCards(position({ walletDebt: 20_000 }), 2.5).find((item) => item.type === 'REPAY');
  assert.equal(enough?.feasibility, 'AVAILABLE');
  assert.equal(executableNote('AVAILABLE', 'Base'), 'Executable with currently available Base balances');
  const short = buildPlannerCards(position({ walletDebt: 100 }), 2.5).find((item) => item.type === 'REPAY');
  assert.equal(short?.feasibility, 'PARTIALLY_AVAILABLE');
  const none = buildPlannerCards(position({ walletDebt: 0, elsewhereDebt: 5_000 }), 2.5).find((item) => item.type === 'REPAY');
  assert.equal(none?.feasibility, 'NOT_CURRENTLY_AVAILABLE');
  assert.equal(none?.availableDebt, 0);
  assert.equal(none?.elsewhereDebt, 5_000);
  const otherChain = buildPlannerCards(position({ walletCollateral: 0, elsewhereCollateral: 1 }), 2.5).find((item) => item.type === 'ADD_COLLATERAL');
  assert.equal(otherChain?.feasibility, 'NOT_CURRENTLY_AVAILABLE');
  assert.equal(otherChain?.availableCollateral, 0);
  assert.notEqual(otherChain?.availableCollateral, otherChain?.elsewhereCollateral);
});

test('a scenario price changes the remedy and does not mutate the live position', () => {
  const live = position({ oraclePrice: 80_000, healthFactor: 12 });
  const before = JSON.stringify(live);
  const stressed = stressScenario(live, 10_000, 2.5);
  assert.equal(JSON.stringify(live), before);
  assert.ok((stressed.stressed?.healthFactor ?? 99) < (stressed.live.healthFactor ?? 0));
  const calm = buildPlannerCards(live, 2.5);
  assert.equal(calm.length, 0);
  assert.ok(stressed.cards.some((item) => item.repayAmount > 0));
});

test('custom amounts project the position without a wallet transaction', () => {
  const projected = projectCustomAction(position(), 1_000, 0.1);
  assert.equal(projected.debt, 9_000);
  assert.equal(projected.collateralAmount, 2.1);
  assert.ok((projected.healthFactor ?? 0) > 1.6);
});

test('review builds a numeric handoff and material drift must be reviewed again', () => {
  const live = position({ walletDebt: 20_000 });
  const repay = buildPlannerCards(live, 2.5).find((item) => item.type === 'REPAY');
  assert.ok(repay);
  const handoff = buildRemedyHandoff({
    card: repay,
    position: live,
    identity: { protocol: 'morpho', chainId: 8453, marketId: '0xmarket', wallet: '0xabc' },
    targetHF: 2.5,
    calculatedAt: '2026-09-28T00:00:00.000Z',
    hypothetical: false,
    freshness: { position: 'fresh', oracle: 'fresh', walletBalances: 'fresh' },
  });
  assert.equal(typeof handoff.repayAmount, 'number');
  assert.equal(typeof handoff.repayAmount === 'string', false);
  assert.equal(handoff.projectedPosition.healthFactor !== null && Math.abs((handoff.projectedPosition.healthFactor ?? 0) - 2.5) < 1e-6, true);
  const changed = { ...repay, repayAmount: repay.repayAmount * 1.1 };
  assert.equal(reviewDecision({ previous: repay, next: changed, hypothetical: false }).proceed, false);
  assert.equal(reviewDecision({ previous: repay, next: changed, hypothetical: false }).message, DRIFT_NOTICE);
  assert.equal(materialAmountDrift(repay.repayAmount, repay.repayAmount), false);
  const hypothetical = reviewDecision({ previous: repay, next: repay, hypothetical: true });
  assert.equal(hypothetical.proceed, true);
  assert.equal(hypothetical.message, HYPOTHETICAL_NOTICE);
  const storage = new Map<string, string>();
  const memory = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  stageRemedyHandoff(memory, handoff);
  const taken = takeRemedyHandoff(memory);
  assert.equal(taken?.type, 'REPAY');
  assert.equal(takeRemedyHandoff(memory), null);
  assert.equal(parseRemedyHandoff(JSON.stringify({ ...handoff, repayAmount: '$4,215' })), null);
  assert.equal(tokenUnits(21.1, 6), 21_100_000n);
});

test('planner history records analysis and the monitor does not send a transaction', () => {
  const storage = new Map<string, string>();
  const memory = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  };
  const saved = appendPlannerHistory(memory, {
    at: '2026-09-28T00:00:00.000Z',
    riskState: 'PREPARE',
    healthFactor: 1.9,
    oraclePrice: 50_000,
    targetHF: 2.5,
    repay: 100,
    collateral: 0.1,
  });
  assert.equal(saved.length, 1);
  const monitor = readFileSync(new URL('../../components/RiskMonitor.tsx', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../../components/ActionPlanner.tsx', import.meta.url), 'utf8');
  assert.equal(monitor.includes('useSendTx'), false);
  assert.equal(planner.includes('useSendTx'), false);
  assert.equal(planner.includes('sendTransaction'), false);
  assert.equal(planner.includes('writeContract'), false);
  assert.equal(monitor.includes('stageRemedyHandoff'), true);
});
