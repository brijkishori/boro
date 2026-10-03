import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rebuildEpisodes,
  reconcileSeedOnlyOpenEpisodes,
  type AuditEvent,
} from './audit';

const wallet = '0x1111111111111111111111111111111111111111';

function seed(overrides: Partial<AuditEvent> = {}): AuditEvent {
  const venueId = overrides.venueId ?? 'borrow:morpho:8453:base-market';
  const chainId = overrides.chainId ?? 8453;
  return {
    hash: overrides.hash ?? `seed:${venueId}`,
    wallet,
    chainId,
    action: overrides.action ?? 'seed',
    at: overrides.at ?? 1,
    protocol: overrides.protocol ?? 'morpho',
    venueId,
    episodeKey: overrides.episodeKey ?? `${wallet}:${venueId}`,
    assetSymbol: overrides.assetSymbol ?? 'cbBTC',
    loanSymbol: overrides.loanSymbol ?? 'USDC',
    amount: overrides.amount ?? '21000000000',
    amountUsd: overrides.amountUsd ?? 21000,
    decimals: overrides.decimals ?? 6,
    borrowApr: overrides.borrowApr ?? 0.048,
    supplyApr: overrides.supplyApr ?? 0.03,
    priceUsd: overrides.priceUsd ?? 80000,
    healthFactor: overrides.healthFactor ?? 3.4,
    collateral: overrides.collateral ?? '100000000',
    debt: overrides.debt ?? '21000000000',
    feeWei: overrides.feeWei ?? '0',
    ethUsd: overrides.ethUsd ?? 2500,
  };
}

test('seed-only phantom is not counted open after exact loan identity is verified with no live loan', () => {
  const base = seed();
  const ethereum = seed({
    hash: 'seed:eth',
    chainId: 1,
    venueId: 'borrow:morpho:1:eth-market',
    episodeKey: `${wallet}:borrow:morpho:1:eth-market`,
  });
  const events = [base, ethereum];
  const episodes = rebuildEpisodes(events);

  const reconciled = reconcileSeedOnlyOpenEpisodes(
    episodes,
    events,
    [base.episodeKey],
    [base.episodeKey, ethereum.episodeKey],
  );

  assert.equal(reconciled.filter((episode) => episode.status === 'open').length, 1);
  assert.equal(reconciled[0]?.venueId, base.venueId);
});

test('seed-only episode is retained when that loan identity was not successfully verified', () => {
  const ethereum = seed({
    chainId: 1,
    venueId: 'borrow:morpho:1:eth-market',
    episodeKey: `${wallet}:borrow:morpho:1:eth-market`,
  });
  const episodes = rebuildEpisodes([ethereum]);

  const reconciled = reconcileSeedOnlyOpenEpisodes(episodes, [ethereum], [], []);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.status, 'open');
});

test('real borrow lifecycle is never suppressed by seed reconciliation', () => {
  const borrow = seed({
    hash: '0xabc',
    action: 'borrow',
    chainId: 1,
    venueId: 'borrow:morpho:1:eth-market',
    episodeKey: `${wallet}:borrow:morpho:1:eth-market`,
  });
  const episodes = rebuildEpisodes([borrow]);

  const reconciled = reconcileSeedOnlyOpenEpisodes(
    episodes,
    [borrow],
    [],
    [borrow.episodeKey],
  );

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.status, 'open');
});
