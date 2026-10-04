import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { protocolMarketId, type Venue } from '@/lib/protocol';
import type { RiskMonitorInput } from './riskMonitor';
import type { PreparedExecution, WalletResources } from './executionPlanner';
import {
  advancePhase6D3AfterRepay,
  buildPhase6D3ManualMixedPlan,
  buildPhase6D3MixedExecution,
  completePhase6D3MixedExecution,
  markPhase6D3CollateralSubmitted,
  markPhase6D3RepaySubmitted,
  phase6D3ManualMixedValidation,
  phase6D3MixedEligibility,
  readPhase6D3MixedExecution,
  stagePhase6D3MixedExecution,
} from './assistedMixed';

const venue = {
  id: 'morpho-8453-cbBTC-USDC-0x9103',
  action: 'borrow',
  protocol: 'morpho',
  chainId: 8453,
  assetSymbol: 'cbBTC',
  loanSymbol: 'USDC',
  assetDecimals: 8,
  loanDecimals: 6,
  assetAddress: '0x1111111111111111111111111111111111111111',
  loanAddress: '0x2222222222222222222222222222222222222222',
  morpho: { marketId: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836', irm: '0x3333333333333333333333333333333333333333', oracle: '0x4444444444444444444444444444444444444444', lltv: 860000000000000000n },
  priceUsd: 84_000,
} as unknown as Venue;

const riskInput = {
  protocol: 'morpho', chainId: 8453, marketId: protocolMarketId(venue), wallet: '0x1111111111111111111111111111111111111111',
  collateralAsset: 'cbBTC', debtAsset: 'USDC', collateralAmount: 1, totalDebt: 20_000,
  oraclePrice: 84_000, liquidationThreshold: 0.86, healthFactor: 3.612,
  sourceBlock: '1', positionFetchedAt: Date.now(), oracleFetchedAt: Date.now(), fetchedAt: Date.now(), walletFetchedAt: Date.now(),
} as unknown as RiskMonitorInput;

const walletResources: WalletResources = {
  debtAssetAvailable: 200,
  collateralAvailable: 0.001,
  nativeGasAvailable: 0.01,
  debtAssetAllowance: 200,
  collateralAllowance: 0.001,
  gasRequired: 0.0001,
};

function preparedFrom(plan = buildPhase6D3ManualMixedPlan({
  riskInput, walletResources, networkContext: { chainId: 8453, marketId: riskInput.marketId }, venue, repayAmount: 5, collateralAmount: 0.00001,
})): PreparedExecution {
  return {
    planId: plan.id,
    preparedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    requiresRevalidationBeforeExecution: true,
    protocol: 'morpho', chainId: 8453, marketId: protocolMarketId(venue),
    freshBeforeState: { debt: 20_000, collateralAmount: 1, oraclePrice: 84_000, liquidationThreshold: 0.86 },
    transactions: [
      { action: 'REPAY', targetContract: '0x1', asset: 'USDC', amount: 5, approvalRequired: false, estimatedGas: 1, simulationStatus: 'PASSED' },
      { action: 'SUPPLY_COLLATERAL', targetContract: '0x1', asset: 'cbBTC', amount: 0.00001, approvalRequired: false, estimatedGas: 1, simulationStatus: 'PASSED' },
    ],
    exactAllowances: { USDC: 200, cbBTC: 0.001 }, estimatedGas: 2, estimatedNetworkCost: 0.01, networkCostUnknownReason: null,
    projectedAfterState: plan.targetState, drift: false, readiness: 'READY', blockingIssues: [], warnings: [], requiresUserConfirmation: true, executable: true,
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

test('6D.3 A: manual mixed plan requires both a partial repay and cbBTC collateral addition', () => {
  const plan = buildPhase6D3ManualMixedPlan({ riskInput, walletResources, networkContext: { chainId: 8453, marketId: riskInput.marketId }, venue, repayAmount: 5, collateralAmount: 0.00001 });
  assert.equal(plan.mode, 'EMERGENCY_MIXED');
  assert.equal(plan.requiredAssets.debtAssetRequired, 5);
  assert.equal(plan.requiredAssets.collateralRequired, 0.00001);
});

test('6D.3 B: full repay remains blocked', () => {
  assert.match(phase6D3ManualMixedValidation({ riskInput, repayAmount: 20_000, collateralAmount: 0.00001, venue }) ?? '', /Full repayment/);
});

test('6D.3 C: non-Morpho/Base/cbBTC paths remain blocked', () => {
  const wrongChain = phase6D3ManualMixedValidation({
    riskInput,
    repayAmount: 5,
    collateralAmount: 0.00001,
    venue: { ...venue, chainId: 1 },
  });
  assert.ok(wrongChain);
  assert.match(wrongChain, /Base/);
  
  const wrongProtocol = phase6D3ManualMixedValidation({
    riskInput,
    repayAmount: 5,
    collateralAmount: 0.00001,
    venue: {
      ...venue,
      protocol: 'aave',
      morpho: undefined,
    } as Venue,
  });
  assert.ok(wrongProtocol);
  assert.match(wrongProtocol, /Morpho/);
  
  const wrongCollateral = phase6D3ManualMixedValidation({
    riskInput,
    repayAmount: 5,
    collateralAmount: 0.00001,
    venue: { ...venue, assetSymbol: 'tBTC' },
  });
  assert.ok(wrongCollateral);
  assert.match(wrongCollateral, /cbBTC/);
});

test('6D.3 D: eligible prepared mixed review can start two-step execution', () => {
  const plan = buildPhase6D3ManualMixedPlan({ riskInput, walletResources, networkContext: { chainId: 8453, marketId: riskInput.marketId }, venue, repayAmount: 5, collateralAmount: 0.00001 });
  const result = phase6D3MixedEligibility({ plan, prepared: preparedFrom(plan), venue, wallet: riskInput.wallet! });
  assert.equal(result.eligible, true);
});

test('6D.3 E: hypothetical or failed transaction review cannot start', () => {
  const plan = buildPhase6D3ManualMixedPlan({ riskInput, walletResources, networkContext: { chainId: 8453, marketId: riskInput.marketId }, venue, repayAmount: 5, collateralAmount: 0.00001 });
  assert.equal(phase6D3MixedEligibility({ plan: { ...plan, hypothetical: true }, prepared: preparedFrom(plan), venue, wallet: riskInput.wallet! }).eligible, false);
  const failed = preparedFrom(plan);
  failed.transactions[1] = { ...failed.transactions[1]!, simulationStatus: 'FAILED' };
  assert.equal(phase6D3MixedEligibility({ plan, prepared: failed, venue, wallet: riskInput.wallet! }).eligible, false);
});

test('6D.3 F: mixed execution creates exact repay first and collateral second handoffs', () => {
  const plan = buildPhase6D3ManualMixedPlan({ riskInput, walletResources, networkContext: { chainId: 8453, marketId: riskInput.marketId }, venue, repayAmount: 5, collateralAmount: 0.00001 });
  const progress = buildPhase6D3MixedExecution({ plan, prepared: preparedFrom(plan), venue, wallet: riskInput.wallet! });
  assert.equal(progress.stage, 'REPAY_PENDING');
  assert.equal(progress.repayHandoff.type, 'REPAY');
  assert.equal(progress.repayHandoff.repayAmount, 5);
  assert.equal(progress.collateralHandoff.type, 'ADD_COLLATERAL');
  assert.equal(progress.collateralHandoff.collateralAmount, 0.00001);
});

test('6D.3 G: storage progression is fail-safe across submitted and confirmed stages', () => {
  const plan = buildPhase6D3ManualMixedPlan({ riskInput, walletResources, networkContext: { chainId: 8453, marketId: riskInput.marketId }, venue, repayAmount: 5, collateralAmount: 0.00001 });
  const progress = buildPhase6D3MixedExecution({ plan, prepared: preparedFrom(plan), venue, wallet: riskInput.wallet! });
  const storage = memoryStorage();
  stagePhase6D3MixedExecution(storage, progress);
  assert.equal(readPhase6D3MixedExecution(storage)?.stage, 'REPAY_PENDING');
  markPhase6D3RepaySubmitted(storage, progress.id, '0xabc');
  assert.equal(readPhase6D3MixedExecution(storage)?.stage, 'REPAY_SUBMITTED');
  advancePhase6D3AfterRepay(storage, progress.id);
  assert.equal(readPhase6D3MixedExecution(storage)?.stage, 'COLLATERAL_PENDING');
  markPhase6D3CollateralSubmitted(storage, progress.id, '0xdef');
  assert.equal(readPhase6D3MixedExecution(storage)?.stage, 'COLLATERAL_SUBMITTED');
  completePhase6D3MixedExecution(storage, progress.id);
  assert.equal(readPhase6D3MixedExecution(storage)?.stage, 'COMPLETE');
});

test('6D.3 H: app orchestration waits for reconciled completion callbacks between legs', () => {
  const page = readFileSync(new URL('../../app/page.tsx', import.meta.url), 'utf8');
  const repay = readFileSync(new URL('../../components/RepayFlow.tsx', import.meta.url), 'utf8');
  const borrow = readFileSync(new URL('../../components/BorrowFlow.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('advancePhase6D3AfterRepay'));
  assert.ok(page.includes('completePhase6D3MixedExecution'));
  assert.ok(repay.includes("confirmed.action !== 'repay'"));
  assert.ok(borrow.includes("confirmed.action !== 'supply'"));
});
