import { formatUnits } from 'viem';
import {
  asBig,
  liveSplit,
  rebuildEpisodes,
  splitRepay,
  type AuditEvent,
} from '@/lib/audit';
import { formatApr, formatUsdExact } from '@/lib/amount';
import { formatHealthFactor, formatLtv } from '@/lib/finance/format';
import { buildLoanRateStatus } from '@/lib/finance/loanView';

/** Outstanding debt at or below this USD amount is not an open loan. */
export const OPEN_DEBT_DUST_USD = 0.01;

export type ActualInterestStatus = 'measured' | 'since-opening' | 'unavailable';

export type ProjectedInterestCost = {
  next7Days: number | null;
  month: number | null;
  year: number | null;
};

export type ActualPeriodInterest = {
  usd: number | null;
  status: ActualInterestStatus;
};

export type EpisodePeriod = {
  tracked: boolean;
  openedAt: number | null;
  openedByBorrow: boolean;
  principalRemainingUsd: number | null;
  accruedUnpaidUsd: number | null;
  interestPaidUsd: number | null;
  principalRepaidUsd: number | null;
  additionalBorrowingUsd: number | null;
  networkFeesUsd: number | null;
  periodStartSnapshot: AccountingSnapshot | null;
  periodEndSnapshot: AccountingSnapshot | null;
  actual: ActualPeriodInterest;
};

export type AccountingSnapshot = {
  totalDebtUsd: number;
  principalUsd: number;
  accruedUnpaidUsd: number;
};

export type DigestPosition = {
  name: string;
  debtUsd: number;
  principalRemainingUsd: number | null;
  accruedUnpaidUsd: number | null;
  apr: number | null;
  openingApr?: number | null;
  ltv: number | null;
  healthFactor: number | null;
  liquidationPriceUsd: number | null;
  actualUsd: number | null;
  actualStatus: ActualInterestStatus;
  interestPaidUsd: number | null;
  principalRepaidUsd: number | null;
  additionalBorrowingUsd: number | null;
  networkFeesUsd: number | null;
};

/** Forward cost at today's balance and APR. This is not interest that already accrued. */
export function projectedInterestCost(debtUsd: number, apr: number | null | undefined): ProjectedInterestCost {
  if (!(debtUsd > 0) || typeof apr !== 'number' || !Number.isFinite(apr) || apr < 0) {
    return { next7Days: null, month: null, year: null };
  }
  return {
    next7Days: debtUsd * apr * 7 / 365,
    month: debtUsd * apr / 12,
    year: debtUsd * apr,
  };
}

/** Protocol debt minus tracked principal. This is not an APR projection. */
export function accruedUnpaidUnits(totalDebt: bigint, principalRemaining: bigint): bigint {
  if (totalDebt <= 0n || principalRemaining >= totalDebt) return 0n;
  return totalDebt - principalRemaining;
}

function unitsToUsd(amount: bigint, decimals: number): number {
  const places = decimals > 0 && decimals <= 18 ? decimals : 6;
  return Number(formatUnits(amount, places));
}

function snapshotUsd(totalDebt: bigint, principal: bigint, decimals: number): AccountingSnapshot {
  const accrued = accruedUnpaidUnits(totalDebt, principal);
  return {
    totalDebtUsd: unitsToUsd(totalDebt, decimals),
    principalUsd: unitsToUsd(principal, decimals),
    accruedUnpaidUsd: unitsToUsd(accrued, decimals),
  };
}

export function actualInterestDuringPeriod(input: {
  periodStart: number;
  periodEnd: number;
  openedAt: number | null;
  openedByBorrow: boolean;
  beginningAccruedUsd: number | null;
  endingAccruedUsd: number | null;
  interestPaidUsd: number | null;
}): ActualPeriodInterest {
  if (input.interestPaidUsd === null || input.endingAccruedUsd === null || !Number.isFinite(input.endingAccruedUsd)) {
    return { usd: null, status: 'unavailable' };
  }
  const openedDuring = input.openedByBorrow
    && input.openedAt !== null
    && input.openedAt >= input.periodStart
    && input.openedAt <= input.periodEnd;
  if (openedDuring) {
    return { usd: input.endingAccruedUsd + input.interestPaidUsd, status: 'since-opening' };
  }
  if (input.beginningAccruedUsd === null || !Number.isFinite(input.beginningAccruedUsd)) {
    return { usd: null, status: 'unavailable' };
  }
  return {
    usd: input.endingAccruedUsd - input.beginningAccruedUsd + input.interestPaidUsd,
    status: 'measured',
  };
}

function tokenUsd(value: string | undefined, decimals: number): number | null {
  if (value === undefined) return null;
  const amount = asBig(value);
  const places = decimals > 0 && decimals <= 18 ? decimals : 6;
  return Number(formatUnits(amount, places));
}

function feeUsd(event: AuditEvent): number | null {
  const wei = asBig(event.feeWei);
  if (wei <= 0n) return 0;
  if (event.ethUsd === null || !Number.isFinite(event.ethUsd)) return null;
  return Number(formatUnits(wei, 18)) * event.ethUsd;
}

function orderedEpisodeEvents(events: AuditEvent[], episodeKey: string) {
  return events
    .filter((event) => event.episodeKey === episodeKey)
    .slice()
    .sort((left, right) => left.at - right.at || left.hash.localeCompare(right.hash));
}

/**
 * Accrued unpaid interest recorded by the ledger at `atOrBefore`.
 * A snapshot from before that instant is not used, because the gap would have to be filled with an APR.
 */
export function accruedSnapshotAt(events: AuditEvent[], episodeKey: string, atOrBefore: number): {
  at: number;
  accruedUnits: bigint;
  principalUnits: bigint;
  decimals: number;
} | null {
  const ordered = orderedEpisodeEvents(events, episodeKey);
  let open = false;
  let opener: AuditEvent | null = null;
  let accrued: bigint | null = null;
  let principal: bigint | null = null;
  let observedAt = 0;
  let decimals = 6;
  for (const event of ordered) {
    if (event.at > atOrBefore) break;
    if (event.action !== 'borrow' && event.action !== 'repay' && event.action !== 'seed') continue;
    decimals = event.decimals > 0 && event.decimals <= 18 ? event.decimals : decimals;
    if (!open && (event.action === 'borrow' || event.action === 'seed')) {
      open = true;
      opener = event;
      principal = asBig(event.amount);
      accrued = event.action === 'borrow' ? 0n : null;
      observedAt = event.action === 'borrow' ? event.at : 0;
      continue;
    }
    if (!open) continue;
    if (event.action === 'borrow') {
      if (principal !== null) principal += asBig(event.amount);
      continue;
    }
    if (event.action === 'seed') continue;
    if (event.interestRemaining !== undefined && event.principalRemaining !== undefined) {
      accrued = asBig(event.interestRemaining);
      principal = asBig(event.principalRemaining);
      observedAt = event.at;
    } else {
      accrued = null;
      observedAt = 0;
    }
    if (event.closing || principal === 0n) {
      open = false;
      opener = null;
      accrued = null;
      principal = null;
      observedAt = 0;
    }
  }
  if (!open || accrued === null || principal === null || opener === null) return null;
  if (observedAt !== atOrBefore) return null;
  return { at: observedAt, accruedUnits: accrued, principalUnits: principal, decimals };
}

export function summarizeEpisodePeriod(input: {
  events: AuditEvent[];
  episodeKey: string;
  periodStart: number;
  periodEnd: number;
  endingDebt: bigint;
  decimals: number;
}): EpisodePeriod {
  const unavailable: EpisodePeriod = {
    tracked: false,
    openedAt: null,
    openedByBorrow: false,
    principalRemainingUsd: null,
    accruedUnpaidUsd: null,
    interestPaidUsd: null,
    principalRepaidUsd: null,
    additionalBorrowingUsd: null,
    networkFeesUsd: null,
    periodStartSnapshot: null,
    periodEndSnapshot: null,
    actual: { usd: null, status: 'unavailable' },
  };
  const episode = episodeOverlapping(input.events, input.episodeKey, input.periodStart, input.periodEnd);
  if (!episode) return unavailable;
  const split = liveSplit(episode, input.endingDebt);
  const places = input.decimals > 0 && input.decimals <= 18 ? input.decimals : 6;
  const ordered = orderedEpisodeEvents(input.events, input.episodeKey);
  const opener = ordered.find((event) => (event.action === 'borrow' || event.action === 'seed') && event.at === episode.openedAt);
  const openedByBorrow = opener?.action === 'borrow';
  const openedDuring = openedByBorrow && episode.openedAt >= input.periodStart && episode.openedAt <= input.periodEnd;
  const windowStart = openedDuring ? episode.openedAt : input.periodStart;
  let interestPaid = 0;
  let interestPaidKnown = true;
  let principalRepaid = 0;
  let principalKnown = true;
  let additional = 0;
  let fees = 0;
  let feesKnown = true;
  let runningPrincipal = 0n;
  let open = false;
  for (const event of ordered) {
    const inWindow = event.at >= windowStart && event.at <= input.periodEnd;
    if (inWindow) {
      const cost = feeUsd(event);
      if (cost === null) feesKnown = false;
      else fees += cost;
    }
    if (event.action === 'borrow' || event.action === 'seed') {
      const added = asBig(event.amount);
      if (!open) {
        open = true;
        runningPrincipal = added;
      } else if (event.action === 'borrow') {
        runningPrincipal += added;
      }
      if (inWindow && event.action === 'borrow') {
        const borrowed = tokenUsd(event.amount, event.decimals || places);
        if (borrowed !== null) additional += borrowed;
      }
      continue;
    }
    if (event.action !== 'repay' || !open) continue;
    const placesForEvent = event.decimals > 0 && event.decimals <= 18 ? event.decimals : places;
    let interest: bigint | null = null;
    let principal: bigint | null = null;
    if (event.interestPaid !== undefined && event.principalPaid !== undefined) {
      interest = asBig(event.interestPaid);
      principal = asBig(event.principalPaid);
      runningPrincipal = event.principalRemaining !== undefined
        ? asBig(event.principalRemaining)
        : (runningPrincipal > principal ? runningPrincipal - principal : 0n);
    } else if (asBig(event.debt) > 0n || asBig(event.amount) === 0n) {
      const split = splitRepay(runningPrincipal, asBig(event.debt), asBig(event.amount));
      interest = split.interestPaid;
      principal = split.principalPaid;
      runningPrincipal = split.principalRemaining;
    }
    if (inWindow) {
      const interestValue = interest === null ? null : Number(formatUnits(interest, placesForEvent));
      const principalValue = principal === null ? null : Number(formatUnits(principal, placesForEvent));
      if (interestValue === null) interestPaidKnown = false;
      else interestPaid += interestValue;
      if (principalValue === null) principalKnown = false;
      else principalRepaid += principalValue;
    }
    if (event.closing || runningPrincipal === 0n) open = false;
  }
  const openingPrincipal = asBig(opener?.amount);
  const periodStartSnapshot = openedDuring
    ? snapshotUsd(openingPrincipal, openingPrincipal, places)
    : boundarySnapshot(input.events, input.episodeKey, input.periodStart);
  const periodEndSnapshot = split.tracked ? snapshotUsd(input.endingDebt, split.principalRemaining, places) : null;
  const actual = actualInterestDuringPeriod({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    openedAt: episode.openedAt,
    openedByBorrow,
    beginningAccruedUsd: periodStartSnapshot?.accruedUnpaidUsd ?? null,
    endingAccruedUsd: periodEndSnapshot?.accruedUnpaidUsd ?? null,
    interestPaidUsd: interestPaidKnown ? interestPaid : null,
  });
  return {
    tracked: split.tracked,
    openedAt: episode.openedAt,
    openedByBorrow,
    principalRemainingUsd: periodEndSnapshot?.principalUsd ?? null,
    accruedUnpaidUsd: periodEndSnapshot?.accruedUnpaidUsd ?? null,
    interestPaidUsd: interestPaidKnown ? interestPaid : null,
    principalRepaidUsd: principalKnown ? principalRepaid : null,
    additionalBorrowingUsd: additional,
    networkFeesUsd: feesKnown ? fees : null,
    periodStartSnapshot,
    periodEndSnapshot,
    actual,
  };
}

function episodeOverlapping(events: AuditEvent[], key: string, periodStart: number, periodEnd: number) {
  const episodes = rebuildEpisodes(events).filter((episode) => episode.key === key);
  const open = episodes.find((episode) => episode.status === 'open' && episode.openedAt <= periodEnd);
  if (open) return open;
  return episodes
    .filter((episode) => episode.status === 'closed'
      && episode.closedAt !== null
      && episode.openedAt <= periodEnd
      && episode.closedAt >= periodStart)
    .sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0))[0] ?? null;
}

function boundarySnapshot(events: AuditEvent[], key: string, at: number): AccountingSnapshot | null {
  const hit = accruedSnapshotAt(events, key, at);
  if (!hit) return null;
  return snapshotUsd(hit.principalUnits + hit.accruedUnits, hit.principalUnits, hit.decimals);
}

const DAY_MS = 86_400_000;

/** Deterministic stand-in for the live loan that opened yesterday. */
export function liveLikeOpenLoan(now = Date.UTC(2026, 8, 28, 17, 0, 0)) {
  const openedAt = now - DAY_MS;
  const principal = 21_100_000_000n;
  const endingDebt = 21_102_790_000n;
  const apr = 0.047;
  const episodeKey = 'live-like-morpho';
  const events: AuditEvent[] = [{
    hash: '0xlive',
    wallet: '0xabc',
    chainId: 8453,
    action: 'borrow',
    at: openedAt,
    protocol: 'morpho',
    venueId: 'morpho-base-cbbtc',
    episodeKey,
    assetSymbol: 'cbBTC',
    loanSymbol: 'USDC',
    amount: principal.toString(),
    amountUsd: 21_100,
    decimals: 6,
    borrowApr: apr,
    supplyApr: null,
    priceUsd: null,
    healthFactor: null,
    collateral: '0',
    debt: '0',
    feeWei: '0',
    ethUsd: null,
  }];
  const summary = summarizeEpisodePeriod({
    events,
    episodeKey,
    periodStart: now - 7 * DAY_MS,
    periodEnd: now,
    endingDebt,
    decimals: 6,
  });
  return { now, openedAt, principal, endingDebt, apr, events, episodeKey, summary };
}

export function previousUtcMonth(now: number) {
  const date = new Date(now);
  const periodEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const periodStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
  return { periodStart, periodEnd };
}

export function isOpenDebt(debtUsd: number) {
  return debtUsd > OPEN_DEBT_DUST_USD;
}

export function countEmailPositions(rows: Array<{ debtUsd: number; supplied: boolean }>) {
  return {
    openDebt: rows.filter((row) => isOpenDebt(row.debtUsd)).length,
    suppliedWithoutDebt: rows.filter((row) => !isOpenDebt(row.debtUsd) && row.supplied).length,
  };
}

function usdOrUnavailable(value: number | null, unavailable: string) {
  return value === null ? unavailable : formatUsdExact(value);
}

function periodWord(period: 'week' | 'month') {
  return period === 'week' ? 'week' : 'month';
}

function aprSinceOpening(row: DigestPosition) {
  if (typeof row.openingApr !== 'number') return [];
  const rate = buildLoanRateStatus({ currentApr: row.apr, openingApr: row.openingApr, debtUsd: row.debtUsd });
  return rate.icon ? [`APR since opening: ${rate.compactText}`] : [];
}

export function digestLines(period: 'week' | 'month', debt: DigestPosition[], supplied: string[]) {
  const open = debt.filter((row) => isOpenDebt(row.debtUsd));
  const word = periodWord(period);
  const lines = [
    period === 'week' ? 'WEEKLY LOAN DIGEST' : 'MONTHLY LOAN STATEMENT',
    `Open debt positions: ${open.length}`,
    `Supplied positions with no debt: ${supplied.length}`,
  ];
  for (const row of open) {
    const projected = projectedInterestCost(row.debtUsd, row.apr);
    const actualLabel = row.actualStatus === 'unavailable' || row.actualUsd === null
      ? `Actual ${word === 'week' ? 'weekly' : 'monthly'} interest unavailable`
      : row.actualStatus === 'since-opening'
        ? `Interest accrued this ${word}: ${formatUsdExact(row.actualUsd)} since this loan opened during the period`
        : `Interest accrued this ${word}: ${formatUsdExact(row.actualUsd)}`;
    lines.push(
      row.name,
      'ACTUAL THIS PERIOD',
      actualLabel,
      `Interest paid this ${word}: ${usdOrUnavailable(row.interestPaidUsd, 'unavailable')}`,
      `Principal repaid this ${word}: ${usdOrUnavailable(row.principalRepaidUsd, 'unavailable')}`,
      `Additional borrowing this ${word}: ${usdOrUnavailable(row.additionalBorrowingUsd, 'unavailable')}`,
      `Network fees this ${word}: ${usdOrUnavailable(row.networkFeesUsd, 'unavailable')}`,
      'CURRENT POSITION',
      `Total debt: ${formatUsdExact(row.debtUsd)}`,
      `Principal remaining: ${usdOrUnavailable(row.principalRemainingUsd, 'unavailable')}`,
      `Accrued unpaid interest: ${usdOrUnavailable(row.accruedUnpaidUsd, 'unavailable')}`,
      `Current APR: ${row.apr === null ? 'unavailable' : formatApr(row.apr)}`,
      ...aprSinceOpening(row),
      `LTV: ${row.ltv === null ? 'unavailable' : formatLtv(row.ltv)}`,
      `HF: ${row.healthFactor === null ? 'unavailable' : formatHealthFactor(row.healthFactor)}`,
      `Liquidation BTC: ${row.liquidationPriceUsd === null || !(row.liquidationPriceUsd > 0) ? '—' : formatUsdExact(row.liquidationPriceUsd)}`,
      'FORWARD-LOOKING ESTIMATES',
      `Estimated next-7-day interest at current balance and APR: ${usdOrUnavailable(projected.next7Days, 'unavailable')}`,
      `Estimated monthly interest at current balance and APR: ${usdOrUnavailable(projected.month, 'unavailable')}`,
      `Estimated annualized interest at current balance and APR: ${usdOrUnavailable(projected.year, 'unavailable')}`,
    );
  }
  if (supplied.length > 0) {
    lines.push('Supplied / watched positions with no debt', ...supplied);
  }
  return lines;
}
