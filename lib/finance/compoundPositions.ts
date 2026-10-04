import { formatUnits } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import type { Venue } from '@/lib/protocol';

export type CompoundLoanBookPosition = {
  venue: Venue;
  snapshot: PositionSnapshot;
  verified?: boolean;
};

function compoundAccountKey(venue: Venue): string | null {
  if (venue.protocol !== 'compound' || !venue.compound?.comet) return null;
  return `${venue.chainId}:${venue.compound.comet.toLowerCase()}:${venue.loanAddress.toLowerCase()}`;
}

function collateralUsd(position: CompoundLoanBookPosition): number {
  const amount = Number(formatUnits(position.snapshot.collateral, position.venue.assetDecimals));
  if (!(amount > 0) || !(position.venue.priceUsd > 0)) return 0;
  return amount * position.venue.priceUsd;
}

function choosePrimary(group: CompoundLoanBookPosition[]): CompoundLoanBookPosition {
  const withCollateral = group.filter((item) => item.snapshot.collateral > 0n);
  const verifiedWithCollateral = withCollateral.filter((item) => item.verified === true);
  const verified = group.filter((item) => item.verified === true);
  const candidates = verifiedWithCollateral.length > 0
    ? verifiedWithCollateral
    : withCollateral.length > 0
      ? withCollateral
      : verified.length > 0
        ? verified
        : group;
  return [...candidates].sort((left, right) => {
    const collateralDelta = collateralUsd(right) - collateralUsd(left);
    if (Math.abs(collateralDelta) > 0.000001) return collateralDelta;
    return left.venue.id.localeCompare(right.venue.id);
  })[0]!;
}

function accountDebt(group: CompoundLoanBookPosition[]): bigint {
  // borrowBalanceOf() is Comet/account-level and therefore repeats for every
  // collateral venue backed by the same Comet. Prefer fresh reads whenever at
  // least one is available; otherwise preserve the best cached debt value.
  const verified = group.filter((item) => item.verified === true);
  const source = verified.length > 0 ? verified : group;
  return source.reduce((max, item) => item.snapshot.debt > max ? item.snapshot.debt : max, 0n);
}

/**
 * Compound V3 debt belongs to the wallet's Comet account, not to an individual
 * collateral asset. Boro models each supported BTC collateral as a Venue, so a
 * raw position scan can repeat the exact same borrowBalanceOf() debt on several
 * venue rows and accidentally render multiple loans or emit duplicate/false
 * safety alerts.
 *
 * Assign the account-level debt to one representative collateral row and set
 * sibling rows' debt to zero. Their collateral is preserved. Derived debt-risk
 * fields are neutralized on those sibling rows because the raw values were
 * calculated by pairing the account debt with only that sibling collateral and
 * therefore are not a valid standalone loan risk measurement.
 */
export function normalizeCompoundLoanBookPositions<T extends CompoundLoanBookPosition>(positions: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const position of positions) {
    const key = compoundAccountKey(position.venue);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(position);
    groups.set(key, list);
  }
  if ([...groups.values()].every((group) => group.length <= 1)) return positions;

  const primaryByKey = new Map<string, T>();
  const debtByKey = new Map<string, bigint>();
  for (const [key, group] of groups) {
    if (group.length <= 1) continue;
    primaryByKey.set(key, choosePrimary(group) as T);
    debtByKey.set(key, accountDebt(group));
  }

  return positions.map((position) => {
    const key = compoundAccountKey(position.venue);
    if (!key) return position;
    const primary = primaryByKey.get(key);
    if (!primary) return position;

    const isPrimary = position === primary;
    const nextDebt = isPrimary ? (debtByKey.get(key) ?? position.snapshot.debt) : 0n;
    if (isPrimary && nextDebt === position.snapshot.debt) return position;

    return {
      ...position,
      snapshot: {
        ...position.snapshot,
        debt: nextDebt,
        ...(isPrimary
          ? null
          : {
              healthFactor: null,
              ltv: 0,
              liquidationPrice: 0,
            }),
      },
    };
  });
}
