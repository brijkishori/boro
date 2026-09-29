import { aprChangeVisual, type AprMovement } from '@/lib/finance/openingApr';
import type { MarketStressStatus, RateEconomicStatus, ReadinessStatus, ResourceFeasibility, RiskSeverity } from '@/lib/finance/riskMonitor';

export type StatusTone = 'normal' | 'watch' | 'prepare' | 'act' | 'urgent' | 'data' | 'neutral';

export type StatusPresentation = {
  tone: StatusTone;
  mark: string;
  label: string;
  detail?: string;
};

const MARK: Record<StatusTone, string> = {
  normal: '●',
  watch: '◉',
  prepare: '▲',
  act: '◆',
  urgent: '■',
  data: '◇',
  neutral: '→',
};

export function statusMark(tone: StatusTone) {
  return MARK[tone];
}

function presented(tone: StatusTone, label: string, detail?: string): StatusPresentation {
  return { tone, mark: MARK[tone], label, detail };
}

export function riskSeverityStatus(severity: RiskSeverity): StatusPresentation {
  switch (severity) {
    case 'NORMAL':
      return presented('normal', 'NORMAL', 'No action required');
    case 'WATCH':
      return presented('watch', 'WATCH', 'Conditions changed — monitor');
    case 'PREPARE':
      return presented('prepare', 'PREPARE', 'Prepare repayment/collateral resources');
    case 'ACT':
      return presented('act', 'ACT', 'Corrective action recommended');
    case 'URGENT':
      return presented('urgent', 'URGENT', 'Immediate action recommended');
    case 'LIQUIDATION_BOUNDARY':
      return presented('urgent', 'LIQUIDATION BOUNDARY', 'Immediate action recommended');
    case 'DATA_WARNING':
      return presented('data', 'DATA WARNING', 'Fresh data unavailable / verify before acting');
    case 'NO_DEBT':
      return presented('neutral', 'NO OPEN DEBT', 'No action required');
    default: {
      const unreachable: never = severity;
      return unreachable;
    }
  }
}

export function readinessStatus(status: ReadinessStatus): StatusPresentation {
  switch (status) {
    case 'READY':
      return presented('normal', 'READY');
    case 'PARTIALLY_READY':
      return presented('prepare', 'PARTIALLY READY');
    case 'NOT_READY':
      return presented('urgent', 'NOT READY');
    case 'DATA_UNKNOWN':
      return presented('data', 'DATA UNKNOWN', 'Fresh data unavailable / verify before acting');
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function marketStressPresentation(status: MarketStressStatus): StatusPresentation {
  switch (status) {
    case 'CALM':
      return presented('normal', 'CALM', 'No action required');
    case 'WATCH':
      return presented('watch', 'WATCH', 'Conditions changed — monitor');
    case 'HIGH':
      return presented('act', 'HIGH', 'Utilization is elevated');
    case 'NOT_APPLICABLE':
      return presented('neutral', 'NOT APPLICABLE');
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function feasibilityStatus(value: ResourceFeasibility): StatusPresentation {
  switch (value) {
    case 'AVAILABLE':
      return presented('normal', 'AVAILABLE');
    case 'PARTIALLY_AVAILABLE':
      return presented('prepare', 'PARTIALLY AVAILABLE');
    case 'NOT_CURRENTLY_AVAILABLE':
      return presented('urgent', 'NOT CURRENTLY AVAILABLE');
    case 'UNKNOWN':
      return presented('data', 'BALANCE NOT LOADED', 'Fresh data unavailable / verify before acting');
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

export function freshnessStatus(stale: boolean): StatusPresentation {
  return stale
    ? presented('data', 'DATA WARNING', 'Fresh data unavailable / verify before acting')
    : presented('normal', 'FRESH');
}

export function benchmarkStatus(status: RateEconomicStatus | null): StatusPresentation {
  switch (status) {
    case 'FAVORABLE':
      return presented('normal', 'BELOW BENCHMARK');
    case 'NEAR_BENCHMARK':
      return presented('neutral', 'NEAR BENCHMARK');
    case 'ABOVE_BENCHMARK':
      return presented('act', 'ABOVE BENCHMARK');
    case 'HIGH_COST':
      return presented('urgent', 'ABOVE BENCHMARK', 'High cost');
    case 'NO_BENCHMARK':
    case null:
      return presented('neutral', 'NO BENCHMARK');
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function aprMovementStatus(movement: AprMovement): StatusPresentation {
  const visual = aprChangeVisual(movement);
  if (visual.icon === null) {
    return { tone: 'neutral', mark: '—', label: visual.statusText };
  }
  const tone = visual.semanticState === 'positive' ? 'normal' : visual.semanticState === 'warning' ? 'act' : 'neutral';
  return { tone, mark: visual.icon, label: visual.compactText.slice(visual.icon.length).trim() };
}
