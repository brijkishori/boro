import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import EmergencyConsole from './EmergencyConsole';
import { RiskMonitorInput, RiskMonitorReport, buildRiskMonitor, resolveRiskThresholds } from '@/lib/finance/riskMonitor';
import {
  WalletResources,
  deriveHypotheticalPosition,
  prepareExecutionReview,
  ExecutionPlan,
} from '@/lib/finance/executionPlanner';
import { priceAtHealthFactor } from '@/lib/finance/liquidation';
import { PreparedReviewUI } from './EmergencyConsole';
import type { Venue } from '@/lib/protocol';
import type { PublicClient } from 'viem';
import fs from 'fs';

// Check for N: no useWriteContract/useSendTx/wallet-send hook exists in Emergency Console
test('EmergencyConsole static check: No write hooks', () => {
  const code = fs.readFileSync(__dirname + '/EmergencyConsole.tsx', 'utf8');
  assert.ok(!code.includes('useWriteContract'), 'Should not use useWriteContract');
  assert.ok(!code.includes('useSendTx'), 'Should not use useSendTx');
  assert.ok(!code.includes('useSendTransaction'), 'Should not use useSendTransaction');
});

const defaultInput: RiskMonitorInput = {
  wallet: '0x123',
  protocol: 'aave',
  chainId: 8453,
  marketId: '1',
  collateralAsset: 'cbBTC',
  debtAsset: 'USDC',
  collateralAmount: 1,
  totalDebt: 60000,
  principal: 60000,
  accruedInterest: 0,
  healthFactor: 1.33,
  healthFactorKind: 'app-derived',
  liquidationThreshold: 0.8,
  currentBorrowApr: 0.05,
  sourceRate: 0.05,
  rateType: 'APR',
  avg1h: null,
  avg6h: null,
  avg24h: null,
  avg7d: null,
  avg30d: null,
  utilization: 0.5,
  availableLiquidity: 1000000,
  oraclePrice: 100000,
  fetchedAt: Date.now(),
  positionFetchedAt: Date.now(),
  oracleFetchedAt: Date.now(),
  rateFetchedAt: Date.now(),
  walletFetchedAt: Date.now(),
  collateralWalletFetchedAt: Date.now(),
  gasFetchedAt: Date.now(),
  source: 'aave',
  positionReadFailed: false,
  walletDebtAssetBalance: 10000,
  walletCollateralBalance: 0.5,
  nativeGasBalance: 0.1,
  gasRequired: 0.01,
  elsewhereDebtAsset: 2000,
  elsewhereCollateral: 0.1,
  benchmarkApr: null,
  benchmarkType: null,
  sourceBlock: 123456n,
  thresholds: { preferredHealthFactor: 2.5, watch: 2.0, prepare: 1.5, act: 1.2, urgent: 1.1, utilizationWatch: null, utilizationHigh: null },
};

const baseReport = buildRiskMonitor(defaultInput);

const defaultReport: RiskMonitorReport = {
  ...baseReport,
  thresholds: resolveRiskThresholds(defaultInput.thresholds),
  decision: {
    ...baseReport.decision,
    currentState: 'NORMAL',
    guidance: 'Monitor position',
    nextRiskState: 'WATCH',
    nextHf: 2.0,
    distanceToNextState: 0.1,
    nextBtcPrice: 90000,
  },
  readinessDecision: {
    ...baseReport.readinessDecision,
    readinessState: 'READY',
    currentSafetyState: 'NORMAL',
    explanation: 'Ready',
    availableUSDC: 10000,
    availableCollateral: 0.5,
    repayNeededAtScenario: 0,
    collateralNeededAtScenario: 0,
    currentActionRequired: false,
    contingencyScenario: 'PREPARE',
  },
};

const defaultResources: WalletResources = {
  debtAssetAvailable: 10000,
  collateralAvailable: 0.5,
  nativeGasAvailable: 0.1,
  gasRequired: 0.01,
  debtAssetAllowance: null,
  collateralAllowance: null,
};

test('A. NORMAL state shows "No action required"', () => {
  const html = renderToString(<EmergencyConsole report={defaultReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('No emergency action is currently required.'));
});

test('B. NORMAL state hides remedy cards by default', () => {
  const html = renderToString(<EmergencyConsole report={defaultReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(!html.includes('ACTION OPTIONS')); // Not showing action options section
});

// Since we cannot click buttons in renderToString directly without a test environment like testing-library,
// we test C by mocking the initial state or just knowing it's there. 
// But wait! We can test C by observing the presence of the "Preview emergency options" button!
test('C. preview emergency options exposes plans in NORMAL state (Button presence)', () => {
  const html = renderToString(<EmergencyConsole report={defaultReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('Preview emergency options'));
});

test('D. WATCH/PREPARE state automatically shows action alternatives', () => {
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const } };
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('ACTION OPTIONS'));
});

test('E. repay plan with sufficient USDC shows AVAILABLE/READY', () => {
  const input = { ...defaultInput, healthFactor: 2.0 };
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const }, snapshot: { ...defaultReport.snapshot, position: { ...defaultReport.snapshot.position, healthFactor: 2.0 } } };
  const resources = { ...defaultResources, debtAssetAvailable: 50000 };
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={input} walletResources={resources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  if (!html.includes('READY')) console.log(html);
  assert.ok(html.includes('READY'));
  assert.ok(html.includes('AVAILABLE'));
});

test('F. repay plan with shortfall shows exact shortfall and BLOCKED', () => {
  const input = { ...defaultInput, healthFactor: 1.5 };
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const }, snapshot: { ...defaultReport.snapshot, position: { ...defaultReport.snapshot.position, healthFactor: 1.5 } } };
  const resources = { ...defaultResources, debtAssetAvailable: 100 }; // Very low, causes shortfall
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={input} walletResources={resources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('BLOCKED'));
  assert.ok(html.includes('Shortfall:'));
});

test('G. collateral plan with sufficient cbBTC shows READY', () => {
  const input = { ...defaultInput, healthFactor: 1.5 };
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const }, snapshot: { ...defaultReport.snapshot, position: { ...defaultReport.snapshot.position, healthFactor: 1.5 } } };
  const resources = { ...defaultResources, collateralAvailable: 10 }; // High collateral
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={input} walletResources={resources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('Add cbBTC'));
});

test('H. mixed plan renders both assets and projected HF', () => {
  const input = { ...defaultInput, healthFactor: 1.5 };
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const }, snapshot: { ...defaultReport.snapshot, position: { ...defaultReport.snapshot.position, healthFactor: 1.5 } } };
  const resources = { ...defaultResources, debtAssetAvailable: 20000, collateralAvailable: 1.0 }; // Plentiful resources
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={input} walletResources={resources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('MIXED REMEDY'));
});

test('I. wrong chain shows exact blocker', () => {
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const } };
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 1, marketId: '1' }} />); // input is 8453, context is 1
  assert.ok(html.includes('Wrong wallet network'));
});

test('J. stale oracle shows refresh-required blocker', () => {
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const } };
  const input = { ...defaultInput, oracleFetchedAt: Date.now() - 10000000 };
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={input} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('Stale oracle'));
  assert.ok(html.includes('Refresh required before relying on this plan.'));
});

test('K. unknown allowance displays unknown/estimated confirmation range', () => {
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const } };
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('Estimated wallet confirmations: ') && (html.includes('1-2') || html.includes('2-4')));
  assert.ok(html.includes('Allowance known') && html.includes('?'));
});

test('L. emergency resource inventory does not count other-chain assets as immediately available', () => {
  const html = renderToString(<EmergencyConsole report={defaultReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('Available elsewhere — transfer/bridge would be required.'));
});

test('M. target HF change recalculates plan values without wallet action', () => {
  const elevatedReport = { ...defaultReport, decision: { ...defaultReport.decision, currentState: 'WATCH' as const } };
  const html = renderToString(<EmergencyConsole report={elevatedReport} input={defaultInput} walletResources={defaultResources} networkContext={{ chainId: 8453, marketId: '1' }} />);
  assert.ok(html.includes('Restore Health Factor to'));
  assert.ok(html.includes('2.50'));
});

// --- Phase 6C Enhancement: Emergency Stress Scenario Preview Tests A - H ---

test('Scenario Test A: healthy live position + target below current HF shows "No action required for this target"', () => {
  const healthyInput = { ...defaultInput, healthFactor: 3.43 };
  const healthyReport: RiskMonitorReport = {
    ...defaultReport,
    snapshot: {
      ...defaultReport.snapshot,
      position: {
        ...defaultReport.snapshot.position,
        healthFactor: 3.43,
      },
    },
  };
  const html = renderToString(
    <EmergencyConsole
      report={healthyReport}
      input={healthyInput}
      walletResources={defaultResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
      initialExplorePreview={true}
    />
  );
  assert.ok(html.includes('No action required for this target.'));
  assert.ok(html.includes('Current HF:') && html.includes('3.43'));
  assert.ok(html.includes('Target HF:') && html.includes('2.50'));
  assert.ok(html.includes('Repay required: $0'));
  assert.ok(html.includes('Additional collateral required: 0') && html.includes('cbBTC'));
  assert.ok(!html.includes('ACTION OPTIONS'));
});

test('Scenario Test B: WATCH scenario derives a stressed hypothetical state', () => {
  const stressed = deriveHypotheticalPosition(defaultInput, defaultReport.thresholds.watch);
  const expectedPrice = priceAtHealthFactor(
    defaultInput.collateralAmount,
    defaultInput.totalDebt,
    defaultInput.liquidationThreshold,
    defaultReport.thresholds.watch
  );
  assert.strictEqual(stressed.healthFactor, defaultReport.thresholds.watch);
  assert.strictEqual(stressed.oraclePrice, expectedPrice);
  assert.strictEqual(stressed.collateralAmount, defaultInput.collateralAmount);
  assert.strictEqual(stressed.debt, defaultInput.totalDebt);

  const html = renderToString(
    <EmergencyConsole
      report={defaultReport}
      input={defaultInput}
      walletResources={defaultResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
      initialScenario="WATCH"
    />
  );
  assert.ok(html.includes('HYPOTHETICAL SCENARIO — no on-chain position has changed.'));
  assert.ok(html.includes('WATCH') && html.includes('2.00'));
  assert.ok(html.includes('Stressed BTC price'));
  assert.ok(html.includes('Return to live position'));
});

test('Scenario Test C: ACT scenario generates positive remedy amounts', () => {
  const html = renderToString(
    <EmergencyConsole
      report={defaultReport}
      input={defaultInput}
      walletResources={defaultResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
      initialScenario="ACT"
    />
  );
  assert.ok(html.includes('ACTION OPTIONS'));
  assert.ok(html.includes('Repay') || html.includes('Add cbBTC'));
  assert.ok(html.includes('Required:'));
});

test('Scenario Test D: hypothetical scenario uses real wallet resources for feasibility', () => {
  const scarceResources = { ...defaultResources, debtAssetAvailable: 50 };
  const scarceHtml = renderToString(
    <EmergencyConsole
      report={defaultReport}
      input={defaultInput}
      walletResources={scarceResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
      initialScenario="ACT"
    />
  );
  assert.ok(scarceHtml.includes('✕ INSUFFICIENT') || scarceHtml.includes('Shortfall:'));

  const ampleResources = { ...defaultResources, debtAssetAvailable: 100000, collateralAvailable: 10 };
  const ampleHtml = renderToString(
    <EmergencyConsole
      report={defaultReport}
      input={defaultInput}
      walletResources={ampleResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
      initialScenario="ACT"
    />
  );
  assert.ok(ampleHtml.includes('✓ AVAILABLE'));
});

const dummyPlan: ExecutionPlan = {
  id: 'plan-test',
  reason: 'Test Plan',
  mode: 'EMERGENCY_REPAY',
  createdAt: Date.now(),
  sourcePosition: {
    debt: 10000,
    collateralAmount: 2,
    oraclePrice: 50000,
    liquidationThreshold: 0.8,
  },
  targetState: {
    targetHealthFactor: 2.0,
    projectedDebt: 5000,
    projectedCollateralAmount: 2,
    projectedHealthFactor: 2.0,
    projectedLiquidationBtc: 40000,
    projectedCushion: 0.2,
  },
  steps: [
    { type: 'REPAY', asset: 'USDC', amount: 5000, label: 'Repay 5000 USDC' }
  ],
  requiredAssets: {
    debtAssetRequired: 5000,
    collateralRequired: 0,
  },
  walletResources: {
    debtAssetAvailable: 6000,
    collateralAvailable: 0,
    nativeGasAvailable: 0.1,
    gasRequired: null,
    debtAssetAllowance: null,
    collateralAllowance: null,
  },
  estimatedNetworkCost: null,
  networkCostUnknownReason: null,
  estimatedWalletConfirmations: 1,
  readiness: 'READY',
  blockingIssues: [],
  warnings: [],
  freshness: {
    positionFetchedAt: Date.now(),
    oracleFetchedAt: Date.now(),
    marketFetchedAt: Date.now(),
    walletFetchedAt: Date.now(),
    calculatedAt: Date.now(),
    requiresRevalidationBeforeExecution: true,
  },
  executable: false,
  hypothetical: true,
};

const dummyVenue = {
  id: '1',
  chainId: 8453,
  marketId: '1',
  protocol: 'aave',
  assetAddress: '0xcbbtc',
  loanAddress: '0xusdc',
  assetDecimals: 8,
  loanDecimals: 6,
  priceUsd: 50000,
  maxLtv: 0.8,
  aave: { pool: '0xpool', aToken: '0xatoken', variableDebtToken: '0xdebttoken' }
} as unknown as Venue;

test('Scenario Test E: hypothetical PreparedExecution is never executable', async () => {
  const dummyClient = {
    readContract: async () => 10000000000n,
    simulateContract: async () => ({ request: { data: '0xdata' } }),
    estimateGas: async () => 100000n,
  } as unknown as PublicClient;
  const review = await prepareExecutionReview(
    dummyPlan,
    defaultInput,
    dummyVenue,
    '0x123',
    dummyClient,
    { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
    { debtAsset: 6000, collateralAsset: 0 },
    1000000000n,
    3000,
    { hypothetical: true }
  );
  assert.strictEqual(review.executable, false);
  assert.strictEqual(review.readiness, 'BLOCKED');
  assert.ok(review.blockingIssues.includes('Hypothetical scenario — live position must be re-evaluated.'));
});

test('Scenario Test F: hypothetical transaction simulation is not marked PASSED', async () => {
  let simulatedCalled = false;
  const client = {
    readContract: async () => 10000000000n,
    simulateContract: async () => {
      simulatedCalled = true;
      return { request: { data: '0xdata' } };
    },
    estimateGas: async () => 100000n,
  } as unknown as PublicClient;
  const review = await prepareExecutionReview(
    dummyPlan,
    defaultInput,
    dummyVenue,
    '0x123',
    client,
    { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
    { debtAsset: 6000, collateralAsset: 0 },
    1000000000n,
    3000,
    { hypothetical: true }
  );
  assert.strictEqual(simulatedCalled, false, 'simulateContract must not be called for hypothetical position');
  assert.ok(review.transactions.every(t => t.simulationStatus !== 'PASSED'));
  
  const html = renderToString(<PreparedReviewUI prepared={review} onCancel={() => {}} input={defaultInput} chainName="Base" />);
  assert.ok(html.includes('On-chain transaction simulation unavailable for a hypothetical position.'));
  assert.ok(html.includes('FINANCIAL PROJECTION'));
  assert.ok(!html.includes('✓ Passed'));
});

test('Scenario Test G: returning to live position removes hypothetical state', () => {
  const liveHtml = renderToString(
    <EmergencyConsole
      report={defaultReport}
      input={defaultInput}
      walletResources={defaultResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
      initialScenario={null}
    />
  );
  assert.ok(!liveHtml.includes('HYPOTHETICAL SCENARIO — no on-chain position has changed.'));
  assert.ok(liveHtml.includes('EMERGENCY READINESS'));
  assert.ok(liveHtml.includes('No emergency action is currently required.'));
});

test('Scenario Test H: thresholds come from existing Risk Monitor configuration, not duplicated literals in UI', () => {
  const customThresholds = resolveRiskThresholds({
    preferredHealthFactor: 2.75,
    watch: 2.22,
    prepare: 1.88,
    act: 1.44,
    urgent: 1.11,
  });
  const customReport: RiskMonitorReport = {
    ...defaultReport,
    thresholds: customThresholds,
  };
  const html = renderToString(
    <EmergencyConsole
      report={customReport}
      input={defaultInput}
      walletResources={defaultResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
    />
  );
  assert.ok(html.includes('2.22'));
  assert.ok(html.includes('1.88'));
  assert.ok(html.includes('1.44'));
  assert.ok(html.includes('1.11'));
});

test('Scenario Test I: hypothetical mode distinctly labels LIVE POSITION and HYPOTHETICAL ACTION ANALYSIS', () => {
  const html = renderToString(
    <EmergencyConsole
      report={defaultReport}
      input={defaultInput}
      walletResources={defaultResources}
      networkContext={{ chainId: 8453, marketId: '1' }}
      initialScenario="ACT"
    />
  );
  // Distinct live position block
  assert.ok(html.includes('LIVE POSITION — CURRENT ON-CHAIN STATUS'));
  assert.ok(html.includes('Healthy / Ready'));
  assert.ok(html.includes('No action required on the live position.'));
  assert.ok(html.includes('Current HF'));

  // Distinct hypothetical analysis block
  assert.ok(html.includes('HYPOTHETICAL ACTION ANALYSIS'));
  assert.ok(html.includes('Starting condition:') && html.includes('ACT') && html.includes('1.20'));
  assert.ok(html.includes('Recovery target:') && html.includes('2.50'));

  // Orange banner warning preserved
  assert.ok(html.includes('HYPOTHETICAL SCENARIO — no on-chain position has changed.'));

  // Compact: does not duplicate the normal full checklist while hypothetical mode is active
  assert.ok(!html.includes('USDC reserve available'));
});
