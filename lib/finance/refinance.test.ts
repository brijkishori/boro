import assert from 'node:assert/strict';
import test from 'node:test';
import type { Venue } from '@/lib/protocol';
import {
  buildMigrationPlan,
  calculateBreakEvenDays,
  calculateRateStability,
  calculateSafetyProjection,
  calculateStaticScenario,
  classifyCandidate,
  findRefinanceCandidates,
  type RefinanceCandidate,
  type RefinanceMarketBaseline,
} from './refinance';

const mockSourceVenue: Venue = {
  id: 'morpho-8453-cbBTC-USDC-0x9103',
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
  borrowApr: 0.0479, // 4.79%
  supplyApr: 0.035,
  maxLtv: 0.86,
  liquidityUsd: 5_000_000,
  priceUsd: 84_000,
  collateralRisk: {
    liquidationLtv: 0.86,
    liquidationThreshold: 0.86,
  },
  freshness: {
    source: 'rpc',
    fetchedAt: Date.now() - 30_000, // 30s ago
  },
};

const mockSourceBaseline: RefinanceMarketBaseline = {
  id: mockSourceVenue.id,
  protocol: 'morpho',
  chainId: 8453,
  marketId: mockSourceVenue.id,
  collateralAsset: 'cbBTC',
  debtAsset: 'USDC',
  collateralAmount: 1.0,
  collateralValueUsd: 84_000,
  debt: 21_000,
  currentApr: 0.0479, // 4.79%
  openingApr: 0.0485,
  safety: calculateSafetyProjection(21_000, 1.0, 84_000, 0.86),
  availableLiquidity: 5_000_000,
  utilization: 0.65,
  freshness: 'fresh',
  oraclePrice: 84_000,
  stability: calculateRateStability(0.0479, { avg7d: 0.0484, avg30d: 0.049 }),
};

function createCandidate(overrides: Partial<RefinanceCandidate> = {}): RefinanceCandidate {
  const venue: Venue = {
    id: overrides.id ?? 'aave-8453-cbBTC-USDC',
    protocol: overrides.protocol ?? 'aave',
    action: 'borrow',
    chainId: overrides.chainId ?? 8453,
    assetSymbol: overrides.collateral ?? 'cbBTC',
    assetKind: 'custodial',
    assetAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    assetDecimals: 8,
    loanSymbol: overrides.debtAsset ?? 'USDC',
    loanAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    loanDecimals: 6,
    borrowApr: overrides.currentApr ?? 0.0429, // 50 bps cheaper than 4.79%
    supplyApr: 0.03,
    maxLtv: overrides.liquidationThreshold ?? 0.86,
    liquidityUsd: overrides.availableLiquidity ?? 20_000_000,
    priceUsd: 84_000,
    collateralRisk: {
      liquidationLtv: overrides.liquidationThreshold ?? 0.86,
      liquidationThreshold: overrides.liquidationThreshold ?? 0.86,
    },
    freshness: {
      source: 'rpc',
      fetchedAt: Date.now() - 30_000,
    },
  };

  const classification = classifyCandidate(mockSourceVenue, venue);

  return {
    id: venue.id,
    protocol: venue.protocol,
    chainId: venue.chainId,
    marketId: venue.id,
    collateral: venue.assetSymbol,
    debtAsset: venue.loanSymbol,
    currentApr: venue.borrowApr,
    stability: calculateRateStability(venue.borrowApr, { avg7d: 0.0435 }),
    liquidationThreshold: overrides.liquidationThreshold ?? 0.86,
    availableLiquidity: overrides.availableLiquidity ?? 20_000_000,
    utilization: 0.55,
    freshness: 'fresh',
    wrapper: venue.assetSymbol,
    classification,
    classificationLabel: 'Same chain · Same wrapper',
    isStale: false,
    venue,
    ...overrides,
  };
}

test('same-chain same-wrapper classification', () => {
  const result = classifyCandidate(
    { chainId: 8453, assetSymbol: 'cbBTC', loanSymbol: 'USDC' },
    { chainId: 8453, assetSymbol: 'cbBTC', loanSymbol: 'USDC' },
  );
  assert.equal(result, 'SAME_CHAIN_SAME_WRAPPER');
});

test('wrapper-change classification', () => {
  const result = classifyCandidate(
    { chainId: 8453, assetSymbol: 'cbBTC', loanSymbol: 'USDC' },
    { chainId: 8453, assetSymbol: 'tBTC', loanSymbol: 'USDC' },
  );
  assert.equal(result, 'SAME_CHAIN_WRAPPER_CHANGE');
});

test('cross-chain classification', () => {
  const result = classifyCandidate(
    { chainId: 8453, assetSymbol: 'cbBTC', loanSymbol: 'USDC' },
    { chainId: 1, assetSymbol: 'cbBTC', loanSymbol: 'USDC' },
  );
  assert.equal(result, 'CROSS_CHAIN');
});

test('candidate 50 bps cheaper => correct annual difference', () => {
  // Source APR: 4.79% (0.0479), Candidate APR: 4.29% (0.0429) => difference: 50 bps (0.005)
  // Debt: $20,000 => Annual savings = 20,000 * 0.005 = $100
  const baseline: RefinanceMarketBaseline = {
    ...mockSourceBaseline,
    debt: 20_000,
    currentApr: 0.0479,
  };
  const candidate = createCandidate({ currentApr: 0.0429 });
  const plan = buildMigrationPlan({
    sourceMarket: baseline,
    destinationMarket: candidate,
  });

  assert.equal(plan.rateDifferenceBps, 50);
  assert.equal(plan.rateDirection, 'lower');
  assert.ok(Math.abs(plan.grossAnnualDifference - 100) < 1e-6);
  assert.ok(Math.abs(plan.monthlyDifference - 100 / 12) < 1e-6);
  assert.ok(Math.abs(plan.dailyDifference - 100 / 365) < 1e-6);
  assert.match(plan.rateDisplay, /↓ 50 bps lower current rate/);
});

test('migration cost => correct break-even', () => {
  // Debt: $20,000, savings: 50 bps = $100/yr
  // Migration cost: $25
  // Break-even days = (25 / 100) * 365 = 91.25 days
  const breakEven = calculateBreakEvenDays(20_000, 0.0479, 0.0429, 25);
  assert.ok(breakEven !== null);
  assert.ok(Math.abs(breakEven - 91.25) < 1e-6);

  // Through migration plan with gas inputs:
  // Gas: 1,020,000 units. gasPrice: 1 gwei (1e9 wei). ETH: $2500.
  // Cost = (1020000 * 1e9 * 2500) / 1e18 = $2.55
  const plan = buildMigrationPlan({
    sourceMarket: { ...mockSourceBaseline, debt: 20_000, currentApr: 0.0479 },
    destinationMarket: createCandidate({ currentApr: 0.0429 }),
    gasPriceWei: 1_000_000_000n,
    ethPriceUsd: 2500,
  });

  assert.ok(plan.estimatedCosts.isCostKnown);
  assert.ok(plan.estimatedCosts.estimatedCostUsd !== null);
  assert.ok(Math.abs(plan.estimatedCosts.estimatedCostUsd - 2.55) < 1e-6);
  assert.ok(plan.breakEvenDays !== null);
  // Break even = (2.55 / 100) * 365 = 9.3075 days
  assert.ok(Math.abs(plan.breakEvenDays - (2.55 / 100) * 365) < 1e-6);
});

test('candidate more expensive => no break-even', () => {
  // Current: 4.79%, Candidate: 5.29% (+50 bps)
  const breakEven = calculateBreakEvenDays(20_000, 0.0479, 0.0529, 25);
  assert.equal(breakEven, null);

  const plan = buildMigrationPlan({
    sourceMarket: { ...mockSourceBaseline, debt: 20_000, currentApr: 0.0479 },
    destinationMarket: createCandidate({ currentApr: 0.0529 }),
    gasPriceWei: 1_000_000_000n,
    ethPriceUsd: 2500,
  });

  assert.equal(plan.rateDirection, 'higher');
  assert.equal(plan.breakEvenDays, null);
  assert.match(plan.rateDisplay, /↑ 50 bps higher current rate/);
});

test('insufficient destination liquidity', () => {
  // Debt: $50,000, Candidate available liquidity: $10,000
  const candidate = createCandidate({ availableLiquidity: 10_000 });
  const plan = buildMigrationPlan({
    sourceMarket: { ...mockSourceBaseline, debt: 50_000 },
    destinationMarket: candidate,
  });

  assert.equal(plan.liquiditySufficiency, 'INSUFFICIENT');
  assert.equal(plan.isExecutable, false);
  assert.equal(plan.liquidityStatusLabel, 'INSUFFICIENT LIQUIDITY');
  assert.ok(plan.factualLabels.includes('INSUFFICIENT LIQUIDITY'));
});

test('lower APR but worse liquidation boundary', () => {
  // Source: liquidation threshold 0.86, collateral 1 BTC, debt $21,000
  // Source liquidation BTC = 21000 / (1 * 0.86) = $24,418.60
  // Candidate: lower threshold 0.77 (e.g. Compound or stricter pool)
  // Candidate liquidation BTC = 21000 / (1 * 0.77) = $27,272.72
  // Candidate liquidates at HIGHER BTC price => LESS liquidation margin!
  const candidate = createCandidate({
    currentApr: 0.0429, // lower rate
    liquidationThreshold: 0.77, // worse boundary
  });

  const plan = buildMigrationPlan({
    sourceMarket: mockSourceBaseline,
    destinationMarket: candidate,
  });

  assert.equal(plan.rateDirection, 'lower');
  assert.equal(plan.safetyComparison.marginComparison, 'LESS_MARGIN');
  assert.equal(plan.safetyComparison.marginCopy, 'Candidate has less liquidation margin');
  assert.ok(plan.factualLabels.includes('LESS LIQUIDATION MARGIN'));
  assert.ok(plan.factualLabels.includes('LOWER CURRENT RATE'));
});

test('missing history != stable history', () => {
  const withoutHistory = calculateRateStability(0.045, null);
  assert.equal(withoutHistory.hasHistory, false);
  assert.equal(withoutHistory.stabilityNote, 'Historical stability unavailable.');
  assert.notEqual(withoutHistory.stabilityNote, 'Stable');

  const withHistory = calculateRateStability(0.045, { avg7d: 0.044, avg30d: 0.046 });
  assert.equal(withHistory.hasHistory, true);
  assert.equal(withHistory.stabilityNote, undefined);
  assert.equal(withHistory.avg7d, 0.044);
});

test('static 90-day comparison', () => {
  // Debt: $20,000, Stay rate: 4.79% (0.0479), Candidate: 4.29% (0.0429)
  // Cost: $20
  // 90 days = 90 / 365 fraction
  // Stay interest = 20000 * 0.0479 * (90/365) = $236.219
  // Candidate interest = 20000 * 0.0429 * (90/365) = $211.5616
  // Gross saved = 20000 * 0.005 * (90/365) = $24.6575
  // Net = 24.6575 - 20 = $4.6575
  const result = calculateStaticScenario(20_000, 0.0479, 0.0429, 90, 20);
  assert.equal(result.days, 90);
  assert.ok(Math.abs(result.grossInterestSaved - (100 * 90) / 365) < 1e-4);
  assert.ok(result.netDifference !== null);
  assert.ok(Math.abs(result.netDifference - ((100 * 90) / 365 - 20)) < 1e-4);
  assert.match(result.disclaimer, /Static-rate scenario/);
});

test('stale candidate handling', () => {
  const staleVenue: Venue = {
    ...mockSourceVenue,
    id: 'aave-stale',
    protocol: 'aave',
    borrowApr: 0.04,
    freshness: {
      source: 'rpc',
      fetchedAt: Date.now() - 10 * 60_000, // 10 minutes ago (> 5m threshold)
    },
  };

  const candidates = findRefinanceCandidates(mockSourceVenue, [staleVenue]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].isStale, true);
  assert.equal(candidates[0].freshness, 'stale');

  const plan = buildMigrationPlan({
    sourceMarket: mockSourceBaseline,
    destinationMarket: candidates[0],
  });

  assert.equal(plan.isStale, true);
  assert.equal(plan.freshness, 'stale');
  // Candidate remains visible and plan is computed, not broken
  assert.ok(plan.rateDifferenceBps > 0);
});

test('zero / tiny APR spread classification', () => {
  const candidate = createCandidate({ currentApr: 0.0478 }); // only 1 bp cheaper
  const plan = buildMigrationPlan({
    sourceMarket: { ...mockSourceBaseline, debt: 20_000, currentApr: 0.0479 },
    destinationMarket: candidate,
  });

  assert.equal(plan.rateDifferenceBps, 1);
  assert.equal(plan.spreadClassification, 'TINY');
  assert.equal(plan.rateDirection, 'lower');
});

test('modest APR spread classification', () => {
  const candidate = createCandidate({ currentApr: 0.0449 }); // 30 bps cheaper
  const plan = buildMigrationPlan({
    sourceMarket: { ...mockSourceBaseline, debt: 20_000, currentApr: 0.0479 },
    destinationMarket: candidate,
  });

  assert.equal(plan.rateDifferenceBps, 30);
  assert.equal(plan.spreadClassification, 'MODEST');
});

test('material APR spread classification', () => {
  const candidate = createCandidate({ currentApr: 0.0419 }); // 60 bps cheaper
  const plan = buildMigrationPlan({
    sourceMarket: { ...mockSourceBaseline, debt: 20_000, currentApr: 0.0479 },
    destinationMarket: candidate,
  });

  assert.equal(plan.rateDifferenceBps, 60);
  assert.equal(plan.spreadClassification, 'MATERIAL');
});

test('unknown migration cost => no authoritative break-even', () => {
  const plan = buildMigrationPlan({
    sourceMarket: { ...mockSourceBaseline, debt: 20_000, currentApr: 0.0479 },
    destinationMarket: createCandidate({ currentApr: 0.0429 }),
    gasPriceWei: null, // Unknown cost
  });

  assert.equal(plan.estimatedCosts.isCostKnown, false);
  assert.equal(plan.estimatedCosts.estimatedCostUsd, null);
  assert.equal(plan.breakEvenDays, null);
});

test('unknown migration cost is strictly null, not $0', () => {
  const planUnknown = buildMigrationPlan({
    sourceMarket: mockSourceBaseline,
    destinationMarket: createCandidate(),
    gasPriceWei: undefined,
  });
  assert.equal(planUnknown.estimatedCosts.isCostKnown, false);
  assert.equal(planUnknown.estimatedCosts.estimatedCostUsd, null);

  const planZero = buildMigrationPlan({
    sourceMarket: mockSourceBaseline,
    destinationMarket: createCandidate(),
    gasPriceWei: 0n,
    ethPriceUsd: 2500,
  });
  assert.equal(planZero.estimatedCosts.isCostKnown, true);
  assert.equal(planZero.estimatedCosts.estimatedCostUsd, 0);
});

test('executionPathSupported classification flags', () => {
  const baseline = { ...mockSourceBaseline };
  
  // Same chain, same wrapper
  const candidate1 = createCandidate();
  const plan1 = buildMigrationPlan({ sourceMarket: baseline, destinationMarket: candidate1 });
  assert.equal(plan1.wrapperChange, false);
  assert.equal(plan1.chainChange, false);
  assert.equal(plan1.executionPathSupported, true);

  // Wrapper change
  const candidate2 = createCandidate({
    collateral: 'WBTC', // from cbBTC
  });
  const plan2 = buildMigrationPlan({ sourceMarket: baseline, destinationMarket: candidate2 });
  assert.equal(plan2.wrapperChange, true);
  assert.equal(plan2.executionPathSupported, false);

  // Cross chain
  const candidate3 = createCandidate({
    chainId: 1, // from 8453
  });
  const plan3 = buildMigrationPlan({ sourceMarket: baseline, destinationMarket: candidate3 });
  assert.equal(plan3.chainChange, true);
  assert.equal(plan3.executionPathSupported, false);
});

import { readFileSync } from 'node:fs';

test('Refinance UI model implementation matches requirements', () => {
  const ui = readFileSync(new URL('../../components/RefinancePanel.tsx', import.meta.url), 'utf8');
  assert.equal(ui.includes('STAY IN CURRENT MARKET'), true);
  assert.equal(ui.includes('Switch'), false);
  assert.equal(ui.includes('Move'), false);
  assert.equal(ui.includes('Refinance now'), false);
  assert.equal(ui.includes('Best market'), false);
  assert.equal(ui.includes('useSendTx'), false, 'no transaction actions in Refinance UI');
  assert.equal(ui.includes('useWriteContract'), false, 'no wallet interactions');
  assert.equal(ui.includes('Unknown'), true);
  assert.equal(ui.includes('Unavailable'), true);
});

test('Refinance UI groups candidates logically and respects default collapsed states', () => {
  const ui = readFileSync(new URL('../../components/RefinancePanel.tsx', import.meta.url), 'utf8');

  // Validate directly comparable group expanded initially (no disclosure button, rendered directly)
  assert.equal(ui.includes('comparablePlans.length > 0'), true);
  assert.equal(ui.includes('{comparablePlans.map(renderPlanCard)}'), true);
  
  // Validate wrapper-change group collapsed initially
  assert.ok(ui.match(/const \[showWrapperChange, setShowWrapperChange\] = useState(?:<boolean>)?\(false\)/));
  // Validate clicking disclosure expands the group
  assert.equal(ui.includes('onClick={() => setShowWrapperChange(!showWrapperChange)}'), true);
  
  // Validate cross-chain group collapsed initially
  assert.ok(ui.match(/const \[showCrossChain, setShowCrossChain\] = useState(?:<boolean>)?\(false\)/));
  // Validate clicking disclosure expands the group
  assert.equal(ui.includes('onClick={() => setShowCrossChain(!showCrossChain)}'), true);
  
  // Validate cross-chain candidate cards are not rendered until expanded
  assert.equal(ui.includes('{showCrossChain && ('), true);
  assert.equal(ui.includes('{crossChainPlans.map(renderPlanCard)}'), true);

  // Validate the main heading is updated
  assert.equal(ui.includes('Refinance alternatives'), true);
  assert.equal(ui.includes('SUPPORTED CANDIDATE MARKETS'), false);
});

test('Refinance UI summary uses Group A correctly and handles secondary options', () => {
  const ui = readFileSync(new URL('../../components/RefinancePanel.tsx', import.meta.url), 'utf8');

  // primary summary uses Group A only
  assert.equal(ui.includes('const bestComparablePlan = useMemo(() => {'), true);
  assert.equal(ui.includes('comparablePlans'), true);

  // current market lowest among Group A
  assert.equal(ui.includes('Current market has the lowest current APR among directly comparable'), true);

  // cheaper Group A candidate summary
  assert.equal(ui.includes('Lowest directly comparable APR:'), true);

  // lower cross-chain/wrapper candidate does not become primary summary
  assert.equal(ui.includes('Lower APR exists outside the directly comparable group:'), true);
});
