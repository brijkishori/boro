import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Venue } from '@/lib/protocol';
import type { ExecutionPlan, PreparedExecution } from './executionPlanner';
import {
  buildPhase6D2CollateralHandoff,
  buildPhase6D2ManualCollateralPlan,
  phase6D2CollateralEligibility,
  phase6D2ManualCollateralValidation,
} from './assistedCollateral';

const venue = {
  id: 'morpho-base-cbbtc-usdc',
  protocol: 'morpho',
  action: 'borrow',
  chainId: 8453,
  assetSymbol: 'cbBTC',
  assetKind: 'custodial',
  assetAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  assetDecimals: 8,
  loanSymbol: 'USDC',
  loanAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  loanDecimals: 6,
  borrowApr: 0.048,
  supplyApr: 0,
  maxLtv: 0.86,
  liquidityUsd: 100_000_000,
  priceUsd: 83_000,
  morpho: {
    marketId: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
    loanToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    collateralToken: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    oracle: '0x1111111111111111111111111111111111111111',
    irm: '0x2222222222222222222222222222222222222222',
    lltv: '860000000000000000',
  },
} as Venue;

function plan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id: 'plan-collateral',
    reason: 'Add collateral',
    mode: 'EMERGENCY_COLLATERAL',
    createdAt: Date.now(),
    sourcePosition: { debt: 20_000, collateralAmount: 1, oraclePrice: 83_000, liquidationThreshold: 0.86 },
    targetState: { targetHealthFactor: 3.8, projectedDebt: 20_000, projectedCollateralAmount: 1.00001, projectedHealthFactor: 3.57, projectedLiquidationBtc: 23_255.58, projectedCushion: 0.72 },
    steps: [{ type: 'SUPPLY_COLLATERAL', asset: 'cbBTC', amount: 0.00001, label: 'Add cbBTC collateral' }],
    requiredAssets: { debtAssetRequired: 0, collateralRequired: 0.00001 },
    walletResources: { debtAssetAvailable: 200, collateralAvailable: 0.0019, nativeGasAvailable: 0.01, gasRequired: 0.0001, debtAssetAllowance: null, collateralAllowance: 0.0019 },
    estimatedNetworkCost: null,
    networkCostUnknownReason: null,
    estimatedWalletConfirmations: 1,
    readiness: 'READY',
    blockingIssues: [],
    warnings: [],
    freshness: { positionFetchedAt: Date.now(), oracleFetchedAt: Date.now(), marketFetchedAt: Date.now(), walletFetchedAt: Date.now(), calculatedAt: Date.now(), requiresRevalidationBeforeExecution: true },
    executable: true,
    ...overrides,
  };
}

function prepared(overrides: Partial<PreparedExecution> = {}): PreparedExecution {
  const now = Date.now();
  return {
    planId: 'plan-collateral',
    preparedAt: now,
    expiresAt: now + 300_000,
    requiresRevalidationBeforeExecution: true,
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho!.marketId,
    freshBeforeState: { debt: 20_000, collateralAmount: 1, oraclePrice: 83_000, liquidationThreshold: 0.86 },
    transactions: [{ action: 'SUPPLY_COLLATERAL', targetContract: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', asset: 'cbBTC', amount: 0.00001, approvalRequired: false, estimatedGas: 200_000, simulationStatus: 'PASSED' }],
    exactAllowances: { cbBTC: 0.0019 },
    estimatedGas: 200_000,
    estimatedNetworkCost: 0.02,
    networkCostUnknownReason: null,
    projectedAfterState: { targetHealthFactor: 3.8, projectedDebt: 20_000, projectedCollateralAmount: 1.00001, projectedHealthFactor: 3.57, projectedLiquidationBtc: 23_255.58, projectedCushion: 0.72 },
    drift: false,
    readiness: 'READY',
    blockingIssues: [],
    warnings: [],
    requiresUserConfirmation: true,
    executable: true,
    hypothetical: false,
    ...overrides,
  };
}

const wallet = '0x424ff23d211ffbb46c3be9726919243fd1ae22cc';

test('6D.2 A: live Morpho Base cbBTC collateral addition can continue', () => {
  const result = phase6D2CollateralEligibility({ plan: plan(), prepared: prepared(), venue, wallet });
  assert.equal(result.eligible, true);
  assert.equal(result.collateralAmount, 0.00001);
});

test('6D.2 B: non-Morpho, non-Base, and non-cbBTC remain review-only', () => {
  const aaveVenue = { ...venue, protocol: 'aave', morpho: undefined } as Venue;
  assert.equal(phase6D2CollateralEligibility({ plan: plan(), prepared: prepared(), venue: aaveVenue, wallet }).eligible, false);
  assert.equal(phase6D2CollateralEligibility({ plan: plan(), prepared: prepared(), venue: { ...venue, chainId: 1 } as Venue, wallet }).eligible, false);
  assert.equal(phase6D2CollateralEligibility({ plan: plan(), prepared: prepared(), venue: { ...venue, assetSymbol: 'tBTC' } as Venue, wallet }).eligible, false);
});

test('6D.2 C: hypothetical, stale, blocked, or failed prepared execution cannot continue', () => {
  assert.equal(phase6D2CollateralEligibility({ plan: plan({ hypothetical: true }), prepared: prepared({ hypothetical: true }), venue, wallet }).eligible, false);
  assert.equal(phase6D2CollateralEligibility({ plan: plan(), prepared: prepared({ readiness: 'BLOCKED', executable: false }), venue, wallet }).eligible, false);
  assert.equal(phase6D2CollateralEligibility({ plan: plan(), prepared: prepared({ expiresAt: Date.now() - 1 }), venue, wallet }).eligible, false);
  const failed = prepared({ transactions: [{ ...prepared().transactions[0], simulationStatus: 'FAILED' }] });
  assert.equal(phase6D2CollateralEligibility({ plan: plan(), prepared: failed, venue, wallet }).eligible, false);
});

test('6D.2 D: approval-required review may continue when approval simulation passed and supply simulation is deferred', () => {
  const review = prepared({
    transactions: [
      { action: 'APPROVE_TOKEN', targetContract: venue.assetAddress, asset: 'cbBTC', amount: 0.00001, approvalRequired: false, estimatedGas: 45_000, simulationStatus: 'PASSED' },
      { action: 'SUPPLY_COLLATERAL', targetContract: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', asset: 'cbBTC', amount: 0.00001, approvalRequired: true, estimatedGas: null, simulationStatus: 'UNAVAILABLE' },
    ],
  });
  assert.equal(phase6D2CollateralEligibility({ plan: plan(), prepared: review, venue, wallet }).eligible, true);
});

test('6D.2 E: handoff carries exact cbBTC amount into existing BorrowFlow supply path', () => {
  const handoff = buildPhase6D2CollateralHandoff({ plan: plan(), prepared: prepared(), venue, wallet });
  assert.equal(handoff.type, 'ADD_COLLATERAL');
  assert.equal(handoff.protocol, 'morpho');
  assert.equal(handoff.chainId, 8453);
  assert.equal(handoff.marketId, venue.id);
  assert.equal(handoff.collateralAmount, 0.00001);
  assert.equal(handoff.hypothetical, false);
  assert.equal(handoff.freshness.position, 'fresh');
  assert.match(handoff.notice ?? '', /revalidate/i);
});

test('6D.2 F: manual 0.00001 cbBTC live Morpho Base addition builds guarded collateral plan', () => {
  const now = Date.now();
  const riskInput = {
    wallet,
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho!.marketId,
    collateralAsset: 'cbBTC',
    debtAsset: 'USDC',
    collateralAmount: 1,
    totalDebt: 20_000,
    healthFactor: 3.5,
    liquidationThreshold: 0.86,
    oraclePrice: 83_000,
    fetchedAt: now,
    positionFetchedAt: now,
    oracleFetchedAt: now,
    walletFetchedAt: now,
    positionReadFailed: false,
    sourceBlock: 123n,
  };
  const walletResources = { debtAssetAvailable: 100, collateralAvailable: 0.0019, nativeGasAvailable: 0.01, gasRequired: 0.0001, debtAssetAllowance: null, collateralAllowance: null };
  const result = buildPhase6D2ManualCollateralPlan({
    riskInput,
    walletResources,
    networkContext: { chainId: 8453, marketId: venue.id },
    venue,
    collateralAmount: 0.00001,
  });
  assert.equal(result.mode, 'EMERGENCY_COLLATERAL');
  assert.equal(result.requiredAssets.collateralRequired, 0.00001);
  assert.equal(result.requiredAssets.debtAssetRequired, 0);
  assert.equal(result.targetState.projectedCollateralAmount, 1.00001);
  assert.equal(result.hypothetical, false);
  assert.equal(result.blockingIssues.length, 0);
});

test('6D.2 G: manual collateral addition requires an open loan', () => {
  const reason = phase6D2ManualCollateralValidation({
    riskInput: {
      wallet,
      protocol: 'morpho',
      chainId: 8453,
      marketId: venue.morpho!.marketId,
      collateralAsset: 'cbBTC',
      debtAsset: 'USDC',
      collateralAmount: 1,
      totalDebt: 0,
      liquidationThreshold: 0.86,
    },
    venue,
    collateralAmount: 0.00001,
  });
  assert.match(reason ?? '', /No live debt/);
});

test('6D.2 H: manual entry remains Morpho Base cbBTC only', () => {
  const riskInput = {
    wallet,
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho!.marketId,
    collateralAsset: 'cbBTC',
    debtAsset: 'USDC',
    collateralAmount: 1,
    totalDebt: 20_000,
    liquidationThreshold: 0.86,
  };
  assert.match(phase6D2ManualCollateralValidation({ riskInput, venue: { ...venue, chainId: 1 } as Venue, collateralAmount: 0.00001 }) ?? '', /Base/);
  assert.match(phase6D2ManualCollateralValidation({ riskInput: { ...riskInput, protocol: 'aave' }, venue: { ...venue, protocol: 'aave', morpho: undefined } as Venue, collateralAmount: 0.00001 }) ?? '', /Morpho/);
  assert.match(phase6D2ManualCollateralValidation({ riskInput: { ...riskInput, collateralAsset: 'tBTC' }, venue: { ...venue, assetSymbol: 'tBTC' } as Venue, collateralAmount: 0.00001 }) ?? '', /cbBTC/);
});


test('6D.2 I: approval handoff revalidates and simulates collateral supply before the second wallet request', () => {
  const source = readFileSync(new URL('../../components/BorrowFlow.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('revalidateSupplyAfterApproval'));
  assert.ok(source.includes("action: 'SUPPLY_COLLATERAL'"));
  assert.ok(source.includes('simulateContract'));
  assert.ok(source.includes("action === 'approve' && reviewAction === 'SUPPLY_COLLATERAL'"));
});
