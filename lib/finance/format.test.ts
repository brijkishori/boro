import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatAccountingAmount,
  formatBps,
  formatCushionOrNone,
  formatMoneyCompact,
  formatMoneyExact,
  formatHealthFactor,
  formatHealthFactorOrNone,
  formatLiquidationOrNone,
  formatLtv,
  formatLtvOrNone,
  formatRate,
  formatTokenAmount,
  formatUsdAdaptive,
  NO_DEBT_LABEL,
  NO_LIQUIDATION_LABEL,
  tokenNumber,
} from './format';

test('LTV keeps full internal precision and displays two decimals', () => {
  const ltv = 0.189947;
  assert.equal(formatLtv(ltv), '18.99%');
  assert.equal(ltv, 0.189947);
  const justOver = 0.190041;
  assert.equal(formatLtv(justOver), '19.00%');
  assert.equal(justOver, 0.190041);
});

test('very small nonzero interest stays nonzero internally and in precise display', () => {
  const interest = tokenNumber(8n, 6);
  assert.equal(interest, 0.000008);
  assert.equal(formatTokenAmount(8n, 6), '0.000008');
  assert.match(formatUsdAdaptive(interest, 'precise'), /0\.000008/);
});

test('BTC token amounts retain eight-decimal precision', () => {
  assert.equal(formatTokenAmount(100000n, 8), '0.00100000');
  assert.equal(formatTokenAmount(7813n, 8), '0.00007813');
  assert.equal(tokenNumber(100000n, 8), 0.001);
  assert.equal(tokenNumber(7813n, 8), 0.00007813);
});

test('ordinary USD uses two decimals while tiny USD keeps extra digits', () => {
  assert.equal(formatUsdAdaptive(21100.1267, 'compact'), '$21,100.13');
  assert.equal(formatUsdAdaptive(21100.1267, 'precise'), '$21,100.13');
  assert.match(formatUsdAdaptive(0.0084), /0\.0084/);
  assert.match(formatUsdAdaptive(0.000007), /0\.000007/);
});

test('APR display rounds only for presentation', () => {
  const apr = 0.0480491;
  assert.equal(formatRate(apr), '4.80%');
  assert.equal(apr, 0.0480491);
  assert.ok(apr > 0.048 && apr < 0.0481);
});

test('health factor display rounds only for presentation', () => {
  const healthFactor = 4.527834;
  assert.equal(formatHealthFactor(healthFactor), '4.53');
  assert.equal(healthFactor, 4.527834);
  assert.ok(healthFactor < 4.53);
});

test('zero-debt UI uses N/A labels instead of 0% or Infinity', () => {
  assert.equal(formatLtvOrNone(0, 0), NO_DEBT_LABEL);
  assert.equal(formatHealthFactorOrNone(Number.POSITIVE_INFINITY, 0), NO_DEBT_LABEL);
  assert.equal(formatLiquidationOrNone(0, 0), NO_LIQUIDATION_LABEL);
  assert.equal(formatCushionOrNone(1, 0), NO_LIQUIDATION_LABEL);
  assert.equal(formatLtvOrNone(0.189947, 16.1), '18.99%');
});

test('accounting money keeps two decimals and compact money is marked as abbreviated', () => {
  assert.equal(formatMoneyExact(21.1, 'USDC'), '21.10 USDC');
  assert.equal(formatAccountingAmount(21_100_000n, 6, 'USDC'), '21.10 USDC');
  assert.equal(formatAccountingAmount(21_078_900_000n, 6, 'USDC'), '21,078.90 USDC');
  assert.equal(formatMoneyExact(21_100, 'USDC'), '21,100.00 USDC');
  assert.equal(formatAccountingAmount(21_100_000n + 21_078_900_000n - 0n, 6, 'USDC'), '21,100.00 USDC');
  assert.equal(formatMoneyCompact(21_100), '$21.1K');
  assert.equal(formatMoneyCompact(84_000), '$84.0K');
  assert.equal(formatMoneyCompact(1_020), '$1.02K');
  assert.equal(formatBps(14), '14 bps');
  assert.notEqual(formatMoneyExact(21_100, 'USDC'), formatMoneyCompact(21_100));
});

test('compact USDC can hide extra dust while precise display keeps it', () => {
  const amount = 21100007n;
  assert.equal(formatTokenAmount(amount, 6, { compact: true, symbol: 'USDC' }), '21.10 USDC');
  assert.equal(formatTokenAmount(amount, 6, { symbol: 'USDC' }), '21.100007 USDC');
});
