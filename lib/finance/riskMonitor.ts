import { benchmarkSpread } from '@/lib/finance/benchmark';
import { aaveHealthFactor, aaveLiquidationPrice, priceAtHealthFactor } from '@/lib/finance/liquidation';
import { distanceToLiquidation, loanToValue } from '@/lib/finance/ltv';
import { RECOMMENDED_ALERT_DEFAULTS, equivalentLtv } from '@/lib/finance/recommendedAlerts';
import { annualInterest, monthlyInterest } from '@/lib/finance/rates';
import { isRateStale } from '@/lib/finance/yield';

export const RISK_MONITOR_DEFAULTS = {
  preferredHealthFactor: RECOMMENDED_ALERT_DEFAULTS.preferredHealthFactor,
  healthFactor: { ...RECOMMENDED_ALERT_DEFAULTS.healthFactor },
  utilization: {
    watch: RECOMMENDED_ALERT_DEFAULTS.utilization.watch,
    high: RECOMMENDED_ALERT_DEFAULTS.utilization.high,
  },
  rateBufferBps: { ...RECOMMENDED_ALERT_DEFAULTS.rateBufferBps },
  mixedRepayFraction: 0.5,
} as const;

export type RiskSeverity =
  | 'NORMAL'
  | 'WATCH'
  | 'PREPARE'
  | 'ACT'
  | 'URGENT'
  | 'LIQUIDATION_BOUNDARY'
  | 'DATA_WARNING'
  | 'NO_DEBT';

export type RateEconomicStatus = 'FAVORABLE' | 'NEAR_BENCHMARK' | 'ABOVE_BENCHMARK' | 'HIGH_COST' | 'NO_BENCHMARK';
export type MarketStressStatus = 'CALM' | 'WATCH' | 'HIGH' | 'NOT_APPLICABLE';
export type ReadinessStatus = 'READY' | 'PARTIALLY_READY' | 'NOT_READY' | 'DATA_UNKNOWN';
export type ResourceFeasibility = 'AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'NOT_CURRENTLY_AVAILABLE' | 'UNKNOWN';
export type RemedyType = 'REPAY' | 'ADD_COLLATERAL' | 'MIXED';

export type RiskThresholdOverrides = {
  preferredHealthFactor?: number | null;
  watch?: number | null;
  prepare?: number | null;
  act?: number | null;
  urgent?: number | null;
  liquidation?: number | null;
  utilizationWatch?: number | null;
  utilizationHigh?: number | null;
};

export type RiskThresholds = {
  preferredHealthFactor: number;
  watch: number;
  prepare: number;
  act: number;
  urgent: number;
  liquidation: number;
  utilizationWatch: number;
  utilizationHigh: number;
};

export type BorrowerRiskSnapshot = {
  identity: {
    wallet: string;
    protocol: string;
    chainId: number;
    marketId: string;
    collateralAsset: string;
    debtAsset: string;
  };
  position: {
    collateralAmount: number;
    collateralUsd: number | null;
    totalDebt: number;
    principal: number | null;
    accruedInterest: number | null;
    ltv: number | null;
    healthFactor: number | null;
    healthFactorKind: 'native' | 'app-derived' | null;
    liquidationThreshold: number;
    liquidationPrice: number | null;
    liquidationCushionPercent: number | null;
  };
  market: {
    currentBorrowApr: number | null;
    sourceRate: number | null;
    rateType: string | null;
    avg1h: number | null;
    avg6h: number | null;
    avg24h: number | null;
    avg7d: number | null;
    avg30d: number | null;
    utilization: number | null;
    availableLiquidity: number | null;
    oraclePrice: number | null;
    fetchedAt: number | null;
    source: string | null;
    isStale: boolean;
  };
  resources: {
    walletDebtAssetBalance: number | null;
    walletCollateralBalance: number | null;
    nativeGasBalance: number | null;
    gasRequired: number | null;
    elsewhereDebtAsset: number | null;
    elsewhereCollateral: number | null;
  };
  benchmark: {
    benchmarkApr: number | null;
    benchmarkType: string | null;
  };
};

export type LadderStep = {
  severity: Exclude<RiskSeverity, 'DATA_WARNING' | 'NO_DEBT' | 'NORMAL'>;
  healthFactor: number;
  equivalentLtv: number | null;
  oraclePrice: number | null;
  priceDeclinePercent: number | null;
  priceDeclineUsd: number | null;
  healthFactorDistance: number | null;
};

export type ProjectedRiskPosition = {
  collateralAmount: number;
  debt: number;
  ltv: number | null;
  healthFactor: number | null;
  liquidationPrice: number | null;
  liquidationCushionPercent: number | null;
};

export type ProposedRemedy = {
  type: RemedyType;
  targetHF: number;
  repayAmount?: number;
  collateralAmount?: number;
  projectedPosition: ProjectedRiskPosition;
  calculatedAt: string;
  sourceBlock?: bigint;
  feasibility: ResourceFeasibility;
  label: string;
};

export type RiskMonitorInput = {
  wallet: string;
  protocol: string;
  chainId: number;
  marketId: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: number;
  totalDebt: number;
  principal?: number | null;
  accruedInterest?: number | null;
  healthFactor?: number | null;
  healthFactorKind?: 'native' | 'app-derived' | null;
  liquidationThreshold: number;
  currentBorrowApr?: number | null;
  sourceRate?: number | null;
  rateType?: string | null;
  avg1h?: number | null;
  avg6h?: number | null;
  avg24h?: number | null;
  avg7d?: number | null;
  avg30d?: number | null;
  utilization?: number | null;
  recentUtilization?: number | null;
  availableLiquidity?: number | null;
  oraclePrice?: number | null;
  fetchedAt?: number | null;
  /** On-chain position read time. Falls back to fetchedAt for older callers. */
  positionFetchedAt?: number | null;
  /** Protocol oracle read time. Falls back to fetchedAt for older callers. */
  oracleFetchedAt?: number | null;
  /** Current borrow-rate quote time. Not used to judge position safety. */
  rateFetchedAt?: number | null;
  walletFetchedAt?: number | null;
  collateralWalletFetchedAt?: number | null;
  gasFetchedAt?: number | null;
  source?: string | null;
  positionReadFailed?: boolean;
  walletDebtAssetBalance?: number | null;
  walletCollateralBalance?: number | null;
  nativeGasBalance?: number | null;
  gasRequired?: number | null;
  elsewhereDebtAsset?: number | null;
  elsewhereCollateral?: number | null;
  benchmarkApr?: number | null;
  benchmarkType?: string | null;
  sourceBlock?: bigint;
  now?: number;
  thresholds?: RiskThresholdOverrides;
};

function finiteOr(value: number | null | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveRiskThresholds(overrides?: RiskThresholdOverrides | null): RiskThresholds {
  const defaults = RISK_MONITOR_DEFAULTS;
  const watch = finiteOr(overrides?.watch, defaults.healthFactor.watch);
  const prepare = finiteOr(overrides?.prepare, defaults.healthFactor.prepare);
  const act = finiteOr(overrides?.act, defaults.healthFactor.act);
  const urgent = finiteOr(overrides?.urgent, defaults.healthFactor.urgent);
  const liquidation = finiteOr(overrides?.liquidation, defaults.healthFactor.liquidation);
  const ordered = watch > prepare && prepare > act && act > urgent && urgent > liquidation;
  const preferredCandidate = finiteOr(overrides?.preferredHealthFactor, defaults.preferredHealthFactor);
  return {
    preferredHealthFactor: preferredCandidate > liquidation ? preferredCandidate : defaults.preferredHealthFactor,
    watch: ordered ? watch : defaults.healthFactor.watch,
    prepare: ordered ? prepare : defaults.healthFactor.prepare,
    act: ordered ? act : defaults.healthFactor.act,
    urgent: ordered ? urgent : defaults.healthFactor.urgent,
    liquidation: ordered ? liquidation : defaults.healthFactor.liquidation,
    utilizationWatch: finiteOr(overrides?.utilizationWatch, defaults.utilization.watch),
    utilizationHigh: finiteOr(overrides?.utilizationHigh, defaults.utilization.high),
  };
}

export function positionIsFresh(input: { fetchedAt?: number | null; oraclePrice?: number | null; positionReadFailed?: boolean; now?: number }) {
  if (input.positionReadFailed) return false;
  if (!(typeof input.oraclePrice === 'number' && input.oraclePrice > 0)) return false;
  if (isRateStale(input.fetchedAt ?? undefined, input.now)) return false;
  return true;
}

export type FreshnessDomain = 'fresh' | 'stale' | 'unavailable';

export type DomainFreshness = {
  position: FreshnessDomain;
  oracle: FreshnessDomain;
  borrowRate: FreshnessDomain;
  liquidity: FreshnessDomain;
  utilization: FreshnessDomain;
  walletBalance: FreshnessDomain;
  collateralBalance: FreshnessDomain;
  gasBalance: FreshnessDomain;
  rateHistory: FreshnessDomain;
};

export type OverallDataStatus = 'LIVE' | 'PARTIAL' | 'STALE' | 'ERROR';

function clock(at: number | null | undefined, now: number): FreshnessDomain {
  if (typeof at !== 'number' || !(at > 0)) return 'unavailable';
  return isRateStale(at, now) ? 'stale' : 'fresh';
}

export function assessDomainFreshness(input: RiskMonitorInput, now = input.now ?? Date.now()): DomainFreshness {
  const positionAt = input.positionFetchedAt ?? input.fetchedAt;
  const oracleAt = input.oracleFetchedAt ?? input.fetchedAt;
  const rateAt = input.rateFetchedAt ?? input.fetchedAt;
  const walletAt = input.walletFetchedAt ?? input.fetchedAt;
  const collateralAt = input.collateralWalletFetchedAt ?? input.walletFetchedAt ?? input.fetchedAt;
  const gasAt = input.gasFetchedAt ?? input.fetchedAt;
  const oraclePriceOk = typeof input.oraclePrice === 'number' && input.oraclePrice > 0;
  return {
    position: input.positionReadFailed ? 'unavailable' : clock(positionAt, now),
    oracle: !oraclePriceOk ? 'unavailable' : clock(oracleAt, now),
    borrowRate: typeof input.currentBorrowApr === 'number' && Number.isFinite(input.currentBorrowApr) ? clock(rateAt, now) : 'unavailable',
    liquidity: typeof input.availableLiquidity === 'number' ? clock(rateAt, now) : 'unavailable',
    utilization: typeof input.utilization === 'number' ? clock(rateAt, now) : 'unavailable',
    walletBalance: input.walletDebtAssetBalance === null || input.walletDebtAssetBalance === undefined ? 'unavailable' : clock(walletAt, now),
    collateralBalance: input.walletCollateralBalance === null || input.walletCollateralBalance === undefined ? 'unavailable' : clock(collateralAt, now),
    gasBalance: input.nativeGasBalance === null || input.nativeGasBalance === undefined ? 'unavailable' : clock(gasAt, now),
    rateHistory: input.avg24h === null || input.avg24h === undefined || input.avg7d === null || input.avg7d === undefined ? 'unavailable' : 'fresh',
  };
}

export function overallDataStatus(domains: DomainFreshness): OverallDataStatus {
  if (domains.position === 'unavailable' || domains.oracle === 'unavailable') return 'ERROR';
  if (domains.position === 'stale' || domains.oracle === 'stale') return 'STALE';
  const optional = [
    domains.borrowRate,
    domains.liquidity,
    domains.utilization,
    domains.walletBalance,
    domains.collateralBalance,
    domains.gasBalance,
    domains.rateHistory,
  ];
  return optional.every((item) => item === 'fresh') ? 'LIVE' : 'PARTIAL';
}

export function safetyInputsFresh(domains: DomainFreshness) {
  return domains.position === 'fresh' && domains.oracle === 'fresh';
}

const NEXT_RISK: Partial<Record<RiskSeverity, RiskSeverity>> = {
  NORMAL: 'WATCH',
  WATCH: 'PREPARE',
  PREPARE: 'ACT',
  ACT: 'URGENT',
  URGENT: 'LIQUIDATION_BOUNDARY',
};

const DECISION_GUIDANCE: Record<RiskSeverity, string> = {
  NORMAL: 'No action required. Continue monitoring.',
  WATCH: 'Conditions changed — monitor.',
  PREPARE: 'Prepare repayment/collateral resources.',
  ACT: 'Corrective action recommended.',
  URGENT: 'Immediate action recommended.',
  LIQUIDATION_BOUNDARY: 'Immediate action recommended.',
  DATA_WARNING: 'Fresh position or oracle data is unavailable. Verify before acting.',
  NO_DEBT: 'No open debt. No corrective action is required.',
};

export type CurrentRiskDecision = {
  currentState: RiskSeverity;
  guidance: string;
  nextRiskState: RiskSeverity | null;
  nextHf: number | null;
  nextBtcPrice: number | null;
  distanceToNextState: number | null;
};

export function currentRiskDecision(input: {
  healthFactor: number | null;
  debt: number;
  collateralAmount: number;
  oraclePrice: number | null;
  liquidationThreshold: number;
  thresholds: RiskThresholds;
  safetyFresh: boolean;
}): CurrentRiskDecision {
  const currentState = classifyPositionRisk(input.healthFactor, input.debt, input.safetyFresh, input.thresholds);
  const nextRiskState = NEXT_RISK[currentState] ?? null;
  const nextLevels: Partial<Record<RiskSeverity, number>> = {
    WATCH: input.thresholds.watch,
    PREPARE: input.thresholds.prepare,
    ACT: input.thresholds.act,
    URGENT: input.thresholds.urgent,
    LIQUIDATION_BOUNDARY: input.thresholds.liquidation,
  };
  const nextHf = nextRiskState === null ? null : nextLevels[nextRiskState] ?? null;
  const nextBtcPrice = nextHf !== null && input.debt > 0
    ? priceAtTargetHf(input.debt, input.collateralAmount, input.liquidationThreshold, nextHf)
    : null;
  const oracle = input.oraclePrice;
  const distanceToNextState = nextBtcPrice !== null && typeof oracle === 'number' && oracle > 0
    ? (oracle - nextBtcPrice) / oracle
    : null;
  return {
    currentState,
    guidance: DECISION_GUIDANCE[currentState],
    nextRiskState,
    nextHf,
    nextBtcPrice,
    distanceToNextState,
  };
}

export type CurrentReadinessDecision = {
  currentActionRequired: boolean;
  currentSafetyState: RiskSeverity;
  contingencyScenario: 'PREPARE';
  repayNeededAtScenario: number | null;
  collateralNeededAtScenario: number | null;
  availableUSDC: number | null;
  availableCollateral: number | null;
  readinessState: ReadinessStatus;
  explanation: string;
};

export function currentReadinessDecision(input: {
  safety: CurrentRiskDecision;
  prepare: StressReadinessLevel | undefined;
  availableUSDC: number | null;
  availableCollateral: number | null;
}): CurrentReadinessDecision {
  const actionable = input.safety.currentState === 'ACT'
    || input.safety.currentState === 'URGENT'
    || input.safety.currentState === 'LIQUIDATION_BOUNDARY';
  const readinessState = input.prepare?.status ?? 'DATA_UNKNOWN';
  const explanation = input.safety.currentState === 'DATA_WARNING'
    ? 'Position safety cannot be judged until the position and oracle are fresh.'
    : actionable
      ? 'A corrective transaction is worth preparing.'
      : 'No corrective transaction is currently required.';
  return {
    currentActionRequired: actionable,
    currentSafetyState: input.safety.currentState,
    contingencyScenario: 'PREPARE',
    repayNeededAtScenario: input.prepare?.repayRequired ?? null,
    collateralNeededAtScenario: input.prepare?.collateralRequired ?? null,
    availableUSDC: input.availableUSDC,
    availableCollateral: input.availableCollateral,
    readinessState,
    explanation,
  };
}

export function classifyPositionRisk(healthFactor: number | null, debt: number, fresh: boolean, thresholds: RiskThresholds): RiskSeverity {
  if (!fresh) return 'DATA_WARNING';
  if (!(debt > 0)) return 'NO_DEBT';
  if (healthFactor === null || !Number.isFinite(healthFactor)) return 'DATA_WARNING';
  if (healthFactor <= thresholds.liquidation) return 'LIQUIDATION_BOUNDARY';
  if (healthFactor <= thresholds.urgent) return 'URGENT';
  if (healthFactor <= thresholds.act) return 'ACT';
  if (healthFactor <= thresholds.prepare) return 'PREPARE';
  if (healthFactor <= thresholds.watch) return 'WATCH';
  return 'NORMAL';
}

export function projectPosition(
  collateralAmount: number,
  debt: number,
  oraclePrice: number,
  liquidationThreshold: number,
): ProjectedRiskPosition {
  const collateralUsd = collateralAmount > 0 && oraclePrice > 0 ? collateralAmount * oraclePrice : null;
  const liquidationPrice = aaveLiquidationPrice(collateralAmount, debt, liquidationThreshold);
  return {
    collateralAmount,
    debt,
    ltv: collateralUsd === null ? null : loanToValue(collateralUsd, debt),
    healthFactor: collateralUsd === null ? null : aaveHealthFactor(collateralUsd, debt, liquidationThreshold),
    liquidationPrice,
    liquidationCushionPercent: liquidationPrice === null ? null : distanceToLiquidation(oraclePrice, liquidationPrice),
  };
}

export function priceAtTargetHf(debt: number, collateralAmount: number, liquidationThreshold: number, targetHf: number) {
  return priceAtHealthFactor(collateralAmount, debt, liquidationThreshold, targetHf);
}

export type RemedyMath = {
  actionable: boolean;
  repayAmount: number;
  collateralAmount: number;
  projected: ProjectedRiskPosition | null;
  message: string | null;
};

function blockedRemedy(message: string): RemedyMath {
  return { actionable: false, repayAmount: 0, collateralAmount: 0, projected: null, message };
}

export function repayToTargetHF(input: {
  collateralAmount: number;
  debt: number;
  oraclePrice: number;
  liquidationThreshold: number;
  targetHf: number;
  actionable?: boolean;
}): RemedyMath {
  if (input.actionable === false) return blockedRemedy('Fresh position data required before calculating an actionable remedy.');
  if (!(input.targetHf > 0) || !(input.liquidationThreshold > 0) || !(input.oraclePrice > 0) || !(input.collateralAmount > 0)) {
    return blockedRemedy('Fresh position data required before calculating an actionable remedy.');
  }
  if (!(input.debt > 0)) {
    return { actionable: true, repayAmount: 0, collateralAmount: 0, projected: projectPosition(input.collateralAmount, 0, input.oraclePrice, input.liquidationThreshold), message: null };
  }
  const collateralUsd = input.collateralAmount * input.oraclePrice;
  const targetDebt = (collateralUsd * input.liquidationThreshold) / input.targetHf;
  const repayAmount = Math.max(input.debt - targetDebt, 0);
  const nextDebt = Math.max(input.debt - repayAmount, 0);
  return {
    actionable: true,
    repayAmount,
    collateralAmount: 0,
    projected: projectPosition(input.collateralAmount, nextDebt, input.oraclePrice, input.liquidationThreshold),
    message: null,
  };
}

export function collateralToTargetHF(input: {
  collateralAmount: number;
  debt: number;
  oraclePrice: number;
  liquidationThreshold: number;
  targetHf: number;
  actionable?: boolean;
}): RemedyMath {
  if (input.actionable === false) return blockedRemedy('Fresh position data required before calculating an actionable remedy.');
  if (!(input.targetHf > 0) || !(input.liquidationThreshold > 0) || !(input.oraclePrice > 0)) {
    return blockedRemedy('Fresh position data required before calculating an actionable remedy.');
  }
  if (!(input.debt > 0)) {
    return { actionable: true, repayAmount: 0, collateralAmount: 0, projected: projectPosition(input.collateralAmount, 0, input.oraclePrice, input.liquidationThreshold), message: null };
  }
  const required = (input.debt * input.targetHf) / (input.oraclePrice * input.liquidationThreshold);
  const collateralAmount = Math.max(required - input.collateralAmount, 0);
  return {
    actionable: true,
    repayAmount: 0,
    collateralAmount,
    projected: projectPosition(input.collateralAmount + collateralAmount, input.debt, input.oraclePrice, input.liquidationThreshold),
    message: null,
  };
}

export function mixedRemedyToTargetHF(input: {
  collateralAmount: number;
  debt: number;
  oraclePrice: number;
  liquidationThreshold: number;
  currentHf: number | null;
  targetHf: number;
  actionable?: boolean;
  repayFraction?: number;
}): RemedyMath {
  if (input.actionable === false) return blockedRemedy('Fresh position data required before calculating an actionable remedy.');
  const current = projectPosition(input.collateralAmount, input.debt, input.oraclePrice, input.liquidationThreshold);
  const currentHf = input.currentHf ?? current.healthFactor;
  if (!(input.debt > 0) || currentHf === null || currentHf >= input.targetHf) {
    return { actionable: true, repayAmount: 0, collateralAmount: 0, projected: current, message: null };
  }
  const fraction = input.repayFraction ?? RISK_MONITOR_DEFAULTS.mixedRepayFraction;
  const midpoint = currentHf + (input.targetHf - currentHf) * fraction;
  const repay = repayToTargetHF({ ...input, targetHf: midpoint, actionable: true });
  if (!repay.projected) return repay;
  const added = collateralToTargetHF({
    collateralAmount: input.collateralAmount,
    debt: repay.projected.debt,
    oraclePrice: input.oraclePrice,
    liquidationThreshold: input.liquidationThreshold,
    targetHf: input.targetHf,
    actionable: true,
  });
  return {
    actionable: true,
    repayAmount: repay.repayAmount,
    collateralAmount: added.collateralAmount,
    projected: added.projected,
    message: null,
  };
}

export function resourceFeasibility(required: number, available: number | null): ResourceFeasibility {
  if (!(required > 0)) return 'AVAILABLE';
  if (available === null || !Number.isFinite(available)) return 'UNKNOWN';
  if (available >= required - 1e-12) return 'AVAILABLE';
  if (available > 0) return 'PARTIALLY_AVAILABLE';
  return 'NOT_CURRENTLY_AVAILABLE';
}

function hfAfterUsingBalance(
  kind: 'repay' | 'collateral',
  debt: number,
  collateralAmount: number,
  oraclePrice: number,
  threshold: number,
  balance: number | null,
) {
  if (balance === null || !Number.isFinite(balance) || !(oraclePrice > 0) || !(threshold > 0)) return null;
  if (!(debt > 0)) return Number.POSITIVE_INFINITY;
  if (kind === 'repay') {
    const nextDebt = Math.max(debt - Math.min(Math.max(balance, 0), debt), 0);
    if (nextDebt <= 0) return Number.POSITIVE_INFINITY;
    return aaveHealthFactor(collateralAmount * oraclePrice, nextDebt, threshold);
  }
  const nextCollateral = collateralAmount + Math.max(balance, 0);
  return aaveHealthFactor(nextCollateral * oraclePrice, debt, threshold);
}

export function assessEmergencyReadiness(input: {
  debt: number;
  collateralAmount: number;
  oraclePrice: number;
  liquidationThreshold: number;
  targetHf: number;
  walletDebtAsset: number | null;
  walletCollateral: number | null;
  gasBalance: number | null;
  gasRequired: number | null;
  fresh: boolean;
}): { status: ReadinessStatus; maxHfByRepay: number | null; maxHfByCollateral: number | null; gasSufficient: boolean | null } {
  const gasSufficient = input.gasBalance === null || input.gasRequired === null || !Number.isFinite(input.gasBalance) || !Number.isFinite(input.gasRequired)
    ? null
    : input.gasBalance >= input.gasRequired;
  if (!input.fresh) {
    return { status: 'DATA_UNKNOWN', maxHfByRepay: null, maxHfByCollateral: null, gasSufficient: null };
  }
  if (!(input.debt > 0)) {
    return { status: 'READY', maxHfByRepay: null, maxHfByCollateral: null, gasSufficient };
  }
  const maxHfByRepay = hfAfterUsingBalance('repay', input.debt, input.collateralAmount, input.oraclePrice, input.liquidationThreshold, input.walletDebtAsset);
  const maxHfByCollateral = hfAfterUsingBalance('collateral', input.debt, input.collateralAmount, input.oraclePrice, input.liquidationThreshold, input.walletCollateral);
  const reaches = (value: number | null) => value !== null && value >= input.targetHf;
  const canReach = reaches(maxHfByRepay) || reaches(maxHfByCollateral);
  const someAsset = (input.walletDebtAsset ?? 0) > 0 || (input.walletCollateral ?? 0) > 0;
  const balancesKnown = input.walletDebtAsset !== null && input.walletCollateral !== null;
  if (!balancesKnown && !canReach) return { status: 'DATA_UNKNOWN', maxHfByRepay, maxHfByCollateral, gasSufficient };
  if (canReach && gasSufficient === true) return { status: 'READY', maxHfByRepay, maxHfByCollateral, gasSufficient };
  if (canReach || someAsset) return { status: 'PARTIALLY_READY', maxHfByRepay, maxHfByCollateral, gasSufficient };
  return { status: 'NOT_READY', maxHfByRepay, maxHfByCollateral, gasSufficient };
}

export type StressReadinessLevel = {
  severity: 'WATCH' | 'PREPARE' | 'ACT';
  stressHf: number;
  targetHf: number;
  scenarioPrice: number | null;
  repayRequired: number | null;
  collateralRequired: number | null;
  repayFeasibility: ResourceFeasibility;
  collateralFeasibility: ResourceFeasibility;
  status: ReadinessStatus;
};

function stressLevelStatus(
  repayRequired: number,
  collateralRequired: number,
  repayFeasibility: ResourceFeasibility,
  collateralFeasibility: ResourceFeasibility,
): ReadinessStatus {
  if (repayRequired <= 0 || collateralRequired <= 0) return 'READY';
  if (repayFeasibility === 'AVAILABLE' || collateralFeasibility === 'AVAILABLE') return 'READY';
  if (repayFeasibility === 'PARTIALLY_AVAILABLE' || collateralFeasibility === 'PARTIALLY_AVAILABLE') return 'PARTIALLY_READY';
  if (repayFeasibility === 'UNKNOWN' && collateralFeasibility === 'UNKNOWN') return 'DATA_UNKNOWN';
  if (repayFeasibility === 'NOT_CURRENTLY_AVAILABLE' && collateralFeasibility === 'NOT_CURRENTLY_AVAILABLE') return 'NOT_READY';
  return 'DATA_UNKNOWN';
}

/** Resources required to restore the preferred health factor after BTC falls to a stress health factor. */
export function stressReadiness(input: {
  debt: number;
  collateralAmount: number;
  liquidationThreshold: number;
  targetHf: number;
  watchHf: number;
  prepareHf: number;
  actHf: number;
  walletDebtAsset: number | null;
  walletCollateral: number | null;
  fresh: boolean;
}): StressReadinessLevel[] {
  const levels: Array<['WATCH' | 'PREPARE' | 'ACT', number]> = [
    ['WATCH', input.watchHf],
    ['PREPARE', input.prepareHf],
    ['ACT', input.actHf],
  ];
  return levels.map(([severity, stressHf]) => {
    if (!input.fresh || !(input.debt > 0) || !(input.collateralAmount > 0)) {
      const idle = input.fresh && !(input.debt > 0);
      return {
        severity,
        stressHf,
        targetHf: input.targetHf,
        scenarioPrice: null,
        repayRequired: idle ? 0 : null,
        collateralRequired: idle ? 0 : null,
        repayFeasibility: idle ? 'AVAILABLE' : 'UNKNOWN',
        collateralFeasibility: idle ? 'AVAILABLE' : 'UNKNOWN',
        status: idle ? 'READY' : 'DATA_UNKNOWN',
      };
    }
    const scenarioPrice = priceAtTargetHf(input.debt, input.collateralAmount, input.liquidationThreshold, stressHf);
    if (scenarioPrice === null) {
      return {
        severity,
        stressHf,
        targetHf: input.targetHf,
        scenarioPrice: null,
        repayRequired: null,
        collateralRequired: null,
        repayFeasibility: 'UNKNOWN',
        collateralFeasibility: 'UNKNOWN',
        status: 'DATA_UNKNOWN',
      };
    }
    const repay = repayToTargetHF({
      collateralAmount: input.collateralAmount,
      debt: input.debt,
      oraclePrice: scenarioPrice,
      liquidationThreshold: input.liquidationThreshold,
      targetHf: input.targetHf,
      actionable: true,
    });
    const collateral = collateralToTargetHF({
      collateralAmount: input.collateralAmount,
      debt: input.debt,
      oraclePrice: scenarioPrice,
      liquidationThreshold: input.liquidationThreshold,
      targetHf: input.targetHf,
      actionable: true,
    });
    const repayFeasibility = resourceFeasibility(repay.repayAmount, input.walletDebtAsset);
    const collateralFeasibility = resourceFeasibility(collateral.collateralAmount, input.walletCollateral);
    return {
      severity,
      stressHf,
      targetHf: input.targetHf,
      scenarioPrice,
      repayRequired: repay.repayAmount,
      collateralRequired: collateral.collateralAmount,
      repayFeasibility,
      collateralFeasibility,
      status: stressLevelStatus(repay.repayAmount, collateral.collateralAmount, repayFeasibility, collateralFeasibility),
    };
  });
}

const READINESS_RANK: Record<ReadinessStatus, number> = {
  READY: 0,
  PARTIALLY_READY: 1,
  DATA_UNKNOWN: 2,
  NOT_READY: 3,
};

export function worstReadiness(levels: StressReadinessLevel[]): ReadinessStatus {
  return levels.reduce<ReadinessStatus>((worst, level) => (
    READINESS_RANK[level.status] > READINESS_RANK[worst] ? level.status : worst
  ), 'READY');
}

export function rateEconomicStatus(apr: number | null, benchmarkApr: number | null): RateEconomicStatus | null {
  if (benchmarkApr === null || benchmarkApr === undefined || !Number.isFinite(benchmarkApr) || benchmarkApr < 0) return 'NO_BENCHMARK';
  if (apr === null || !Number.isFinite(apr)) return null;
  const watchGap = RISK_MONITOR_DEFAULTS.rateBufferBps.watchBelowBenchmark / 10_000;
  const highGap = RISK_MONITOR_DEFAULTS.rateBufferBps.highCostAboveBenchmark / 10_000;
  if (apr <= benchmarkApr - watchGap) return 'FAVORABLE';
  if (apr < benchmarkApr) return 'NEAR_BENCHMARK';
  if (apr < benchmarkApr + highGap) return 'ABOVE_BENCHMARK';
  return 'HIGH_COST';
}

export function marketStressStatus(utilization: number | null | undefined, thresholds: RiskThresholds): MarketStressStatus {
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return 'NOT_APPLICABLE';
  if (utilization >= thresholds.utilizationHigh) return 'HIGH';
  if (utilization >= thresholds.utilizationWatch) return 'WATCH';
  return 'CALM';
}

function change(current: number | null | undefined, previous: number | null | undefined) {
  if (typeof current !== 'number' || typeof previous !== 'number' || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}

function ladder(input: RiskMonitorInput, healthFactor: number | null, thresholds: RiskThresholds): LadderStep[] {
  const steps: Array<LadderStep['severity']> = ['WATCH', 'PREPARE', 'ACT', 'URGENT', 'LIQUIDATION_BOUNDARY'];
  const levels = [thresholds.watch, thresholds.prepare, thresholds.act, thresholds.urgent, thresholds.liquidation];
  return steps.map((severity, index) => {
    const level = levels[index];
    const price = input.totalDebt > 0 ? priceAtTargetHf(input.totalDebt, input.collateralAmount, input.liquidationThreshold, level) : null;
    const oracle = input.oraclePrice ?? null;
    return {
      severity,
      healthFactor: level,
      equivalentLtv: equivalentLtv(input.liquidationThreshold, level),
      oraclePrice: price,
      priceDeclinePercent: price !== null && oracle !== null && oracle > 0 ? (oracle - price) / oracle : null,
      priceDeclineUsd: price !== null && oracle !== null ? oracle - price : null,
      healthFactorDistance: healthFactor === null ? null : healthFactor - level,
    };
  });
}

function remedyProposal(
  type: RemedyType,
  math: RemedyMath,
  targetHf: number,
  feasibility: ResourceFeasibility,
  calculatedAt: string,
  sourceBlock: bigint | undefined,
  label: string,
): ProposedRemedy | null {
  if (!math.actionable || !math.projected) return null;
  if (math.repayAmount <= 0 && math.collateralAmount <= 0) return null;
  return {
    type,
    targetHF: targetHf,
    repayAmount: math.repayAmount > 0 ? math.repayAmount : undefined,
    collateralAmount: math.collateralAmount > 0 ? math.collateralAmount : undefined,
    projectedPosition: math.projected,
    calculatedAt,
    sourceBlock,
    feasibility,
    label,
  };
}

export type RiskMonitorReport = {
  snapshot: BorrowerRiskSnapshot;
  thresholds: RiskThresholds;
  severity: RiskSeverity;
  ladder: LadderStep[];
  rateStatus: RateEconomicStatus | null;
  spreadToBenchmark: number | null;
  monthlyInterest: number | null;
  annualInterest: number | null;
  aprChange1h: number | null;
  aprChange6h: number | null;
  aprChange24h: number | null;
  utilizationChange: number | null;
  marketStress: MarketStressStatus;
  readiness: ReturnType<typeof assessEmergencyReadiness>;
  stress: StressReadinessLevel[];
  stressSummary: ReadinessStatus;
  remedies: ProposedRemedy[];
  remedyMessage: string | null;
  watchDeclinePercent: number | null;
  domains: DomainFreshness;
  overall: OverallDataStatus;
  decision: CurrentRiskDecision;
  readinessDecision: CurrentReadinessDecision;
};

export function buildRiskMonitor(input: RiskMonitorInput, now = input.now ?? Date.now()): RiskMonitorReport {
  const thresholds = resolveRiskThresholds(input.thresholds);
  const domains = assessDomainFreshness(input, now);
  const fresh = safetyInputsFresh(domains);
  const projected = input.oraclePrice && input.oraclePrice > 0
    ? projectPosition(input.collateralAmount, input.totalDebt, input.oraclePrice, input.liquidationThreshold)
    : null;
  const healthFactor = input.healthFactor ?? projected?.healthFactor ?? null;
  const severity = classifyPositionRisk(healthFactor, input.totalDebt, fresh, thresholds);
  const actionable = fresh && input.totalDebt > 0 && healthFactor !== null;
  const base = {
    collateralAmount: input.collateralAmount,
    debt: input.totalDebt,
    oraclePrice: input.oraclePrice ?? 0,
    liquidationThreshold: input.liquidationThreshold,
    targetHf: thresholds.preferredHealthFactor,
    actionable,
  };
  const repay = repayToTargetHF(base);
  const collateral = collateralToTargetHF(base);
  const mixed = mixedRemedyToTargetHF({ ...base, currentHf: healthFactor });
  const calculatedAt = new Date(now).toISOString();
  const walletDebt = domains.walletBalance === 'fresh' ? input.walletDebtAssetBalance ?? null : null;
  const walletCollateral = domains.collateralBalance === 'fresh' ? input.walletCollateralBalance ?? null : null;
  const gasBalance = domains.gasBalance === 'fresh' ? input.nativeGasBalance ?? null : null;
  const remedies = [
    remedyProposal('REPAY', repay, thresholds.preferredHealthFactor, resourceFeasibility(repay.repayAmount, walletDebt), calculatedAt, input.sourceBlock, 'Repay to preferred HF'),
    remedyProposal('ADD_COLLATERAL', collateral, thresholds.preferredHealthFactor, resourceFeasibility(collateral.collateralAmount, walletCollateral), calculatedAt, input.sourceBlock, 'Add collateral to preferred HF'),
    remedyProposal('MIXED', mixed, thresholds.preferredHealthFactor, mixedFeasibility(mixed, { ...input, walletDebtAssetBalance: walletDebt, walletCollateralBalance: walletCollateral }), calculatedAt, input.sourceBlock, 'Balanced remedy'),
  ].filter((item): item is ProposedRemedy => item !== null);
  const steps = ladder(input, healthFactor, thresholds);
  const apr = input.currentBorrowApr ?? null;
  const stress = stressReadiness({
    debt: input.totalDebt,
    collateralAmount: input.collateralAmount,
    liquidationThreshold: input.liquidationThreshold,
    targetHf: thresholds.preferredHealthFactor,
    watchHf: thresholds.watch,
    prepareHf: thresholds.prepare,
    actHf: thresholds.act,
    walletDebtAsset: walletDebt,
    walletCollateral: walletCollateral,
    fresh,
  });
  const decision = currentRiskDecision({
    healthFactor,
    debt: input.totalDebt,
    collateralAmount: input.collateralAmount,
    oraclePrice: input.oraclePrice ?? null,
    liquidationThreshold: input.liquidationThreshold,
    thresholds,
    safetyFresh: fresh,
  });
  const readinessDecision = currentReadinessDecision({
    safety: decision,
    prepare: stress.find((level) => level.severity === 'PREPARE'),
    availableUSDC: walletDebt,
    availableCollateral: walletCollateral,
  });
  return {
    snapshot: {
      identity: {
        wallet: input.wallet,
        protocol: input.protocol,
        chainId: input.chainId,
        marketId: input.marketId,
        collateralAsset: input.collateralAsset,
        debtAsset: input.debtAsset,
      },
      position: {
        collateralAmount: input.collateralAmount,
        collateralUsd: input.collateralAmount > 0 && typeof input.oraclePrice === 'number' && input.oraclePrice > 0
          ? input.collateralAmount * input.oraclePrice
          : null,
        totalDebt: input.totalDebt,
        principal: input.principal ?? null,
        accruedInterest: input.accruedInterest ?? null,
        ltv: projected?.ltv ?? null,
        healthFactor,
        healthFactorKind: input.healthFactorKind ?? null,
        liquidationThreshold: input.liquidationThreshold,
        liquidationPrice: projected?.liquidationPrice ?? null,
        liquidationCushionPercent: projected?.liquidationCushionPercent ?? null,
      },
      market: {
        currentBorrowApr: apr,
        sourceRate: input.sourceRate ?? null,
        rateType: input.rateType ?? null,
        avg1h: input.avg1h ?? null,
        avg6h: input.avg6h ?? null,
        avg24h: input.avg24h ?? null,
        avg7d: input.avg7d ?? null,
        avg30d: input.avg30d ?? null,
        utilization: typeof input.utilization === 'number' ? input.utilization : null,
        availableLiquidity: input.availableLiquidity ?? null,
        oraclePrice: input.oraclePrice ?? null,
        fetchedAt: input.positionFetchedAt ?? input.fetchedAt ?? null,
        source: input.source ?? null,
        isStale: !fresh,
      },
      resources: {
        walletDebtAssetBalance: input.walletDebtAssetBalance ?? null,
        walletCollateralBalance: input.walletCollateralBalance ?? null,
        nativeGasBalance: input.nativeGasBalance ?? null,
        gasRequired: input.gasRequired ?? null,
        elsewhereDebtAsset: input.elsewhereDebtAsset ?? null,
        elsewhereCollateral: input.elsewhereCollateral ?? null,
      },
      benchmark: {
        benchmarkApr: input.benchmarkApr ?? null,
        benchmarkType: input.benchmarkType ?? null,
      },
    },
    thresholds,
    severity,
    ladder: steps,
    rateStatus: rateEconomicStatus(apr, input.benchmarkApr ?? null),
    spreadToBenchmark: input.benchmarkApr == null || apr === null ? null : benchmarkSpread(input.benchmarkApr, apr),
    monthlyInterest: apr === null ? null : monthlyInterest(input.totalDebt, apr),
    annualInterest: apr === null ? null : annualInterest(input.totalDebt, apr),
    aprChange1h: change(apr, input.avg1h),
    aprChange6h: change(apr, input.avg6h),
    aprChange24h: change(apr, input.avg24h),
    utilizationChange: change(input.utilization, input.recentUtilization),
    marketStress: marketStressStatus(input.utilization, thresholds),
    readiness: assessEmergencyReadiness({
      debt: input.totalDebt,
      collateralAmount: input.collateralAmount,
      oraclePrice: input.oraclePrice ?? 0,
      liquidationThreshold: input.liquidationThreshold,
      targetHf: thresholds.preferredHealthFactor,
      walletDebtAsset: walletDebt,
      walletCollateral: walletCollateral,
      gasBalance,
      gasRequired: input.gasRequired ?? null,
      fresh: actionable || (fresh && !(input.totalDebt > 0)),
    }),
    stress,
    stressSummary: worstReadiness(stress),
    remedies,
    remedyMessage: actionable
      ? null
      : domains.oracle !== 'fresh' && domains.position === 'fresh'
        ? 'Fresh oracle data is required before calculating an actionable remedy.'
        : 'Fresh position data required before calculating an actionable remedy.',
    watchDeclinePercent: steps.find((step) => step.severity === 'WATCH')?.priceDeclinePercent ?? null,
    domains,
    overall: overallDataStatus(domains),
    decision,
    readinessDecision,
  };
}

function mixedFeasibility(math: RemedyMath, input: RiskMonitorInput): ResourceFeasibility {
  const repay = resourceFeasibility(math.repayAmount, input.walletDebtAssetBalance ?? null);
  const collateral = resourceFeasibility(math.collateralAmount, input.walletCollateralBalance ?? null);
  if (repay === 'UNKNOWN' || collateral === 'UNKNOWN') return 'UNKNOWN';
  if (repay === 'AVAILABLE' && collateral === 'AVAILABLE') return 'AVAILABLE';
  if (repay === 'NOT_CURRENTLY_AVAILABLE' && collateral === 'NOT_CURRENTLY_AVAILABLE') return 'NOT_CURRENTLY_AVAILABLE';
  return 'PARTIALLY_AVAILABLE';
}

export function simulateBtcPrice(input: RiskMonitorInput, oraclePrice: number): RiskMonitorReport {
  const next = { ...input, oraclePrice, healthFactor: null };
  return buildRiskMonitor(next, input.now);
}

export function simulateApr(input: RiskMonitorInput, apr: number): RiskMonitorReport {
  return buildRiskMonitor({ ...input, currentBorrowApr: apr }, input.now);
}

export type SimulationMode = 'repay' | 'collateral';
export type SimulationPreset =
  | 'restore'
  | 'debt-10'
  | 'debt-25'
  | 'debt-50'
  | 'coll-0.05'
  | 'coll-0.10'
  | 'coll-0.25'
  | 'custom';

export type SimulationState = {
  mode: SimulationMode;
  scenarioPrice: string;
  targetHf: string;
  amount: string;
  preset: SimulationPreset;
};

export type SimulationView = {
  mode: SimulationMode;
  scenarioPrice: number | null;
  targetHf: number | null;
  before: ProjectedRiskPosition | null;
  actionAmount: number;
  after: ProjectedRiskPosition | null;
  available: number | null;
  elsewhere: number | null;
  shortfall: number | null;
  surplus: number | null;
  feasibility: ResourceFeasibility;
  liquidationUnchangedByPrice: boolean;
};

export function openSimulation(mode: SimulationMode, oraclePrice: number | null | undefined, preferredHf: number): SimulationState {
  return {
    mode,
    scenarioPrice: typeof oraclePrice === 'number' && Number.isFinite(oraclePrice) && oraclePrice > 0 ? String(oraclePrice) : '',
    targetHf: String(preferredHf),
    amount: '',
    preset: 'restore',
  };
}

export function resetSimulation(state: SimulationState, oraclePrice: number | null | undefined, preferredHf: number): SimulationState {
  return openSimulation(state.mode, oraclePrice, preferredHf);
}

const DEBT_FRACTIONS: Partial<Record<SimulationPreset, number>> = {
  'debt-10': 0.1,
  'debt-25': 0.25,
  'debt-50': 0.5,
};

const COLLATERAL_AMOUNTS: Partial<Record<SimulationPreset, number>> = {
  'coll-0.05': 0.05,
  'coll-0.10': 0.1,
  'coll-0.25': 0.25,
};

function positiveInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function simulationAmount(state: SimulationState, input: RiskMonitorInput): number {
  const fraction = state.mode === 'repay' ? DEBT_FRACTIONS[state.preset] : undefined;
  if (fraction !== undefined) return Math.max(input.totalDebt, 0) * fraction;
  const fixed = state.mode === 'collateral' ? COLLATERAL_AMOUNTS[state.preset] : undefined;
  if (fixed !== undefined) return fixed;
  if (state.preset === 'custom') {
    const parsed = Number(state.amount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  const price = positiveInput(state.scenarioPrice);
  const target = positiveInput(state.targetHf);
  if (price === null || target === null) return 0;
  const shared = {
    collateralAmount: input.collateralAmount,
    debt: input.totalDebt,
    oraclePrice: price,
    liquidationThreshold: input.liquidationThreshold,
    targetHf: target,
    actionable: true as const,
  };
  return state.mode === 'repay' ? repayToTargetHF(shared).repayAmount : collateralToTargetHF(shared).collateralAmount;
}

/** Local copy only. Does not mutate the live risk input. */
export function evaluateSimulation(state: SimulationState, input: RiskMonitorInput): SimulationView {
  const price = positiveInput(state.scenarioPrice);
  const target = positiveInput(state.targetHf);
  const liveLiquidation = input.oraclePrice && input.oraclePrice > 0
    ? projectPosition(input.collateralAmount, input.totalDebt, input.oraclePrice, input.liquidationThreshold).liquidationPrice
    : null;
  const before = price === null
    ? null
    : projectPosition(input.collateralAmount, input.totalDebt, price, input.liquidationThreshold);
  const actionAmount = simulationAmount(state, input);
  const after = before === null || price === null
    ? null
    : state.mode === 'repay'
      ? projectPosition(input.collateralAmount, Math.max(input.totalDebt - actionAmount, 0), price, input.liquidationThreshold)
      : projectPosition(input.collateralAmount + actionAmount, input.totalDebt, price, input.liquidationThreshold);
  const available = state.mode === 'repay' ? (input.walletDebtAssetBalance ?? null) : (input.walletCollateralBalance ?? null);
  const elsewhere = state.mode === 'repay' ? (input.elsewhereDebtAsset ?? null) : (input.elsewhereCollateral ?? null);
  return {
    mode: state.mode,
    scenarioPrice: price,
    targetHf: target,
    before,
    actionAmount,
    after,
    available,
    elsewhere,
    shortfall: available === null ? null : Math.max(actionAmount - available, 0),
    surplus: available === null ? null : Math.max(available - actionAmount, 0),
    feasibility: resourceFeasibility(actionAmount, available),
    liquidationUnchangedByPrice: before?.liquidationPrice === liveLiquidation,
  };
}

export function rateScenarios(
  debt: number,
  currentApr: number | null,
  benchmarkApr: number | null,
  openingApr: number | null = null,
) {
  const rows: Array<{ label: string; apr: number; forecast: false }> = [];
  if (currentApr !== null && Number.isFinite(currentApr)) rows.push({ label: 'Current', apr: currentApr, forecast: false });
  if (openingApr !== null && Number.isFinite(openingApr)) rows.push({ label: 'Opening APR', apr: openingApr, forecast: false });
  rows.push({ label: '6%', apr: 0.06, forecast: false });
  if (benchmarkApr !== null && Number.isFinite(benchmarkApr)) rows.push({ label: 'Financing benchmark', apr: benchmarkApr, forecast: false });
  rows.push({ label: '8%', apr: 0.08, forecast: false }, { label: '10%', apr: 0.1, forecast: false });
  return rows.map((row) => ({
    ...row,
    monthlyInterest: monthlyInterest(debt, row.apr),
    annualInterest: annualInterest(debt, row.apr),
    spreadToBenchmark: benchmarkApr === null ? null : benchmarkSpread(benchmarkApr, row.apr),
    differenceVsOpening: openingApr === null || !Number.isFinite(openingApr) ? null : row.apr - openingApr,
  }));
}
