import type { FinancingBenchmark, RateAlertConfig } from '@/lib/finance/benchmark';
import { DEFAULT_RATE_ALERT } from '@/lib/finance/benchmark';

export type BorrowScenario = {
  borrowAmount: number;
  collateralAmount?: number;
  collateralAsset: string;
  loanAsset: string;
  monthlyPayment?: number;
};

export type StressRates = number[];

const BENCHMARK_KEY = 'simplebtc_benchmark';
const SCENARIO_KEY = 'simplebtc_borrow_scenario';
const ALERT_KEY = 'simplebtc_rate_alerts';
const STRESS_KEY = 'simplebtc_stress_rates';

export const DEFAULT_STRESS_RATES = [0.06, 0.08, 0.1, 0.12, 0.15];

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const PLANNER_EVENT = 'simplebtc_planner';

function notifyPlanner() {
  cachedPlanner = null;
  cachedPlannerKey = '';
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PLANNER_EVENT));
}

function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    if (window.localStorage.getItem(key) === null) return false;
    notifyPlanner();
    return true;
  } catch {
    return false;
  }
}

function removeJson(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(key);
    notifyPlanner();
    return true;
  } catch {
    return false;
  }
}

function asFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBenchmark(): FinancingBenchmark | null {
  const raw = readJson<Partial<FinancingBenchmark>>(BENCHMARK_KEY);
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const annualRate = asFinite(raw.annualRate);
  if (annualRate === undefined || annualRate < 0 || annualRate >= 1) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'benchmark',
    name: raw.name.trim(),
    provider: typeof raw.provider === 'string' ? raw.provider : undefined,
    balance: asFinite(raw.balance),
    annualRate,
    rateType: raw.rateType === 'variable' ? 'variable' : 'fixed',
    monthlyPayment: asFinite(raw.monthlyPayment),
    remainingMonths: asFinite(raw.remainingMonths),
    fees: asFinite(raw.fees),
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

export function writeBenchmark(value: FinancingBenchmark | null): boolean {
  return value ? writeJson(BENCHMARK_KEY, value) : removeJson(BENCHMARK_KEY);
}

export function readScenario(): BorrowScenario | null {
  const raw = readJson<Partial<BorrowScenario>>(SCENARIO_KEY);
  const borrowAmount = asFinite(raw?.borrowAmount);
  if (!raw || borrowAmount === undefined || borrowAmount <= 0) return null;
  return {
    borrowAmount,
    collateralAmount: asFinite(raw.collateralAmount),
    collateralAsset: typeof raw.collateralAsset === 'string' && raw.collateralAsset ? raw.collateralAsset : 'BTC',
    loanAsset: typeof raw.loanAsset === 'string' && raw.loanAsset ? raw.loanAsset : 'USDC',
    monthlyPayment: asFinite(raw.monthlyPayment),
  };
}

export function writeScenario(value: BorrowScenario | null): boolean {
  return value ? writeJson(SCENARIO_KEY, value) : removeJson(SCENARIO_KEY);
}

export function readAlertConfig(): RateAlertConfig {
  const raw = readJson<Partial<RateAlertConfig>>(ALERT_KEY);
  return {
    warningBufferBps: Math.max(0, asFinite(raw?.warningBufferBps) ?? DEFAULT_RATE_ALERT.warningBufferBps),
    criticalBufferBps: Math.max(0, asFinite(raw?.criticalBufferBps) ?? DEFAULT_RATE_ALERT.criticalBufferBps),
  };
}

export function writeAlertConfig(value: RateAlertConfig): boolean {
  return writeJson(ALERT_KEY, value);
}

const EMPTY_PLANNER = {
  benchmark: null as ReturnType<typeof readBenchmark>,
  scenario: null as ReturnType<typeof readScenario>,
  alerts: DEFAULT_RATE_ALERT,
  stress: DEFAULT_STRESS_RATES,
};

export type PlannerSnapshot = typeof EMPTY_PLANNER;

let cachedPlanner: typeof EMPTY_PLANNER | null = null;
let cachedPlannerKey = '';

export function subscribePlanner(onStore: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('storage', onStore);
  window.addEventListener(PLANNER_EVENT, onStore);
  return () => {
    window.removeEventListener('storage', onStore);
    window.removeEventListener(PLANNER_EVENT, onStore);
  };
}

export function plannerServerSnapshot() {
  return EMPTY_PLANNER;
}

export function plannerSnapshot() {
  const key = typeof window === 'undefined'
    ? ''
    : [BENCHMARK_KEY, SCENARIO_KEY, ALERT_KEY, STRESS_KEY].map((item) => window.localStorage.getItem(item) ?? '').join('|');
  if (cachedPlanner && cachedPlannerKey === key) return cachedPlanner;
  cachedPlannerKey = key;
  cachedPlanner = {
    benchmark: readBenchmark(),
    scenario: readScenario(),
    alerts: readAlertConfig(),
    stress: readStressRates(),
  };
  return cachedPlanner;
}

export function readStressRates(): number[] {
  const raw = readJson<number[]>(STRESS_KEY);
  if (!Array.isArray(raw)) return DEFAULT_STRESS_RATES;
  const rates = raw.filter((value) => Number.isFinite(value) && value >= 0 && value < 1);
  return rates.length > 0 ? rates : DEFAULT_STRESS_RATES;
}

export function writeStressRates(value: number[]): boolean {
  return writeJson(STRESS_KEY, value);
}
