import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAddress } from 'viem';
import { CHAINS, COMETS, canonicalMarketKey, dedupeVenues, rankVenues, type Venue } from './protocol';

const BASE_CBBTC = CHAINS[8453].btc.find((token) => token.symbol === 'cbBTC')!;
const BASE_TBTC = CHAINS[8453].btc.find((token) => token.symbol === 'tBTC')!;
const BASE_USDC = CHAINS[8453].usdc;
const BASE_COMET = COMETS[8453]!;

function compoundVenue(partial: Partial<Venue> & Pick<Venue, 'id' | 'assetSymbol' | 'assetAddress'>): Venue {
  const token = partial.assetSymbol === 'tBTC' ? BASE_TBTC : BASE_CBBTC;
  return {
    protocol: 'compound',
    action: 'borrow',
    chainId: 8453,
    assetKind: token.kind,
    assetDecimals: token.decimals,
    loanSymbol: 'USDC',
    loanAddress: BASE_USDC.address,
    loanDecimals: 6,
    borrowApr: 0.0449,
    supplyApr: 0.03,
    maxLtv: 0.8,
    liquidityUsd: 952_584,
    priceUsd: 84_000,
    compound: { comet: BASE_COMET, minBorrow: '1' },
    ...partial,
    assetAddress: token.address,
  };
}

test('duplicate Compound representations collapse to one ranked market', () => {
  const checksum = compoundVenue({
    id: `borrow:compound:8453:${BASE_CBBTC.address}`,
    assetSymbol: 'cbBTC',
    assetAddress: BASE_CBBTC.address,
  });
  const lowercase = compoundVenue({
    id: `borrow:compound:8453:${BASE_CBBTC.address.toLowerCase()}`,
    assetSymbol: 'cbBTC',
    assetAddress: getAddress(BASE_CBBTC.address.toLowerCase()),
    liquidityUsd: 900_000,
  });
  assert.equal(canonicalMarketKey(checksum), canonicalMarketKey(lowercase));
  const ranked = rankVenues([checksum, lowercase], 'borrow');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, checksum.id);
});

test('Compound records without a comet still collapse onto the same collateral market', () => {
  const withComet = compoundVenue({
    id: `borrow:compound:8453:${BASE_CBBTC.address}`,
    assetSymbol: 'cbBTC',
    assetAddress: BASE_CBBTC.address,
  });
  const missingComet = {
    ...withComet,
    id: 'borrow:compound:8453:duplicate-cbbtc',
    compound: undefined,
    liquidityUsd: 100,
  };
  assert.equal(canonicalMarketKey(withComet), canonicalMarketKey(missingComet));
  const unique = dedupeVenues([missingComet, withComet], 'borrow');
  assert.equal(unique.length, 1);
  assert.equal(unique[0]?.id, withComet.id);
});

test('different Compound collaterals on the same Comet stay distinct', () => {
  const cbBtc = compoundVenue({
    id: `borrow:compound:8453:${BASE_CBBTC.address}`,
    assetSymbol: 'cbBTC',
    assetAddress: BASE_CBBTC.address,
  });
  const tBtc = compoundVenue({
    id: `borrow:compound:8453:${BASE_TBTC.address}`,
    assetSymbol: 'tBTC',
    assetAddress: BASE_TBTC.address,
  });
  assert.notEqual(canonicalMarketKey(cbBtc), canonicalMarketKey(tBtc));
  assert.equal(rankVenues([cbBtc, tBtc], 'borrow').length, 2);
});
