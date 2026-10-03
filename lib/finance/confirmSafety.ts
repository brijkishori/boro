import { liquidationBound, type PositionChangeAction, type ProposedPositionChange } from '@/lib/finance/positionChange';
import { formatBtcPrice, formatLtv, formatRate } from '@/lib/finance/format';
import { isRateStale } from '@/lib/finance/yield';
import { canonicalMarketKey, protocolMarketId, type Venue } from '@/lib/protocol';

/**
 * Confirmation-time drift policy.
 * Identity / liquidation-parameter / position raw-balance changes always re-review.
 * Continuous quotes use relative or absolute tolerances below.
 */
export const CONFIRM_DRIFT = {
  /** Absolute APR decimal. 5 bps. */
  RATE_ABS: 0.0005,
  /** Relative oracle / collateral price. 0.25%. */
  ORACLE_PRICE_REL: 0.0025,
  /** Relative available liquidity. 2%. */
  LIQUIDITY_REL: 0.02,
  /** Absolute LTV ratio. 25 bps. */
  LTV_ABS: 0.0025,
  /** Relative liquidation BTC price. 0.25%. */
  LIQ_PRICE_REL: 0.0025,
  /** Absolute liquidation cushion ratio. 25 bps. */
  CUSHION_ABS: 0.0025,
  /** Confirm-time max age for required market/position sources. */
  MAX_AGE_MS: 45_000,
  FETCH_TIMEOUT_MS: 12_000,
} as const;

export const CONFIRM_FAIL_MESSAGE = 'Unable to verify fresh market data. Refresh and try again.';
export const CONFIRM_DRIFT_MESSAGE = 'Market or position data changed since your review. Please review the updated values before confirming.';

export type DriftCategory =
  | 'RATE_DRIFT'
  | 'ORACLE_PRICE_DRIFT'
  | 'POSITION_DRIFT'
  | 'LIQUIDITY_DRIFT'
  | 'RISK_METRIC_DRIFT'
  | 'MARKET_CONFIGURATION_DRIFT';

export type DriftChange = {
  category: DriftCategory;
  field: string;
  from: string;
  to: string;
  alwaysRereview: boolean;
};

export type ConfirmSnapshot = {
  action: PositionChangeAction;
  chainId: number;
  marketId: string;
  venueId: string;
  protocol: Venue['protocol'];
  canonicalKey: string;
  collateralAsset: string;
  borrowAsset: string;
  collateralAddress: string;
  debtAddress: string;
  plannedAmount: string;
  oraclePrice: number;
  borrowApr: number;
  sourceRate?: number;
  lltv?: number;
  liquidationThreshold?: number;
  liquidityUsd: number;
  currentCollateral: string;
  currentDebt: string;
  walletBalance: string;
  projectedLtv?: number;
  projectedHealthFactor?: number;
  projectedLiquidationPrice?: number;
  projectedCushion?: number;
  fetchedAt: number;
  blockNumber?: string;
  fingerprint: string;
};

export type ConfirmDecision =
  | { status: 'proceed'; fresh: ConfirmSnapshot; invokeWallet: true }
  | { status: 'rereview'; fresh: ConfirmSnapshot; changes: DriftChange[]; message: string; invokeWallet: false }
  | { status: 'failed'; message: string; invokeWallet: false }
  | { status: 'busy'; invokeWallet: false };

export function confirmFingerprint(input: Omit<ConfirmSnapshot, 'fingerprint'>): string {
  return [
    input.chainId,
    input.marketId,
    input.collateralAddress.toLowerCase(),
    input.debtAddress.toLowerCase(),
    input.plannedAmount,
    input.oraclePrice,
    input.borrowApr,
    input.lltv ?? '',
    input.liquidationThreshold ?? '',
    input.currentCollateral,
    input.currentDebt,
    input.projectedLtv ?? '',
    input.projectedLiquidationPrice ?? '',
    input.projectedCushion ?? '',
    input.blockNumber ?? '',
  ].join('|');
}

export function buildConfirmSnapshot(input: {
  action: PositionChangeAction;
  venue: Venue;
  change: ProposedPositionChange;
  currentCollateral: bigint;
  currentDebt: bigint;
  walletBalance: bigint;
  plannedAmount: bigint;
  fetchedAt: number;
  blockNumber?: bigint | number | string;
}): ConfirmSnapshot {
  const bound = liquidationBound(input.venue);
  const risk = input.venue.collateralRisk;
  const base: Omit<ConfirmSnapshot, 'fingerprint'> = {
    action: input.action,
    chainId: input.venue.chainId,
    marketId: protocolMarketId(input.venue),
    venueId: input.venue.id,
    protocol: input.venue.protocol,
    canonicalKey: canonicalMarketKey(input.venue),
    collateralAsset: input.venue.assetSymbol,
    borrowAsset: input.venue.loanSymbol,
    collateralAddress: input.venue.assetAddress,
    debtAddress: input.venue.loanAddress,
    plannedAmount: input.plannedAmount.toString(),
    oraclePrice: input.venue.priceUsd,
    borrowApr: input.venue.borrowApr,
    sourceRate: input.venue.borrowRate?.sourceValue,
    lltv: risk?.liquidationLtv ?? (input.venue.protocol === 'morpho' ? bound : undefined),
    liquidationThreshold: risk?.liquidationThreshold ?? (input.venue.protocol !== 'morpho' ? bound : undefined),
    liquidityUsd: input.venue.liquidity?.availableToBorrow ?? input.venue.liquidityUsd,
    currentCollateral: input.currentCollateral.toString(),
    currentDebt: input.currentDebt.toString(),
    walletBalance: input.walletBalance.toString(),
    projectedLtv: input.change.projected.ltv,
    projectedHealthFactor: input.change.projected.healthFactor,
    projectedLiquidationPrice: input.change.projected.liquidationPrice,
    projectedCushion: input.change.projected.liquidationCushionPercent,
    fetchedAt: input.fetchedAt,
    blockNumber: input.blockNumber === undefined ? undefined : String(input.blockNumber),
  };
  return { ...base, fingerprint: confirmFingerprint(base) };
}

function relChanged(left: number | undefined, right: number | undefined, rel: number): boolean {
  if (left === undefined || right === undefined || !Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (left === 0 && right === 0) return false;
  const denom = Math.max(Math.abs(left), Math.abs(right), 1e-12);
  return Math.abs(left - right) / denom >= rel;
}

function absChanged(left: number | undefined, right: number | undefined, abs: number): boolean {
  if (left === undefined || right === undefined || !Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) >= abs;
}

function row(category: DriftCategory, field: string, from: string, to: string, alwaysRereview = false): DriftChange {
  return { category, field, from, to, alwaysRereview };
}

/**
 * Interest-bearing debt grows continuously even when the user has not changed the
 * position. Requiring byte-for-byte debt equality makes confirm-time validation
 * impossible on protocols such as Morpho because the debt can advance every block.
 *
 * For REPAY only, allow a very small monotonic increase that is consistent with
 * passive interest accrual. Any debt decrease, collateral change, or materially
 * larger debt increase still forces a new review.
 */
function expectedRepayDebtAccrual(reviewed: ConfirmSnapshot, fresh: ConfirmSnapshot): boolean {
  if (reviewed.action !== 'REPAY' || fresh.action !== 'REPAY') return false;

  const before = BigInt(reviewed.currentDebt);
  const after = BigInt(fresh.currentDebt);
  if (after < before) return false;
  if (after === before) return true;
  if (before <= 0n) return false;

  const elapsedMs = Math.max(0, fresh.fetchedAt - reviewed.fetchedAt);
  const apr = Math.max(reviewed.borrowApr, fresh.borrowApr, 0);
  if (!Number.isFinite(apr)) return false;

  // Add one minute of timing/block slack because the reviewed debt and the rate
  // snapshot are not necessarily sampled in the same RPC round. The multiplier
  // absorbs normal index/share rounding. The fixed floor is 0.005 USDC (6 decimals).
  // This is intentionally tiny: a real borrow or other material position change
  // remains far outside the allowance and still forces re-review.
  const accrualWindowMs = BigInt(Math.ceil(elapsedMs + 60_000));
  const aprScale = 1_000_000_000n;
  const aprScaled = BigInt(Math.ceil(apr * Number(aprScale)));
  const yearMs = 365n * 24n * 60n * 60n * 1000n;
  const expectedUnits = (before * aprScaled * accrualWindowMs) / (aprScale * yearMs);
  const allowanceUnits = expectedUnits * 2n > 5_000n ? expectedUnits * 2n : 5_000n;
  return after - before <= allowanceUnits;
}

export function compareConfirmSnapshots(reviewed: ConfirmSnapshot, fresh: ConfirmSnapshot): DriftChange[] {
  const changes: DriftChange[] = [];
  if (
    reviewed.canonicalKey !== fresh.canonicalKey
    || reviewed.marketId !== fresh.marketId
    || reviewed.chainId !== fresh.chainId
    || reviewed.collateralAddress.toLowerCase() !== fresh.collateralAddress.toLowerCase()
    || reviewed.debtAddress.toLowerCase() !== fresh.debtAddress.toLowerCase()
  ) {
    changes.push(row('MARKET_CONFIGURATION_DRIFT', 'Market', reviewed.marketId, fresh.marketId, true));
  }
  if (reviewed.lltv !== fresh.lltv || reviewed.liquidationThreshold !== fresh.liquidationThreshold) {
    const from = String(reviewed.lltv ?? reviewed.liquidationThreshold ?? '—');
    const to = String(fresh.lltv ?? fresh.liquidationThreshold ?? '—');
    changes.push(row('MARKET_CONFIGURATION_DRIFT', 'Liquidation parameter', from, to, true));
  }
  const collateralChanged = reviewed.currentCollateral !== fresh.currentCollateral;
  const debtChanged = reviewed.currentDebt !== fresh.currentDebt;
  const benignRepayAccrual = debtChanged && expectedRepayDebtAccrual(reviewed, fresh);
  if (collateralChanged || (debtChanged && !benignRepayAccrual)) {
    changes.push(row(
      'POSITION_DRIFT',
      'On-chain position',
      `${reviewed.currentCollateral} / ${reviewed.currentDebt}`,
      `${fresh.currentCollateral} / ${fresh.currentDebt}`,
      true,
    ));
  }
  if (absChanged(reviewed.borrowApr, fresh.borrowApr, CONFIRM_DRIFT.RATE_ABS)) {
    changes.push(row('RATE_DRIFT', 'Borrow APR', formatRate(reviewed.borrowApr), formatRate(fresh.borrowApr)));
  }
  if (relChanged(reviewed.oraclePrice, fresh.oraclePrice, CONFIRM_DRIFT.ORACLE_PRICE_REL)) {
    changes.push(row('ORACLE_PRICE_DRIFT', 'BTC oracle', formatBtcPrice(reviewed.oraclePrice), formatBtcPrice(fresh.oraclePrice)));
  }
  const plannedUsd = Number(fresh.plannedAmount) / (fresh.action === 'BORROW' || fresh.action === 'REPAY' ? 1e6 : 1e8);
  if (fresh.action === 'BORROW' && Number.isFinite(plannedUsd) && plannedUsd > fresh.liquidityUsd) {
    changes.push(row('LIQUIDITY_DRIFT', 'Available liquidity', String(reviewed.liquidityUsd), String(fresh.liquidityUsd), true));
  } else if (relChanged(reviewed.liquidityUsd, fresh.liquidityUsd, CONFIRM_DRIFT.LIQUIDITY_REL)) {
    changes.push(row('LIQUIDITY_DRIFT', 'Available liquidity', String(reviewed.liquidityUsd), String(fresh.liquidityUsd)));
  }
  if (absChanged(reviewed.projectedLtv, fresh.projectedLtv, CONFIRM_DRIFT.LTV_ABS)) {
    changes.push(row(
      'RISK_METRIC_DRIFT',
      'Projected LTV',
      reviewed.projectedLtv === undefined ? '—' : formatLtv(reviewed.projectedLtv),
      fresh.projectedLtv === undefined ? '—' : formatLtv(fresh.projectedLtv),
    ));
  }
  if (relChanged(reviewed.projectedLiquidationPrice, fresh.projectedLiquidationPrice, CONFIRM_DRIFT.LIQ_PRICE_REL)) {
    changes.push(row(
      'RISK_METRIC_DRIFT',
      'Projected liquidation',
      reviewed.projectedLiquidationPrice === undefined ? '—' : formatBtcPrice(reviewed.projectedLiquidationPrice),
      fresh.projectedLiquidationPrice === undefined ? '—' : formatBtcPrice(fresh.projectedLiquidationPrice),
    ));
  }
  if (absChanged(reviewed.projectedCushion, fresh.projectedCushion, CONFIRM_DRIFT.CUSHION_ABS)) {
    changes.push(row(
      'RISK_METRIC_DRIFT',
      'Projected BTC cushion',
      reviewed.projectedCushion === undefined ? '—' : formatLtv(reviewed.projectedCushion),
      fresh.projectedCushion === undefined ? '—' : formatLtv(fresh.projectedCushion),
    ));
  }
  const reviewedWallet = BigInt(reviewed.walletBalance);
  const freshWallet = BigInt(fresh.walletBalance);
  const planned = BigInt(fresh.plannedAmount);
  if (
    (reviewed.action === 'SUPPLY_COLLATERAL' || reviewed.action === 'REPAY')
    && planned > freshWallet
    && planned > 0n
  ) {
    changes.push(row('POSITION_DRIFT', 'Wallet balance', reviewed.walletBalance, fresh.walletBalance, true));
  } else if (reviewedWallet !== freshWallet && (reviewed.action === 'SUPPLY_COLLATERAL' || reviewed.action === 'REPAY')) {
    const denom = reviewedWallet > freshWallet ? reviewedWallet : freshWallet;
    if (denom > 0n && (reviewedWallet > freshWallet ? reviewedWallet - freshWallet : freshWallet - reviewedWallet) * 100n / denom >= 1n) {
      changes.push(row('POSITION_DRIFT', 'Wallet balance', reviewed.walletBalance, fresh.walletBalance));
    }
  }
  return changes;
}

export function confirmSourceStale(fetchedAt: number | undefined, now = Date.now(), maxAgeMs = CONFIRM_DRIFT.MAX_AGE_MS): boolean {
  return isRateStale(fetchedAt, now, maxAgeMs);
}

export function decideConfirmation(reviewed: ConfirmSnapshot, fresh: ConfirmSnapshot | null, opts?: {
  fetchFailed?: boolean;
  now?: number;
}): Exclude<ConfirmDecision, { status: 'busy' }> {
  if (opts?.fetchFailed || !fresh) {
    return { status: 'failed', message: CONFIRM_FAIL_MESSAGE, invokeWallet: false };
  }
  if (confirmSourceStale(fresh.fetchedAt, opts?.now)) {
    return { status: 'failed', message: CONFIRM_FAIL_MESSAGE, invokeWallet: false };
  }
  const changes = compareConfirmSnapshots(reviewed, fresh);
  if (changes.length > 0) {
    return { status: 'rereview', fresh, changes, message: CONFIRM_DRIFT_MESSAGE, invokeWallet: false };
  }
  return { status: 'proceed', fresh, invokeWallet: true };
}

export function requestWalletAfterConfirm(decision: ConfirmDecision, send: () => void): boolean {
  if (!decision.invokeWallet) return false;
  send();
  return true;
}

export type ConfirmLock = { busy: boolean };

export async function runConfirmGuard(input: {
  reviewed: ConfirmSnapshot;
  loadFresh: () => Promise<ConfirmSnapshot | null>;
  lock: ConfirmLock;
  now?: number;
}): Promise<ConfirmDecision> {
  if (input.lock.busy) return { status: 'busy', invokeWallet: false };
  input.lock.busy = true;
  try {
    const fresh = await input.loadFresh();
    return decideConfirmation(input.reviewed, fresh, { fetchFailed: fresh === null, now: input.now });
  } catch {
    return { status: 'failed', message: CONFIRM_FAIL_MESSAGE, invokeWallet: false };
  } finally {
    input.lock.busy = false;
  }
}
