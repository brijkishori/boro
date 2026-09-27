import { annualInterest } from '@/lib/finance/rates';

export type AmortizationEstimate = {
  months: number | null;
  totalInterest: number | null;
  firstInterest: number;
  firstPrincipal: number;
  coversInterest: boolean;
  next12MonthInterest: number;
};

const EPS = 1e-8;
const MAX_MONTHS = 12_000;

/** Month-by-month declining principal at a constant APR. */
export function simulateDecliningBalance(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
): AmortizationEstimate | null {
  if (!(balance > 0) || !Number.isFinite(annualRate) || annualRate < 0 || !(monthlyPayment > 0)) return null;
  const monthlyRate = annualRate / 12;
  const firstInterest = balance * monthlyRate;
  const coversInterest = monthlyPayment > firstInterest + 1e-9;
  const firstPrincipal = Math.max(0, monthlyPayment - firstInterest);

  if (!coversInterest) {
    return {
      months: null,
      totalInterest: null,
      firstInterest,
      firstPrincipal: 0,
      coversInterest: false,
      next12MonthInterest: annualInterest(balance, annualRate),
    };
  }

  if (monthlyRate === 0) {
    const months = Math.ceil(balance / monthlyPayment);
    return {
      months,
      totalInterest: 0,
      firstInterest: 0,
      firstPrincipal: Math.min(monthlyPayment, balance),
      coversInterest: true,
      next12MonthInterest: 0,
    };
  }

  let remaining = balance;
  let totalInterest = 0;
  let next12MonthInterest = 0;
  let months = 0;
  while (remaining > EPS && months < MAX_MONTHS) {
    const interest = remaining * monthlyRate;
    const due = remaining + interest;
    const payment = Math.min(monthlyPayment, due);
    remaining = Math.max(0, remaining - (payment - interest));
    totalInterest += interest;
    months += 1;
    if (months <= 12) next12MonthInterest += interest;
  }

  if (months >= MAX_MONTHS && remaining > EPS) {
    return {
      months: null,
      totalInterest: null,
      firstInterest,
      firstPrincipal,
      coversInterest: true,
      next12MonthInterest,
    };
  }

  return {
    months,
    totalInterest,
    firstInterest,
    firstPrincipal,
    coversInterest: true,
    next12MonthInterest,
  };
}

export function amortizationEstimate(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
): AmortizationEstimate | null {
  return simulateDecliningBalance(balance, annualRate, monthlyPayment);
}
