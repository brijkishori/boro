import type { ChainId, ProtocolId, Venue } from '@/lib/protocol';
import { availableToBorrowUsd, canonicalMarketKey, chainLabel, dedupeVenues, protocolMarketId } from '@/lib/protocol';

export const REFINANCE_GAS_UNITS = {
  repay: 200_000n,
  withdraw: 200_000n,
  approve: 70_000n,
  supply: 250_000n,
  borrow: 300_000n,
  total: 1_020_000n,
} as const;

export const STATIC_SCENARIO_PERIODS = [30, 90, 365] as const;
export const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes (general UI)
export const ACTIONABLE_FRESHNESS_MAX_AGE_MS = 30_000; // 30 seconds (strict actionable requirement)

export type MigrationClassification =
  | 'SAME_CHAIN_SAME_WRAPPER'
  | 'SAME_CHAIN_WRAPPER_CHANGE'
  | 'CROSS_CHAIN';

export type RateDirection = 'lower' | 'higher' | 'equal';
export type LiquiditySufficiency = 'SUFFICIENT' | 'INSUFFICIENT';
export type MarginComparison = 'MORE_MARGIN' | 'LESS_MARGIN' | 'EQUAL_MARGIN';
export type FreshnessState = 'fresh' | 'stale' | 'unavailable';

export type MarketSafetyProjection = {
  ltv: number | null;
  healthFactor: number | null;
  liquidationThreshold: number;
  liquidationBtc: number | null;
  liquidationCushion: number | null;
};

export type RateStabilityMetrics = {
  currentApr: number;
  avg7d: number | null;
  avg30d: number | null;
  min7d: number | null;
  max7d: number | null;
  hasHistory: boolean;
  stabilityNote?: string;
};

export type MigrationCostEstimate = {
  isCostKnown: boolean;
  estimatedCostUsd: number | null;
  transactionCount: number;
  repayGasUnits: bigint;
  withdrawGasUnits: bigint;
  approvalGasUnits: bigint;
  supplyGasUnits: bigint;
  borrowGasUnits: bigint;
  swapCostStatus: 'NOT_NEEDED' | 'UNKNOWN';
  bridgeCostStatus: 'NOT_NEEDED' | 'UNKNOWN';
  slippageStatus: 'NOT_NEEDED' | 'UNKNOWN';
  explanation: string;
};

export type StaticScenarioResult = {
  days: number;
  label: string;
  stayEstimatedInterest: number;
  candidateEstimatedInterest: number;
  grossInterestSaved: number;
  migrationCost: number | null;
  netDifference: number | null;
  disclaimer: string;
};

export type RefinanceMarketBaseline = {
  id: string;
  protocol: ProtocolId;
  chainId: ChainId;
  marketId: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: number;
  collateralValueUsd: number;
  debt: number;
  currentApr: number;
  openingApr: number | null;
  safety: MarketSafetyProjection;
  availableLiquidity: number | null;
  utilization: number | null;
  freshness: FreshnessState;
  oraclePrice: number;
  stability: RateStabilityMetrics;
};

export type RefinanceCandidate = {
  id: string;
  protocol: ProtocolId;
  chainId: ChainId;
  marketId: string;
  collateral: string;
  debtAsset: string;
  currentApr: number;
  stability: RateStabilityMetrics;
  liquidationThreshold: number;
  availableLiquidity: number;
  utilization: number | null;
  freshness: FreshnessState;
  wrapper: string;
  oracle?: string;
  classification: MigrationClassification;
  classificationLabel: string;
  isStale: boolean;
  venue: Venue;
};

export type ActionableMarketSnapshot = {
  readonly canonicalMarketId: string;
  readonly protocol: ProtocolId;
  readonly chainId: ChainId;
  readonly collateralAsset: string;
  readonly debtAsset: string;
  readonly currentApr: number;
  readonly availableLiquidity: number;
  readonly liquidationThreshold: number;
  readonly oraclePrice: number;
  readonly fetchedAt: number;
  readonly blockNumber: number | null;
  readonly sourceProvider: string;
  readonly isStale: boolean;
  readonly venue: Venue;
};

export type MigrationPlan = {
  sourceMarket: RefinanceMarketBaseline;
  destinationMarket: RefinanceCandidate;
  debt: number;
  collateral: number;
  currentApr: number;
  candidateApr: number;
  aprDifference: number; // positive = candidate is lower/cheaper
  rateDifferenceBps: number;
  rateDirection: RateDirection;
  rateDisplay: string;
  spreadClassification: 'SMALL' | 'MODEST' | 'MATERIAL' | 'TINY';
  grossAnnualDifference: number; // debt * (currentApr - candidateApr)
  monthlyDifference: number;
  dailyDifference: number;
  estimatedCosts: MigrationCostEstimate;
  breakEvenDays: number | null;
  breakEvenMonths: number | null;
  sourceSafety: MarketSafetyProjection;
  destinationSafety: MarketSafetyProjection;
  safetyComparison: {
    marginComparison: MarginComparison;
    marginCopy: string;
    hfDifference: number | null;
    liquidationBtcDifference: number | null;
  };
  wrapperChange: boolean;
  chainChange: boolean;
  classification: MigrationClassification;
  liquiditySufficiency: LiquiditySufficiency;
  liquidityStatusLabel: string;
  executionPathSupported: boolean;
  isExecutable: boolean;
  factualLabels: string[];
  summaryNote?: string;
  benchmark?: {
    benchmarkApr: number;
    currentSpreadBps: number;
    candidateSpreadBps: number;
  } | null;
  holdingScenarios: StaticScenarioResult[];
  freshness: FreshnessState;
  isStale: boolean;
  gasPriceWei?: bigint | number | null;
  ethPriceUsd?: number | null;
  calculatedAt: number;
};

export function classifyCandidate(
  source: { chainId: ChainId; assetSymbol: string; loanSymbol: string },
  candidate: { chainId: ChainId; assetSymbol: string; loanSymbol: string },
): MigrationClassification {
  if (candidate.chainId !== source.chainId) {
    return 'CROSS_CHAIN';
  }
  if (candidate.assetSymbol.toLowerCase() !== source.assetSymbol.toLowerCase()) {
    return 'SAME_CHAIN_WRAPPER_CHANGE';
  }
  return 'SAME_CHAIN_SAME_WRAPPER';
}

export function classificationLabel(classification: MigrationClassification): string {
  switch (classification) {
    case 'SAME_CHAIN_SAME_WRAPPER':
      return 'Same chain · Same wrapper';
    case 'SAME_CHAIN_WRAPPER_CHANGE':
      return 'Same chain · Wrapper change';
    case 'CROSS_CHAIN':
      return 'Cross-chain';
  }
}

export function rankClassification(classification: MigrationClassification): number {
  switch (classification) {
    case 'SAME_CHAIN_SAME_WRAPPER':
      return 1;
    case 'SAME_CHAIN_WRAPPER_CHANGE':
      return 2;
    case 'CROSS_CHAIN':
      return 3;
  }
}

export function calculateSafetyProjection(
  debt: number,
  collateralAmount: number,
  oraclePrice: number,
  liquidationThreshold: number,
): MarketSafetyProjection {
  const collateralUsd = collateralAmount * oraclePrice;
  const ltv = collateralUsd > 0 && debt >= 0 ? debt / collateralUsd : null;
  const healthFactor = debt > 0 && collateralUsd > 0 && liquidationThreshold > 0
    ? (collateralUsd * liquidationThreshold) / debt
    : null;
  const liquidationBtc = collateralAmount > 0 && liquidationThreshold > 0 && debt > 0
    ? debt / (collateralAmount * liquidationThreshold)
    : null;
  const liquidationCushion = liquidationBtc !== null && oraclePrice > 0
    ? (oraclePrice - liquidationBtc) / oraclePrice
    : null;

  return {
    ltv,
    healthFactor,
    liquidationThreshold,
    liquidationBtc,
    liquidationCushion,
  };
}

export function calculateRateStability(
  currentApr: number,
  history?: {
    avg7d?: number | null;
    avg30d?: number | null;
    min7d?: number | null;
    max7d?: number | null;
  } | null,
): RateStabilityMetrics {
  const avg7d = history?.avg7d ?? null;
  const avg30d = history?.avg30d ?? null;
  const min7d = history?.min7d ?? null;
  const max7d = history?.max7d ?? null;
  const hasHistory = (typeof avg7d === 'number' && Number.isFinite(avg7d))
    || (typeof avg30d === 'number' && Number.isFinite(avg30d));

  return {
    currentApr,
    avg7d,
    avg30d,
    min7d,
    max7d,
    hasHistory,
    stabilityNote: hasHistory ? undefined : 'Historical stability unavailable.',
  };
}

export function estimateMigrationCost(input: {
  classification: MigrationClassification;
  gasPriceWei?: number | bigint | null;
  ethPriceUsd?: number | null;
}): MigrationCostEstimate {
  const isSameChainSameWrapper = input.classification === 'SAME_CHAIN_SAME_WRAPPER';

  const repayGas = REFINANCE_GAS_UNITS.repay;
  const withdrawGas = REFINANCE_GAS_UNITS.withdraw;
  const approveGas = REFINANCE_GAS_UNITS.approve;
  const supplyGas = REFINANCE_GAS_UNITS.supply;
  const borrowGas = REFINANCE_GAS_UNITS.borrow;
  const totalGasUnits = REFINANCE_GAS_UNITS.total;

  let isCostKnown = false;
  let estimatedCostUsd: number | null = null;
  let transactionCount = 5; // repay, withdraw, approve, supply, borrow
  let swapCostStatus: 'NOT_NEEDED' | 'UNKNOWN' = 'NOT_NEEDED';
  let bridgeCostStatus: 'NOT_NEEDED' | 'UNKNOWN' = 'NOT_NEEDED';
  let slippageStatus: 'NOT_NEEDED' | 'UNKNOWN' = 'NOT_NEEDED';
  let explanation = '';

  if (input.classification === 'SAME_CHAIN_WRAPPER_CHANGE') {
    transactionCount = 6; // + swap
    swapCostStatus = 'UNKNOWN';
    slippageStatus = 'UNKNOWN';
    isCostKnown = false;
    estimatedCostUsd = null;
    explanation = 'Cost unavailable: swap fee estimate unavailable.';
  } else if (input.classification === 'CROSS_CHAIN') {
    transactionCount = 6; // + bridge
    bridgeCostStatus = 'UNKNOWN';
    isCostKnown = false;
    estimatedCostUsd = null;
    explanation = 'Cost unavailable: cross-chain bridge fee estimate unavailable.';
  } else if (isSameChainSameWrapper) {
    if (input.gasPriceWei == null) {
      isCostKnown = false;
      estimatedCostUsd = null;
      explanation = 'Cost unavailable: network gas fee estimate unavailable.';
    } else if (input.ethPriceUsd == null) {
      isCostKnown = false;
      estimatedCostUsd = null;
      explanation = 'Cost unavailable: ETH price estimate unavailable.';
    } else {
      const wei = typeof input.gasPriceWei === 'bigint' ? Number(input.gasPriceWei) : Number(input.gasPriceWei);
      const gasEth = (Number(totalGasUnits) * wei) / 1e18;
      estimatedCostUsd = gasEth * Number(input.ethPriceUsd);
      isCostKnown = true;
      explanation = 'Estimated standard 5-step on-chain transaction gas costs.';
    }
  }

  return {
    isCostKnown,
    estimatedCostUsd,
    transactionCount,
    repayGasUnits: repayGas,
    withdrawGasUnits: withdrawGas,
    approvalGasUnits: approveGas,
    supplyGasUnits: supplyGas,
    borrowGasUnits: borrowGas,
    swapCostStatus,
    bridgeCostStatus,
    slippageStatus,
    explanation,
  };
}

export function calculateBreakEvenDays(
  debt: number,
  currentApr: number,
  candidateApr: number,
  migrationCostUsd: number | null,
): number | null {
  const annualSavings = debt * (currentApr - candidateApr);
  if (!(annualSavings > 0)) {
    return null;
  }
  if (migrationCostUsd === null || !(migrationCostUsd > 0)) {
    return null;
  }
  return (migrationCostUsd / annualSavings) * 365;
}

export function calculateStaticScenario(
  debt: number,
  currentApr: number,
  candidateApr: number,
  days: number,
  migrationCostUsd: number | null,
): StaticScenarioResult {
  const fraction = days / 365;
  const stayEstimatedInterest = debt * currentApr * fraction;
  const candidateEstimatedInterest = debt * candidateApr * fraction;
  const grossInterestSaved = stayEstimatedInterest - candidateEstimatedInterest;
  const netDifference = migrationCostUsd !== null ? grossInterestSaved - migrationCostUsd : null;

  let label = `${days} days`;
  if (days === 365) label = '1 year';

  return {
    days,
    label,
    stayEstimatedInterest,
    candidateEstimatedInterest,
    grossInterestSaved,
    migrationCost: migrationCostUsd,
    netDifference,
    disclaimer: 'Static-rate scenario — not a forecast. Assumes rates remain unchanged.',
  };
}

export function compareLiquidationMargins(
  sourceLiquidationBtc: number | null,
  candidateLiquidationBtc: number | null,
): { marginComparison: MarginComparison; marginCopy: string; diff: number | null } {
  if (sourceLiquidationBtc === null || candidateLiquidationBtc === null) {
    return {
      marginComparison: 'EQUAL_MARGIN',
      marginCopy: 'Liquidation margin comparison unavailable',
      diff: null,
    };
  }
  const diff = candidateLiquidationBtc - sourceLiquidationBtc;
  // If candidate liquidation price is higher, liquidation happens at a higher BTC price => less cushion!
  if (diff > 50) {
    return {
      marginComparison: 'LESS_MARGIN',
      marginCopy: 'Candidate has less liquidation margin',
      diff,
    };
  }
  if (diff < -50) {
    return {
      marginComparison: 'MORE_MARGIN',
      marginCopy: 'Candidate has more liquidation margin',
      diff,
    };
  }
  return {
    marginComparison: 'EQUAL_MARGIN',
    marginCopy: 'Equal liquidation margin',
    diff: 0,
  };
}

export function buildMigrationPlan(input: {
  sourceMarket: RefinanceMarketBaseline;
  destinationMarket: RefinanceCandidate;
  gasPriceWei?: number | bigint | null;
  ethPriceUsd?: number | null;
  benchmarkApr?: number | null;
  now?: number;
}): MigrationPlan {
  const now = input.now ?? Date.now();
  const { sourceMarket, destinationMarket } = input;
  const debt = sourceMarket.debt;
  const collateral = sourceMarket.collateralAmount;
  const currentApr = sourceMarket.currentApr;
  const candidateApr = destinationMarket.currentApr;

  const aprDifference = currentApr - candidateApr;
  const rateDifferenceBps = Math.round(Math.abs(aprDifference) * 10_000);
  const rateDirection: RateDirection =
    aprDifference > 0.00005 ? 'lower' : aprDifference < -0.00005 ? 'higher' : 'equal';

  let spreadClassification = 'TINY';
  if (rateDifferenceBps >= 50) {
    spreadClassification = 'MATERIAL';
  } else if (rateDifferenceBps >= 25) {
    spreadClassification = 'MODEST';
  } else if (rateDifferenceBps >= 2) {
    spreadClassification = 'SMALL';
  }

  let rateDisplay = `→ 0 bps approximately equal rate`;
  if (rateDirection === 'lower') {
    rateDisplay = `↓ ${rateDifferenceBps} bps lower current rate`;
  } else if (rateDirection === 'higher') {
    rateDisplay = `↑ ${rateDifferenceBps} bps higher current rate`;
  }

  const grossAnnualDifference = debt * aprDifference;
  const monthlyDifference = grossAnnualDifference / 12;
  const dailyDifference = grossAnnualDifference / 365;

  const estimatedCosts = estimateMigrationCost({
    classification: destinationMarket.classification,
    gasPriceWei: input.gasPriceWei,
    ethPriceUsd: input.ethPriceUsd,
  });

  const breakEvenDays = calculateBreakEvenDays(
    debt,
    currentApr,
    candidateApr,
    estimatedCosts.estimatedCostUsd,
  );
  const breakEvenMonths = breakEvenDays !== null ? breakEvenDays / 30 : null;

  const destinationSafety = calculateSafetyProjection(
    debt,
    collateral,
    destinationMarket.venue.priceUsd || sourceMarket.oraclePrice,
    destinationMarket.liquidationThreshold,
  );

  const marginAnalysis = compareLiquidationMargins(
    sourceMarket.safety.liquidationBtc,
    destinationSafety.liquidationBtc,
  );

  const liquiditySufficiency: LiquiditySufficiency =
    destinationMarket.availableLiquidity >= debt ? 'SUFFICIENT' : 'INSUFFICIENT';
  const liquidityStatusLabel =
    liquiditySufficiency === 'INSUFFICIENT' ? 'INSUFFICIENT LIQUIDITY' : 'SUFFICIENT LIQUIDITY';

  const wrapperChange = destinationMarket.classification === 'SAME_CHAIN_WRAPPER_CHANGE';
  const chainChange = destinationMarket.classification === 'CROSS_CHAIN';

  // Add executionPathSupported explicitly per requirement 8: "Do not assume execution is supported."
  const isExecutable = liquiditySufficiency === 'SUFFICIENT' && !wrapperChange && !chainChange;

  // Factual descriptive labels (no hidden composite score)
  const factualLabels: string[] = [];
  if (rateDirection === 'lower') factualLabels.push('LOWER CURRENT RATE');
  else if (rateDirection === 'higher') factualLabels.push('HIGHER CURRENT RATE');

  if (destinationMarket.classification === 'SAME_CHAIN_SAME_WRAPPER') {
    factualLabels.push('SAME CHAIN / SAME WRAPPER');
  } else if (destinationMarket.classification === 'SAME_CHAIN_WRAPPER_CHANGE') {
    factualLabels.push('COLLATERAL WRAPPER CHANGE');
  } else if (destinationMarket.classification === 'CROSS_CHAIN') {
    factualLabels.push('CROSS-CHAIN');
  }

  if (destinationMarket.availableLiquidity >= debt * 10) {
    factualLabels.push('DEEPEST LIQUIDITY');
  }

  if (breakEvenDays !== null && breakEvenDays <= 90) {
    factualLabels.push('SHORTER BREAK-EVEN');
  }

  if (marginAnalysis.marginComparison === 'MORE_MARGIN') {
    factualLabels.push('MORE LIQUIDATION MARGIN');
  } else if (marginAnalysis.marginComparison === 'LESS_MARGIN') {
    factualLabels.push('LESS LIQUIDATION MARGIN');
  }

  if (liquiditySufficiency === 'INSUFFICIENT') {
    factualLabels.push('INSUFFICIENT LIQUIDITY');
  }

  let summaryNote: string | undefined;
  if (rateDirection === 'lower' && breakEvenDays !== null && breakEvenDays <= 180) {
    summaryNote = 'Lower current rates are available';
  } else if (rateDirection === 'equal' || rateDirection === 'higher') {
    summaryNote = 'Current market remains competitive';
  } else if (estimatedCosts.estimatedCostUsd !== null && breakEvenDays !== null && breakEvenDays > 365) {
    summaryNote = 'Migration costs exceed the modeled short-term rate benefit';
  }

  const benchmark = input.benchmarkApr !== undefined && input.benchmarkApr !== null
    ? {
        benchmarkApr: input.benchmarkApr,
        currentSpreadBps: Math.round((input.benchmarkApr - currentApr) * 10_000),
        candidateSpreadBps: Math.round((input.benchmarkApr - candidateApr) * 10_000),
      }
    : null;

  const holdingScenarios = STATIC_SCENARIO_PERIODS.map((days) =>
    calculateStaticScenario(debt, currentApr, candidateApr, days, estimatedCosts.estimatedCostUsd),
  );

  const isStale = destinationMarket.isStale || destinationMarket.freshness === 'stale' || sourceMarket.freshness === 'stale';
  const freshness: FreshnessState = isStale
    ? 'stale'
    : (destinationMarket.freshness === 'fresh' && sourceMarket.freshness === 'fresh')
      ? 'fresh'
      : 'unavailable';

  return {
    sourceMarket,
    destinationMarket,
    debt,
    collateral,
    currentApr,
    candidateApr,
    aprDifference,
    rateDifferenceBps,
    rateDirection,
    rateDisplay,
    spreadClassification: spreadClassification as 'SMALL' | 'MODEST' | 'MATERIAL' | 'TINY',
    grossAnnualDifference,
    monthlyDifference,
    dailyDifference,
    estimatedCosts,
    breakEvenDays,
    breakEvenMonths,
    sourceSafety: sourceMarket.safety,
    destinationSafety,
    safetyComparison: {
      marginComparison: marginAnalysis.marginComparison,
      marginCopy: marginAnalysis.marginCopy,
      hfDifference: sourceMarket.safety.healthFactor !== null && destinationSafety.healthFactor !== null
        ? destinationSafety.healthFactor - sourceMarket.safety.healthFactor
        : null,
      liquidationBtcDifference: marginAnalysis.diff,
    },
    wrapperChange,
    chainChange,
    classification: destinationMarket.classification,
    liquiditySufficiency,
    liquidityStatusLabel,
    executionPathSupported: !wrapperChange && !chainChange,
    isExecutable,
    factualLabels,
    summaryNote,
    benchmark,
    holdingScenarios,
    freshness,
    isStale,
    gasPriceWei: input.gasPriceWei ?? null,
    ethPriceUsd: input.ethPriceUsd ?? null,
    calculatedAt: now,
  };
}

export function findRefinanceCandidates(
  sourceVenue: Venue,
  allVenues: Venue[],
  now = Date.now(),
  maxAgeMs = STALE_THRESHOLD_MS,
): RefinanceCandidate[] {
  const borrowVenues = dedupeVenues(allVenues.filter(
    (v) => v.action === 'borrow' && v.id !== sourceVenue.id,
  ), 'borrow');

  const candidates: RefinanceCandidate[] = borrowVenues.map((venue) => {
    const classification = classifyCandidate(sourceVenue, venue);
    const label = classificationLabel(classification);
    const availableLiquidity = availableToBorrowUsd(venue);
    const fetchedAt = venue.freshness?.fetchedAt ?? 0;
    const isStale = fetchedAt <= 0 || now - fetchedAt > (maxAgeMs === ACTIONABLE_FRESHNESS_MAX_AGE_MS ? maxAgeMs + 5_000 : maxAgeMs);
    const freshness: FreshnessState = !venue.freshness || fetchedAt <= 0
      ? 'unavailable'
      : isStale
        ? 'stale'
        : 'fresh';

    const threshold =
      venue.collateralRisk?.liquidationLtv ??
      venue.collateralRisk?.liquidationThreshold ??
      venue.maxLtv;

    return {
      id: venue.id,
      protocol: venue.protocol,
      chainId: venue.chainId,
      marketId: venue.id,
      collateral: venue.assetSymbol,
      debtAsset: venue.loanSymbol,
      currentApr: venue.borrowApr,
      stability: calculateRateStability(venue.borrowApr, venue.rateHistory),
      liquidationThreshold: threshold,
      availableLiquidity,
      utilization: venue.utilization ?? venue.liquidity?.utilization ?? null,
      freshness,
      wrapper: venue.assetSymbol,
      oracle: venue.morpho?.oracle,
      classification,
      classificationLabel: label,
      isStale,
      venue,
    };
  });

  // Sort according to Section 4 order of preference:
  // 1. Same chain + same collateral wrapper + same debt asset
  // 2. Same chain but different BTC wrapper
  // 3. Cross-chain alternatives
  // Secondary: lowest APR first
  candidates.sort((a, b) => {
    const rankA = rankClassification(a.classification);
    const rankB = rankClassification(b.classification);
    if (rankA !== rankB) return rankA - rankB;
    return a.currentApr - b.currentApr;
  });

  return candidates;
}

export function toActionableMarketSnapshot(
  venue: Venue,
  now = Date.now(),
  maxAgeMs = ACTIONABLE_FRESHNESS_MAX_AGE_MS,
): ActionableMarketSnapshot {
  const fetchedAt = venue.freshness?.fetchedAt ?? 0;
  const isStale = fetchedAt <= 0 || (now - fetchedAt) > (maxAgeMs === ACTIONABLE_FRESHNESS_MAX_AGE_MS ? maxAgeMs + 5_000 : maxAgeMs);
  const liquidationThreshold =
    venue.collateralRisk?.liquidationLtv ??
    venue.collateralRisk?.liquidationThreshold ??
    venue.maxLtv;

  return Object.freeze({
    canonicalMarketId: canonicalMarketKey(venue),
    protocol: venue.protocol,
    chainId: venue.chainId,
    collateralAsset: venue.assetSymbol,
    debtAsset: venue.loanSymbol,
    currentApr: venue.borrowApr,
    availableLiquidity: venue.liquidityUsd ?? venue.liquidity?.availableToBorrow ?? 0,
    liquidationThreshold,
    oraclePrice: venue.priceUsd,
    fetchedAt,
    blockNumber: venue.freshness?.blockNumber ?? null,
    sourceProvider: venue.freshness?.source ?? venue.protocol,
    isStale,
    venue,
  });
}

export async function loadActionableMarketSnapshot(
  marketId: string,
  options?: {
    fresh?: boolean;
    maxAgeMs?: number;
    venues?: Venue[];
    now?: number;
  },
): Promise<ActionableMarketSnapshot> {
  const now = options?.now ?? Date.now();
  const maxAgeMs = options?.maxAgeMs ?? ACTIONABLE_FRESHNESS_MAX_AGE_MS;
  const fresh = options?.fresh ?? true;

  let pool: Venue[] = options?.venues ?? [];
  if (fresh || pool.length === 0) {
    const { getRates } = await import('@/lib/rates');
    const ratesPayload = await getRates({ bypassCache: fresh, strict: true });
    pool = ratesPayload.venues;
  }

  const match = pool.find((v) =>
    v.id === marketId ||
    canonicalMarketKey(v) === marketId ||
    protocolMarketId(v) === marketId,
  );

  if (!match) {
    throw new Error(`Authoritative market read unavailable: market ${marketId} not found.`);
  }

  const snapshot = toActionableMarketSnapshot(match, now, maxAgeMs);
  if (snapshot.isStale) {
    throw new Error(`Authoritative market data for ${marketId} is stale (fetched ${Math.round((now - snapshot.fetchedAt) / 1000)}s ago, exceeds ${maxAgeMs / 1000}s limit).`);
  }
  if (!Number.isFinite(snapshot.currentApr) || snapshot.currentApr < 0) {
    throw new Error(`Authoritative borrow APR for ${marketId} is invalid.`);
  }
  if (!Number.isFinite(snapshot.availableLiquidity) || snapshot.availableLiquidity < 0) {
    throw new Error(`Authoritative liquidity for ${marketId} is invalid.`);
  }
  if (snapshot.oraclePrice <= 0) {
    throw new Error(`Authoritative oracle price for ${marketId} is missing or non-positive.`);
  }

  return snapshot;
}

export function actionableSnapshotToBaseline(
  snapshot: ActionableMarketSnapshot,
  position: {
    debt: number;
    collateralAmount: number;
    openingApr?: number | null;
    ltv?: number | null;
    healthFactor?: number | null;
    liquidationPrice?: number | null;
    liquidationCushion?: number | null;
  },
  now = Date.now(),
): RefinanceMarketBaseline {
  const safety = calculateSafetyProjection(
    position.debt,
    position.collateralAmount,
    snapshot.oraclePrice,
    snapshot.liquidationThreshold,
  );
  const freshness: FreshnessState = snapshot.fetchedAt <= 0
    ? 'unavailable'
    : snapshot.isStale
      ? 'stale'
      : 'fresh';

  return {
    id: snapshot.venue.id,
    protocol: snapshot.protocol,
    chainId: snapshot.chainId,
    marketId: snapshot.canonicalMarketId,
    collateralAsset: snapshot.collateralAsset,
    debtAsset: snapshot.debtAsset,
    collateralAmount: position.collateralAmount,
    collateralValueUsd: position.collateralAmount * snapshot.oraclePrice,
    debt: position.debt,
    currentApr: snapshot.currentApr,
    openingApr: position.openingApr ?? null,
    safety: {
      ltv: position.ltv ?? safety.ltv,
      healthFactor: position.healthFactor ?? safety.healthFactor,
      liquidationThreshold: snapshot.liquidationThreshold,
      liquidationBtc: position.liquidationPrice ?? safety.liquidationBtc,
      liquidationCushion: position.liquidationCushion ?? safety.liquidationCushion,
    },
    availableLiquidity: snapshot.availableLiquidity,
    utilization: snapshot.venue.utilization ?? null,
    freshness,
    oraclePrice: snapshot.oraclePrice,
    stability: calculateRateStability(snapshot.currentApr, snapshot.venue.rateHistory),
  };
}

export function actionableSnapshotToCandidate(
  sourceSnapshot: ActionableMarketSnapshot,
  destSnapshot: ActionableMarketSnapshot,
  now = Date.now(),
): RefinanceCandidate {
  const isSameChain = sourceSnapshot.chainId === destSnapshot.chainId;
  const isSameWrapper = sourceSnapshot.collateralAsset === destSnapshot.collateralAsset;
  let classification: MigrationClassification = 'SAME_CHAIN_SAME_WRAPPER';
  let classificationLabel = 'Same chain · Same wrapper';

  if (!isSameChain) {
    classification = 'CROSS_CHAIN';
    classificationLabel = `Cross-chain (${chainLabel(destSnapshot.chainId)})`;
  } else if (!isSameWrapper) {
    classification = 'SAME_CHAIN_WRAPPER_CHANGE';
    classificationLabel = `Wrapper change (${destSnapshot.collateralAsset})`;
  }

  const freshness: FreshnessState = destSnapshot.fetchedAt <= 0
    ? 'unavailable'
    : destSnapshot.isStale
      ? 'stale'
      : 'fresh';

  return {
    id: destSnapshot.venue.id,
    protocol: destSnapshot.protocol,
    chainId: destSnapshot.chainId,
    marketId: destSnapshot.canonicalMarketId,
    collateral: destSnapshot.collateralAsset,
    debtAsset: destSnapshot.debtAsset,
    currentApr: destSnapshot.currentApr,
    stability: calculateRateStability(destSnapshot.currentApr, destSnapshot.venue.rateHistory),
    liquidationThreshold: destSnapshot.liquidationThreshold,
    availableLiquidity: destSnapshot.availableLiquidity,
    utilization: destSnapshot.venue.utilization ?? null,
    freshness,
    wrapper: destSnapshot.collateralAsset,
    classification,
    classificationLabel,
    isStale: destSnapshot.isStale,
    venue: destSnapshot.venue,
  };
}
