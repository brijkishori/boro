import { asBig, splitRepay, type AuditEvent } from '@/lib/audit';
import { annualInterest, monthlyInterest } from '@/lib/finance/rates';

/** Absolute APR change below this is treated as approximately unchanged. */
export const OPENING_APR_NEUTRAL_BPS = 5;

export type OpeningAprStatus =
  | 'CHEAPER_THAN_OPENING'
  | 'NEAR_OPENING_RATE'
  | 'MORE_EXPENSIVE_THAN_OPENING'
  | 'NOT_CAPTURED';

export type CapturedBorrowRate = {
  normalizedBorrowApr: number;
  rawSourceRate: number | null;
  sourceRateType: string | null;
  protocol: string;
  chainId: number;
  marketId: string;
  txHash: string;
  blockNumber: string | null;
  timestamp: number;
};

export type LoanRateHistory = {
  opening: CapturedBorrowRate | null;
  latestBorrow: CapturedBorrowRate | null;
};

export type AprMovement = {
  status: OpeningAprStatus;
  openingApr: number | null;
  currentApr: number | null;
  changeApr: number | null;
  changeBps: number | null;
  annualAtOpening: number | null;
  annualAtCurrent: number | null;
  annualDifference: number | null;
  monthlyDifference: number | null;
};

function finiteApr(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1;
}

function finiteSource(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function captured(event: AuditEvent): CapturedBorrowRate | null {
  if (event.action !== 'borrow' || !finiteApr(event.borrowApr)) return null;
  return {
    normalizedBorrowApr: event.borrowApr,
    rawSourceRate: finiteSource(event.sourceRate) ? event.sourceRate : null,
    sourceRateType: event.sourceRateType ?? null,
    protocol: event.protocol,
    chainId: event.chainId,
    marketId: event.marketId || event.venueId,
    txHash: event.hash,
    blockNumber: event.blockNumber ?? null,
    timestamp: event.at,
  };
}

/**
 * Opening APR is the normalized borrow APR on the borrow that took this lifecycle
 * from zero debt to nonzero debt. Seed rows and closed lifecycles are not reused.
 */
export function loanRateHistory(events: AuditEvent[], episodeKey: string): LoanRateHistory {
  if (!episodeKey) return { opening: null, latestBorrow: null };
  const ordered = events
    .filter((event) => event.episodeKey === episodeKey)
    .slice()
    .sort((left, right) => left.at - right.at || left.hash.localeCompare(right.hash));
  let open = false;
  let principalRemaining = 0n;
  let opener: AuditEvent | null = null;
  const additional: AuditEvent[] = [];
  for (const event of ordered) {
    if (event.action !== 'borrow' && event.action !== 'repay' && event.action !== 'seed') continue;
    if (!open && (event.action === 'borrow' || event.action === 'seed')) {
      open = true;
      principalRemaining = asBig(event.amount);
      opener = event;
      additional.length = 0;
      continue;
    }
    if (!open) continue;
    if (event.action === 'borrow') {
      principalRemaining += asBig(event.amount);
      additional.push(event);
      continue;
    }
    const split = event.interestPaid !== undefined && event.principalPaid !== undefined
      ? { principalRemaining: asBig(event.principalRemaining ?? '0') }
      : splitRepay(principalRemaining, asBig(event.debt), asBig(event.amount));
    principalRemaining = split.principalRemaining;
    if (event.closing || principalRemaining === 0n) {
      open = false;
      opener = null;
      additional.length = 0;
      principalRemaining = 0n;
    }
  }
  if (!open || !opener) return { opening: null, latestBorrow: null };
  const latest = additional.length > 0 ? captured(additional[additional.length - 1]) : null;
  return { opening: captured(opener), latestBorrow: latest };
}

export function aprMovement(openingApr: number | null, currentApr: number | null, debt: number): AprMovement {
  if (!finiteApr(openingApr) || !finiteApr(currentApr)) {
    return {
      status: 'NOT_CAPTURED',
      openingApr: finiteApr(openingApr) ? openingApr : null,
      currentApr: finiteApr(currentApr) ? currentApr : null,
      changeApr: null,
      changeBps: null,
      annualAtOpening: null,
      annualAtCurrent: null,
      annualDifference: null,
      monthlyDifference: null,
    };
  }
  const changeApr = currentApr - openingApr;
  const changeBps = changeApr * 10_000;
  const status: OpeningAprStatus = Math.abs(changeBps) < OPENING_APR_NEUTRAL_BPS
    ? 'NEAR_OPENING_RATE'
    : changeApr < 0
      ? 'CHEAPER_THAN_OPENING'
      : 'MORE_EXPENSIVE_THAN_OPENING';
  const annualAtOpening = annualInterest(debt, openingApr);
  const annualAtCurrent = annualInterest(debt, currentApr);
  const annualDifference = annualAtCurrent - annualAtOpening;
  return {
    status,
    openingApr,
    currentApr,
    changeApr,
    changeBps,
    annualAtOpening,
    annualAtCurrent,
    annualDifference,
    monthlyDifference: monthlyInterest(debt, currentApr) - monthlyInterest(debt, openingApr),
  };
}

export function movementBpsText(changeBps: number): string {
  const abs = Math.abs(changeBps);
  return abs >= 9.95 ? abs.toFixed(0) : abs.toFixed(1).replace(/\.0$/, '');
}

export type AprDirection = 'UP' | 'DOWN' | 'NEUTRAL';
export type AprSemanticState = 'positive' | 'warning' | 'neutral';

export type AprChangeVisual = {
  direction: AprDirection | null;
  icon: '↑' | '↓' | '→' | null;
  statusText: string;
  semanticState: AprSemanticState;
  compactText: string;
};

/** Arrow, words, and semantic state for an active loan's APR versus opening. */
export function aprChangeVisual(movement: AprMovement): AprChangeVisual {
  if (movement.status === 'NOT_CAPTURED' || movement.changeBps === null) {
    return {
      direction: null,
      icon: null,
      statusText: 'Opening APR not captured',
      semanticState: 'neutral',
      compactText: 'Opening APR not captured',
    };
  }
  const bps = movementBpsText(movement.changeBps);
  if (movement.status === 'NEAR_OPENING_RATE') {
    return {
      direction: 'NEUTRAL',
      icon: '→',
      statusText: 'approximately unchanged',
      semanticState: 'neutral',
      compactText: `→ ${bps} bps approximately unchanged`,
    };
  }
  if (movement.status === 'CHEAPER_THAN_OPENING') {
    return {
      direction: 'DOWN',
      icon: '↓',
      statusText: 'cheaper',
      semanticState: 'positive',
      compactText: `↓ ${bps} bps cheaper`,
    };
  }
  return {
    direction: 'UP',
    icon: '↑',
    statusText: 'more expensive',
    semanticState: 'warning',
    compactText: `↑ ${bps} bps more expensive`,
  };
}

export function movementCopy(movement: AprMovement): string {
  return aprChangeVisual(movement).compactText;
}

export function movementSentence(movement: AprMovement): string {
  if (movement.status === 'CHEAPER_THAN_OPENING') return 'Borrowing cost has decreased since opening.';
  if (movement.status === 'MORE_EXPENSIVE_THAN_OPENING') return 'Borrowing cost has increased since opening.';
  if (movement.status === 'NEAR_OPENING_RATE') return 'Borrowing cost is approximately unchanged since opening.';
  return 'Opening APR not captured.';
}

export function benchmarkComparisonCopy(currentApr: number | null, benchmarkApr: number | null): string {
  if (benchmarkApr === null || !Number.isFinite(benchmarkApr)) return 'Financing benchmark not saved';
  if (currentApr === null || !Number.isFinite(currentApr)) return 'Current APR unavailable';
  const bps = (currentApr - benchmarkApr) * 10_000;
  const text = movementBpsText(bps);
  if (Math.abs(bps) < OPENING_APR_NEUTRAL_BPS) return `→ ${text} bps approximately unchanged`;
  if (bps < 0) return `↓ ${text} bps cheaper`;
  return `↑ ${text} bps more expensive`;
}
