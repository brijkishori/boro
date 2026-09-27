/** Rates must be APR decimals in [0, 1), never percentage points. */

export function isAprDecimal(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0 && rate < 1;
}

export function rateSpread(lendApr: number, borrowApr: number): number | null {
  if (!isAprDecimal(lendApr) || !isAprDecimal(borrowApr)) return null;
  return lendApr - borrowApr;
}

/** Gross annual carry: principal * (lend APR − borrow APR). */
export function grossAnnualCarry(principal: number, borrowApr: number, lendApr: number): number | null {
  if (!(principal > 0) || !Number.isFinite(principal)) return null;
  const spread = rateSpread(lendApr, borrowApr);
  if (spread === null) return null;
  return principal * spread;
}

export function grossMonthlyCarry(principal: number, borrowApr: number, lendApr: number): number | null {
  const annual = grossAnnualCarry(principal, borrowApr, lendApr);
  return annual === null ? null : annual / 12;
}

export function annualInterestOnPrincipal(principal: number, apr: number): number | null {
  if (!(principal > 0) || !Number.isFinite(principal) || !isAprDecimal(apr)) return null;
  return principal * apr;
}

export const EXAMPLE_CARRY_PRINCIPAL = 1_000;
