export type LoanAlertRule = {
  venueId: string;
  enabled: boolean;
  borrowAprThreshold?: number;
  healthFactorThreshold?: number;
  ltvThreshold?: number;
  liquidationDistanceThreshold?: number;
  liquidationPriceThreshold?: number;
  utilizationSpike: boolean;
  significantRateChange: boolean;
  monthlyStatement: boolean;
  lastChecked?: number;
  lastNotified?: number;
};

const KEY = 'simplebtc_loan_alerts';

export function defaultLoanAlertRule(venueId: string): LoanAlertRule {
  return {
    venueId,
    enabled: false,
    utilizationSpike: false,
    significantRateChange: false,
    monthlyStatement: true,
  };
}

function readAll(): LoanAlertRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LoanAlertRule[];
    return Array.isArray(parsed) ? parsed.filter((row) => typeof row?.venueId === 'string') : [];
  } catch {
    return [];
  }
}

function writeAll(rules: LoanAlertRule[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rules));
    return true;
  } catch {
    return false;
  }
}

export function readLoanAlertRule(venueId: string): LoanAlertRule {
  return readAll().find((row) => row.venueId === venueId) ?? defaultLoanAlertRule(venueId);
}

export function writeLoanAlertRule(rule: LoanAlertRule): boolean {
  const current = readAll().filter((row) => row.venueId !== rule.venueId);
  current.push(rule);
  return writeAll(current);
}

export function markLoanAlertChecked(venueId: string, at = Date.now()): LoanAlertRule {
  const rule = { ...readLoanAlertRule(venueId), lastChecked: at };
  writeLoanAlertRule(rule);
  return rule;
}
