import { annualInterest, monthlyInterest } from '@/lib/finance/rates';
import { amortizationEstimate } from '@/lib/finance/amortization';
import { annualInterestDifference, benchmarkSpread } from '@/lib/finance/benchmark';
import { assessPosition, healthFactorPrices } from '@/lib/finance/projection';
import type { FinancingBenchmark } from '@/lib/finance/benchmark';
import type { BorrowScenario } from '@/lib/finance/persist';
import type { Venue } from '@/lib/protocol';

export type ScenarioView = {
  collateralUsd: number | null;
  startingLtv: number | null;
  healthFactor: number | null;
  healthFactorKind: 'native' | 'app-derived' | null;
  liquidationPrice: number | null;
  distanceToLiquidation: number | null;
  healthFactorPrices: Array<{ healthFactor: number; price: number | null }>;
  yearOneInterest: number;
  monthOneInterest: number;
  interestDeclining: boolean;
  amortization: ReturnType<typeof amortizationEstimate>;
  spread: number | null;
  annualDifference: number | null;
  comparisonPrincipal: number;
  benchmarkPayoffBalance: number | null;
};

export function scenarioForVenue(
  venue: Venue,
  scenario: BorrowScenario,
  priceUsd: number,
  benchmark?: FinancingBenchmark | null,
): ScenarioView {
  const collateralAmount = scenario.collateralAmount ?? 0;
  const position = assessPosition(venue, collateralAmount, scenario.borrowAmount, priceUsd);
  const amortization = scenario.monthlyPayment
    ? amortizationEstimate(scenario.borrowAmount, venue.borrowApr, scenario.monthlyPayment)
    : null;
  const interestDeclining = Boolean(amortization?.coversInterest);
  const spread = benchmark ? benchmarkSpread(benchmark.annualRate, venue.borrowApr) : null;
  const comparisonPrincipal = scenario.borrowAmount;
  const benchmarkPayoffBalance = benchmark?.balance && benchmark.balance > 0 ? benchmark.balance : null;
  return {
    collateralUsd: position.collateralUsd,
    startingLtv: position.ltv,
    healthFactor: position.healthFactor,
    healthFactorKind: position.healthFactorKind,
    liquidationPrice: position.liquidationPrice,
    distanceToLiquidation: position.distanceToLiquidation,
    healthFactorPrices: healthFactorPrices(venue, collateralAmount, scenario.borrowAmount),
    yearOneInterest: interestDeclining && amortization
      ? amortization.next12MonthInterest
      : annualInterest(scenario.borrowAmount, venue.borrowApr),
    monthOneInterest: interestDeclining && amortization
      ? amortization.firstInterest
      : monthlyInterest(scenario.borrowAmount, venue.borrowApr),
    interestDeclining,
    amortization,
    spread,
    annualDifference: spread === null ? null : annualInterestDifference(comparisonPrincipal, spread),
    comparisonPrincipal,
    benchmarkPayoffBalance,
  };
}
