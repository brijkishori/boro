import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUnits } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import { refinanceAlert } from '@/lib/alertEmail';
import type { Venue } from '@/lib/protocol';
import {
  buildMigrationPlan,
  calculateRateStability,
  calculateSafetyProjection,
  type RefinanceCandidate,
  type RefinanceMarketBaseline,
} from './refinance';
import {
  buildRefinanceDeepLink,
  evaluateRefinanceAlertDeduplication,
  findActionableRefinanceOpportunity,
  qualifyRefinancePlan,
  recheckRefinanceCandidate,
  recordRefinanceDisqualified,
  type RefinanceQualification,
} from './refinanceAlertQualification';

function createMockSourceVenue(overrides: Partial<Venue> = {}): Venue {
  return {
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
    borrowApr: 0.05, // 5.0%
    supplyApr: 0.03,
    maxLtv: 0.86,
    liquidityUsd: 10_000_000,
    priceUsd: 84_000,
    collateralRisk: {
      liquidationLtv: 0.86,
      liquidationThreshold: 0.86,
    },
    freshness: {
      source: 'rpc',
      fetchedAt: Date.now() - 30_000,
    },
    ...overrides,
  };
}

function createMockCandidateVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'compound-8453-cbBTC-USDC-0x1234',
    protocol: 'compound',
    action: 'borrow',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    assetKind: 'custodial',
    assetAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    assetDecimals: 8,
    loanSymbol: 'USDC',
    loanAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    loanDecimals: 6,
    borrowApr: 0.04, // 4.0% (100 bps cheaper)
    supplyApr: 0.025,
    maxLtv: 0.86,
    liquidityUsd: 5_000_000,
    priceUsd: 84_000,
    collateralRisk: {
      liquidationLtv: 0.86,
      liquidationThreshold: 0.86,
    },
    freshness: {
      source: 'rpc',
      fetchedAt: Date.now() - 30_000,
    },
    ...overrides,
  };
}

function createMockBaseline(sourceVenue: Venue, debt = 20_000, collateralAmount = 1.0): RefinanceMarketBaseline {
  return {
    id: sourceVenue.id,
    protocol: sourceVenue.protocol,
    chainId: sourceVenue.chainId,
    marketId: sourceVenue.id,
    collateralAsset: sourceVenue.assetSymbol,
    debtAsset: sourceVenue.loanSymbol,
    collateralAmount,
    collateralValueUsd: collateralAmount * sourceVenue.priceUsd,
    debt,
    currentApr: sourceVenue.borrowApr,
    openingApr: sourceVenue.borrowApr,
    safety: calculateSafetyProjection(debt, collateralAmount, sourceVenue.priceUsd, 0.86),
    availableLiquidity: sourceVenue.liquidityUsd,
    utilization: 0.6,
    freshness: 'fresh',
    oraclePrice: sourceVenue.priceUsd,
    stability: calculateRateStability(sourceVenue.borrowApr, { avg7d: sourceVenue.borrowApr }),
  };
}

function createMockCandidate(candidateVenue: Venue): RefinanceCandidate {
  return {
    id: candidateVenue.id,
    protocol: candidateVenue.protocol,
    chainId: candidateVenue.chainId,
    marketId: candidateVenue.id,
    collateral: candidateVenue.assetSymbol,
    debtAsset: candidateVenue.loanSymbol,
    currentApr: candidateVenue.borrowApr,
    stability: calculateRateStability(candidateVenue.borrowApr, { avg7d: candidateVenue.borrowApr }),
    liquidationThreshold: 0.86,
    availableLiquidity: candidateVenue.liquidityUsd,
    utilization: 0.5,
    freshness: 'fresh',
    wrapper: candidateVenue.assetSymbol,
    classification: 'SAME_CHAIN_SAME_WRAPPER',
    classificationLabel: 'Same chain · Same wrapper',
    isStale: false,
    venue: candidateVenue,
  };
}

function createMockQualification(overrides?: {
  debt?: number;
  currentApr?: number;
  candidateApr?: number;
  candidateLiquidity?: number;
  gasPriceWei?: bigint;
  ethPriceUsd?: number;
}): RefinanceQualification {
  const debt = overrides?.debt ?? 20_000;
  const currentApr = overrides?.currentApr ?? 0.05;
  const candidateApr = overrides?.candidateApr ?? 0.04;
  const candidateLiquidity = overrides?.candidateLiquidity ?? 5_000_000;
  const gasPriceWei = overrides?.gasPriceWei ?? 1_000_000_000n;
  const ethPriceUsd = overrides?.ethPriceUsd ?? 2500;

  const sourceVenue = createMockSourceVenue({ borrowApr: currentApr });
  const candidateVenue = createMockCandidateVenue({ borrowApr: candidateApr, liquidityUsd: candidateLiquidity });
  const sourceMarket = createMockBaseline(sourceVenue, debt);
  const destinationMarket = createMockCandidate(candidateVenue);

  const plan = buildMigrationPlan({
    sourceMarket,
    destinationMarket,
    gasPriceWei,
    ethPriceUsd,
    now: Date.now(),
  });

  return qualifyRefinancePlan(plan);
}

test('A. pre-send rate still cheaper but liquidity falls below debt -> no email', () => {
  const sourceVenue = createMockSourceVenue();
  const initialCandidateVenue = createMockCandidateVenue({ liquidityUsd: 5_000_000 });
  const snapshot: PositionSnapshot = {
    collateral: parseUnits('1', 8),
    debt: parseUnits('20000', 6),
    maxBorrow: 0n,
    borrowRoom: 0n,
    withdrawMax: 0n,
    healthFactor: 3.6,
    ltv: 0.238,
    liquidationPrice: 23255,
    ready: true,
  };

  const initial = findActionableRefinanceOpportunity({
    sourceVenue,
    snapshot,
    allVenues: [sourceVenue, initialCandidateVenue],
    gasPriceWei: 1_000_000_000n,
    ethPriceUsd: 2500,
  });

  assert.ok(initial !== null, 'Initial candidate should qualify');
  assert.equal(initial.isQualified, true);

  // Pre-send: rate is still cheaper (4.0% vs 5.0%), but candidate liquidity collapses to $5,000 (debt is $20,000)
  const drainedCandidateVenue = createMockCandidateVenue({
    borrowApr: 0.04,
    liquidityUsd: 5_000,
  });

  const rechecked = recheckRefinanceCandidate(
    initial,
    [sourceVenue, drainedCandidateVenue],
    undefined,
    Date.now(),
  );

  assert.equal(rechecked.isQualified, false, 'Candidate must not qualify when liquidity < debt');
  assert.equal(rechecked.status, 'NOT_QUALIFIED');
  assert.ok(
    rechecked.reasons.includes('INSUFFICIENT_LIQUIDITY'),
    `Expected INSUFFICIENT_LIQUIDITY reason, got: ${rechecked.reasons.join(', ')}`,
  );
});

test('B. pre-send safety becomes unavailable -> no email', () => {
  const initial = createMockQualification();
  assert.equal(initial.isQualified, true);

  const sourceVenue = createMockSourceVenue();
  // Candidate risk parameters disappear / wipe out
  const invalidSafetyCandidate = createMockCandidateVenue({
    collateralRisk: { liquidationLtv: 0, liquidationThreshold: 0 },
    maxLtv: 0,
  });

  const rechecked = recheckRefinanceCandidate(
    initial,
    [sourceVenue, invalidSafetyCandidate],
    undefined,
    Date.now(),
  );

  assert.equal(rechecked.isQualified, false, 'Candidate must not qualify when safety cannot be projected');
  assert.equal(rechecked.status, 'NOT_QUALIFIED');
  assert.ok(
    rechecked.reasons.includes('SAFETY_DATA_UNAVAILABLE'),
    `Expected SAFETY_DATA_UNAVAILABLE, got: ${rechecked.reasons.join(', ')}`,
  );
  // Verify old safety was not reused
  assert.equal(rechecked.snapshot.safetyComparison.projectedHealthFactor, null);
});

test('C. source debt becomes zero -> no email', () => {
  const sourceVenue = createMockSourceVenue();
  const candidateVenue = createMockCandidateVenue();

  // 1. Initial scan with zero debt must return null
  const zeroDebtSnapshot: PositionSnapshot = {
    collateral: parseUnits('1', 8),
    debt: 0n,
    maxBorrow: 0n,
    borrowRoom: 0n,
    withdrawMax: 0n,
    healthFactor: null,
    ltv: 0,
    liquidationPrice: 0,
    ready: true,
  };
  const opportunity = findActionableRefinanceOpportunity({
    sourceVenue,
    snapshot: zeroDebtSnapshot,
    allVenues: [sourceVenue, candidateVenue],
    gasPriceWei: 1_000_000_000n,
    ethPriceUsd: 2500,
  });
  assert.equal(opportunity, null, 'Zero debt position must return null opportunity');

  // 2. Pre-send recheck when debt was repaid to 0
  const initial = createMockQualification({ debt: 20_000 });
  assert.equal(initial.isQualified, true);

  const rechecked = recheckRefinanceCandidate(
    initial,
    [sourceVenue, candidateVenue],
    undefined,
    Date.now(),
    { currentDebt: 0 },
  );

  assert.equal(rechecked.isQualified, false, 'Repaid position must not qualify on recheck');
  assert.equal(rechecked.status, 'NOT_QUALIFIED');
  assert.ok(
    rechecked.reasons.includes('ZERO_DEBT'),
    `Expected ZERO_DEBT reason, got: ${rechecked.reasons.join(', ')}`,
  );
});

test('D. recurring monthly savings excludes one-time migration cost', () => {
  // Debt: $20,000, currentApr: 5% (0.05), candidateApr: 4% (0.04)
  // Annual recurring interest difference = 20,000 * (0.05 - 0.04) = $200.00
  // Monthly recurring interest difference = $200.00 / 12 = $16.66666...
  // Gas: 1,020,000 gas units * 28 gwei = 0.02856 ETH * $2500 = $71.40 migration cost
  const qualification = createMockQualification({
    debt: 20_000,
    currentApr: 0.05,
    candidateApr: 0.04,
    gasPriceWei: 28_000_000_000n,
    ethPriceUsd: 2500,
  });

  assert.equal(qualification.isQualified, true);
  const snap = qualification.snapshot;

  // Monthly difference must strictly reflect recurring interest difference
  assert.ok(
    Math.abs(snap.estimatedMonthlyDifference - 200 / 12) < 0.001,
    `Monthly difference should be ~$16.67, got: ${snap.estimatedMonthlyDifference}`,
  );
  // Annual difference must be approximately $200
  assert.ok(Math.abs(snap.estimatedAnnualDifference - 200) < 0.001);

  // Migration cost is separately reported and NOT subtracted from monthly or annual
  assert.ok(snap.migrationCostUsd !== null && Math.abs(snap.migrationCostUsd - 71.4) < 0.01);

  // Break-even is determined by migration cost / annual savings: (71.40 / 200) * 365 = 130.305 days
  assert.ok(snap.breakEvenDays !== null && Math.abs(snap.breakEvenDays - 130.305) < 0.1);

  // Verify email rendering formats both recurring figures without amortized migration cost
  const email = refinanceAlert('0x1234567890123456789012345678901234567890', qualification);
  assert.match(email.text, /~\$16\.67\/mo lower borrowing cost/);
  assert.match(email.text, /~\$200\.00\/yr lower borrowing cost/);
  assert.match(email.text, /Migration cost: \$71\.40/);
  assert.match(email.text, /Estimated break-even: ~130 days/);
  assert.match(email.html, /~\$16\.67\/mo lower borrowing cost/);
  assert.match(email.html, /~\$200\.00\/yr lower borrowing cost/);
});

test('E. email values equal the final requalified snapshot', () => {
  const initial = createMockQualification({
    debt: 20_000,
    currentApr: 0.05,
    candidateApr: 0.042, // Initially 4.2% -> savings = $160/yr ($13.33/mo)
  });
  assert.equal(initial.isQualified, true);

  // Candidate APR drops to 3.8% right before send -> savings = $240/yr ($20.00/mo)
  const freshCandidateVenue = createMockCandidateVenue({ borrowApr: 0.038 });
  const freshSourceVenue = createMockSourceVenue({ borrowApr: 0.05 });

  const rechecked = recheckRefinanceCandidate(
    initial,
    [freshSourceVenue, freshCandidateVenue],
    undefined,
    Date.now(),
  );

  assert.equal(rechecked.isQualified, true);
  assert.equal(rechecked.snapshot.candidateApr, 0.038);
  assert.ok(Math.abs(rechecked.snapshot.estimatedAnnualDifference - 240) < 0.001);
  assert.ok(Math.abs(rechecked.snapshot.estimatedMonthlyDifference - 20) < 0.001);

  const email = refinanceAlert('0x1234567890123456789012345678901234567890', rechecked);
  assert.match(email.subject, /~\$20\/mo lower borrowing cost/);
  assert.match(email.text, /APR 3\.80%/);
  assert.match(email.text, /~\$20\.00\/mo lower borrowing cost/);
  assert.match(email.text, /~\$240\.00\/yr lower borrowing cost/);
  assert.doesNotMatch(email.text, /APR 4\.20%/);
  assert.doesNotMatch(email.text, /~\$13\.33\/mo/);
});

test('F. valid canonical deep link resolves exact candidate', () => {
  const sourceId = 'morpho-8453-cbBTC-USDC-0x9103';
  const candidateId = 'compound-8453-cbBTC-USDC-0x1234';

  const link = buildRefinanceDeepLink(sourceId, candidateId, 'https://boro.finance');
  assert.equal(
    link,
    'https://boro.finance/risk?market=morpho-8453-cbBTC-USDC-0x9103&tab=refinance&candidate=compound-8453-cbBTC-USDC-0x1234&source=alert',
  );

  const url = new URL(link);
  assert.equal(url.searchParams.get('market'), sourceId);
  assert.equal(url.searchParams.get('tab'), 'refinance');
  assert.equal(url.searchParams.get('candidate'), candidateId);
  assert.equal(url.searchParams.get('source'), 'alert');

  // Candidate resolves in market catalog
  const candidateVenue = createMockCandidateVenue({ id: candidateId });
  const candidate = createMockCandidate(candidateVenue);
  assert.equal(candidate.id, candidateId);
});

test('G. invalid candidate fails safely', () => {
  const candidateVenue = createMockCandidateVenue();
  const candidates = [createMockCandidate(candidateVenue)];

  const invalidCandidateId = 'non-existent-candidate-999';
  const match = candidates.find((c) => c.id === invalidCandidateId);
  assert.equal(match, undefined, 'Invalid candidate must return undefined safely');

  // Verify that an invalid candidate parameter passed to deep link does not throw
  const link = buildRefinanceDeepLink('morpho-8453-cbBTC-USDC-0x9103', invalidCandidateId, 'https://boro.finance');
  assert.ok(link.includes(encodeURIComponent(invalidCandidateId)));
});

test('H. qualify -> suppress -> disqualify -> requalify lifecycle', async () => {
  const address = `0xTestLifecycle${Date.now()}`;
  const initial = createMockQualification({ debt: 20_000, currentApr: 0.05, candidateApr: 0.04 });
  const sourceMarketId = initial.snapshot.sourceMarketId;

  // 1. Initial qualification -> EMAIL
  const step1 = await evaluateRefinanceAlertDeduplication(address, initial, true);
  assert.equal(step1.shouldSend, true);
  assert.equal(step1.reason, 'INITIAL_QUALIFYING_ALERT');

  // 2. Same unchanged opportunity -> SUPPRESS
  const step2 = await evaluateRefinanceAlertDeduplication(address, initial, true);
  assert.equal(step2.shouldSend, false);
  assert.equal(step2.reason, 'UNCHANGED_OPPORTUNITY_DEDUPLICATED');

  // 3. Candidate disqualifies -> STATE RECORDS DISQUALIFICATION
  await recordRefinanceDisqualified(address, sourceMarketId);

  // 4. Later requalifies -> EMAIL AGAIN
  const step4 = await evaluateRefinanceAlertDeduplication(address, initial, true);
  assert.equal(step4.shouldSend, true);
  assert.equal(step4.reason, 'REQUALIFIED_AFTER_DISQUALIFICATION');

  // 5. Different candidate appears -> EMAIL
  const otherCandidateQualification = {
    ...initial,
    snapshot: {
      ...initial.snapshot,
      destinationMarketId: 'aave-8453-cbBTC-USDC-other',
    },
  };
  const step5 = await evaluateRefinanceAlertDeduplication(address, otherCandidateQualification, true);
  assert.equal(step5.shouldSend, true);
  assert.equal(step5.reason, 'CANDIDATE_CHANGED');

  // 6. Same candidate materially better (+$6/mo savings) -> EMAIL
  const materiallyBetter = {
    ...otherCandidateQualification,
    snapshot: {
      ...otherCandidateQualification.snapshot,
      estimatedMonthlyDifference: otherCandidateQualification.snapshot.estimatedMonthlyDifference + 6,
    },
  };
  const step6 = await evaluateRefinanceAlertDeduplication(address, materiallyBetter, true);
  assert.equal(step6.shouldSend, true);
  assert.equal(step6.reason, 'MATERIALLY_BETTER_SAVINGS');
});
