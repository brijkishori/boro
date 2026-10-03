import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { prepareExecutionReview, ExecutionPlan, ExecutionStep } from './executionPlanner';
import type { RiskMonitorInput } from './riskMonitor';
import type { Venue } from '@/lib/protocol';
import type { PublicClient } from 'viem';
import fs from 'fs';

function mockFn<T extends (...args: unknown[]) => unknown>(impl?: T) {
  return async (...args: unknown[]) => {
    if (impl) return await impl(...args);
  };
}

describe('Phase 6C: Emergency Action Review + Transaction Simulation', () => {
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
      { type: 'REPAY', asset: 'USDC', amount: 5000, label: 'Repay 5000 USDC' } as ExecutionStep
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
    executable: true,
  };

  const dummyInput = {
    wallet: '0xabc',
    protocol: 'morpho',
    chainId: 8453,
    marketId: '0xmarket',
    collateralAsset: '0xcbbtc',
    debtAsset: '0xusdc',
  } as unknown as RiskMonitorInput;

  const dummyVenue = {
    chainId: 8453,
    marketId: '0xmarket',
    protocol: 'morpho',
    assetAddress: '0xcbbtc',
    loanAddress: '0xusdc',
    assetDecimals: 8,
    loanDecimals: 6,
    priceUsd: 50000,
    maxLtv: 0.8,
    morpho: { marketId: '0xmarket', oracle: '0xoracle', lltv: 800000000000000000n }
  } as unknown as Venue;

  const dummyClient = {
    readContract: mockFn(async () => 10000000000n), // 10000 USDC
    simulateContract: mockFn(async () => ({ request: { data: '0xdata' } })),
    estimateGas: mockFn(async () => 100000n),
  } as unknown as PublicClient;

  it('A. READY repay plan opens review without wallet invocation (returns structure, no transactions sent)', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      1000000000n, // gasPriceWei
      3000 // ethPriceUsd
    );
    if (review.readiness === 'BLOCKED') console.error('A BLOCKED ISSUES:', review.blockingIssues);
    assert.strictEqual(review.readiness, 'READY');
    assert.strictEqual(review.transactions.length, 1);
    assert.strictEqual(review.transactions[0].action, 'REPAY');
  });

  it('B. sufficient allowance removes approval transaction', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient, // returns 10000 USDC allowance > 5000 needed
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      1000000000n,
      3000
    );
    assert.ok(!review.transactions.find(t => t.action === 'APPROVE_TOKEN'));
    assert.strictEqual(review.transactions.find(t => t.action === 'REPAY')?.approvalRequired, false);
  });

  it('C. insufficient allowance creates approval intent', async () => {
    const insufficientClient = { ...dummyClient, readContract: mockFn(async () => 1000000n) } as unknown as PublicClient; // 1 USDC
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      insufficientClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      1000000000n,
      3000
    );
    assert.ok(review.transactions.some(t => t.action === 'APPROVE_TOKEN'));
    assert.strictEqual(review.transactions.find(t => t.action === 'REPAY')?.approvalRequired, true);
    assert.strictEqual(review.transactions.find(t => t.action === 'REPAY')?.simulationStatus, 'UNAVAILABLE');
    assert.ok(review.warnings.some((warning) => warning.includes('simulation deferred')));
  });

  it('D. fresh wallet balance below required amount blocks review', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 1000, collateralAsset: 0 } // required is 5000
    );
    assert.strictEqual(review.readiness, 'BLOCKED');
    assert.ok(review.blockingIssues.includes('Insufficient current USDC'));
  });

  it('E. fresh position change causes plan refresh/re-review (blocks plan)', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 12000, collateralAmount: 2, oraclePrice: 50000 }, // debt drifted from 10000
      { debtAsset: 6000, collateralAsset: 0 }
    );
    assert.strictEqual(review.readiness, 'BLOCKED');
    assert.ok(review.blockingIssues.includes('Position changed'));
  });

  it('F. market identity mismatch blocks review', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      { ...dummyInput, chainId: 1 }, // mismatch
      dummyVenue, // 8453
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 }
    );
    assert.strictEqual(review.readiness, 'BLOCKED');
    assert.ok(review.blockingIssues.includes('Wrong wallet network'));
  });

  it('G. successful simulation marks transaction PASSED', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      1000000000n,
      3000
    );
    assert.strictEqual(review.transactions[0].simulationStatus, 'PASSED');
  });

  it('H. simulation revert blocks prepared execution', async () => {
    const revertClient = { ...dummyClient, simulateContract: async () => { throw new Error('revert: not enough money') } } as unknown as PublicClient;
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      revertClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 }
    );
    assert.strictEqual(review.readiness, 'BLOCKED');
    assert.ok(review.blockingIssues.includes('Simulation reverted'));
    assert.strictEqual(review.transactions[0].simulationStatus, 'FAILED');
    assert.ok(review.transactions[0].revertReason?.includes('revert: not enough money'));
  });

  it('I. gas estimate produces non-zero cost when all inputs known', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient, // returns 100000 gas
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      1000000000n, // 1 gwei
      3000 // $3000 ETH
    );
    assert.ok((review.estimatedNetworkCost ?? 0) > 0);
    assert.strictEqual(review.networkCostUnknownReason, null);
  });

  it('J. missing gas input remains null with exact reason', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      undefined, // no gas price
      3000
    );
    assert.strictEqual(review.estimatedNetworkCost, null);
    assert.strictEqual(review.networkCostUnknownReason, 'Gas estimate unavailable');
  });

  it('K. projected after-state matches ExecutionPlan finance math', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      1000000000n,
      3000
    );
    assert.deepStrictEqual(review.projectedAfterState, dummyPlan.targetState);
  });

  it('L. mixed repay + collateral creates ordered supported intents', async () => {
    const mixedPlan = { ...dummyPlan, steps: [
      { type: 'REPAY', asset: 'USDC', amount: 5000, label: 'Repay 5000 USDC' },
      { type: 'SUPPLY_COLLATERAL', asset: 'cbBTC', amount: 1, label: 'Add 1 cbBTC' }
    ] } as ExecutionPlan;
    
    const review = await prepareExecutionReview(
      mixedPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 1 },
      1000000000n,
      3000
    );
    assert.strictEqual(review.transactions.length, 2);
    assert.strictEqual(review.transactions[0].action, 'REPAY');
    assert.strictEqual(review.transactions[1].action, 'SUPPLY_COLLATERAL');
  });

  it('M. prepared review expires/requires revalidation', async () => {
    const review = await prepareExecutionReview(
      dummyPlan,
      dummyInput,
      dummyVenue,
      '0xabc',
      dummyClient,
      { debt: 10000, collateralAmount: 2, oraclePrice: 50000 },
      { debtAsset: 6000, collateralAsset: 0 },
      1000000000n,
      3000
    );
    assert.strictEqual(review.requiresRevalidationBeforeExecution, true);
    assert.ok(review.expiresAt > review.preparedAt);
  });

  it('N. no wallet write/send hook exists in Phase 6C path', () => {
    const code = fs.readFileSync(__dirname + '/../../components/EmergencyConsole.tsx', 'utf8');
    assert.ok(!code.includes('useWriteContract'));
    assert.ok(!code.includes('useSendTransaction'));
    assert.ok(!code.includes('walletClient'));
  });
});