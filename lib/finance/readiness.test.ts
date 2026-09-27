import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMaterialTransaction, materialPreviewChanged, READINESS_ACKNOWLEDGMENTS, buildLoanReadiness } from './readiness';
import type { Venue } from '../protocol';

test('material size uses recent activity when available instead of one fixed dollar number', () => {
  assert.equal(isMaterialTransaction(200), false);
  assert.equal(isMaterialTransaction(250), true);
  assert.equal(isMaterialTransaction(40, 10), false);
  assert.equal(isMaterialTransaction(50, 10), true);
  assert.equal(isMaterialTransaction(49, 10), false);
});

test('oracle or rate drift between preview and confirmation is material', () => {
  const preview = { borrowApr: 0.048, priceUsd: 84_000, ltv: 0.25, liquidationPrice: 24_535, liquidityUsd: 1_000_000 };
  assert.equal(materialPreviewChanged(preview, preview), false);
  assert.equal(materialPreviewChanged(preview, { ...preview, priceUsd: 84_500 }), true);
  assert.equal(materialPreviewChanged(preview, { ...preview, borrowApr: 0.055 }), true);
  assert.equal(materialPreviewChanged(preview, { ...preview, liquidityUsd: 900_000 }), true);
});

test('readiness checklist states variable rate, liquidation, wrapper, protocol, and preview drift', () => {
  const venue = {
    id: 'borrow:morpho:8453:1',
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
    priceUsd: 84_000,
  } as Venue;
  const readiness = buildLoanReadiness({
    venue,
    collateralAmount: 0.001,
    collateralUsd: 84,
    borrowAmount: 21.1,
    startingLtv: 0.25,
    liquidationPrice: 24_535,
    cushion: 0.71,
    healthFactor: 4.53,
    healthFactorKind: 'app-derived',
    walletCollateral: 0.002,
  });
  assert.equal(readiness.marketId.startsWith('0x') || readiness.marketId.includes('morpho'), true);
  assert.equal(READINESS_ACKNOWLEDGMENTS.length, 5);
  assert.ok(readiness.acknowledgments.some((row) => /variable/.test(row)));
  assert.ok(readiness.acknowledgments.some((row) => /liquidated/.test(row)));
});
