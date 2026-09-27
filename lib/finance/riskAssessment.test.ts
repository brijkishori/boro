import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessMarket } from './riskAssessment';
import type { Venue } from '../protocol';

function venue(id: string, borrowApr: number, liquidityUsd: number): Venue {
  return {
    id,
    protocol: 'aave',
    action: 'borrow',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    assetKind: 'custodial',
    assetAddress: '0x0000000000000000000000000000000000000001',
    assetDecimals: 8,
    loanSymbol: 'USDC',
    loanAddress: '0x0000000000000000000000000000000000000002',
    loanDecimals: 6,
    borrowApr,
    supplyApr: 0.02,
    maxLtv: 0.75,
    liquidityUsd,
    priceUsd: 100_000,
  };
}

test('does not treat the cheapest APR as automatically suggested', () => {
  const cheapThin = venue('cheap', 0.03, 50_000);
  const deeper = venue('deep', 0.035, 50_000_000);
  const cheap = assessMarket(cheapThin, { action: 'borrow', peers: [cheapThin, deeper] });
  const deep = assessMarket(deeper, { action: 'borrow', peers: [cheapThin, deeper] });
  assert.ok((deep.liquidityScore ?? 0) > (cheap.liquidityScore ?? 0));
  assert.ok((cheap.overallScore ?? 0) > 0);
  assert.ok(deep.reasons.some((reason) => /liquidity/i.test(reason)));
});

test('missing history is a caution, not an invented stability score', () => {
  const market = venue('a', 0.04, 20_000_000);
  const assessment = assessMarket(market, { action: 'borrow', peers: [market] });
  assert.equal(assessment.rateStabilityScore, undefined);
  assert.ok(assessment.cautions.some((item) => /history/i.test(item)));
});
