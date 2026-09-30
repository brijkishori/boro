import { RECOMMENDED_ALERT_DEFAULTS } from '@/lib/finance/recommendedAlerts';
import {
  currentRiskDecision,
  type FreshnessDomain,
  type RiskSeverity,
  type RiskThresholds,
} from '@/lib/finance/riskMonitor';

export const EARLY_WARNING_DEFAULTS = {
  hfNoise: 0.02,
  minCoverage: 0.5,
  aprNoiseBps: 10,
  aprRising6hBps: 10,
  aprRising24hBps: 25,
  risingQuickly6hBps: RECOMMENDED_ALERT_DEFAULTS.rateJumpBps.within6h,
  risingQuickly24hBps: RECOMMENDED_ALERT_DEFAULTS.rateJumpBps.within24h,
  utilizationApproach: 0.02,
  oracleWatch: 0.005,
  oracleWarning: 0.01,
  liquidityDeepMultiple: 100,
  liquidityAdequateMultiple: 10,
  maxPaceHours: 14 * 24,
  priceDriverPct: 0.01,
} as const;

export const PACE_LABEL = 'At the recent observed pace';
export const PACE_DISCLAIMER = 'Not a forecast. Market conditions can change immediately.';
export const TREND_UNAVAILABLE = '24h trend unavailable — insufficient history.';

const HOUR_MS = 3_600_000;
const WINDOWS = {
  '1h': { ago: HOUR_MS, tolerance: 20 * 60_000 },
  '6h': { ago: 6 * HOUR_MS, tolerance: 90 * 60_000 },
  '24h': { ago: 24 * HOUR_MS, tolerance: 3 * HOUR_MS },
  '7d': { ago: 7 * 24 * HOUR_MS, tolerance: 18 * HOUR_MS },
} as const;

export type TrendWindow = keyof typeof WINDOWS;

export type TrendSample = {
  t: number;
  hf?: number;
  ltv?: number;
  cushion?: number;
  oracle?: number;
  apr?: number;
  utilization?: number;
  liquidity?: number;
  reference?: number;
  wrapper?: number;
};

export type HfDirection = 'IMPROVING' | 'STABLE' | 'DETERIORATING' | 'DETERIORATING SLIGHTLY';
export type AprAcceleration = 'STABLE' | 'RISING' | 'RISING QUICKLY' | 'FALLING';
export type UtilizationPressure = 'CALM' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
export type LiquidityContext = 'DEEP' | 'ADEQUATE' | 'LIMITED' | 'THIN';
export type DivergenceBand = 'NORMAL' | 'WATCH' | 'WARNING';
export type AttentionLevel = 'NONE' | 'MONITOR' | 'PREPARE' | 'DATA_WARNING';
export type AttentionState = AttentionLevel;
export type PrimaryDriver =
  | 'BTC/collateral decline'
  | 'HF deterioration'
  | 'Borrow APR acceleration'
  | 'Utilization pressure'
  | 'Data quality'
  | 'Reference-price divergence'
  | 'Liquidity deterioration';

export type RiskTrendSnapshot = {
  position: {
    currentHF?: number;
    hf1hAgo?: number;
    hf6hAgo?: number;
    hf24hAgo?: number;
    hf7dAgo?: number;
    hfChange1h?: number;
    hfChange6h?: number;
    hfChange24h?: number;
    ltvChange?: number;
    liquidationCushionChange?: number;
  };
  collateral: {
    currentOraclePrice?: number;
    price1hAgo?: number;
    price6hAgo?: number;
    price24hAgo?: number;
    priceChange1hPct?: number;
    priceChange6hPct?: number;
    priceChange24hPct?: number;
  };
  rate: {
    currentBorrowApr?: number;
    avg1h?: number;
    avg6h?: number;
    avg24h?: number;
    avg7d?: number;
    change1hBps?: number;
    change6hBps?: number;
    change24hBps?: number;
  };
  market: {
    currentUtilization?: number;
    utilization1hAgo?: number;
    utilization6hAgo?: number;
    utilization24hAgo?: number;
    availableLiquidity?: number;
    liquidityChange1hPct?: number;
    liquidityChange24hPct?: number;
  };
  quality: {
    positionFreshness: FreshnessDomain;
    oracleFreshness: FreshnessDomain;
    rateFreshness: FreshnessDomain;
    marketFreshness: FreshnessDomain;
    historyCoverage?: number;
    marketHistoryCoverage?: number;
  };
};

export type EarlyWarning = {
  snapshot: RiskTrendSnapshot;
  positionState: RiskSeverity;
  trend?: HfDirection;
  hfDirection?: HfDirection;
  hfPerHour?: number;
  next: {
    state: RiskSeverity;
    hf: number;
    hfDistance?: number;
    btc?: number;
    priceDistance?: number;
    priceDistanceUsd?: number;
  } | null;
  pace: {
    shown: boolean;
    hours?: number;
    text?: string;
    label: string;
    disclaimer: string;
  };
  apr?: AprAcceleration;
  utilization?: UtilizationPressure;
  utilizationNote?: string;
  liquidity?: LiquidityContext;
  liquidityNote?: string;
  reference?: { deviation?: number; band?: DivergenceBand };
  wrapper?: { ratio?: number; deviation?: number; band?: DivergenceBand; trend?: number };
  attention: AttentionState;
  driver: PrimaryDriver | null;
  reason: string;
  summary: string[];
  guidance: string;
};

export type EarlyWarningInput = {
  now?: number;
  healthFactor: number | null;
  ltv: number | null;
  cushion: number | null;
  debt: number;
  collateralAmount: number;
  liquidationThreshold: number;
  oraclePrice: number | null;
  borrowApr: number | null;
  openingApr?: number | null;
  avg1h?: number | null;
  avg6h?: number | null;
  avg24h?: number | null;
  avg7d?: number | null;
  utilization: number | null;
  availableLiquidity: number | null;
  referenceBtc?: number | null;
  wrapperPrice?: number | null;
  samples?: TrendSample[];
  marketSamples?: TrendSample[];
  safetyFresh: boolean;
  positionFreshness: FreshnessDomain;
  oracleFreshness: FreshnessDomain;
  rateFreshness: FreshnessDomain;
  marketFreshness: FreshnessDomain;
  thresholds: RiskThresholds;
};

function defined(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function delta(current: number | undefined, previous: number | undefined) {
  if (current === undefined || previous === undefined) return undefined;
  return current - previous;
}

function pctChange(current: number | undefined, previous: number | undefined) {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  return (current - previous) / previous;
}

function pointAt(samples: TrendSample[], now: number, window: TrendWindow) {
  const { ago, tolerance } = WINDOWS[window];
  const target = now - ago;
  let nearest: TrendSample | undefined;
  for (const sample of samples) {
    if (sample.t > now) continue;
    if (!nearest || Math.abs(sample.t - target) < Math.abs(nearest.t - target)) nearest = sample;
  }
  if (!nearest || Math.abs(nearest.t - target) > tolerance) return undefined;
  return nearest;
}

function coverage(samples: TrendSample[], now: number, window: TrendWindow) {
  const start = now - WINDOWS[window].ago;
  const inside = samples.filter((sample) => sample.t >= start && sample.t <= now);
  if (inside.length < 2) return undefined;
  const span = Math.max(...inside.map((sample) => sample.t)) - Math.min(...inside.map((sample) => sample.t));
  return span / WINDOWS[window].ago;
}

function fieldAt(samples: TrendSample[], now: number, window: TrendWindow, field: keyof TrendSample, minCoverage: number) {
  const covered = coverage(samples, now, window);
  if (covered === undefined || covered < minCoverage) return undefined;
  const sample = pointAt(samples, now, window);
  const value = sample?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function withCurrent(samples: TrendSample[], now: number, current: TrendSample) {
  return [...samples.filter((sample) => sample.t < now), { ...current, t: now }];
}

function significantHf(change: number | undefined) {
  return change !== undefined && Math.abs(change) >= EARLY_WARNING_DEFAULTS.hfNoise;
}

export function classifyHfDirection(change1h?: number, change6h?: number, change24h?: number): HfDirection | undefined {
  const windows = [
    ['6h', change6h],
    ['24h', change24h],
    ['1h', change1h],
  ] as const;
  if (windows.every(([, value]) => value === undefined)) return undefined;
  const meaningful = windows.find(([, value]) => significantHf(value));
  const chosen = meaningful?.[1] ?? change6h ?? change24h ?? change1h;
  if (chosen === undefined || !significantHf(chosen)) return 'STABLE';
  if (chosen < 0) {
    return Math.abs(chosen) < 0.10 ? 'DETERIORATING SLIGHTLY' : 'DETERIORATING';
  }
  return 'IMPROVING';
}

export function formatPace(hours: number) {
  if (hours < 48) return `~${Math.max(1, Math.round(hours))}h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `~${days} days`;
}

function paceUnstable(change6h?: number, change24h?: number) {
  if (!significantHf(change6h) || !significantHf(change24h)) return false;
  return Math.sign(change6h as number) !== Math.sign(change24h as number);
}

export function classifyAprAcceleration(change6hBps?: number, change24hBps?: number, change1hBps?: number): AprAcceleration | undefined {
  const six = change6hBps;
  const day = change24hBps;
  const hour = change1hBps;
  if (six === undefined && day === undefined && hour === undefined) return undefined;
  const quick = (six !== undefined && six >= EARLY_WARNING_DEFAULTS.risingQuickly6hBps)
    || (day !== undefined && day >= EARLY_WARNING_DEFAULTS.risingQuickly24hBps);
  if (quick) return 'RISING QUICKLY';
  const rising = (six !== undefined && six >= EARLY_WARNING_DEFAULTS.aprRising6hBps)
    || (day !== undefined && day >= EARLY_WARNING_DEFAULTS.aprRising24hBps);
  if (rising) return 'RISING';
  const falling = (six !== undefined && six <= -EARLY_WARNING_DEFAULTS.aprRising6hBps)
    || (day !== undefined && day <= -EARLY_WARNING_DEFAULTS.aprRising24hBps);
  if (falling) return 'FALLING';
  if (six === undefined && day === undefined) return undefined;
  return 'STABLE';
}

export function classifyUtilization(current: number | undefined, watch: number, high: number, change6h?: number): UtilizationPressure | undefined {
  if (current === undefined) return undefined;
  if (current >= high) return 'CRITICAL';
  if (current >= watch) return 'HIGH';
  const approaching = current >= watch - EARLY_WARNING_DEFAULTS.utilizationApproach
    || (change6h !== undefined && change6h >= 0.02 && current >= watch - 0.05);
  if (approaching) return 'ELEVATED';
  return 'CALM';
}

export function classifyLiquidity(liquidity: number | undefined, debt: number): LiquidityContext | undefined {
  if (liquidity === undefined || !(debt > 0)) return undefined;
  const multiple = liquidity / debt;
  if (multiple >= EARLY_WARNING_DEFAULTS.liquidityDeepMultiple) return 'DEEP';
  if (multiple >= EARLY_WARNING_DEFAULTS.liquidityAdequateMultiple) return 'ADEQUATE';
  if (multiple >= 1) return 'LIMITED';
  return 'THIN';
}

export function classifyDivergence(left: number | undefined, right: number | undefined): { deviation?: number; band?: DivergenceBand } {
  if (left === undefined || right === undefined || right <= 0) return {};
  const deviation = Math.abs(left - right) / right;
  const band: DivergenceBand = deviation < EARLY_WARNING_DEFAULTS.oracleWatch
    ? 'NORMAL'
    : deviation <= EARLY_WARNING_DEFAULTS.oracleWarning
      ? 'WATCH'
      : 'WARNING';
  return { deviation, band };
}

function attentionRank(state: AttentionState) {
  if (state === 'DATA_WARNING') return -1;
  return { NONE: 0, MONITOR: 1, PREPARE: 2 }[state];
}

function positionAttention(state: RiskSeverity): AttentionState {
  if (state === 'DATA_WARNING') return 'DATA_WARNING';
  if (state === 'NO_DEBT' || state === 'NORMAL') return 'NONE';
  if (state === 'WATCH') return 'MONITOR';
  return 'PREPARE';
}

function higher(current: AttentionState, next: AttentionState) {
  if (current === 'DATA_WARNING' || next === 'DATA_WARNING') return 'DATA_WARNING';
  return attentionRank(next) > attentionRank(current) ? next : current;
}

function hfText(value: number) {
  return value.toFixed(2);
}

function pctText(ratio: number) {
  const pct = Math.abs(ratio * 100);
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

function usdText(value: number) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function priceExplains(snapshot: RiskTrendSnapshot) {
  const day = snapshot.collateral.priceChange24hPct;
  const six = snapshot.collateral.priceChange6hPct;
  return (day !== undefined && day <= -EARLY_WARNING_DEFAULTS.priceDriverPct)
    || (six !== undefined && six <= -EARLY_WARNING_DEFAULTS.priceDriverPct);
}

const BANNED = [/btc will/i, /liquidation is likely/i, /hf will/i, /will reach/i, /likely to liquidat/i];

export function hasPredictiveClaim(text: string) {
  return BANNED.some((pattern) => pattern.test(text));
}

export function buildEarlyWarning(input: EarlyWarningInput, now = input.now ?? Date.now()): EarlyWarning {
  const minCoverage = EARLY_WARNING_DEFAULTS.minCoverage;
  const positionSamples = withCurrent(input.samples ?? [], now, {
    t: now,
    hf: defined(input.healthFactor),
    ltv: defined(input.ltv),
    cushion: defined(input.cushion),
    oracle: defined(input.oraclePrice),
    reference: defined(input.referenceBtc),
    wrapper: defined(input.wrapperPrice),
  });
  const marketSamples = withCurrent(input.marketSamples ?? input.samples ?? [], now, {
    t: now,
    apr: defined(input.borrowApr),
    utilization: defined(input.utilization),
    liquidity: defined(input.availableLiquidity),
  });
  const hf = (window: TrendWindow) => fieldAt(positionSamples, now, window, 'hf', minCoverage);
  const oracle = (window: TrendWindow) => fieldAt(positionSamples, now, window, 'oracle', minCoverage);
  const ltv = (window: TrendWindow) => fieldAt(positionSamples, now, window, 'ltv', minCoverage);
  const cushion = (window: TrendWindow) => fieldAt(positionSamples, now, window, 'cushion', minCoverage);
  const apr = (window: TrendWindow) => fieldAt(marketSamples, now, window, 'apr', minCoverage);
  const utilization = (window: TrendWindow) => fieldAt(marketSamples, now, window, 'utilization', minCoverage);
  const liquidity = (window: TrendWindow) => fieldAt(marketSamples, now, window, 'liquidity', minCoverage);
  const currentHf = defined(input.healthFactor);
  const currentOracle = defined(input.oraclePrice);
  const currentApr = defined(input.borrowApr);
  const currentUtilization = defined(input.utilization);
  const currentLiquidity = defined(input.availableLiquidity);
  const hf1 = hf('1h');
  const hf6 = hf('6h');
  const hf24 = hf('24h');
  const price1 = oracle('1h');
  const price6 = oracle('6h');
  const price24 = oracle('24h');
  const util1 = utilization('1h');
  const util6 = utilization('6h');
  const util24 = utilization('24h');
  const liq1 = liquidity('1h');
  const liq24 = liquidity('24h');
  const snapshot: RiskTrendSnapshot = {
    position: {
      currentHF: currentHf,
      hf1hAgo: hf1,
      hf6hAgo: hf6,
      hf24hAgo: hf24,
      hf7dAgo: hf('7d'),
      hfChange1h: delta(currentHf, hf1),
      hfChange6h: delta(currentHf, hf6),
      hfChange24h: delta(currentHf, hf24),
      ltvChange: delta(defined(input.ltv), ltv('24h')),
      liquidationCushionChange: delta(defined(input.cushion), cushion('24h')),
    },
    collateral: {
      currentOraclePrice: currentOracle,
      price1hAgo: price1,
      price6hAgo: price6,
      price24hAgo: price24,
      priceChange1hPct: pctChange(currentOracle, price1),
      priceChange6hPct: pctChange(currentOracle, price6),
      priceChange24hPct: pctChange(currentOracle, price24),
    },
    rate: {
      currentBorrowApr: currentApr,
      avg1h: defined(input.avg1h),
      avg6h: defined(input.avg6h),
      avg24h: defined(input.avg24h),
      avg7d: defined(input.avg7d),
      change1hBps: (() => {
        const change = delta(currentApr, apr('1h'));
        return change === undefined ? undefined : change * 10_000;
      })(),
      change6hBps: (() => {
        const change = delta(currentApr, apr('6h'));
        return change === undefined ? undefined : change * 10_000;
      })(),
      change24hBps: (() => {
        const change = delta(currentApr, apr('24h'));
        return change === undefined ? undefined : change * 10_000;
      })(),
    },
    market: {
      currentUtilization,
      utilization1hAgo: util1,
      utilization6hAgo: util6,
      utilization24hAgo: util24,
      availableLiquidity: currentLiquidity,
      liquidityChange1hPct: pctChange(currentLiquidity, liq1),
      liquidityChange24hPct: pctChange(currentLiquidity, liq24),
    },
    quality: {
      positionFreshness: input.positionFreshness,
      oracleFreshness: input.oracleFreshness,
      rateFreshness: input.rateFreshness,
      marketFreshness: input.marketFreshness,
      historyCoverage: coverage(positionSamples, now, '24h'),
      marketHistoryCoverage: coverage(marketSamples, now, '24h'),
    },
  };
  const decision = currentRiskDecision({
    healthFactor: input.healthFactor,
    debt: input.debt,
    collateralAmount: input.collateralAmount,
    oraclePrice: input.oraclePrice,
    liquidationThreshold: input.liquidationThreshold,
    thresholds: input.thresholds,
    safetyFresh: input.safetyFresh,
  });
  const hfDirection = classifyHfDirection(snapshot.position.hfChange1h, snapshot.position.hfChange6h, snapshot.position.hfChange24h);
  const paceWindow = significantHf(snapshot.position.hfChange6h)
    ? { change: snapshot.position.hfChange6h, hours: 6, covered: snapshot.quality.historyCoverage === undefined ? coverage(positionSamples, now, '6h') : coverage(positionSamples, now, '6h') }
    : significantHf(snapshot.position.hfChange24h)
      ? { change: snapshot.position.hfChange24h, hours: 24, covered: snapshot.quality.historyCoverage }
      : significantHf(snapshot.position.hfChange1h)
        ? { change: snapshot.position.hfChange1h, hours: 1, covered: coverage(positionSamples, now, '1h') }
        : null;
  const hfDistance = decision.nextHf !== null && currentHf !== undefined ? currentHf - decision.nextHf : undefined;
  const next = decision.nextRiskState && decision.nextHf !== null
    ? {
      state: decision.nextRiskState,
      hf: decision.nextHf,
      hfDistance,
      btc: decision.nextBtcPrice ?? undefined,
      priceDistance: decision.distanceToNextState ?? undefined,
      priceDistanceUsd: decision.nextBtcPrice !== null && currentOracle !== undefined ? currentOracle - decision.nextBtcPrice : undefined,
    }
    : null;
  const unstable = paceUnstable(snapshot.position.hfChange6h, snapshot.position.hfChange24h);
  const perHour = paceWindow?.change !== undefined && paceWindow.change < 0 ? -paceWindow.change / paceWindow.hours : undefined;
  const rawHours = perHour && hfDistance !== undefined && hfDistance > 0 ? hfDistance / perHour : undefined;
  const paceShown = hfDirection === 'DETERIORATING'
    && !unstable
    && rawHours !== undefined
    && rawHours > 0
    && rawHours <= EARLY_WARNING_DEFAULTS.maxPaceHours
    && (paceWindow?.covered ?? 0) >= minCoverage;
  const aprState = classifyAprAcceleration(snapshot.rate.change6hBps, snapshot.rate.change24hBps, snapshot.rate.change1hBps);
  const utilChange6h = delta(currentUtilization, util6);
  const utilizationState = classifyUtilization(currentUtilization, input.thresholds.utilizationWatch, input.thresholds.utilizationHigh, utilChange6h);
  const liquidityState = classifyLiquidity(currentLiquidity, input.debt);
  const reference = classifyDivergence(currentOracle, defined(input.referenceBtc));
  const wrapperPrice = defined(input.wrapperPrice);
  const referenceBtc = defined(input.referenceBtc);
  const wrapperDeviation = classifyDivergence(wrapperPrice, referenceBtc);
  const wrapperAgo = fieldAt(positionSamples, now, '24h', 'wrapper', minCoverage);
  const wrapperReferenceAgo = fieldAt(positionSamples, now, '24h', 'reference', minCoverage);
  const wrapperNow = wrapperPrice !== undefined && referenceBtc !== undefined && referenceBtc > 0 ? wrapperPrice / referenceBtc : undefined;
  const wrapperThen = wrapperAgo !== undefined && wrapperReferenceAgo !== undefined && wrapperReferenceAgo > 0 ? wrapperAgo / wrapperReferenceAgo : undefined;
  let attention = positionAttention(decision.currentState);
  if (hfDirection === 'DETERIORATING') {
    attention = higher(attention, paceShown && rawHours !== undefined && rawHours <= 24 ? 'PREPARE' : 'MONITOR');
  } else if (hfDirection === 'DETERIORATING SLIGHTLY') {
    attention = higher(attention, 'MONITOR');
  }
  if (aprState === 'RISING QUICKLY') attention = higher(attention, 'MONITOR');
  if (utilizationState === 'HIGH' || utilizationState === 'CRITICAL') attention = higher(attention, 'MONITOR');
  if (reference.band === 'WARNING' || wrapperDeviation.band === 'WARNING') attention = higher(attention, 'MONITOR');
  if (liquidityState === 'THIN') attention = higher(attention, 'MONITOR');
  if (!input.safetyFresh) attention = 'DATA_WARNING';
  const positionElevated = decision.currentState !== 'NORMAL' && decision.currentState !== 'NO_DEBT' && decision.currentState !== 'DATA_WARNING';
  const driver: PrimaryDriver | null = attention === 'DATA_WARNING'
    ? 'Data quality'
    : attention === 'NONE'
      ? null
      : positionElevated || hfDirection === 'DETERIORATING' || hfDirection === 'DETERIORATING SLIGHTLY'
        ? (priceExplains(snapshot) ? 'BTC/collateral decline' : 'HF deterioration')
        : aprState === 'RISING QUICKLY'
          ? 'Borrow APR acceleration'
          : utilizationState === 'HIGH' || utilizationState === 'CRITICAL'
            ? 'Utilization pressure'
            : reference.band === 'WARNING' || wrapperDeviation.band === 'WARNING'
              ? 'Reference-price divergence'
              : liquidityState === 'THIN'
                ? 'Liquidity deterioration'
                : 'HF deterioration';
  const guidance = attention === 'DATA_WARNING'
    ? 'Verify data'
    : attention === 'NONE'
      ? 'No action required'
      : attention === 'MONITOR'
        ? 'Monitor'
        : 'Prepare';
  const reasonParts: string[] = [];
  if (snapshot.position.hfChange24h !== undefined && snapshot.position.hfChange24h < 0 && hf24 !== undefined && hf24 > 0) {
    reasonParts.push(`HF has fallen ${pctText(-snapshot.position.hfChange24h / hf24)} over 24h`);
  } else if (snapshot.position.hfChange6h !== undefined && snapshot.position.hfChange6h < 0 && hf6 !== undefined) {
    reasonParts.push(`HF fell from ${hfText(hf6)} to ${hfText(currentHf ?? hf6)} over 6h`);
  }
  if (next?.priceDistance !== undefined && next.priceDistance > 0) {
    reasonParts.push(`BTC is ${pctText(next.priceDistance)} from the ${next.state} boundary`);
  }
  if (driver === 'Borrow APR acceleration') reasonParts.push('Borrow APR is rising quickly');
  if (driver === 'Utilization pressure' && utilizationState === 'ELEVATED') reasonParts.push('Utilization is approaching the configured warning level');
  if (driver === 'Data quality') reasonParts.push('Position or oracle data is not fresh');
  const reason = attention === 'NONE'
    ? 'No action required.'
    : reasonParts.length > 0
      ? `${reasonParts.slice(0, 2).join(' and ')}.`
      : `${guidance}.`;
  const summary = decisionSummary({
    positionState: decision.currentState,
    attention,
    guidance,
    currentHf,
    hfDirection,
    hf6,
    next,
    openingApr: defined(input.openingApr),
    currentApr,
    utilization: utilizationState,
    paceShown,
    paceText: paceShown && rawHours !== undefined ? formatPace(rawHours) : undefined,
  });
  return {
    snapshot,
    positionState: decision.currentState,
    trend: hfDirection,
    hfDirection,
    hfPerHour: paceWindow?.change === undefined ? undefined : paceWindow.change / paceWindow.hours,
    next,
    pace: {
      shown: paceShown,
      hours: paceShown ? rawHours : undefined,
      text: paceShown && rawHours !== undefined ? formatPace(rawHours) : undefined,
      label: PACE_LABEL,
      disclaimer: PACE_DISCLAIMER,
    },
    apr: aprState,
    utilization: utilizationState,
    utilizationNote: utilizationState === 'ELEVATED' && currentUtilization !== undefined && currentUtilization < input.thresholds.utilizationWatch
      ? 'Utilization is approaching the configured warning level.'
      : undefined,
    liquidity: liquidityState,
    liquidityNote: liquidityState === 'DEEP' ? 'still ample for this position' : undefined,
    reference,
    wrapper: wrapperNow === undefined && wrapperDeviation.deviation === undefined
      ? {}
      : {
        ratio: wrapperNow,
        deviation: wrapperDeviation.deviation,
        band: wrapperDeviation.band,
        trend: wrapperNow !== undefined && wrapperThen !== undefined ? wrapperNow - wrapperThen : undefined,
      },
    attention,
    driver,
    reason,
    summary,
    guidance,
  };
}

function decisionSummary(input: {
  positionState: RiskSeverity;
  attention: AttentionState;
  guidance: string;
  currentHf?: number;
  hfDirection?: HfDirection;
  hf6?: number;
  next: EarlyWarning['next'];
  openingApr?: number;
  currentApr?: number;
  utilization?: UtilizationPressure;
  paceShown: boolean;
  paceText?: string;
}) {
  const lines: string[] = [];
  if (input.attention === 'DATA_WARNING') {
    lines.push('DATA WARNING: Fresh position or oracle data is unavailable.');
    lines.push('Verify before acting.');
    return lines;
  }
  lines.push(`Position: ${input.positionState}`);
  if (input.attention === 'NONE') lines.push('No action required.');
  else if (input.attention === 'MONITOR') lines.push('No immediate corrective transaction required. Monitor position.');
  else if (input.attention === 'PREPARE') lines.push('Prepare repayment/collateral resources.');
  else lines.push('Corrective action recommended.');
  if (input.currentHf !== undefined) {
    const trend = input.hfDirection === 'DETERIORATING'
      ? 'deteriorating'
      : input.hfDirection === 'DETERIORATING SLIGHTLY'
        ? 'deteriorating slightly'
        : input.hfDirection === 'IMPROVING'
          ? 'improving'
          : input.hfDirection === 'STABLE'
            ? 'stable'
            : null;
    lines.push(trend ? `HF ${hfText(input.currentHf)} and ${trend}.` : `HF ${hfText(input.currentHf)}.`);
  }
  if (input.attention !== 'NONE' && (input.hfDirection === 'DETERIORATING' || input.hfDirection === 'DETERIORATING SLIGHTLY') && input.hf6 !== undefined && input.currentHf !== undefined) {
    lines.push(`HF fell from ${hfText(input.hf6)} to ${hfText(input.currentHf)} over 6h.`);
  }
  if (input.next && input.next.priceDistance !== undefined && input.next.priceDistance > 0) {
    lines.push(`BTC is ~${pctText(input.next.priceDistance)} above the ${input.next.state} trigger.`);
  }
  if (input.attention !== 'NONE' && input.next) {
    lines.push(`${input.next.state} boundary is ${hfText(input.next.hf)}.`);
  }
  if (input.paceShown && input.paceText) {
    lines.push(`${PACE_LABEL}: ${input.paceText}. ${PACE_DISCLAIMER}`);
  }
  if (input.currentApr !== undefined && input.openingApr !== undefined) {
    const gap = (input.currentApr - input.openingApr) * 10_000;
    lines.push(Math.abs(gap) < 5
      ? 'Borrow APR is approximately unchanged since opening.'
      : gap > 0
        ? 'Borrow APR is above the opening rate.'
        : 'Borrow APR is below the opening rate.');
  }
  if (input.utilization === 'CALM') lines.push('Market utilization is calm.');
  return lines.filter((line) => !hasPredictiveClaim(line));
}

export function earlyWarningEmailLines(warning: EarlyWarning) {
  const lines: string[] = [];
  const hf = warning.snapshot.position.currentHF;
  const ago = warning.snapshot.position.hf6hAgo ?? warning.snapshot.position.hf24hAgo;
  const span = warning.snapshot.position.hf6hAgo !== undefined ? '6h' : '24h';
  if (hf !== undefined && ago !== undefined) lines.push(`HF: ${hfText(ago)} → ${hfText(hf)} over ${span}`);
  if (warning.next) lines.push(`${warning.next.state} threshold: ${hfText(warning.next.hf)}`);
  if (warning.snapshot.collateral.currentOraclePrice !== undefined) lines.push(`Current BTC: ${usdText(warning.snapshot.collateral.currentOraclePrice)}`);
  if (warning.next?.btc !== undefined) lines.push(`${warning.next.state} BTC: ${usdText(warning.next.btc)}`);
  if (warning.next?.priceDistance !== undefined) lines.push(`Distance: ${pctText(warning.next.priceDistance)}`);
  if (warning.snapshot.rate.currentBorrowApr !== undefined) lines.push(`Borrow APR: ${(warning.snapshot.rate.currentBorrowApr * 100).toFixed(2)}%`);
  lines.push(warning.attention === 'PREPARE'
    ? 'Action: Prepare repayment/collateral resources.'
    : warning.attention === 'MONITOR'
      ? 'Action: Monitor position.'
      : 'Action: No immediate corrective transaction required.');
  return lines.filter((line) => !hasPredictiveClaim(line));
}

export function alertForDriver(driver: PrimaryDriver | null, rules: Array<{ id: string; enabled: boolean }>) {
  const id = driver === 'Borrow APR acceleration'
    ? 'rate-velocity'
    : driver === 'Utilization pressure'
      ? 'utilization-watch'
      : driver === 'Liquidity deterioration'
        ? 'liquidity'
        : driver === 'Data quality'
          ? 'data-stale'
          : 'hf-watch';
  const match = rules.find((rule) => rule.id === id);
  return {
    ruleId: id,
    label: match?.enabled ? 'Alert enabled' as const : 'Alert not configured' as const,
  };
}

export const TREND_SAMPLE_MS = 10 * 60_000;
export const TREND_RECENT_MS = 26 * HOUR_MS;
export const TREND_KEEP_MS = 8 * 24 * HOUR_MS;

export function compactTrendSamples(samples: TrendSample[], now: number) {
  const buckets = new Map<number, TrendSample>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.t) || sample.t > now + 60_000 || now - sample.t > TREND_KEEP_MS) continue;
    const size = now - sample.t <= TREND_RECENT_MS ? TREND_SAMPLE_MS : HOUR_MS;
    buckets.set(Math.floor(sample.t / size), sample);
  }
  return [...buckets.values()].sort((left, right) => left.t - right.t);
}

export function appendTrendSample(samples: TrendSample[], next: TrendSample, now = next.t) {
  const last = samples[samples.length - 1];
  if (last && next.t - last.t < TREND_SAMPLE_MS) return samples;
  return compactTrendSamples([...samples, next], now);
}

export function reachesBoundaryCopy(state: string, price: number | undefined) {
  if (price === undefined) return 'The next configured boundary is not available.';
  return `The position reaches ${state} at BTC ${usdText(price)}.`;
}
