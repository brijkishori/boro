import { splitRepay } from '@/lib/audit';
import {
  formatBtcPrice,
  formatCryptoBalance,
  formatHealthFactor,
  formatLtv,
  formatTokenAmount,
  tokenNumber,
} from '@/lib/finance/format';
import { isRateStale } from '@/lib/finance/yield';
import { liveRiskParameters, projectAfterTransaction, type PositionView } from '@/lib/finance/projection';
import { chainLabel, isChainId, protocolMarketId, protocolLabel, type Venue } from '@/lib/protocol';

export type ExecutionIntent = 'modify-current' | 'planning-scenario';

export type PositionChangeAction = 'SUPPLY_COLLATERAL' | 'WITHDRAW_COLLATERAL' | 'BORROW' | 'REPAY';

export type FinancialMetric = {
  rawValue?: string;
  value: number;
  sourceDecimals?: number;
  source?: string;
  derived?: boolean;
};

export type PositionSnapshot = {
  collateralAsset: string;
  collateralAmount: number;
  collateralAmountRaw?: string;
  collateralValueUsd?: number;
  debtAsset: string;
  principalDebt?: number;
  accruedInterest?: number;
  totalDebt: number;
  totalDebtRaw?: string;
  ltv?: number;
  healthFactor?: number;
  healthFactorKind?: 'native' | 'app-derived';
  liquidationPrice?: number;
  liquidationCushionPercent?: number;
  borrowApr?: number;
};

export type RiskDirection = 'decreases' | 'preserves' | 'increases';

export type ReviewStepKind = 'reset' | 'approve' | 'enter' | 'action';

export type ReviewStep = {
  index: number;
  of: number;
  kind: ReviewStepKind;
  label: string;
};

export type RepayAccounting = {
  repayAmount: number;
  repayAmountRaw: string;
  estimatedInterestPaid: number;
  estimatedInterestPaidRaw: string;
  estimatedPrincipalReduction: number;
  estimatedPrincipalReductionRaw: string;
  estimatedPrincipalRemaining: number;
  estimatedPrincipalRemainingRaw: string;
  estimatedTotalDebtRemaining: number;
  estimatedTotalDebtRemainingRaw: string;
  maxRepay: boolean;
  protocolSafeFullRepay: boolean;
};

export type ProposedPositionChange = {
  action: PositionChangeAction;
  amount: number;
  amountRaw: string;
  asset: string;
  protocol: string;
  protocolId: Venue['protocol'];
  chainId: number;
  marketId: string;
  collateralAsset: string;
  debtAsset: string;
  current: PositionSnapshot;
  projected: PositionSnapshot;
  repayAccounting?: RepayAccounting;
  riskDirection: RiskDirection;
  riskNote: string;
  warnings: string[];
  blockers: string[];
  steps: ReviewStep[];
  estimatedNetworkFeeUsd?: number;
  networkLabel: string;
  confirmLabel: string;
  actionTitle: string;
  interestNote?: string;
  fetchedAt?: number;
  isStale: boolean;
  approvalRequired: boolean;
  walletTxCount: number;
  executionIntent?: ExecutionIntent;
  maxWithdraw?: boolean;
  protocolSafeFullWithdraw?: boolean;
};

export type PositionChangeInput = {
  action: PositionChangeAction;
  venue: Pick<Venue, 'protocol' | 'chainId' | 'assetSymbol' | 'loanSymbol' | 'assetDecimals' | 'loanDecimals' | 'borrowApr' | 'maxLtv' | 'liquidityUsd' | 'collateralRisk' | 'proposedCollateralRisk' | 'morpho' | 'compound' | 'aave' | 'moonwell' | 'freshness' | 'id'>;
  amount: bigint;
  currentCollateral: bigint;
  currentDebt: bigint;
  spendableBalance: bigint;
  priceUsd: number;
  wrongNetwork?: boolean;
  approvalNeeded?: boolean;
  resetNeeded?: boolean;
  needsEnterMarket?: boolean;
  maxRepay?: boolean;
  protocolSafeFullRepay?: boolean;
  maxWithdraw?: boolean;
  protocolSafeFullWithdraw?: boolean;
  borrowRoom?: bigint;
  withdrawMax?: bigint;
  minBorrow?: bigint;
  principalRemaining?: bigint;
  interestRemaining?: bigint;
  collateralAvailable?: boolean;
  estimatedNetworkFeeUsd?: number;
  fetchedAt?: number;
  executionIntent?: ExecutionIntent;
};

const CONFIRM_LABEL: Record<PositionChangeAction, string> = {
  SUPPLY_COLLATERAL: 'Confirm supply',
  WITHDRAW_COLLATERAL: 'Confirm withdrawal',
  BORROW: 'Confirm borrow',
  REPAY: 'Confirm repayment',
};

const ACTION_VERB: Record<PositionChangeAction, string> = {
  SUPPLY_COLLATERAL: 'Supply',
  WITHDRAW_COLLATERAL: 'Withdraw',
  BORROW: 'Borrow',
  REPAY: 'Repay',
};

const MATERIAL_LTV = 0.05;
const MATERIAL_CUSHION = 0.1;
const MATERIAL_HF = 0.5;
const MATERIAL_LIQ_REL = 0.15;
const PRESERVE_LTV = 0.0005;
const PRESERVE_HF = 0.01;
const PRESERVE_CUSHION = 0.0025;
const PRESERVE_LIQ_REL = 0.005;

function snapshotFromView(
  view: PositionView,
  input: PositionChangeInput,
  collateralRaw: bigint,
  debtRaw: bigint,
  principal?: bigint,
  interest?: bigint,
): PositionSnapshot {
  const loanDecimals = input.venue.loanDecimals;
  return {
    collateralAsset: input.venue.assetSymbol,
    collateralAmount: view.collateralAmount,
    collateralAmountRaw: collateralRaw.toString(),
    collateralValueUsd: view.collateralUsd ?? undefined,
    debtAsset: input.venue.loanSymbol,
    principalDebt: principal !== undefined ? tokenNumber(principal, loanDecimals) : undefined,
    accruedInterest: interest !== undefined ? tokenNumber(interest, loanDecimals) : undefined,
    totalDebt: view.debtUsd,
    totalDebtRaw: debtRaw.toString(),
    ltv: view.ltv ?? undefined,
    healthFactor: view.healthFactor ?? undefined,
    healthFactorKind: view.healthFactorKind ?? undefined,
    liquidationPrice: view.liquidationPrice ?? undefined,
    liquidationCushionPercent: view.distanceToLiquidation ?? undefined,
    borrowApr: input.venue.borrowApr,
  };
}

export function liquidationBound(
  venue: Pick<Venue, 'protocol' | 'maxLtv' | 'collateralRisk' | 'proposedCollateralRisk'>,
): number | undefined {
  const risk = liveRiskParameters(venue);
  if (venue.protocol === 'morpho') return risk.liquidationLtv ?? venue.maxLtv;
  return risk.liquidationThreshold ?? risk.liquidationLtv ?? risk.maxLtv ?? venue.maxLtv;
}

export function riskNoteFromMetrics(
  action: PositionChangeAction,
  current: PositionSnapshot,
  projected: PositionSnapshot,
  direction: RiskDirection,
): string {
  if (current.totalDebt > 0 && projected.totalDebt <= 0) return 'Borrowing risk removed';
  if (current.totalDebt <= 0 && projected.totalDebt <= 0 && action === 'WITHDRAW_COLLATERAL' && projected.collateralAmount <= 0) {
    return 'No borrowing risk — position closes';
  }
  if (current.totalDebt <= 0 && projected.totalDebt <= 0) return 'No borrowing risk';
  if (direction === 'decreases') return 'Risk decreases';
  if (direction === 'increases') return 'Risk increases';
  return 'Risk is approximately unchanged';
}

export function riskDirectionFromMetrics(current: PositionSnapshot, projected: PositionSnapshot): RiskDirection {
  if (current.totalDebt <= 0 && projected.totalDebt <= 0) return 'preserves';
  if (current.totalDebt > 0 && projected.totalDebt <= 0) return 'decreases';
  if (current.totalDebt <= 0 && projected.totalDebt > 0) return 'increases';

  const scores: number[] = [];
  if (current.ltv !== undefined && projected.ltv !== undefined) {
    const delta = projected.ltv - current.ltv;
    if (Math.abs(delta) > PRESERVE_LTV) scores.push(delta > 0 ? 1 : -1);
  }
  if (current.healthFactor !== undefined && projected.healthFactor !== undefined) {
    const delta = current.healthFactor - projected.healthFactor;
    if (Math.abs(delta) > PRESERVE_HF) scores.push(delta > 0 ? 1 : -1);
  }
  if (current.liquidationPrice !== undefined && projected.liquidationPrice !== undefined && current.liquidationPrice > 0) {
    const rel = (projected.liquidationPrice - current.liquidationPrice) / current.liquidationPrice;
    if (Math.abs(rel) > PRESERVE_LIQ_REL) scores.push(rel > 0 ? 1 : -1);
  }
  if (current.liquidationCushionPercent !== undefined && projected.liquidationCushionPercent !== undefined) {
    const delta = current.liquidationCushionPercent - projected.liquidationCushionPercent;
    if (Math.abs(delta) > PRESERVE_CUSHION) scores.push(delta > 0 ? 1 : -1);
  }
  if (scores.length === 0) return 'preserves';
  const sum = scores.reduce((left, right) => left + right, 0);
  if (sum === 0) return 'preserves';
  return sum > 0 ? 'increases' : 'decreases';
}

function riskWarnings(current: PositionSnapshot, projected: PositionSnapshot): string[] {
  const warnings: string[] = [];
  if (current.ltv !== undefined && projected.ltv !== undefined && projected.ltv - current.ltv >= MATERIAL_LTV) {
    warnings.push(`Projected LTV increases from ${formatLtv(current.ltv)} to ${formatLtv(projected.ltv)}.`);
  }
  if (
    current.liquidationPrice !== undefined
    && projected.liquidationPrice !== undefined
    && current.liquidationPrice > 0
    && (projected.liquidationPrice - current.liquidationPrice) / current.liquidationPrice >= MATERIAL_LIQ_REL
  ) {
    warnings.push(`BTC liquidation price rises from ${formatBtcPrice(current.liquidationPrice)} to ${formatBtcPrice(projected.liquidationPrice)}.`);
  }
  if (
    current.liquidationCushionPercent !== undefined
    && projected.liquidationCushionPercent !== undefined
    && current.liquidationCushionPercent - projected.liquidationCushionPercent >= MATERIAL_CUSHION
  ) {
    warnings.push(`BTC liquidation cushion falls from ${formatLtv(current.liquidationCushionPercent)} to ${formatLtv(projected.liquidationCushionPercent)}.`);
  }
  if (
    current.healthFactor !== undefined
    && projected.healthFactor !== undefined
    && (current.healthFactor - projected.healthFactor >= MATERIAL_HF || projected.healthFactor < 1.25)
    && projected.healthFactor < current.healthFactor
  ) {
    const label = projected.healthFactorKind === 'app-derived' ? 'App-derived Health Factor' : 'Health Factor';
    warnings.push(`${label} moves from ${formatHealthFactor(current.healthFactor)} to ${formatHealthFactor(projected.healthFactor)}.`);
  }
  return warnings;
}

function appliedRepay(input: PositionChangeInput): bigint {
  if (input.action !== 'REPAY') return 0n;
  if (input.maxRepay && input.protocolSafeFullRepay) return input.currentDebt;
  if (input.amount > input.currentDebt) return input.currentDebt;
  return input.amount > 0n ? input.amount : 0n;
}

function projectedCollateralRaw(input: PositionChangeInput): bigint {
  if (input.action === 'SUPPLY_COLLATERAL') return input.currentCollateral + input.amount;
  if (input.action === 'WITHDRAW_COLLATERAL') {
    if (input.maxWithdraw && input.protocolSafeFullWithdraw) return 0n;
    return input.amount >= input.currentCollateral ? 0n : input.currentCollateral - input.amount;
  }
  return input.currentCollateral;
}

function actionTitleFor(input: PositionChangeInput, decimals: number, asset: string): string {
  if (input.action === 'REPAY' && input.maxRepay && input.protocolSafeFullRepay) return 'Full repayment';
  if (input.action === 'REPAY' && input.maxRepay) return 'Full repayment (wallet-limited)';
  if (input.action === 'WITHDRAW_COLLATERAL' && input.maxWithdraw && input.protocolSafeFullWithdraw) return 'Full supplied balance';
  if (input.action === 'WITHDRAW_COLLATERAL' && input.maxWithdraw) return 'Full supplied balance';
  return `${ACTION_VERB[input.action]} ${formatCryptoBalance(input.amount, decimals, asset, true)}`;
}

function projectedDebtRaw(input: PositionChangeInput): bigint {
  if (input.action === 'BORROW') return input.currentDebt + input.amount;
  if (input.action === 'REPAY') {
    const repaid = appliedRepay(input);
    return input.currentDebt > repaid ? input.currentDebt - repaid : 0n;
  }
  return input.currentDebt;
}

function buildSteps(input: PositionChangeInput): ReviewStep[] {
  const kinds: Array<{ kind: ReviewStepKind; label: string }> = [];
  if (input.resetNeeded) kinds.push({ kind: 'reset', label: 'Reset approval' });
  if (input.approvalNeeded || input.resetNeeded) {
    kinds.push({
      kind: 'approve',
      label: input.action === 'REPAY' ? `Approve ${input.venue.loanSymbol}` : `Approve ${input.venue.assetSymbol}`,
    });
  }
  if (input.needsEnterMarket && input.action === 'BORROW') {
    kinds.push({ kind: 'enter', label: 'Enable collateral' });
  }
  kinds.push({ kind: 'action', label: ACTION_VERB[input.action] });
  return kinds.map((step, index) => ({
    index: index + 1,
    of: kinds.length,
    kind: step.kind,
    label: `Step ${index + 1} of ${kinds.length}: ${step.label}`,
  }));
}

function blockersFor(input: PositionChangeInput, projected: PositionView, nextDebt: bigint, nextCollateral: bigint): string[] {
  const blockers: string[] = [];
  if (input.wrongNetwork) blockers.push('Wallet is on the wrong network for this market.');
  if (input.collateralAvailable === false && (input.action === 'SUPPLY_COLLATERAL' || input.action === 'WITHDRAW_COLLATERAL')) {
    blockers.push('This collateral is not available for the selected market.');
  }
  const network = isChainId(input.venue.chainId) ? chainLabel(input.venue.chainId) : `Chain ${input.venue.chainId}`;
  if (input.action === 'SUPPLY_COLLATERAL' && input.amount > input.spendableBalance) {
    const required = formatTokenAmount(input.amount, input.venue.assetDecimals, { symbol: input.venue.assetSymbol });
    const available = formatTokenAmount(input.spendableBalance, input.venue.assetDecimals, { symbol: input.venue.assetSymbol });
    const short = formatTokenAmount(input.amount - input.spendableBalance, input.venue.assetDecimals, { symbol: input.venue.assetSymbol });
    blockers.push(`Required: ${required}. Available on ${network}: ${available}. Shortfall: ${short}.`);
  }
  if (input.action === 'REPAY' && input.amount > input.spendableBalance) {
    const required = formatTokenAmount(input.amount, input.venue.loanDecimals, { symbol: input.venue.loanSymbol });
    const available = formatTokenAmount(input.spendableBalance, input.venue.loanDecimals, { symbol: input.venue.loanSymbol });
    const short = formatTokenAmount(input.amount - input.spendableBalance, input.venue.loanDecimals, { symbol: input.venue.loanSymbol });
    blockers.push(`Required: ${required}. Available on ${network}: ${available}. Shortfall: ${short}.`);
  }
  if (input.action === 'BORROW') {
    if (input.borrowRoom !== undefined && input.amount > input.borrowRoom) {
      blockers.push('This borrow exceeds the safe remaining borrow room.');
    }
    if (input.minBorrow !== undefined && input.minBorrow > 0n && input.amount < input.minBorrow) {
      blockers.push(`Borrow is below the protocol minimum of ${formatTokenAmount(input.minBorrow, input.venue.loanDecimals, { symbol: input.venue.loanSymbol })}.`);
    }
    const borrowUsd = tokenNumber(input.amount, input.venue.loanDecimals);
    if (borrowUsd > input.venue.liquidityUsd) {
      blockers.push('The selected market does not have enough liquidity for this borrow.');
    }
  }
  if (input.action === 'WITHDRAW_COLLATERAL') {
    if (input.withdrawMax !== undefined && input.amount > input.withdrawMax) {
      blockers.push('This withdrawal would leave the position above the safe collateral limit.');
    }
    if (input.amount > input.currentCollateral) {
      blockers.push('Withdrawal exceeds supplied collateral.');
    }
  }
  const bound = liquidationBound(input.venue);
  if (projected.ltv !== null && bound !== undefined && projected.ltv >= bound - 1e-12) {
    blockers.push('Projected position would be at or above the liquidation limit.');
  }
  if (projected.healthFactor !== null && projected.healthFactor < 1) {
    blockers.push('Projected position would be liquidatable.');
  }
  if (nextDebt > 0n && nextCollateral <= 0n) {
    blockers.push('Projected position would have debt with no collateral.');
  }
  return blockers;
}

export function nextExecutionStep(change: ProposedPositionChange): ReviewStepKind {
  return change.steps[0]?.kind ?? 'action';
}

export function confirmationBlocked(change: ProposedPositionChange): boolean {
  return change.blockers.length > 0;
}

export function canRequestWallet(change: ProposedPositionChange): boolean {
  return !confirmationBlocked(change);
}

export function requestWalletIfAllowed(change: ProposedPositionChange, send: () => void): boolean {
  if (!canRequestWallet(change)) return false;
  send();
  return true;
}

export function serializePositionSnapshot(snapshot: PositionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function buildProposedPositionChange(input: PositionChangeInput): ProposedPositionChange {
  const asset = input.action === 'SUPPLY_COLLATERAL' || input.action === 'WITHDRAW_COLLATERAL'
    ? input.venue.assetSymbol
    : input.venue.loanSymbol;
  const decimals = asset === input.venue.assetSymbol ? input.venue.assetDecimals : input.venue.loanDecimals;
  const repayRaw = appliedRepay(input);
  const nextCollateral = projectedCollateralRaw(input);
  const nextDebt = projectedDebtRaw(input);
  const currentCollateralAmount = tokenNumber(input.currentCollateral, input.venue.assetDecimals);
  const currentDebtUsd = tokenNumber(input.currentDebt, input.venue.loanDecimals);
  const { current, projected } = projectAfterTransaction({
    venue: input.venue,
    priceUsd: input.priceUsd,
    currentCollateralAmount,
    currentDebtUsd,
    supplyAmount: input.action === 'SUPPLY_COLLATERAL' ? tokenNumber(input.amount, input.venue.assetDecimals) : 0,
    withdrawAmount: input.action === 'WITHDRAW_COLLATERAL' ? tokenNumber(input.amount, input.venue.assetDecimals) : 0,
    borrowUsd: input.action === 'BORROW' ? tokenNumber(input.amount, input.venue.loanDecimals) : 0,
    repayUsd: input.action === 'REPAY' ? tokenNumber(repayRaw, input.venue.loanDecimals) : 0,
  });

  const principal = input.principalRemaining;
  const interest = input.interestRemaining;
  const currentSnapshot = snapshotFromView(current, input, input.currentCollateral, input.currentDebt, principal, interest);
  let projectedPrincipal = principal;
  let projectedInterest = interest;
  let repayAccounting: RepayAccounting | undefined;
  if (input.action === 'REPAY') {
    const split = splitRepay(principal ?? input.currentDebt, input.currentDebt, repayRaw);
    projectedPrincipal = split.principalRemaining;
    projectedInterest = split.interestRemaining;
    repayAccounting = {
      repayAmount: tokenNumber(repayRaw, input.venue.loanDecimals),
      repayAmountRaw: repayRaw.toString(),
      estimatedInterestPaid: tokenNumber(split.interestPaid, input.venue.loanDecimals),
      estimatedInterestPaidRaw: split.interestPaid.toString(),
      estimatedPrincipalReduction: tokenNumber(split.principalPaid, input.venue.loanDecimals),
      estimatedPrincipalReductionRaw: split.principalPaid.toString(),
      estimatedPrincipalRemaining: tokenNumber(split.principalRemaining, input.venue.loanDecimals),
      estimatedPrincipalRemainingRaw: split.principalRemaining.toString(),
      estimatedTotalDebtRemaining: tokenNumber(nextDebt, input.venue.loanDecimals),
      estimatedTotalDebtRemainingRaw: nextDebt.toString(),
      maxRepay: Boolean(input.maxRepay),
      protocolSafeFullRepay: Boolean(input.protocolSafeFullRepay),
    };
  }

  const projectedSnapshot = snapshotFromView(projected, input, nextCollateral, nextDebt, projectedPrincipal, projectedInterest);
  const direction = riskDirectionFromMetrics(currentSnapshot, projectedSnapshot);
  const network = isChainId(input.venue.chainId) ? chainLabel(input.venue.chainId) : `Chain ${input.venue.chainId}`;
  const fetchedAt = input.fetchedAt ?? input.venue.freshness?.fetchedAt;
  const steps = buildSteps(input);

  return {
    action: input.action,
    amount: tokenNumber(input.amount, decimals),
    amountRaw: input.amount.toString(),
    asset,
    protocol: protocolLabel(input.venue.protocol),
    protocolId: input.venue.protocol,
    chainId: input.venue.chainId,
    marketId: protocolMarketId(input.venue as Venue),
    collateralAsset: input.venue.assetSymbol,
    debtAsset: input.venue.loanSymbol,
    current: currentSnapshot,
    projected: projectedSnapshot,
    repayAccounting,
    riskDirection: direction,
    riskNote: riskNoteFromMetrics(input.action, currentSnapshot, projectedSnapshot, direction),
    warnings: direction === 'increases' ? riskWarnings(currentSnapshot, projectedSnapshot) : [],
    blockers: blockersFor(input, projected, nextDebt, nextCollateral),
    steps,
    estimatedNetworkFeeUsd: input.estimatedNetworkFeeUsd,
    networkLabel: network,
    confirmLabel: CONFIRM_LABEL[input.action],
    actionTitle: actionTitleFor(input, decimals, asset),
    interestNote: input.action === 'REPAY'
      ? 'Final amounts may differ slightly because interest accrues continuously.'
      : undefined,
    fetchedAt,
    isStale: isRateStale(fetchedAt),
    approvalRequired: steps.some((step) => step.kind === 'approve' || step.kind === 'reset'),
    walletTxCount: steps.length,
    executionIntent: input.executionIntent,
    maxWithdraw: input.maxWithdraw,
    protocolSafeFullWithdraw: input.protocolSafeFullWithdraw,
  };
}
