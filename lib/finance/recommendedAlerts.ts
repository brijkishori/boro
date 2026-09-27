import { priceAtHealthFactor } from '@/lib/finance/liquidation';

export const RECOMMENDED_ALERT_DEFAULTS = {
  preferredHealthFactor: 2.5,
  healthFactor: {
    watch: 2.5,
    prepare: 2,
    act: 1.5,
    urgent: 1.25,
    liquidation: 1,
  },
  cushionFraction: 0.5,
  rateBufferBps: {
    watchBelowBenchmark: 100,
    highCostAboveBenchmark: 150,
  },
  ratePersistenceMs: {
    watch: 6 * 3_600_000,
    breakEven: 12 * 3_600_000,
    highCost: 24 * 3_600_000,
  },
  rateJumpBps: {
    within6h: 50,
    within24h: 100,
  },
  utilization: {
    watch: 0.95,
    high: 0.98,
    watchPersistenceMs: 2 * 3_600_000,
    highPersistenceMs: 0,
  },
  liquidityDropFraction: 0.5,
  staleDataMs: 10 * 60_000,
  cooldownMs: 12 * 3_600_000,
  emailResolutions: false,
} as const;

export type AlertCategory = 'position-safety' | 'borrowing-cost' | 'market-stress' | 'data-health' | 'reporting';
export type AlertSeverity = 'watch' | 'prepare' | 'act' | 'urgent' | 'info';

export const ALERT_ACTIONS: Record<AlertSeverity, string> = {
  watch: 'No action required. Review if conditions continue deteriorating.',
  prepare: 'Ensure repayment USDC and/or additional collateral are readily available.',
  act: 'Evaluate repayment or additional collateral to restore your configured target HF.',
  urgent: 'Immediate corrective action is recommended to increase liquidation margin.',
  info: 'Review the notice. Nothing is sent automatically.',
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  watch: 1,
  prepare: 2,
  act: 3,
  urgent: 4,
};

export type AlertRecommendationInput = {
  wallet: string;
  chainId: number;
  protocol: string;
  marketId: string;
  collateralAmount: number;
  debtUsd: number;
  oraclePriceUsd: number;
  healthFactor: number | null;
  ltv: number | null;
  liquidationThreshold: number;
  liquidationPriceUsd: number | null;
  cushion: number | null;
  borrowApr: number;
  benchmarkApr?: number | null;
  utilization?: number | null;
  liquidityUsd?: number | null;
  recentLiquidityUsd?: number | null;
  aprChange6hBps?: number | null;
  aprChange24hBps?: number | null;
  recentUtilization?: number | null;
  recentBorrowApr?: number | null;
  historyAdequate?: boolean;
  freshnessAgeMs?: number | null;
  positionReadFailed?: boolean;
  oracleStale?: boolean;
  customRateThresholds?: { watch?: number; breakEven?: number; highCost?: number } | null;
};

export type AlertRuleConfig = {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  alertType: string;
  threshold: number | null;
  persistenceMs: number;
  selected: boolean;
  enabled: boolean;
  channel: 'email';
};

export type AlertDescription = {
  trigger: string;
  currentValue: string;
  reason: string;
  action: string;
  equivalentLtv: number | null;
  equivalentBtcPrice: number | null;
  btcDistance: number | null;
  hfDistance: number | null;
};

export type AlertRuntimeState = {
  alertType: string;
  lastTriggeredAt?: number;
  currentSeverity?: AlertSeverity | null;
  lastObservedValue?: number | null;
  acknowledgedAt?: number | null;
  resolvedAt?: number | null;
  breachSince?: number | null;
  paused?: boolean;
  resumePending?: boolean;
};

export type AlertEvent = {
  protocol: string;
  chainId: number;
  marketId: string;
  wallet: string;
  severity: AlertSeverity;
  alertType: string;
  category: AlertCategory;
  currentPositionDebtUsd: number;
  currentHf: number | null;
  currentLtv: number | null;
  currentOraclePrice: number | null;
  liquidationPrice: number | null;
  threshold: number | null;
  distanceToThreshold: number | null;
  timestamp: number;
  groupedTypes: string[];
  message: string;
};

export type StoredRecommendedPlan = {
  marketKey: string;
  wallet: string;
  chainId: number;
  protocol: string;
  marketId: string;
  preferredHealthFactor: number;
  benchmarkApr: number | null;
  approved: boolean;
  emailResolutions: boolean;
  rules: AlertRuleConfig[];
  states: AlertRuntimeState[];
};

export function alertMarketKey(input: { wallet: string; chainId: number; protocol: string; marketId: string }) {
  return `${input.wallet.toLowerCase()}:${input.chainId}:${input.protocol.toLowerCase()}:${input.marketId.toLowerCase()}`;
}

export function equivalentLtv(liquidationThreshold: number, healthFactor: number): number | null {
  if (!(liquidationThreshold > 0) || !(healthFactor > 0)) return null;
  return liquidationThreshold / healthFactor;
}

export function equivalentBtcPrice(
  debtUsd: number,
  collateralAmount: number,
  liquidationThreshold: number,
  healthFactor: number,
): number | null {
  return priceAtHealthFactor(collateralAmount, debtUsd, liquidationThreshold, healthFactor);
}

export function benchmarkRateThresholds(benchmarkApr: number | null | undefined) {
  if (benchmarkApr === null || benchmarkApr === undefined || !Number.isFinite(benchmarkApr) || benchmarkApr < 0 || benchmarkApr >= 1) {
    return null;
  }
  const watchGap = RECOMMENDED_ALERT_DEFAULTS.rateBufferBps.watchBelowBenchmark / 10_000;
  const highGap = RECOMMENDED_ALERT_DEFAULTS.rateBufferBps.highCostAboveBenchmark / 10_000;
  return {
    watch: Math.max(0, benchmarkApr - watchGap),
    breakEven: benchmarkApr,
    highCost: benchmarkApr + highGap,
  };
}

function ratioText(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function usdText(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function protocolName(protocol: string) {
  return protocol ? protocol.slice(0, 1).toUpperCase() + protocol.slice(1) : 'market';
}

function hfText(value: number) {
  return value.toFixed(2);
}

function rule(
  id: string,
  category: AlertCategory,
  severity: AlertSeverity,
  alertType: string,
  threshold: number | null,
  persistenceMs: number,
): AlertRuleConfig {
  return {
    id,
    category,
    severity,
    alertType,
    threshold,
    persistenceMs,
    selected: true,
    enabled: false,
    channel: 'email',
  };
}

export function generateRecommendedRules(input: AlertRecommendationInput): AlertRuleConfig[] {
  const defaults = RECOMMENDED_ALERT_DEFAULTS;
  const rules: AlertRuleConfig[] = [];
  if (input.liquidationThreshold > 0) {
    rules.push(
      rule('hf-watch', 'position-safety', 'watch', 'hf-watch', defaults.healthFactor.watch, 0),
      rule('hf-prepare', 'position-safety', 'prepare', 'hf-prepare', defaults.healthFactor.prepare, 0),
      rule('hf-act', 'position-safety', 'act', 'hf-act', defaults.healthFactor.act, 0),
      rule('hf-urgent', 'position-safety', 'urgent', 'hf-urgent', defaults.healthFactor.urgent, 0),
    );
  }
  if (input.liquidationPriceUsd !== null && input.oraclePriceUsd > 0) {
    rules.push(rule('btc-cushion', 'position-safety', 'watch', 'btc-cushion', defaults.cushionFraction, 0));
  }
  const derived = benchmarkRateThresholds(input.benchmarkApr);
  const custom = input.customRateThresholds;
  const watchApr = derived?.watch ?? custom?.watch;
  const breakEvenApr = derived?.breakEven ?? custom?.breakEven;
  const highApr = derived?.highCost ?? custom?.highCost;
  if (watchApr !== undefined) rules.push(rule('rate-watch', 'borrowing-cost', 'watch', 'rate-watch', watchApr, defaults.ratePersistenceMs.watch));
  if (breakEvenApr !== undefined) rules.push(rule('rate-break-even', 'borrowing-cost', 'prepare', 'rate-break-even', breakEvenApr, defaults.ratePersistenceMs.breakEven));
  if (highApr !== undefined) rules.push(rule('rate-high', 'borrowing-cost', 'act', 'rate-high', highApr, defaults.ratePersistenceMs.highCost));
  rules.push(rule('rate-velocity', 'borrowing-cost', 'watch', 'rate-velocity', defaults.rateJumpBps.within6h, 0));
  if (typeof input.utilization === 'number' && Number.isFinite(input.utilization)) {
    rules.push(
      rule('utilization-watch', 'market-stress', 'watch', 'utilization-watch', defaults.utilization.watch, defaults.utilization.watchPersistenceMs),
      rule('utilization-high', 'market-stress', 'act', 'utilization-high', defaults.utilization.high, defaults.utilization.highPersistenceMs),
    );
  }
  if (typeof input.liquidityUsd === 'number' && Number.isFinite(input.liquidityUsd)) {
    rules.push(rule('liquidity', 'market-stress', 'watch', 'liquidity', defaults.liquidityDropFraction, 0));
  }
  rules.push(rule('data-stale', 'data-health', 'info', 'data-stale', defaults.staleDataMs, 0));
  rules.push(rule('monthly-statement', 'reporting', 'info', 'monthly-statement', null, 0));
  return rules;
}

export function describeRecommendedAlert(config: AlertRuleConfig, input: AlertRecommendationInput): AlertDescription {
  const action = ALERT_ACTIONS[config.severity];
  if (config.alertType.startsWith('hf-') && config.threshold !== null) {
    const ltv = equivalentLtv(input.liquidationThreshold, config.threshold);
    const price = equivalentBtcPrice(input.debtUsd, input.collateralAmount, input.liquidationThreshold, config.threshold);
    const btcDistance = price !== null && input.oraclePriceUsd > 0 ? (input.oraclePriceUsd - price) / input.oraclePriceUsd : null;
    const hfDistance = input.healthFactor !== null ? input.healthFactor - config.threshold : null;
    return {
      trigger: `HF <= ${hfText(config.threshold)}`,
      currentValue: input.healthFactor === null ? 'No health factor' : `HF ${hfText(input.healthFactor)}`,
      reason: 'Early warning on the health-factor ladder. The BTC trigger is recalculated from the live debt, collateral, and liquidation threshold.',
      action,
      equivalentLtv: ltv,
      equivalentBtcPrice: price,
      btcDistance,
      hfDistance,
    };
  }
  if (config.alertType === 'btc-cushion') {
    return {
      trigger: `BTC cushion <= ${ratioText(config.threshold, 0)}`,
      currentValue: input.cushion === null ? 'Cushion unavailable' : `Cushion ${ratioText(input.cushion, 0)}`,
      reason: 'One early warning for distance to liquidation. It is grouped with a health-factor alert when both fire together.',
      action,
      equivalentLtv: null,
      equivalentBtcPrice: input.liquidationPriceUsd,
      btcDistance: input.cushion,
      hfDistance: null,
    };
  }
  if (config.alertType === 'rate-watch' || config.alertType === 'rate-break-even' || config.alertType === 'rate-high') {
    const label = config.alertType === 'rate-watch' ? 'Watch rate' : config.alertType === 'rate-break-even' ? 'Break-even' : 'High cost';
    return {
      trigger: `${label}: borrow APR >= ${ratioText(config.threshold)}`,
      currentValue: `Borrow APR ${ratioText(input.borrowApr)}`,
      reason: input.benchmarkApr !== null && input.benchmarkApr !== undefined
        ? 'Derived from the saved financing benchmark. A short spike must persist before this sends.'
        : 'Custom APR threshold. No financing benchmark is saved.',
      action,
      equivalentLtv: null,
      equivalentBtcPrice: null,
      btcDistance: null,
      hfDistance: null,
    };
  }
  if (config.alertType === 'rate-velocity') {
    return {
      trigger: `+${RECOMMENDED_ALERT_DEFAULTS.rateJumpBps.within6h} bps in 6h or +${RECOMMENDED_ALERT_DEFAULTS.rateJumpBps.within24h} bps in 24h`,
      currentValue: input.historyAdequate ? `Borrow APR ${ratioText(input.borrowApr)}` : 'Rate history is not adequate yet',
      reason: 'Speed of the borrow rate, separate from the benchmark level. Missing history is not treated as zero change.',
      action,
      equivalentLtv: null,
      equivalentBtcPrice: null,
      btcDistance: null,
      hfDistance: null,
    };
  }
  if (config.alertType.startsWith('utilization-')) {
    return {
      trigger: `Utilization >= ${ratioText(config.threshold, 0)}`,
      currentValue: typeof input.utilization === 'number'
        ? `Utilization ${ratioText(input.utilization, 0)}. Recent ${ratioText(input.recentUtilization, 0)}. APR ${ratioText(input.borrowApr)}. Recent APR ${input.recentBorrowApr === null || input.recentBorrowApr === undefined ? 'unavailable' : input.borrowApr > input.recentBorrowApr ? 'up' : input.borrowApr < input.recentBorrowApr ? 'down' : 'flat'}`
        : 'Utilization unavailable',
      reason: 'Utilization stress for markets that publish it. This is not a liquidation warning.',
      action,
      equivalentLtv: null,
      equivalentBtcPrice: null,
      btcDistance: null,
      hfDistance: null,
    };
  }
  if (config.alertType === 'liquidity') {
    return {
      trigger: 'Available liquidity falls by more than half, or below outstanding debt',
      currentValue: typeof input.liquidityUsd === 'number' ? `Available liquidity ${usdText(input.liquidityUsd)}` : 'Liquidity unavailable',
      reason: 'Relative to the recent baseline and to this loan. Not a fixed dollar cutoff.',
      action,
      equivalentLtv: null,
      equivalentBtcPrice: null,
      btcDistance: null,
      hfDistance: null,
    };
  }
  if (config.alertType === 'data-stale') {
    return {
      trigger: 'Oracle, rate, or position read is stale or failed',
      currentValue: input.positionReadFailed ? 'Position read failed' : input.oracleStale ? 'Oracle stale' : 'Data check',
      reason: 'Data warning only. It is not a financial-risk alert.',
      action: ALERT_ACTIONS.info,
      equivalentLtv: null,
      equivalentBtcPrice: null,
      btcDistance: null,
      hfDistance: null,
    };
  }
  return {
    trigger: 'Monthly statement',
    currentValue: input.debtUsd > 0 ? 'Open loan' : 'No open debt',
    reason: 'A monthly report of debt, interest, LTV, health factor, liquidation price, cushion, and the financing benchmark when one is saved.',
    action: ALERT_ACTIONS.info,
    equivalentLtv: null,
    equivalentBtcPrice: null,
    btcDistance: null,
    hfDistance: null,
  };
}

function positionSafetyPaused(input: AlertRecommendationInput, config: AlertRuleConfig) {
  return input.debtUsd <= 0 && config.category === 'position-safety';
}

function breached(config: AlertRuleConfig, input: AlertRecommendationInput, statementDue: boolean): { hit: boolean; value: number | null } {
  if (config.alertType.startsWith('hf-')) {
    if (input.healthFactor === null || config.threshold === null) return { hit: false, value: input.healthFactor };
    return { hit: input.healthFactor <= config.threshold, value: input.healthFactor };
  }
  if (config.alertType === 'btc-cushion') {
    if (input.cushion === null || config.threshold === null) return { hit: false, value: input.cushion };
    return { hit: input.cushion <= config.threshold, value: input.cushion };
  }
  if (config.alertType === 'rate-watch' || config.alertType === 'rate-break-even' || config.alertType === 'rate-high') {
    if (config.threshold === null || !Number.isFinite(input.borrowApr)) return { hit: false, value: input.borrowApr };
    return { hit: input.borrowApr >= config.threshold, value: input.borrowApr };
  }
  if (config.alertType === 'rate-velocity') {
    if (!input.historyAdequate) return { hit: false, value: null };
    const six = input.aprChange6hBps ?? null;
    const day = input.aprChange24hBps ?? null;
    const hit = (six !== null && six >= RECOMMENDED_ALERT_DEFAULTS.rateJumpBps.within6h)
      || (day !== null && day >= RECOMMENDED_ALERT_DEFAULTS.rateJumpBps.within24h);
    return { hit, value: six ?? day };
  }
  if (config.alertType === 'utilization-watch' || config.alertType === 'utilization-high') {
    if (typeof input.utilization !== 'number' || config.threshold === null) return { hit: false, value: input.utilization ?? null };
    return { hit: input.utilization >= config.threshold, value: input.utilization };
  }
  if (config.alertType === 'liquidity') {
    const now = input.liquidityUsd;
    const recent = input.recentLiquidityUsd;
    if (typeof now !== 'number') return { hit: false, value: null };
    const dropped = typeof recent === 'number' && recent > 0 && now <= recent * (1 - RECOMMENDED_ALERT_DEFAULTS.liquidityDropFraction);
    const smallVsDebt = input.debtUsd > 0 && now < input.debtUsd;
    return { hit: dropped || smallVsDebt, value: now };
  }
  if (config.alertType === 'data-stale') {
    const stale = input.positionReadFailed === true
      || input.oracleStale === true
      || (typeof input.freshnessAgeMs === 'number' && input.freshnessAgeMs >= RECOMMENDED_ALERT_DEFAULTS.staleDataMs);
    return { hit: stale, value: input.freshnessAgeMs ?? null };
  }
  if (config.alertType === 'monthly-statement') return { hit: statementDue && input.debtUsd > 0, value: input.debtUsd };
  return { hit: false, value: null };
}

function meaningfullyWorse(alertType: string, previous: number | null | undefined, next: number | null) {
  if (previous === null || previous === undefined || next === null) return false;
  if (alertType.startsWith('hf-') || alertType === 'btc-cushion') return next <= previous - 0.1;
  if (alertType.startsWith('rate-') && alertType !== 'rate-velocity') return next >= previous + 0.0025;
  if (alertType.startsWith('utilization-')) return next >= previous + 0.01;
  if (alertType === 'liquidity') return previous > 0 && next <= previous * 0.8;
  return false;
}

export type AlertDecision = {
  action: 'notify' | 'suppress' | 'resolve' | 'pause';
  reason: string;
  state: AlertRuntimeState;
  event?: AlertEvent;
  emailResolution: boolean;
};

export type MonthlyLedger = {
  startingDebtUsd?: number | null;
  principalRepaidUsd?: number | null;
  interestAccruedUsd?: number | null;
  interestPaidUsd?: number | null;
  networkFeesUsd?: number | null;
};

export function monthlyStatementLines(input: AlertRecommendationInput, ledger?: MonthlyLedger): string[] {
  const lines = [
    `Ending debt ${usdText(input.debtUsd)}`,
    `Borrow APR ${ratioText(input.borrowApr)}`,
    `LTV ${ratioText(input.ltv)}`,
    `Health factor ${input.healthFactor === null ? 'unavailable' : hfText(input.healthFactor)}`,
    `Liquidation BTC ${usdText(input.liquidationPriceUsd)}`,
    `Cushion ${ratioText(input.cushion, 0)}`,
    input.benchmarkApr === null || input.benchmarkApr === undefined
      ? 'No financing benchmark saved'
      : `Benchmark APR ${ratioText(input.benchmarkApr)}`,
  ];
  if (!ledger) {
    lines.push('Starting debt, principal repaid, interest paid, and network fees stay in the on-device loan ledger.');
    return lines;
  }
  lines.push(
    ledger.startingDebtUsd === null || ledger.startingDebtUsd === undefined ? 'Starting debt not recorded' : `Starting debt ${usdText(ledger.startingDebtUsd)}`,
    ledger.principalRepaidUsd === null || ledger.principalRepaidUsd === undefined ? 'Principal repaid not recorded' : `Principal repaid ${usdText(ledger.principalRepaidUsd)}`,
    ledger.interestAccruedUsd === null || ledger.interestAccruedUsd === undefined ? 'Interest accrued not recorded' : `Interest accrued ${usdText(ledger.interestAccruedUsd)}`,
    ledger.interestPaidUsd === null || ledger.interestPaidUsd === undefined ? 'Interest paid not recorded' : `Interest paid ${usdText(ledger.interestPaidUsd)}`,
    ledger.networkFeesUsd === null || ledger.networkFeesUsd === undefined ? 'Network fees not recorded' : `Network fees ${usdText(ledger.networkFeesUsd)}`,
  );
  return lines;
}

function velocityMessage(input: AlertRecommendationInput) {
  const six = input.aprChange6hBps;
  const day = input.aprChange24hBps;
  const useSix = typeof six === 'number' && six >= RECOMMENDED_ALERT_DEFAULTS.rateJumpBps.within6h;
  const delta = useSix ? six : day;
  const hours = useSix ? 6 : 24;
  const previous = typeof delta === 'number' ? input.borrowApr - delta / 10_000 : null;
  const extraMonth = typeof delta === 'number' ? (input.debtUsd * delta) / 10_000 / 12 : null;
  const move = previous === null
    ? 'Borrow APR history does not show a measured change.'
    : `Borrow APR increased from ${ratioText(previous)} to ${ratioText(input.borrowApr)} over ${hours} hours.`;
  const benchmark = input.benchmarkApr === null || input.benchmarkApr === undefined
    ? ''
    : ` Benchmark APR ${ratioText(input.benchmarkApr)}.`;
  return `${move} Current debt ${usdText(input.debtUsd)}. Estimated additional monthly interest ${usdText(extraMonth)}.${benchmark}`;
}

function dataMessage(input: AlertRecommendationInput) {
  const name = protocolName(input.protocol);
  if (input.positionReadFailed) return `Data warning: SimpleBTC could not verify a fresh ${name} position.`;
  if (input.oracleStale) return `Data warning: the ${name} oracle price is stale.`;
  const minutes = Math.max(1, Math.round((input.freshnessAgeMs ?? RECOMMENDED_ALERT_DEFAULTS.staleDataMs) / 60_000));
  return `Data warning: SimpleBTC could not verify a fresh ${name} position for ${minutes} minutes.`;
}

function eventFor(
  input: AlertRecommendationInput,
  config: AlertRuleConfig,
  at: number,
  distance: number | null,
): AlertEvent {
  const described = describeRecommendedAlert(config, input);
  const message = config.alertType === 'rate-velocity'
    ? velocityMessage(input)
    : config.alertType === 'data-stale'
      ? dataMessage(input)
      : `${described.trigger}. ${described.action}`;
  return {
    protocol: input.protocol,
    chainId: input.chainId,
    marketId: input.marketId,
    wallet: input.wallet,
    severity: config.severity,
    alertType: config.alertType,
    category: config.category,
    currentPositionDebtUsd: input.debtUsd,
    currentHf: input.healthFactor,
    currentLtv: input.ltv,
    currentOraclePrice: input.oraclePriceUsd,
    liquidationPrice: input.liquidationPriceUsd,
    threshold: config.threshold,
    distanceToThreshold: distance,
    timestamp: at,
    groupedTypes: [config.alertType],
    message,
  };
}

export function evaluateAlertRule(input: {
  config: AlertRuleConfig;
  position: AlertRecommendationInput;
  state?: AlertRuntimeState;
  at: number;
  statementDue?: boolean;
  emailResolutions?: boolean;
  cooldownMs?: number;
}): AlertDecision {
  const prior = input.state ?? { alertType: input.config.alertType };
  const emailResolutions = input.emailResolutions ?? RECOMMENDED_ALERT_DEFAULTS.emailResolutions;
  if (!input.config.enabled) {
    return { action: 'suppress', reason: 'disabled', state: prior, emailResolution: false };
  }
  if (input.position.positionReadFailed && input.config.category !== 'data-health') {
    return { action: 'suppress', reason: 'unread', state: prior, emailResolution: false };
  }
  if (positionSafetyPaused(input.position, input.config)) {
    return {
      action: 'pause',
      reason: 'zero-debt',
      emailResolution: false,
      state: { ...prior, paused: true, resumePending: false, breachSince: undefined, currentSeverity: null },
    };
  }
  if (prior.paused || prior.resumePending) {
    return {
      action: 'suppress',
      reason: 'resume-pending',
      emailResolution: false,
      state: { ...prior, paused: false, resumePending: true },
    };
  }
  const observation = breached(input.config, input.position, input.statementDue === true);
  const distance = input.config.alertType.startsWith('hf-') && input.position.healthFactor !== null && input.config.threshold !== null
    ? input.position.healthFactor - input.config.threshold
    : null;
  if (!observation.hit) {
    if (prior.currentSeverity || prior.breachSince) {
      return {
        action: 'resolve',
        reason: 'recovered',
        emailResolution: emailResolutions,
        state: {
          ...prior,
          currentSeverity: null,
          breachSince: undefined,
          resolvedAt: input.at,
          lastObservedValue: observation.value,
        },
      };
    }
    return {
      action: 'suppress',
      reason: 'clear',
      emailResolution: false,
      state: { ...prior, lastObservedValue: observation.value, breachSince: undefined, currentSeverity: null },
    };
  }
  const since = prior.breachSince ?? input.at;
  const persisted = input.at - since >= input.config.persistenceMs;
  const nextState: AlertRuntimeState = {
    ...prior,
    breachSince: since,
    lastObservedValue: observation.value,
    resolvedAt: undefined,
  };
  if (!persisted) {
    return { action: 'suppress', reason: 'persisting', state: nextState, emailResolution: false };
  }
  const rank = SEVERITY_RANK[input.config.severity];
  const previousRank = prior.currentSeverity ? SEVERITY_RANK[prior.currentSeverity] : 0;
  const escalated = rank > previousRank;
  const cooldownMs = input.cooldownMs ?? RECOMMENDED_ALERT_DEFAULTS.cooldownMs;
  const cooled = !prior.lastTriggeredAt || input.at - prior.lastTriggeredAt >= cooldownMs;
  const worse = meaningfullyWorse(input.config.alertType, prior.lastObservedValue, observation.value);
  if (!escalated && !cooled && !worse && prior.currentSeverity === input.config.severity) {
    return { action: 'suppress', reason: 'cooldown', state: { ...nextState, currentSeverity: input.config.severity }, emailResolution: false };
  }
  const notified: AlertRuntimeState = {
    ...nextState,
    currentSeverity: input.config.severity,
    lastTriggeredAt: input.at,
    lastObservedValue: observation.value,
  };
  return {
    action: 'notify',
    reason: escalated ? 'escalated' : worse ? 'worsened' : 'threshold',
    emailResolution: false,
    state: notified,
    event: eventFor(input.position, input.config, input.at, distance),
  };
}

export function evaluateEnabledPlan(input: {
  rules: AlertRuleConfig[];
  position: AlertRecommendationInput;
  states?: AlertRuntimeState[];
  at: number;
  statementDue?: boolean;
  emailResolutions?: boolean;
}): { decisions: AlertDecision[]; states: AlertRuntimeState[]; notifications: AlertEvent[] } {
  const prior = new Map((input.states ?? []).map((state) => [state.alertType, state]));
  const decisions = input.rules.filter((config) => config.enabled).map((config) => evaluateAlertRule({
    config,
    position: input.position,
    state: prior.get(config.alertType),
    at: input.at,
    statementDue: input.statementDue,
    emailResolutions: input.emailResolutions,
  }));
  const notifications = decisions.flatMap((decision) => (decision.action === 'notify' && decision.event ? [decision.event] : []));
  const grouped = groupNotifications(notifications);
  const groupedTypes = new Set(grouped.map((event) => event.alertType));
  const visible = decisions.map((decision) => {
    if (decision.action === 'notify' && decision.event && !groupedTypes.has(decision.event.alertType)) {
      return { ...decision, action: 'suppress' as const, reason: 'grouped' };
    }
    if (decision.action === 'notify' && decision.event) {
      const match = grouped.find((event) => event.alertType === decision.event?.alertType);
      return match ? { ...decision, event: match } : decision;
    }
    return decision;
  });
  const states = input.rules.map((config) => visible.find((decision) => decision.state.alertType === config.alertType)?.state ?? prior.get(config.alertType) ?? { alertType: config.alertType });
  return { decisions: visible, states, notifications: grouped };
}

function highest(events: AlertEvent[]): AlertEvent | null {
  if (events.length === 0) return null;
  const top = events.slice().sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity])[0];
  return { ...top, groupedTypes: events.map((event) => event.alertType) };
}

function groupNotifications(events: AlertEvent[]): AlertEvent[] {
  const result: AlertEvent[] = [];
  const safety = highest(events.filter((event) => event.category === 'position-safety'));
  const rateLevel = highest(events.filter((event) => event.alertType.startsWith('rate-') && event.alertType !== 'rate-velocity'));
  const utilization = highest(events.filter((event) => event.alertType.startsWith('utilization-')));
  if (safety) result.push(safety);
  if (rateLevel) result.push(rateLevel);
  if (utilization) result.push(utilization);
  for (const event of events) {
    if (event.category === 'position-safety') continue;
    if (event.alertType.startsWith('rate-') && event.alertType !== 'rate-velocity') continue;
    if (event.alertType.startsWith('utilization-')) continue;
    result.push(event);
  }
  return result;
}

export function approveSelectedRules(rules: AlertRuleConfig[], selectedIds: string[]): AlertRuleConfig[] {
  const selected = new Set(selectedIds);
  return rules.map((config) => ({ ...config, selected: selected.has(config.id), enabled: selected.has(config.id) }));
}

export function deliveryKind(event: AlertEvent): 'urgent' | 'health' | 'liquidation' | 'apr' | 'monthly' {
  if (event.alertType === 'monthly-statement') return 'monthly';
  if (event.severity === 'urgent') return 'urgent';
  if (event.alertType === 'btc-cushion') return 'liquidation';
  if (event.category === 'borrowing-cost' || event.category === 'market-stress') return 'apr';
  return 'health';
}

export function resumePositionAlerts(states: AlertRuntimeState[]): AlertRuntimeState[] {
  return states.map((state) => ({ ...state, paused: false, resumePending: false }));
}

export function createRecommendedPlan(input: AlertRecommendationInput, preferredHealthFactor: number = RECOMMENDED_ALERT_DEFAULTS.preferredHealthFactor): StoredRecommendedPlan {
  return {
    marketKey: alertMarketKey(input),
    wallet: input.wallet,
    chainId: input.chainId,
    protocol: input.protocol,
    marketId: input.marketId,
    preferredHealthFactor,
    benchmarkApr: input.benchmarkApr ?? null,
    approved: false,
    emailResolutions: RECOMMENDED_ALERT_DEFAULTS.emailResolutions,
    rules: generateRecommendedRules(input),
    states: [],
  };
}
