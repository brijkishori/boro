import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Venue } from '../protocol';
import {
  buildProposedPositionChange,
  canRequestWallet,
  requestWalletIfAllowed,
  riskDirectionFromMetrics,
  type PositionChangeInput,
  type PositionSnapshot,
} from './positionChange';

function venue(partial: Partial<Venue> & Pick<Venue, 'protocol'> = { protocol: 'morpho' }): Venue {
  return {
    id: 'borrow:test:1:0x1',
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
    priceUsd: 84_385,
    collateralRisk: { liquidationLtv: 0.86, parameterSource: 'live' },
    ...partial,
  };
}

function base(partial: Partial<PositionChangeInput> = {}): PositionChangeInput {
  return {
    action: 'REPAY',
    venue: venue(),
    amount: 5_000_000n,
    currentCollateral: 100_000n,
    currentDebt: 21_100_000n,
    spendableBalance: 100_000_000n,
    priceUsd: 84_385,
    ...partial,
  };
}

test('repay 21.10 debt by 5 projects about 16.10 remaining', () => {
  const change = buildProposedPositionChange(base());
  assert.equal(change.current.totalDebt, 21.1);
  assert.ok(Math.abs(change.projected.totalDebt - 16.1) < 1e-10);
  assert.equal(change.riskDirection, 'decreases');
});

test('Morpho 0.001 cbBTC at 86% LLTV liquidates near 24535 then 18721 after a $5 repay', () => {
  const current = buildProposedPositionChange(base({ amount: 0n }));
  assert.ok(current.current.liquidationPrice);
  assert.ok(Math.abs((current.current.liquidationPrice ?? 0) - 21.1 / (0.001 * 0.86)) < 1e-8);
  assert.ok(Math.abs((current.current.liquidationPrice ?? 0) - 24_535) < 1);
  const repaid = buildProposedPositionChange(base());
  assert.ok(Math.abs((repaid.projected.liquidationPrice ?? 0) - 16.1 / (0.001 * 0.86)) < 1e-8);
  assert.ok(Math.abs((repaid.projected.liquidationPrice ?? 0) - 18_721) < 1);
  assert.ok(repaid.current.healthFactor);
  assert.equal(repaid.current.healthFactorKind, 'app-derived');
  assert.ok((repaid.projected.healthFactor ?? 0) > (repaid.current.healthFactor ?? 0));
});

test('adding 0.0001 BTC collateral improves HF and lowers LTV and liquidation price', () => {
  const change = buildProposedPositionChange(base({
    action: 'SUPPLY_COLLATERAL',
    amount: 10_000n,
  }));
  assert.equal(change.current.collateralAmount, 0.001);
  assert.ok(Math.abs(change.projected.collateralAmount - 0.0011) < 1e-12);
  assert.equal(change.current.totalDebt, change.projected.totalDebt);
  assert.ok(change.current.healthFactor);
  assert.ok(change.projected.healthFactor);
  assert.ok(change.projected.healthFactor > change.current.healthFactor);
  assert.ok((change.projected.ltv ?? 1) < (change.current.ltv ?? 0));
  assert.ok((change.projected.liquidationPrice ?? 1) < (change.current.liquidationPrice ?? 0));
  assert.equal(change.riskDirection, 'decreases');
  assert.equal(change.current.healthFactorKind, 'app-derived');
});

test('collateral withdrawal worsens risk metrics', () => {
  const change = buildProposedPositionChange(base({
    action: 'WITHDRAW_COLLATERAL',
    amount: 20_000n,
    withdrawMax: 20_000n,
  }));
  assert.ok((change.projected.ltv ?? 0) > (change.current.ltv ?? 0));
  assert.ok((change.projected.liquidationPrice ?? 0) > (change.current.liquidationPrice ?? 0));
  assert.ok((change.projected.liquidationCushionPercent ?? 1) < (change.current.liquidationCushionPercent ?? 0));
  assert.equal(change.riskDirection, 'increases');
});

test('collateral addition improves risk metrics', () => {
  const change = buildProposedPositionChange(base({
    action: 'SUPPLY_COLLATERAL',
    amount: 20_000n,
  }));
  assert.ok((change.projected.ltv ?? 1) < (change.current.ltv ?? 0));
  assert.ok((change.projected.liquidationPrice ?? 1) < (change.current.liquidationPrice ?? 0));
  assert.ok((change.projected.liquidationCushionPercent ?? 0) > (change.current.liquidationCushionPercent ?? 1));
  assert.equal(change.riskDirection, 'decreases');
});

test('borrow worsens risk metrics', () => {
  const change = buildProposedPositionChange(base({
    action: 'BORROW',
    amount: 5_000_000n,
    borrowRoom: 10_000_000n,
  }));
  assert.ok((change.projected.totalDebt) > change.current.totalDebt);
  assert.ok((change.projected.ltv ?? 0) > (change.current.ltv ?? 0));
  assert.equal(change.riskDirection, 'increases');
});

test('MAX repay with protocol-safe full close projects zero debt', () => {
  const change = buildProposedPositionChange(base({
    amount: 21_100_000n,
    maxRepay: true,
    protocolSafeFullRepay: true,
  }));
  assert.equal(change.projected.totalDebt, 0);
  assert.equal(change.repayAccounting?.protocolSafeFullRepay, true);
  assert.equal(change.repayAccounting?.estimatedTotalDebtRemaining, 0);
});

test('MAX repay without protocol-safe surplus leaves a remainder when the wallet cannot cover buffer', () => {
  const change = buildProposedPositionChange(base({
    amount: 20_000_000n,
    spendableBalance: 20_000_000n,
    maxRepay: true,
    protocolSafeFullRepay: false,
  }));
  assert.ok(change.projected.totalDebt > 0);
  assert.ok(Math.abs(change.projected.totalDebt - 1.1) < 1e-10);
});

test('continuous interest can move previewed remaining debt', () => {
  const preview = buildProposedPositionChange(base());
  const later = buildProposedPositionChange(base({ currentDebt: 21_100_008n }));
  assert.notEqual(preview.projected.totalDebt, later.projected.totalDebt);
  assert.equal(preview.interestNote, 'Final amounts may differ slightly because interest accrues continuously.');
});

test('unsafe projected position blocks confirmation', () => {
  const change = buildProposedPositionChange(base({
    action: 'WITHDRAW_COLLATERAL',
    amount: 100_000n,
    withdrawMax: 100_000n,
  }));
  assert.ok(change.blockers.length > 0);
  assert.equal(canRequestWallet(change), false);
});

test('insufficient token balance blocks confirmation before a wallet call', () => {
  const change = buildProposedPositionChange(base({
    spendableBalance: 1_000_000n,
  }));
  let called = false;
  assert.equal(requestWalletIfAllowed(change, () => { called = true; }), false);
  assert.equal(called, false);
  assert.ok(change.blockers.some((row) => /Required:.*USDC/.test(row) && /Shortfall:/.test(row)));
});

test('risk direction uses projected metrics rather than action labels alone', () => {
  const safer: PositionSnapshot = {
    collateralAsset: 'cbBTC',
    collateralAmount: 0.001,
    debtAsset: 'USDC',
    totalDebt: 16.1,
    ltv: 0.19,
    healthFactor: 4.98,
    liquidationPrice: 18_721,
    liquidationCushionPercent: 0.78,
  };
  const riskier: PositionSnapshot = {
    ...safer,
    totalDebt: 21.1,
    ltv: 0.25,
    healthFactor: 4.53,
    liquidationPrice: 24_535,
    liquidationCushionPercent: 0.71,
  };
  assert.equal(riskDirectionFromMetrics(riskier, safer), 'decreases');
  assert.equal(riskDirectionFromMetrics(safer, riskier), 'increases');
  assert.equal(riskDirectionFromMetrics(safer, { ...safer }), 'preserves');
});

test('zero-debt full withdrawal is not described as risky', () => {
  const change = buildProposedPositionChange(base({
    action: 'WITHDRAW_COLLATERAL',
    amount: 100_000n,
    currentDebt: 0n,
    withdrawMax: 100_000n,
    maxWithdraw: true,
    protocolSafeFullWithdraw: true,
  }));
  assert.equal(change.projected.totalDebt, 0);
  assert.equal(change.projected.collateralAmount, 0);
  assert.equal(change.riskDirection, 'preserves');
  assert.equal(change.riskNote, 'No borrowing risk — position closes');
  assert.equal(change.actionTitle, 'Full supplied balance');
});

test('MAX repay title and dust-free close use the protocol-safe path', () => {
  const change = buildProposedPositionChange(base({
    amount: 21_100_000n,
    maxRepay: true,
    protocolSafeFullRepay: true,
    principalRemaining: 21_100_000n,
    interestRemaining: 0n,
  }));
  assert.equal(change.actionTitle, 'Full repayment');
  assert.equal(change.projected.totalDebt, 0);
  assert.equal(change.repayAccounting?.estimatedTotalDebtRemaining, 0);
  assert.equal(change.riskNote, 'Borrowing risk removed');
});
