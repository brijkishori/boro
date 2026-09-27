import { annualInterest, monthlyInterest } from '@/lib/finance/rates';
import { simulateDecliningBalance } from '@/lib/finance/amortization';

export type FinancingBenchmark = {
  id: string;
  name: string;
  provider?: string;
  balance?: number;
  annualRate: number;
  rateType: 'fixed' | 'variable';
  monthlyPayment?: number;
  remainingMonths?: number;
  fees?: number;
  notes?: string;
};

export type RateAlertConfig = {
  warningBufferBps: number;
  criticalBufferBps: number;
};

export type RateAlertLevel = 'green' | 'yellow' | 'red';

export const DEFAULT_RATE_ALERT: RateAlertConfig = {
  warningBufferBps: 100,
  criticalBufferBps: 0,
};

export function benchmarkSpread(benchmarkApr: number, cryptoApr: number): number | null {
  if (!Number.isFinite(benchmarkApr) || !Number.isFinite(cryptoApr)) return null;
  return benchmarkApr - cryptoApr;
}

export function annualInterestDifference(balance: number, spread: number): number | null {
  if (!(balance > 0) || !Number.isFinite(spread)) return null;
  return balance * spread;
}

export type StressRow = {
  rate: number;
  yearOneInterest: number;
  monthOneInterest: number;
  spread: number | null;
  months: number | null;
  totalInterest: number | null;
  declining: boolean;
  breakEven: boolean;
};

function validApr(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0 && rate < 1;
}

/** Every rate is treated as APR. Includes the benchmark APR as a break-even row when provided. */
export function stressRows(
  balance: number,
  rates: number[],
  benchmarkApr?: number,
  monthlyPayment?: number,
): StressRow[] {
  const all = rates.filter(validApr);
  if (benchmarkApr !== undefined && validApr(benchmarkApr) && !all.some((rate) => Math.abs(rate - benchmarkApr) < 1e-12)) {
    all.push(benchmarkApr);
  }
  all.sort((left, right) => left - right);
  return all.map((rate) => {
    const sim = monthlyPayment ? simulateDecliningBalance(balance, rate, monthlyPayment) : null;
    const declining = Boolean(sim?.coversInterest);
    return {
      rate,
      yearOneInterest: declining && sim ? sim.next12MonthInterest : annualInterest(balance, rate),
      monthOneInterest: declining && sim ? sim.firstInterest : monthlyInterest(balance, rate),
      spread: benchmarkApr === undefined ? null : benchmarkSpread(benchmarkApr, rate),
      months: sim?.coversInterest ? sim.months : null,
      totalInterest: sim?.coversInterest ? sim.totalInterest : null,
      declining,
      breakEven: benchmarkApr !== undefined && Math.abs(rate - benchmarkApr) < 1e-12,
    };
  });
}

export function rateAlertLevel(
  cryptoApr: number,
  benchmarkApr: number,
  config: RateAlertConfig = DEFAULT_RATE_ALERT,
): RateAlertLevel | null {
  if (!Number.isFinite(cryptoApr) || !Number.isFinite(benchmarkApr)) return null;
  const warning = Math.max(0, config.warningBufferBps) / 10_000;
  const critical = Math.max(0, config.criticalBufferBps) / 10_000;
  if (cryptoApr >= benchmarkApr - critical) return 'red';
  if (cryptoApr >= benchmarkApr - warning) return 'yellow';
  return 'green';
}
