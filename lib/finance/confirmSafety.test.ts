import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIRM_DRIFT,
  CONFIRM_DRIFT_MESSAGE,
  CONFIRM_FAIL_MESSAGE,
  buildConfirmSnapshot,
  compareConfirmSnapshots,
  decideConfirmation,
  requestWalletAfterConfirm,
  runConfirmGuard,
  type ConfirmLock,
  type ConfirmSnapshot,
} from './confirmSafety';
import { buildProposedPositionChange, type PositionChangeInput } from './positionChange';
import type { Venue } from '../protocol';

function venue(partial: Partial<Venue> = {}): Venue {
  return {
    id: 'borrow:morpho:8453:cbbtc',
    protocol: 'morpho',
    action: 'borrow',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    assetKind: 'custodial',
    assetAddress: '0x0000000000000000000000000000000000000001',
    assetDecimals: 8,
    loanSymbol: 'USDC',
    loanAddress: '0x0000000000000000000000000000000000000002',
    loanDecimals: 6,
    borrowApr: 0.048,
    supplyApr: 0.03,
    maxLtv: 0.86,
    liquidityUsd: 10_000_000,
    priceUsd: 85_000,
    collateralRisk: { liquidationLtv: 0.86, parameterSource: 'live' },
    morpho: {
      marketId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      loanToken: '0x0000000000000000000000000000000000000002',
      collateralToken: '0x0000000000000000000000000000000000000001',
      oracle: '0x0000000000000000000000000000000000000003',
      irm: '0x0000000000000000000000000000000000000004',
      lltv: '860000000000000000',
    },
    freshness: { source: 'test', fetchedAt: Date.now() },
    ...partial,
  };
}

function changeInput(market: Venue, partial: Partial<PositionChangeInput> = {}): PositionChangeInput {
  return {
    action: 'BORROW',
    venue: market,
    amount: 21_100_000n,
    currentCollateral: 100_000n,
    currentDebt: 0n,
    spendableBalance: 200_000n,
    priceUsd: market.priceUsd,
    borrowRoom: 50_000_000n,
    fetchedAt: market.freshness?.fetchedAt,
    ...partial,
  };
}

function snap(market: Venue, input: PositionChangeInput = changeInput(market)): ConfirmSnapshot {
  const change = buildProposedPositionChange(input);
  return buildConfirmSnapshot({
    action: input.action,
    venue: market,
    change,
    currentCollateral: input.currentCollateral,
    currentDebt: input.currentDebt,
    walletBalance: input.spendableBalance,
    plannedAmount: input.amount,
    fetchedAt: market.freshness?.fetchedAt ?? Date.now(),
    blockNumber: 1,
  });
}

test('A: stale React quote 4.8% vs fresh API 6.0% blocks wallet and requires re-review', async () => {
  const reviewedMarket = venue({ borrowApr: 0.048 });
  const staleReactMarket = venue({ borrowApr: 0.048 });
  const freshMarket = venue({ borrowApr: 0.06 });
  const reviewed = snap(reviewedMarket);
  let invoked = false;
  const lock: ConfirmLock = { busy: false };
  const decision = await runConfirmGuard({
    reviewed,
    lock,
    loadFresh: async () => {
      assert.equal(staleReactMarket.borrowApr, 0.048);
      return snap(freshMarket, changeInput(freshMarket));
    },
  });
  assert.equal(decision.status, 'rereview');
  assert.equal(decision.invokeWallet, false);
  if (decision.status === 'rereview') {
    assert.equal(decision.fresh.borrowApr, 0.06);
    assert.ok(decision.changes.some((row) => row.category === 'RATE_DRIFT'));
    assert.equal(decision.message, CONFIRM_DRIFT_MESSAGE);
  }
  assert.equal(requestWalletAfterConfirm(decision, () => { invoked = true; }), false);
  assert.equal(invoked, false);
});

test('B: fresh BTC price rebuilds projected risk and requires re-review', () => {
  const reviewed = snap(venue({ priceUsd: 85_000 }));
  const fresh = snap(venue({ priceUsd: 80_000 }), changeInput(venue({ priceUsd: 80_000 })));
  const decision = decideConfirmation(reviewed, fresh);
  assert.equal(decision.status, 'rereview');
  assert.equal(decision.invokeWallet, false);
  if (decision.status === 'rereview') {
    assert.equal(decision.fresh.oraclePrice, 80_000);
    assert.notEqual(decision.fresh.projectedLtv, reviewed.projectedLtv);
    assert.ok(decision.changes.some((row) => row.category === 'ORACLE_PRICE_DRIFT' || row.category === 'RISK_METRIC_DRIFT'));
  }
});

test('C: confirm uses the freshly returned position, not a later React state update', async () => {
  const reviewed = snap(venue(), changeInput(venue(), { currentCollateral: 100_000n, currentDebt: 0n }));
  const lock: ConfirmLock = { busy: false };
  const decision = await runConfirmGuard({
    reviewed,
    lock,
    loadFresh: async () => snap(venue(), changeInput(venue(), { currentCollateral: 110_000n, currentDebt: 5_000_000n })),
  });
  assert.equal(decision.status, 'rereview');
  if (decision.status === 'rereview') {
    assert.equal(decision.fresh.currentCollateral, '110000');
    assert.equal(decision.fresh.currentDebt, '5000000');
  }
});

test('D: liquidity below the requested borrow blocks wallet invocation', () => {
  const reviewed = snap(venue({ liquidityUsd: 10_000_000 }));
  const fresh = snap(venue({ liquidityUsd: 1 }), changeInput(venue({ liquidityUsd: 1 })));
  const decision = decideConfirmation(reviewed, fresh);
  assert.equal(decision.invokeWallet, false);
  assert.notEqual(decision.status, 'proceed');
  const changes = compareConfirmSnapshots(reviewed, fresh);
  assert.ok(changes.some((row) => row.category === 'LIQUIDITY_DRIFT'));
});

test('E: failed fresh fetch fails closed and never invokes the wallet', async () => {
  const reviewed = snap(venue());
  let invoked = false;
  const decision = await runConfirmGuard({
    reviewed,
    lock: { busy: false },
    loadFresh: async () => {
      throw new Error('network');
    },
  });
  assert.equal(decision.status, 'failed');
  assert.equal(decision.invokeWallet, false);
  assert.equal(decision.status, 'failed');
  if (decision.status === 'failed') assert.equal(decision.message, CONFIRM_FAIL_MESSAGE);
  assert.equal(requestWalletAfterConfirm(decision, () => { invoked = true; }), false);
  assert.equal(invoked, false);
  assert.equal(decideConfirmation(reviewed, null, { fetchFailed: true }).invokeWallet, false);
});

test('F: sub-threshold quote movement can proceed when identity and position are unchanged', () => {
  const reviewed = snap(venue({ borrowApr: 0.048, priceUsd: 85_000 }));
  const fresh = snap(venue({ borrowApr: 0.0482, priceUsd: 85_100 }), changeInput(venue({ borrowApr: 0.0482, priceUsd: 85_100 })));
  const decision = decideConfirmation(reviewed, fresh);
  assert.equal(decision.status, 'proceed');
  assert.equal(decision.invokeWallet, true);
});

test('G: LLTV or market ID change always requires a new review', () => {
  const reviewed = snap(venue());
  const newMarket = venue({
    morpho: {
      marketId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      loanToken: '0x0000000000000000000000000000000000000002',
      collateralToken: '0x0000000000000000000000000000000000000001',
      oracle: '0x0000000000000000000000000000000000000003',
      irm: '0x0000000000000000000000000000000000000004',
      lltv: '860000000000000000',
    },
  });
  const marketDecision = decideConfirmation(reviewed, snap(newMarket, changeInput(newMarket)));
  assert.equal(marketDecision.status, 'rereview');
  assert.equal(marketDecision.invokeWallet, false);

  const lltvVenue = venue({
    maxLtv: 0.8,
    collateralRisk: { liquidationLtv: 0.8, parameterSource: 'live' },
  });
  const lltvDecision = decideConfirmation(reviewed, snap(lltvVenue, changeInput(lltvVenue)));
  assert.equal(lltvDecision.status, 'rereview');
  if (lltvDecision.status === 'rereview') {
    assert.ok(lltvDecision.changes.some((row) => row.alwaysRereview && row.category === 'MARKET_CONFIGURATION_DRIFT'));
  }
});

test('H: a second overlapping confirm does not invoke the wallet', async () => {
  const reviewed = snap(venue());
  const lock: ConfirmLock = { busy: false };
  let loadCount = 0;
  let invokes = 0;
  const hanging = runConfirmGuard({
    reviewed,
    lock,
    loadFresh: async () => {
      loadCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return snap(venue());
    },
  });
  const second = await runConfirmGuard({
    reviewed,
    lock,
    loadFresh: async () => {
      loadCount += 1;
      return snap(venue());
    },
  });
  assert.equal(second.status, 'busy');
  assert.equal(second.invokeWallet, false);
  assert.equal(requestWalletAfterConfirm(second, () => { invokes += 1; }), false);
  const first = await hanging;
  assert.equal(first.status, 'proceed');
  assert.equal(loadCount, 1);
  assert.equal(invokes, 0);
});

test('confirm drift tolerances live in one config object', () => {
  assert.equal(CONFIRM_DRIFT.RATE_ABS, 0.0005);
  assert.equal(CONFIRM_DRIFT.ORACLE_PRICE_REL, 0.0025);
  assert.equal(CONFIRM_DRIFT.LIQUIDITY_REL, 0.02);
  assert.equal(CONFIRM_DRIFT.MAX_AGE_MS, 45_000);
});
