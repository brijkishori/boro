import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aaveHealthFactor,
  aaveLiquidationPrice,
  morphoLiquidationPrice,
  priceAtHealthFactor,
} from './liquidation';

test('Aave health factor uses liquidation threshold, not max LTV', () => {
  const hf = aaveHealthFactor(100_000, 40_000, 0.8);
  assert.ok(hf);
  assert.ok(Math.abs(hf - 2) < 1e-10);
  assert.equal(aaveHealthFactor(100_000, 0, 0.8), null);
});

test('Aave liquidation price uses threshold', () => {
  const price = aaveLiquidationPrice(1, 40_000, 0.8);
  assert.equal(price, 50_000);
});

test('Morpho liquidation price uses LLTV', () => {
  const price = morphoLiquidationPrice(1, 43_000, 0.86);
  assert.ok(price);
  assert.ok(Math.abs(price - 43_000 / 0.86) < 1e-8);
});

test('Morpho 86% LLTV liquidation price for a 21100 debt on 1 BTC', () => {
  const price = morphoLiquidationPrice(1, 21_100, 0.86);
  assert.ok(price);
  assert.ok(Math.abs(price - 21_100 / 0.86) < 1e-8);
});

test('price at a target health factor scales linearly', () => {
  const atOne = priceAtHealthFactor(1, 40_000, 0.8, 1);
  const atTwo = priceAtHealthFactor(1, 40_000, 0.8, 2);
  assert.equal(atOne, 50_000);
  assert.equal(atTwo, 100_000);
});
