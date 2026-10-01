import { formatUnits } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import { appUrl } from '@/lib/alerts';
import {
  buildMigrationPlan,
  calculateRateStability,
  calculateSafetyProjection,
  findRefinanceCandidates,
  type FreshnessState,
  type MarginComparison,
  type MigrationPlan,
  type RefinanceCandidate,
  type RefinanceMarketBaseline,
  STALE_THRESHOLD_MS,
} from '@/lib/finance/refinance';
import { type Venue } from '@/lib/protocol';
import { storeJson, storeSetJson, type Json } from '@/lib/store';

export type QualificationStatus = 'QUALIFIED_FOR_REVIEW' | 'NOT_QUALIFIED';

export type QualificationReason =
  | 'QUALIFIED'
  | 'ZERO_DEBT'
  | 'RATE_NOT_LOWER'
  | 'NO_MEANINGFUL_SAVINGS'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'STALE_RATE'
  | 'UNKNOWN_MIGRATION_COST'
  | 'UNKNOWN_BREAK_EVEN'
  | 'UNSUPPORTED_PATH'
  | 'SAFETY_DATA_UNAVAILABLE'
  | 'UNVERIFIED_SOURCE_MARKET'
  | 'UNVERIFIED_DESTINATION_MARKET'
  | 'OUTSIDE_SAFETY_REQUIREMENTS';

export type RefinanceAlertQualificationCriteria = {
  minAprImprovementBps?: number;
  minMonthlySavingsUsd?: number;
  minYearlySavingsUsd?: number;
  minHealthFactor?: number;
};

export const DEFAULT_QUALIFICATION_CRITERIA: Required<RefinanceAlertQualificationCriteria> = {
  minAprImprovementBps: 15,
  minMonthlySavingsUsd: 2,
  minYearlySavingsUsd: 25,
  minHealthFactor: 1.2,
};

export type RefinanceQualificationSnapshot = {
  sourceMarketId: string;
  destinationMarketId: string;
  currentApr: number;
  candidateApr: number;
  aprImprovementBps: number;
  estimatedMonthlyDifference: number;
  estimatedAnnualDifference: number;
  migrationCostUsd: number | null;
  breakEvenDays: number | null;
  liquidity: number;
  safetyComparison: {
    sourceHealthFactor: number | null;
    projectedHealthFactor: number | null;
    sourceLiquidationBtc: number | null;
    projectedLiquidationBtc: number | null;
    marginComparison: MarginComparison;
    marginCopy: string;
    hasLessMargin: boolean;
  };
  freshness: FreshnessState;
  debt: number;
  timestamp: number;
};

export type RefinanceQualification = {
  status: QualificationStatus;
  isQualified: boolean;
  reasons: QualificationReason[];
  primaryReason: QualificationReason;
  plan: MigrationPlan;
  snapshot: RefinanceQualificationSnapshot;
};

export type StoredRefinanceAlertState = {
  sourceMarketId: string;
  candidateMarketId: string;
  qualificationState: QualificationStatus;
  monthlySavings: number;
  aprImprovementBps: number;
  candidateApr: number;
  sentAt: number;
  snapshot: RefinanceQualificationSnapshot;
};

/**
 * Evaluates an existing MigrationPlan against qualification rules.
 * A candidate qualifies ONLY when all facts are verified, fresh, liquid,
 * cost is known, break-even is calculable, execution path is supported,
 * safety is projected and sufficient, and savings is economically meaningful.
 */
export function qualifyRefinancePlan(
  plan: MigrationPlan,
  criteria?: RefinanceAlertQualificationCriteria,
  now = Date.now(),
): RefinanceQualification {
  const minAprImprovementBps = criteria?.minAprImprovementBps ?? DEFAULT_QUALIFICATION_CRITERIA.minAprImprovementBps;
  const minMonthlySavingsUsd = criteria?.minMonthlySavingsUsd ?? DEFAULT_QUALIFICATION_CRITERIA.minMonthlySavingsUsd;
  const minYearlySavingsUsd = criteria?.minYearlySavingsUsd ?? DEFAULT_QUALIFICATION_CRITERIA.minYearlySavingsUsd;
  const minHealthFactor = criteria?.minHealthFactor ?? DEFAULT_QUALIFICATION_CRITERIA.minHealthFactor;

  const reasons: QualificationReason[] = [];

  // 0. Zero-debt guard: A position with no current debt must never qualify
  if (plan.debt <= 0) {
    reasons.push('ZERO_DEBT');
  }

  // 1. Source market verified
  if (!plan.sourceMarket.id || plan.sourceMarket.freshness === 'unavailable') {
    reasons.push('UNVERIFIED_SOURCE_MARKET');
  }

  // 2. Destination canonical market verified
  if (!plan.destinationMarket.id || plan.destinationMarket.freshness === 'unavailable') {
    reasons.push('UNVERIFIED_DESTINATION_MARKET');
  }

  // 3. Source/candidate data fresh
  const isStale = plan.isStale ||
    plan.freshness !== 'fresh' ||
    plan.sourceMarket.freshness !== 'fresh' ||
    plan.destinationMarket.freshness !== 'fresh' ||
    plan.destinationMarket.isStale;
  if (isStale) {
    reasons.push('STALE_RATE');
  }

  // 4. Candidate APR lower than current APR
  const isRateLower = plan.rateDirection === 'lower' && plan.aprDifference > 0 && plan.candidateApr < plan.currentApr;
  if (!isRateLower) {
    reasons.push('RATE_NOT_LOWER');
  }

  // 5. Destination liquidity sufficient for full current debt
  const isLiquid = plan.debt > 0 &&
    plan.liquiditySufficiency === 'SUFFICIENT' &&
    plan.destinationMarket.availableLiquidity >= plan.debt;
  if (!isLiquid) {
    reasons.push('INSUFFICIENT_LIQUIDITY');
  }

  // 6. Migration cost known
  const isCostKnown = plan.estimatedCosts.isCostKnown &&
    plan.estimatedCosts.estimatedCostUsd !== null &&
    Number.isFinite(plan.estimatedCosts.estimatedCostUsd);
  if (!isCostKnown) {
    reasons.push('UNKNOWN_MIGRATION_COST');
  }

  // 7. Break-even calculable
  const isBreakEvenCalculable = plan.breakEvenDays !== null &&
    Number.isFinite(plan.breakEvenDays) &&
    plan.breakEvenDays >= 0;
  if (!isBreakEvenCalculable) {
    reasons.push('UNKNOWN_BREAK_EVEN');
  }

  // 8. Execution path classified as supported by the app's current capabilities
  // Currently supported: same-chain same-wrapper only
  const isSupportedPath = plan.executionPathSupported &&
    plan.classification === 'SAME_CHAIN_SAME_WRAPPER' &&
    !plan.wrapperChange &&
    !plan.chainChange;
  if (!isSupportedPath) {
    reasons.push('UNSUPPORTED_PATH');
  }

  // 9. Projected destination safety values available & no critical unknown inputs
  const hasSafetyData = plan.sourceSafety.healthFactor !== null &&
    plan.destinationSafety.healthFactor !== null &&
    plan.sourceSafety.liquidationBtc !== null &&
    plan.destinationSafety.liquidationBtc !== null &&
    plan.sourceMarket.oraclePrice > 0;
  if (!hasSafetyData) {
    reasons.push('SAFETY_DATA_UNAVAILABLE');
  }

  // 10. Candidate is not materially outside configured/user safety requirements
  if (plan.destinationSafety.healthFactor !== null) {
    if (plan.destinationSafety.healthFactor < minHealthFactor || plan.destinationSafety.healthFactor < 1.05) {
      reasons.push('OUTSIDE_SAFETY_REQUIREMENTS');
    }
  }

  // 11. Economic materiality: minimum APR improvement in bps AND (minimum monthly OR yearly savings)
  const hasMeaningfulBps = plan.rateDifferenceBps >= minAprImprovementBps;
  const hasMeaningfulMonthly = plan.monthlyDifference >= minMonthlySavingsUsd;
  const hasMeaningfulYearly = plan.grossAnnualDifference >= minYearlySavingsUsd;
  if (!hasMeaningfulBps || (!hasMeaningfulMonthly && !hasMeaningfulYearly)) {
    reasons.push('NO_MEANINGFUL_SAVINGS');
  }

  const isQualified = reasons.length === 0;
  const status: QualificationStatus = isQualified ? 'QUALIFIED_FOR_REVIEW' : 'NOT_QUALIFIED';
  const primaryReason: QualificationReason = isQualified ? 'QUALIFIED' : reasons[0]!;

  const snapshot: RefinanceQualificationSnapshot = {
    sourceMarketId: plan.sourceMarket.id,
    destinationMarketId: plan.destinationMarket.id,
    currentApr: plan.currentApr,
    candidateApr: plan.candidateApr,
    aprImprovementBps: plan.rateDifferenceBps,
    estimatedMonthlyDifference: plan.monthlyDifference,
    estimatedAnnualDifference: plan.grossAnnualDifference,
    migrationCostUsd: plan.estimatedCosts.estimatedCostUsd,
    breakEvenDays: plan.breakEvenDays,
    liquidity: plan.destinationMarket.availableLiquidity,
    safetyComparison: {
      sourceHealthFactor: plan.sourceSafety.healthFactor,
      projectedHealthFactor: plan.destinationSafety.healthFactor,
      sourceLiquidationBtc: plan.sourceSafety.liquidationBtc,
      projectedLiquidationBtc: plan.destinationSafety.liquidationBtc,
      marginComparison: plan.safetyComparison.marginComparison,
      marginCopy: plan.safetyComparison.marginCopy,
      hasLessMargin: plan.safetyComparison.marginComparison === 'LESS_MARGIN',
    },
    freshness: plan.freshness,
    debt: plan.debt,
    timestamp: now,
  };

  return {
    status,
    isQualified,
    reasons: isQualified ? ['QUALIFIED'] : reasons,
    primaryReason,
    plan,
    snapshot,
  };
}

/**
 * Scans candidate borrow markets for a given position and returns the best qualified plan,
 * or null if no candidate qualifies.
 */
export function findActionableRefinanceOpportunity(input: {
  sourceVenue: Venue;
  snapshot: PositionSnapshot;
  allVenues: Venue[];
  criteria?: RefinanceAlertQualificationCriteria;
  gasPriceWei?: bigint | number | null;
  ethPriceUsd?: number | null;
  benchmarkApr?: number | null;
  openingApr?: number | null;
  now?: number;
}): RefinanceQualification | null {
  const { sourceVenue, snapshot, allVenues, criteria, gasPriceWei, ethPriceUsd, benchmarkApr, openingApr } = input;
  const now = input.now ?? Date.now();

  const collateralAmount = Number(formatUnits(snapshot.collateral, sourceVenue.assetDecimals));
  const debt = Number(formatUnits(snapshot.debt, sourceVenue.loanDecimals));
  if (debt <= 0 || collateralAmount <= 0) return null;

  const oraclePrice = sourceVenue.priceUsd > 0 ? sourceVenue.priceUsd : 0;
  const threshold = sourceVenue.collateralRisk?.liquidationLtv ?? sourceVenue.collateralRisk?.liquidationThreshold ?? sourceVenue.maxLtv;

  const fetchedAt = sourceVenue.freshness?.fetchedAt ?? 0;
  const isSourceStale = fetchedAt > 0 && (now - fetchedAt > STALE_THRESHOLD_MS);
  const sourceFreshness: FreshnessState = isSourceStale
    ? 'stale'
    : (sourceVenue.freshness ? 'fresh' : 'unavailable');

  const sourceBaseline: RefinanceMarketBaseline = {
    id: sourceVenue.id,
    protocol: sourceVenue.protocol,
    chainId: sourceVenue.chainId,
    marketId: sourceVenue.id,
    collateralAsset: sourceVenue.assetSymbol,
    debtAsset: sourceVenue.loanSymbol,
    collateralAmount,
    collateralValueUsd: collateralAmount * oraclePrice,
    debt,
    currentApr: sourceVenue.borrowApr,
    openingApr: openingApr ?? null,
    safety: {
      ltv: snapshot.ltv,
      healthFactor: snapshot.healthFactor,
      liquidationThreshold: threshold,
      liquidationBtc: snapshot.liquidationPrice > 0 ? snapshot.liquidationPrice : null,
      liquidationCushion: snapshot.liquidationPrice > 0 && oraclePrice > 0
        ? (oraclePrice - snapshot.liquidationPrice) / oraclePrice
        : null,
    },
    availableLiquidity: sourceVenue.liquidityUsd ?? null,
    utilization: sourceVenue.utilization ?? sourceVenue.liquidity?.utilization ?? null,
    freshness: sourceFreshness,
    oraclePrice,
    stability: calculateRateStability(sourceVenue.borrowApr, sourceVenue.rateHistory),
  };

  const candidates = findRefinanceCandidates(sourceVenue, allVenues, now);
  const qualifiedPlans: RefinanceQualification[] = [];

  for (const candidate of candidates) {
    const plan = buildMigrationPlan({
      sourceMarket: sourceBaseline,
      destinationMarket: candidate,
      gasPriceWei,
      ethPriceUsd,
      benchmarkApr,
      now,
    });
    const qualification = qualifyRefinancePlan(plan, criteria, now);
    if (qualification.isQualified) {
      qualifiedPlans.push(qualification);
    }
  }

  if (qualifiedPlans.length === 0) return null;

  // Highest monthly savings first
  qualifiedPlans.sort((a, b) => b.snapshot.estimatedMonthlyDifference - a.snapshot.estimatedMonthlyDifference);
  return qualifiedPlans[0] ?? null;
}

/**
 * Re-validates an existing qualification against fresh venue data immediately before sending.
 */
export function recheckRefinanceCandidate(
  qualification: RefinanceQualification,
  freshVenues: Venue[],
  criteria?: RefinanceAlertQualificationCriteria,
  now = Date.now(),
  options?: {
    currentDebt?: number;
    currentCollateral?: number;
    gasPriceWei?: bigint | number | null;
    ethPriceUsd?: number | null;
    benchmarkApr?: number | null;
  },
): RefinanceQualification {
  const sourceVenue = freshVenues.find((v) => v.id === qualification.plan.sourceMarket.id);
  const candidateVenue = freshVenues.find((v) => v.id === qualification.plan.destinationMarket.id);

  if (!sourceVenue || !candidateVenue) {
    return {
      ...qualification,
      status: 'NOT_QUALIFIED',
      isQualified: false,
      reasons: [!sourceVenue ? 'UNVERIFIED_SOURCE_MARKET' : 'UNVERIFIED_DESTINATION_MARKET'],
      primaryReason: !sourceVenue ? 'UNVERIFIED_SOURCE_MARKET' : 'UNVERIFIED_DESTINATION_MARKET',
    };
  }

  const prevPlan = qualification.plan;
  const debt = options?.currentDebt !== undefined ? options.currentDebt : prevPlan.debt;
  const collateral = options?.currentCollateral !== undefined ? options.currentCollateral : prevPlan.collateral;
  const gasPriceWei = options?.gasPriceWei !== undefined ? options.gasPriceWei : prevPlan.gasPriceWei;
  const ethPriceUsd = options?.ethPriceUsd !== undefined ? options.ethPriceUsd : prevPlan.ethPriceUsd;
  const benchmarkApr = options?.benchmarkApr !== undefined ? options.benchmarkApr : prevPlan.benchmark?.benchmarkApr;

  // Enforce fresh oracle price: if current oracle price is missing/<=0, do not fall back to old projection
  const oraclePrice = sourceVenue.priceUsd > 0 ? sourceVenue.priceUsd : 0;
  const sourceThreshold = sourceVenue.collateralRisk?.liquidationLtv ?? sourceVenue.collateralRisk?.liquidationThreshold ?? sourceVenue.maxLtv ?? 0;

  const isSourceStale = Boolean(sourceVenue.freshness?.fetchedAt && (now - sourceVenue.freshness.fetchedAt > STALE_THRESHOLD_MS));
  const sourceFreshness: FreshnessState = isSourceStale
    ? 'stale'
    : (sourceVenue.freshness ? 'fresh' : 'unavailable');

  const freshSourceBaseline: RefinanceMarketBaseline = {
    ...prevPlan.sourceMarket,
    debt,
    collateralAmount: collateral,
    collateralValueUsd: collateral * oraclePrice,
    currentApr: sourceVenue.borrowApr,
    oraclePrice,
    availableLiquidity: sourceVenue.liquidityUsd ?? null,
    freshness: sourceFreshness,
    safety: calculateSafetyProjection(
      debt,
      collateral,
      oraclePrice,
      sourceThreshold,
    ),
  };

  const candidateCandidates = findRefinanceCandidates(sourceVenue, [candidateVenue], now);
  const freshCandidate = candidateCandidates.find((c) => c.id === candidateVenue.id);
  if (!freshCandidate) {
    return {
      ...qualification,
      status: 'NOT_QUALIFIED',
      isQualified: false,
      reasons: ['UNVERIFIED_DESTINATION_MARKET'],
      primaryReason: 'UNVERIFIED_DESTINATION_MARKET',
    };
  }

  const freshPlan = buildMigrationPlan({
    sourceMarket: freshSourceBaseline,
    destinationMarket: freshCandidate,
    gasPriceWei,
    ethPriceUsd,
    benchmarkApr,
    now,
  });

  return qualifyRefinancePlan(freshPlan, criteria, now);
}

/**
 * Evaluates whether an alert should be sent based on deduplication rules.
 * Key dedupe by: loan/source market + candidate canonical market + qualification state.
 * Only re-alerts when:
 * 1. candidate changes
 * 2. previous opportunity stopped qualifying and later qualifies again
 * 3. materially better savings (+$5/mo or >=20% higher or +25 bps)
 */
export async function evaluateRefinanceAlertDeduplication(
  address: string,
  qualification: RefinanceQualification,
  record = true,
  now = Date.now(),
): Promise<{ shouldSend: boolean; reason: string }> {
  const sourceMarketId = qualification.snapshot.sourceMarketId;
  const key = `alert:refi:state:${address.toLowerCase()}:${sourceMarketId}`;
  const prev = await storeJson<StoredRefinanceAlertState>(key);

  if (!prev) {
    if (record) {
      await recordRefinanceAlertSent(address, qualification, now);
    }
    return { shouldSend: true, reason: 'INITIAL_QUALIFYING_ALERT' };
  }

  // 1. Candidate changes
  if (prev.candidateMarketId !== qualification.snapshot.destinationMarketId) {
    if (record) {
      await recordRefinanceAlertSent(address, qualification, now);
    }
    return { shouldSend: true, reason: 'CANDIDATE_CHANGED' };
  }

  // 2. Previous opportunity stopped qualifying and later qualifies again
  if (prev.qualificationState === 'NOT_QUALIFIED') {
    if (record) {
      await recordRefinanceAlertSent(address, qualification, now);
    }
    return { shouldSend: true, reason: 'REQUALIFIED_AFTER_DISQUALIFICATION' };
  }

  // 3. Materially better savings
  const higherMonthlyUsd = qualification.snapshot.estimatedMonthlyDifference - prev.monthlySavings;
  const pctSavingsIncrease = prev.monthlySavings > 0
    ? (qualification.snapshot.estimatedMonthlyDifference - prev.monthlySavings) / prev.monthlySavings
    : 0;
  const higherBps = qualification.snapshot.aprImprovementBps - prev.aprImprovementBps;

  const isMateriallyBetter =
    higherMonthlyUsd >= 5 ||
    (pctSavingsIncrease >= 0.20 && higherMonthlyUsd >= 1) ||
    higherBps >= 25;

  if (isMateriallyBetter) {
    if (record) {
      await recordRefinanceAlertSent(address, qualification, now);
    }
    return { shouldSend: true, reason: 'MATERIALLY_BETTER_SAVINGS' };
  }

  // Unchanged opportunity -> suppress / deduplicate
  return { shouldSend: false, reason: 'UNCHANGED_OPPORTUNITY_DEDUPLICATED' };
}

export async function recordRefinanceAlertSent(
  address: string,
  qualification: RefinanceQualification,
  now = Date.now(),
): Promise<void> {
  const sourceMarketId = qualification.snapshot.sourceMarketId;
  const stateKey = `alert:refi:state:${address.toLowerCase()}:${sourceMarketId}`;
  const record: StoredRefinanceAlertState = {
    sourceMarketId,
    candidateMarketId: qualification.snapshot.destinationMarketId,
    qualificationState: qualification.status,
    monthlySavings: qualification.snapshot.estimatedMonthlyDifference,
    aprImprovementBps: qualification.snapshot.aprImprovementBps,
    candidateApr: qualification.snapshot.candidateApr,
    sentAt: now,
    snapshot: qualification.snapshot,
  };
  await storeSetJson(stateKey, record as unknown as Json);
  await storeRefinanceAlertSnapshot(address, qualification.snapshot);
}

export async function recordRefinanceDisqualified(
  address: string,
  sourceMarketId: string,
  _candidateMarketId?: string,
): Promise<void> {
  const stateKey = `alert:refi:state:${address.toLowerCase()}:${sourceMarketId}`;
  const prev = await storeJson<StoredRefinanceAlertState>(stateKey);
  if (prev && prev.qualificationState !== 'NOT_QUALIFIED') {
    prev.qualificationState = 'NOT_QUALIFIED';
    await storeSetJson(stateKey, prev as unknown as Json);
  }
}

export async function storeRefinanceAlertSnapshot(
  address: string,
  snapshot: RefinanceQualificationSnapshot,
): Promise<void> {
  const snapKey = `alert:refi:snap:${address.toLowerCase()}:${snapshot.sourceMarketId}:${snapshot.destinationMarketId}`;
  await storeSetJson(snapKey, snapshot as unknown as Json);
  console.log(`[REFINANCE ALERT SNAPSHOT] ${address} ${snapshot.sourceMarketId} -> ${snapshot.destinationMarketId}:`, JSON.stringify(snapshot));
}

/**
 * Builds canonical deep link to exact refinance candidate in Risk Monitor.
 */
export function buildRefinanceDeepLink(
  sourceMarketId: string,
  candidateMarketId: string,
  baseUrl?: string,
): string {
  const base = baseUrl ?? appUrl();
  return `${base}/risk?market=${encodeURIComponent(sourceMarketId)}&tab=refinance&candidate=${encodeURIComponent(candidateMarketId)}&source=alert`;
}
