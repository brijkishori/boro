import test from 'node:test';
import assert from 'node:assert/strict';
import type { Venue } from '@/lib/protocol';
import type { ExecutionPlan, PreparedExecution } from './executionPlanner';
import { buildPhase6D1RepayHandoff, phase6D1RepayEligibility } from './assistedRepay';

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
    id: 'plan',
    reason: 'Repay',
    mode: 'EMERGENCY_REPAY',
    createdAt: Date.now(),
    sourcePosition: { debt: 20_000, collateralAmount: 1, oraclePrice: 83_000, liquidationThreshold: 0.86 },
    targetState: { targetHealthFactor: 2.5, projectedDebt: 15_000, projectedCollateralAmount: 1, projectedHealthFactor: 4.75, projectedLiquidationBtc: 17_441.86, projectedCushion: 0.79 },
    steps: [{ type: 'REPAY', asset: 'USDC', amount: 5_000, label: 'Repay USDC' }],
    requiredAssets: { debtAssetRequired: 5_000, collateralRequired: 0 },
    walletResources: { debtAssetAvailable: 6_000, collateralAvailable: 0, nativeGasAvailable: 0.01, gasRequired: 0.0001, debtAssetAllowance: 6_000, collateralAllowance: null },
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
    planId: 'plan',
    preparedAt: now,
    expiresAt: now + 300_000,
    requiresRevalidationBeforeExecution: true,
    protocol: 'morpho',
    chainId: 8453,
    marketId: venue.morpho!.marketId,
    freshBeforeState: { debt: 20_000, collateralAmount: 1, oraclePrice: 83_000, liquidationThreshold: 0.86 },
    transactions: [{ action: 'REPAY', targetContract: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', asset: 'USDC', amount: 5_000, approvalRequired: false, estimatedGas: 200_000, simulationStatus: 'PASSED' }],
    exactAllowances: { USDC: 6_000 },
    estimatedGas: 200_000,
    estimatedNetworkCost: 0.02,
    networkCostUnknownReason: null,
    projectedAfterState: { targetHealthFactor: 2.5, projectedDebt: 15_000, projectedCollateralAmount: 1, projectedHealthFactor: 4.75, projectedLiquidationBtc: 17_441.86, projectedCushion: 0.79 },
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

test('6D.1 A: live Morpho Base partial repay can continue', () => {
  const result = phase6D1RepayEligibility({ plan: plan(), prepared: prepared(), venue, wallet });
  assert.equal(result.eligible, true);
  assert.equal(result.repayAmount, 5_000);
});

test('6D.1 B: full repay is blocked', () => {
  const result = phase6D1RepayEligibility({ plan: plan({ requiredAssets: { debtAssetRequired: 20_000, collateralRequired: 0 } }), prepared: prepared(), venue, wallet });
  assert.equal(result.eligible, false);
  assert.match(result.reason ?? '', /Full repayment/);
});

test('6D.1 C: non-Morpho and non-Base remain review-only', () => {
  const aaveVenue = { ...venue, protocol: 'aave', morpho: undefined } as Venue;
  assert.equal(phase6D1RepayEligibility({ plan: plan(), prepared: prepared(), venue: aaveVenue, wallet }).eligible, false);
  const ethVenue = { ...venue, chainId: 1 } as Venue;
  assert.equal(phase6D1RepayEligibility({ plan: plan(), prepared: prepared(), venue: ethVenue, wallet }).eligible, false);
});

test('6D.1 D: stale/blocked/failed prepared execution cannot continue', () => {
  assert.equal(phase6D1RepayEligibility({ plan: plan(), prepared: prepared({ readiness: 'BLOCKED', executable: false }), venue, wallet }).eligible, false);
  assert.equal(phase6D1RepayEligibility({ plan: plan(), prepared: prepared({ expiresAt: Date.now() - 1 }), venue, wallet }).eligible, false);
  const failed = prepared({ transactions: [{ ...prepared().transactions[0], simulationStatus: 'FAILED' }] });
  assert.equal(phase6D1RepayEligibility({ plan: plan(), prepared: failed, venue, wallet }).eligible, false);
});

test('6D.1 E: handoff carries exact partial repay into existing RepayFlow path', () => {
  const handoff = buildPhase6D1RepayHandoff({ plan: plan(), prepared: prepared(), venue, wallet });
  assert.equal(handoff.type, 'REPAY');
  assert.equal(handoff.protocol, 'morpho');
  assert.equal(handoff.chainId, 8453);
  assert.equal(handoff.marketId, venue.id);
  assert.equal(handoff.repayAmount, 5_000);
  assert.equal(handoff.hypothetical, false);
  assert.equal(handoff.freshness.position, 'fresh');
  assert.match(handoff.notice ?? '', /revalidate/i);
});
