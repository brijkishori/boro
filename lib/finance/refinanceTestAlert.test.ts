import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseUnits, type Address } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import {
  refinanceAlert,
  sampleAlertByKind,
  sampleAlertEmails,
  sampleRefinanceQualification,
  sampleSimulatedRefinanceAlert,
} from '@/lib/alertEmail';
import type { Venue } from '@/lib/protocol';
import {
  buildRefinanceDeepLink,
  evaluateLiveRefinanceOpportunity,
} from './refinanceAlertQualification';

const TEST_ADDRESS: Address = '0x1111111111111111111111111111111111111111';

function createMockVenue(overrides: Partial<Venue> = {}): Venue {
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
    borrowApr: 0.0484, // 4.84%
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
      fetchedAt: Date.now() - 10_000,
    },
    ...overrides,
  };
}

function createMockPosition(debtUsd = 20_000, collateralTokens = 1.0): PositionSnapshot {
  return {
    collateral: parseUnits(String(collateralTokens), 8),
    debt: parseUnits(String(debtUsd), 6),
    maxBorrow: parseUnits('50000', 6),
    borrowRoom: parseUnits('30000', 6),
    withdrawMax: parseUnits('0.5', 8),
    healthFactor: 3.61,
    ltv: 0.238,
    liquidationPrice: 23_255,
    ready: true,
  };
}

test('A. /api/alerts/test does not call sampleRefinanceQualification', () => {
  const routeContent = readFileSync('app/api/alerts/test/route.ts', 'utf8');
  assert.ok(
    !routeContent.includes('sampleRefinanceQualification'),
    'app/api/alerts/test/route.ts must not reference sampleRefinanceQualification',
  );

  // sampleAlertByKind for refinance must return null so that test endpoints cannot receive fixture data
  const sampleRefi = sampleAlertByKind(TEST_ADDRESS, 'refinance');
  assert.equal(sampleRefi, null, 'sampleAlertByKind("refinance") must return null');

  // sampleAlertEmails must not contain refinance by default
  const allSamples = sampleAlertEmails(TEST_ADDRESS);
  assert.ok(
    !allSamples.some((s) => s.kind === 'refinance'),
    'sampleAlertEmails must not include refinance in default sample bundle',
  );
});

test('B. live source 4.84% + candidate 5.56% => sent:false / NO_QUALIFIED_REFINANCE_OPPORTUNITY', async () => {
  const sourceVenue = createMockVenue({
    id: 'morpho-8453-cbBTC-USDC-0x9103',
    protocol: 'morpho',
    borrowApr: 0.0484, // Morpho live rate ~4.84%
  });

  const candidateVenue = createMockVenue({
    id: 'compound-8453-cbBTC-USDC-0x1234',
    protocol: 'compound',
    borrowApr: 0.0556, // Compound live rate ~5.56% (more expensive)
  });

  // User has open position on Morpho, but no position on Compound
  const mockPosition = createMockPosition(20_000, 1.0);

  const result = await evaluateLiveRefinanceOpportunity({
    address: TEST_ADDRESS,
    venues: [sourceVenue, candidateVenue],
    ethPriceUsd: 2500,
    readPositionFn: async (v) => (v.id === sourceVenue.id ? mockPosition : null),
    getGasPriceFn: async () => 1_000_000_000n,
    now: Date.now(),
  });

  assert.equal(result.isQualified, false);
  assert.equal(result.reason, 'NO_QUALIFIED_REFINANCE_OPPORTUNITY');
  assert.equal(result.qualification, undefined);
});

test('C. live test email, when an opportunity genuinely qualifies, uses exact fresh qualification APR/cost values', async () => {
  const sourceVenue = createMockVenue({
    id: 'morpho-8453-cbBTC-USDC-0x9103',
    protocol: 'morpho',
    borrowApr: 0.0620, // 6.20%
  });

  const candidateVenue = createMockVenue({
    id: 'compound-8453-cbBTC-USDC-0x1234',
    protocol: 'compound',
    borrowApr: 0.0380, // 3.80% (240 bps cheaper)
  });

  const mockPosition = createMockPosition(20_000, 1.0);
  const now = Date.now();

  const result = await evaluateLiveRefinanceOpportunity({
    address: TEST_ADDRESS,
    venues: [sourceVenue, candidateVenue],
    ethPriceUsd: 3000,
    readPositionFn: async (v) => (v.id === sourceVenue.id ? mockPosition : null),
    getGasPriceFn: async () => 2_000_000_000n, // 2 gwei -> gas cost = 1020000 * 2e9 * 3000 / 1e18 = $6.12
    now,
  });

  assert.equal(result.isQualified, true);
  assert.ok(result.qualification);
  assert.equal(result.qualification.snapshot.currentApr, 0.0620);
  assert.equal(result.qualification.snapshot.candidateApr, 0.0380);
  assert.ok(result.qualification.snapshot.migrationCostUsd !== null);
  assert.equal(result.qualification.snapshot.migrationCostUsd, 6.12);

  const deepLink = buildRefinanceDeepLink(result.sourceVenue!.id, result.qualification.snapshot.destinationMarketId);
  const email = refinanceAlert(TEST_ADDRESS, result.qualification, { deepLinkUrl: deepLink, now });

  // Email must reflect exact live APR values
  assert.match(email.text, /APR 6\.20%/);
  assert.match(email.text, /APR 3\.80%/);
  assert.match(email.html, /APR 6\.20%/);
  assert.match(email.html, /APR 3\.80%/);

  // Email must reflect exact live migration cost
  assert.match(email.text, /Migration cost: \$6\.12/);
  assert.match(email.html, /Migration cost: \$6\.12/);

  // Live test email must NOT be labeled SIMULATED DATA
  assert.ok(!email.text.includes('SIMULATED DATA — NOT LIVE MARKET DATA'));
  assert.ok(!email.html.includes('SIMULATED DATA — NOT LIVE MARKET DATA'));
});

test('D. fixture helper cannot emit "Data verified just now"', () => {
  const simulatedAlert = sampleSimulatedRefinanceAlert(TEST_ADDRESS);
  assert.ok(
    !simulatedAlert.text.includes('Data verified just now'),
    'Simulated email text must not emit "Data verified just now"',
  );
  assert.ok(
    !simulatedAlert.text.includes('Data verified: just now'),
    'Simulated email text must not emit "Data verified: just now"',
  );
  assert.ok(
    !simulatedAlert.text.includes('just now'),
    'Simulated email text must not emit "just now"',
  );
  assert.ok(
    !simulatedAlert.html.includes('just now'),
    'Simulated email HTML must not emit "just now"',
  );

  const qualAlert = refinanceAlert(TEST_ADDRESS, sampleRefinanceQualification());
  assert.ok(
    !qualAlert.text.includes('Data verified just now'),
    'Refinance alert with fixture qualification must not emit "Data verified just now"',
  );
  assert.ok(
    !qualAlert.text.includes('just now'),
    'Refinance alert with fixture qualification must not emit "just now"',
  );
  assert.ok(
    !qualAlert.html.includes('just now'),
    'Refinance alert with fixture qualification HTML must not emit "just now"',
  );
});

test('E. fixture helper is explicitly labeled SIMULATED DATA', () => {
  const simulatedAlert = sampleSimulatedRefinanceAlert(TEST_ADDRESS);
  assert.ok(
    simulatedAlert.text.includes('SIMULATED DATA — NOT LIVE MARKET DATA'),
    'Simulated email text must contain prominent SIMULATED DATA label',
  );
  assert.ok(
    simulatedAlert.html.includes('SIMULATED DATA — NOT LIVE MARKET DATA'),
    'Simulated email HTML must contain prominent SIMULATED DATA label',
  );

  const qualAlert = refinanceAlert(TEST_ADDRESS, sampleRefinanceQualification());
  assert.ok(
    qualAlert.text.includes('SIMULATED DATA — NOT LIVE MARKET DATA'),
    'Fixture qualification email text must contain prominent SIMULATED DATA label',
  );
  assert.ok(
    qualAlert.html.includes('SIMULATED DATA — NOT LIVE MARKET DATA'),
    'Fixture qualification email HTML must contain prominent SIMULATED DATA label',
  );
});

test('F. constants 3.98% / $2.55 cannot leak into LIVE_TEST path', async () => {
  // Test 1: Disqualified live test path does not emit email
  const disqualifiedVenueA = createMockVenue({ borrowApr: 0.0484 });
  const disqualifiedVenueB = createMockVenue({ id: 'comp-1', protocol: 'compound', borrowApr: 0.0556 });
  const disqualifiedResult = await evaluateLiveRefinanceOpportunity({
    address: TEST_ADDRESS,
    venues: [disqualifiedVenueA, disqualifiedVenueB],
    readPositionFn: async (venue) =>
      venue.id === disqualifiedVenueA.id
        ? createMockPosition(20_000, 1.0)
        : createMockPosition(0, 0),
    getGasPriceFn: async () => 1_000_000_000n,
    ethPriceUsd: 2500,
  });
  assert.equal(disqualifiedResult.isQualified, false);

  // Test 2: Qualified live test path with non-fixture values cannot contain 3.98% or $2.55
  const liveVenueA = createMockVenue({ borrowApr: 0.0510 });
  const liveVenueB = createMockVenue({ id: 'comp-2', protocol: 'compound', borrowApr: 0.0350 });
  const qualifiedResult = await evaluateLiveRefinanceOpportunity({
    address: TEST_ADDRESS,
    venues: [liveVenueA, liveVenueB],
    readPositionFn: async (venue) =>
      venue.id === liveVenueA.id
        ? createMockPosition(20_000, 1.0)
        : createMockPosition(0, 0),
    getGasPriceFn: async () => 500_000_000n, // 0.5 gwei
    ethPriceUsd: 2000,
  });

  assert.equal(qualifiedResult.isQualified, true);
  assert.ok(qualifiedResult.qualification);
  assert.notEqual(qualifiedResult.qualification.snapshot.candidateApr, 0.0398);
  assert.notEqual(qualifiedResult.qualification.snapshot.migrationCostUsd, 2.55);

  const email = refinanceAlert(TEST_ADDRESS, qualifiedResult.qualification);
  assert.ok(!email.text.includes('3.98%'), 'Live email text must not leak fixture 3.98%');
  assert.ok(!email.text.includes('$2.55'), 'Live email text must not leak fixture $2.55');
  assert.ok(!email.html.includes('3.98%'), 'Live email HTML must not leak fixture 3.98%');
  assert.ok(!email.html.includes('$2.55'), 'Live email HTML must not leak fixture $2.55');
});
