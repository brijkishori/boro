import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Venue } from '../protocol';
import { buildProposedPositionChange, type PositionChangeInput } from './positionChange';
import { formatLtv } from './format';

function venue(): Venue {
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
    borrowApr: 0.0478,
    supplyApr: 0.03,
    maxLtv: 0.86,
    liquidityUsd: 10_000_000,
    priceUsd: 84_385,
    collateralRisk: { liquidationLtv: 0.86, parameterSource: 'live' },
    morpho: {
      marketId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      loanToken: '0x0000000000000000000000000000000000000002',
      collateralToken: '0x0000000000000000000000000000000000000001',
      oracle: '0x0000000000000000000000000000000000000003',
      irm: '0x0000000000000000000000000000000000000004',
      lltv: '860000000000000000',
    },
  };
}

function step(partial: Partial<PositionChangeInput> = {}): PositionChangeInput {
  return {
    action: 'SUPPLY_COLLATERAL',
    venue: venue(),
    amount: 100_000n,
    currentCollateral: 0n,
    currentDebt: 0n,
    spendableBalance: 200_000n,
    priceUsd: 84_385,
    ...partial,
  };
}

test('Morpho lifecycle: supply, borrow, partial repay, add collateral, partial withdraw, full repay, full withdraw', () => {
  const supplied = buildProposedPositionChange(step());
  assert.equal(supplied.projected.collateralAmount, 0.001);
  assert.equal(supplied.projected.totalDebt, 0);
  assert.equal(supplied.riskNote, 'No borrowing risk');

  const borrowed = buildProposedPositionChange(step({
    action: 'BORROW',
    amount: 21_100_000n,
    currentCollateral: 100_000n,
    borrowRoom: 50_000_000n,
  }));
  assert.equal(borrowed.current.collateralAmount, 0.001);
  assert.equal(borrowed.projected.totalDebt, 21.1);
  assert.ok(Math.abs((borrowed.projected.ltv ?? 0) - 21.1 / (0.001 * 84_385)) < 1e-10);
  assert.ok(Math.abs((borrowed.projected.liquidationPrice ?? 0) - 21.1 / (0.001 * 0.86)) < 1e-8);
  assert.equal(borrowed.riskDirection, 'increases');
  assert.equal(borrowed.projected.healthFactorKind, 'app-derived');

  const repaid = buildProposedPositionChange(step({
    action: 'REPAY',
    amount: 5_000_000n,
    currentCollateral: 100_000n,
    currentDebt: 21_100_000n,
    spendableBalance: 100_000_000n,
  }));
  assert.ok(Math.abs(repaid.projected.totalDebt - 16.1) < 1e-10);
  assert.equal(repaid.riskDirection, 'decreases');

  const added = buildProposedPositionChange(step({
    action: 'SUPPLY_COLLATERAL',
    amount: 10_000n,
    currentCollateral: 100_000n,
    currentDebt: 16_100_000n,
  }));
  assert.ok(Math.abs(added.projected.collateralAmount - 0.0011) < 1e-12);
  assert.equal(added.projected.totalDebt, added.current.totalDebt);
  assert.ok((added.projected.ltv ?? 1) < (added.current.ltv ?? 0));
  assert.ok((added.projected.healthFactor ?? 0) > (added.current.healthFactor ?? 0));
  assert.equal(added.riskDirection, 'decreases');

  const withdrawn = buildProposedPositionChange(step({
    action: 'WITHDRAW_COLLATERAL',
    amount: 10_000n,
    currentCollateral: 110_000n,
    currentDebt: 16_100_000n,
    withdrawMax: 10_000n,
  }));
  assert.ok(Math.abs(withdrawn.projected.collateralAmount - 0.001) < 1e-12);
  assert.equal(withdrawn.projected.totalDebt, withdrawn.current.totalDebt);
  assert.ok((withdrawn.projected.ltv ?? 0) > (withdrawn.current.ltv ?? 0));
  assert.equal(withdrawn.riskDirection, 'increases');

  const closed = buildProposedPositionChange(step({
    action: 'REPAY',
    amount: 16_100_000n,
    currentCollateral: 100_000n,
    currentDebt: 16_100_000n,
    spendableBalance: 100_000_000n,
    maxRepay: true,
    protocolSafeFullRepay: true,
  }));
  assert.equal(closed.projected.totalDebt, 0);
  assert.equal(closed.repayAccounting?.estimatedTotalDebtRemaining, 0);
  assert.equal(closed.actionTitle, 'Full repayment');
  assert.equal(closed.riskNote, 'Borrowing risk removed');

  const emptied = buildProposedPositionChange(step({
    action: 'WITHDRAW_COLLATERAL',
    amount: 100_000n,
    currentCollateral: 100_000n,
    currentDebt: 0n,
    withdrawMax: 100_000n,
    maxWithdraw: true,
    protocolSafeFullWithdraw: true,
  }));
  assert.equal(emptied.projected.collateralAmount, 0);
  assert.equal(emptied.projected.totalDebt, 0);
  assert.equal(emptied.actionTitle, 'Full supplied balance');
  assert.equal(emptied.riskNote, 'No borrowing risk — position closes');
});

test('internal LTV stays full precision while display rounds to 18.99%', () => {
  const ltv = 0.189947;
  assert.equal(formatLtv(ltv), '18.99%');
  assert.equal(ltv, 0.189947);
});
