import assert from 'node:assert/strict';
import test from 'node:test';
import type { Venue } from '@/lib/protocol';
import type { MigrationPlan } from './refinance';
import {
  advancePhase6D4AfterVerifiedReceipt,
  buildPhase6D4Progress,
  buildPhase6D4Readiness,
  markPhase6D4Submitted,
  phase6D4ReloadRequiresManualVerification,
  readPhase6D4Progress,
  savePhase6D4Progress,
} from './assistedRefinance';

const sourceVenue = {
  id: 'morpho-base-cbbtc-usdc',
  protocol: 'morpho',
  chainId: 8453,
  assetSymbol: 'cbBTC',
  loanSymbol: 'USDC',
} as Venue;

const destinationVenue = {
  id: 'aave-base-cbbtc-usdc',
  protocol: 'aave',
  chainId: 8453,
  assetSymbol: 'cbBTC',
  loanSymbol: 'USDC',
} as Venue;

function plan(overrides: Partial<MigrationPlan> = {}): MigrationPlan {
  return {
    debt: 20_000,
    collateral: 1,
    classification: 'SAME_CHAIN_SAME_WRAPPER',
    rateDirection: 'lower',
    liquiditySufficiency: 'SUFFICIENT',
    isStale: false,
    freshness: 'fresh',
    destinationMarket: {
      id: destinationVenue.id,
      chainId: 8453,
      protocol: 'aave',
      collateral: 'cbBTC',
      debtAsset: 'USDC',
      availableLiquidity: 1_000_000,
      venue: destinationVenue,
    },
    ...overrides,
  } as MigrationPlan;
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

test('6D.4 A: qualified fresh Base same-wrapper plan is execution-ready when source debt is self-funded', () => {
  const readiness = buildPhase6D4Readiness({ plan: plan(), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true });
  assert.equal(readiness.eligible, true);
  assert.equal(readiness.steps.length, 4);
  assert.deepEqual(readiness.steps.map((step) => step.action), ['REPAY_SOURCE', 'WITHDRAW_SOURCE', 'SUPPLY_DESTINATION', 'BORROW_DESTINATION']);
});

test('6D.4 B: current-wallet style balance blocks execution with exact funding shortfall', () => {
  const readiness = buildPhase6D4Readiness({ plan: plan(), sourceVenue, walletDebtAssetAvailable: 204.64, walletFresh: true, qualificationPassed: true });
  assert.equal(readiness.eligible, false);
  assert.ok((readiness.fundingShortfall ?? 0) > 19_000);
  assert.match(readiness.reason ?? '', /Self-funded refinance/);
});

test('6D.4 C: unqualified, stale, worse-rate, insufficient-liquidity, wrapper-change, and cross-chain plans remain blocked', () => {
  assert.equal(buildPhase6D4Readiness({ plan: plan(), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: false }).eligible, false);
  assert.equal(buildPhase6D4Readiness({ plan: plan({ isStale: true, freshness: 'stale' }), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true }).eligible, false);
  assert.equal(buildPhase6D4Readiness({ plan: plan({ rateDirection: 'higher' }), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true }).eligible, false);
  assert.equal(buildPhase6D4Readiness({ plan: plan({ liquiditySufficiency: 'INSUFFICIENT' }), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true }).eligible, false);
  assert.equal(buildPhase6D4Readiness({ plan: plan({ classification: 'SAME_CHAIN_WRAPPER_CHANGE' }), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true }).eligible, false);
  assert.equal(buildPhase6D4Readiness({ plan: plan({ classification: 'CROSS_CHAIN', destinationMarket: { ...plan().destinationMarket, chainId: 1 } }), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true }).eligible, false);
});

test('6D.4 D: stale wallet balance fails closed', () => {
  const readiness = buildPhase6D4Readiness({ plan: plan(), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: false, qualificationPassed: true });
  assert.equal(readiness.eligible, false);
  assert.equal(readiness.walletDebtAssetAvailable, null);
  assert.match(readiness.blockingIssues.join(' '), /Fresh source-chain USDC wallet balance/);
});

test('6D.4 E: progress starts at source repay and submitted stages never auto-advance after reload', () => {
  const storage = memoryStorage();
  const readiness = buildPhase6D4Readiness({ plan: plan(), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true });
  const progress = buildPhase6D4Progress({ readiness, wallet: '0x1111111111111111111111111111111111111111', sourceVenueId: sourceVenue.id, destinationVenueId: destinationVenue.id, sourceChainId: 8453, destinationChainId: 8453, now: 100 });
  savePhase6D4Progress(storage, progress);
  const submitted = markPhase6D4Submitted(storage, 'REPAY_SOURCE_PENDING', 'REPAY_SOURCE_SUBMITTED', '0xabc', 101);
  assert.equal(submitted?.stage, 'REPAY_SOURCE_SUBMITTED');
  assert.equal(phase6D4ReloadRequiresManualVerification(readPhase6D4Progress(storage)), true);
  assert.equal(readPhase6D4Progress(storage)?.stage, 'REPAY_SOURCE_SUBMITTED');
});

test('6D.4 F: verified receipt advances exactly one leg at a time', () => {
  const storage = memoryStorage();
  const readiness = buildPhase6D4Readiness({ plan: plan(), sourceVenue, walletDebtAssetAvailable: 25_000, walletFresh: true, qualificationPassed: true });
  savePhase6D4Progress(storage, buildPhase6D4Progress({ readiness, wallet: '0x1111111111111111111111111111111111111111', sourceVenueId: sourceVenue.id, destinationVenueId: destinationVenue.id, sourceChainId: 8453, destinationChainId: 8453, now: 100 }));
  markPhase6D4Submitted(storage, 'REPAY_SOURCE_PENDING', 'REPAY_SOURCE_SUBMITTED', '0xabc', 101);
  assert.equal(advancePhase6D4AfterVerifiedReceipt(storage, 'REPAY_SOURCE_SUBMITTED', 102)?.stage, 'WITHDRAW_SOURCE_PENDING');
});
