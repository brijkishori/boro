'use client';

import { Button } from '@/components/ui/button';
import { formatApr, formatUsd } from '@/lib/amount';
import { formatCushion, formatHealthFactor, formatLtv, healthFactorLabel } from '@/lib/finance/format';
import { formatSpreadShort } from '@/lib/finance/display';
import { historyCoverage, historyCoverageLabel } from '@/lib/finance/history';
import { scenarioForVenue } from '@/lib/finance/scenario';
import type { FinancingBenchmark } from '@/lib/finance/benchmark';
import type { BorrowScenario } from '@/lib/finance/persist';
import { availableToBorrowUsd, chainLabel, protocolLabel, type Venue } from '@/lib/protocol';

export default function DecisionCard({
  venue,
  scenario,
  benchmark,
  btcPrice,
  onCompare,
  onReviewMarket,
  onReviewTransaction,
}: {
  venue: Venue;
  scenario: BorrowScenario;
  benchmark: FinancingBenchmark | null;
  btcPrice: number;
  onCompare: () => void;
  onReviewMarket: () => void;
  onReviewTransaction: () => void;
}) {
  const view = scenarioForVenue(venue, scenario, venue.priceUsd || btcPrice, benchmark);
  const available = availableToBorrowUsd(venue);
  const coverage = historyCoverage(venue.rateHistory);

  return (
    <section id="decision-summary" className="rounded-xl border border-blue-500/40 bg-blue-500/5 p-3">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">Decision summary</p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <Stat label="Intended borrow" value={`${formatUsd(scenario.borrowAmount)} ${scenario.loanAsset}`} />
        <Stat label="Market" value={`${protocolLabel(venue.protocol)} · ${chainLabel(venue.chainId)}`} />
        <Stat label="Collateral / debt" value={`${venue.assetSymbol} / ${venue.loanSymbol}`} />
        <Stat label="Current APR" value={`${formatApr(venue.borrowApr)} variable`} />
        {benchmark && (
          <>
            <Stat label="Benchmark APR" value={`${formatApr(benchmark.annualRate)} ${benchmark.rateType}`} />
            {view.spread !== null && <Stat label="Difference" value={formatSpreadShort(view.spread)} />}
            {view.annualDifference !== null && (
              <Stat label="Est. annual interest difference" value={formatUsd(Math.abs(view.annualDifference))} />
            )}
            <Stat label="Comparison principal" value={formatUsd(view.comparisonPrincipal)} />
          </>
        )}
        {view.startingLtv !== null && <Stat label="Your LTV" value={formatLtv(view.startingLtv)} />}
        {view.liquidationPrice !== null && <Stat label="Liquidation" value={`~${formatUsd(view.liquidationPrice)} BTC`} />}
        {view.distanceToLiquidation !== null && <Stat label="BTC cushion" value={formatCushion(view.distanceToLiquidation)} />}
        {view.healthFactor !== null && <Stat label={healthFactorLabel(view.healthFactorKind)} value={formatHealthFactor(view.healthFactor)} />}
        <Stat label="Available to borrow" value={formatUsd(available)} />
        <Stat label="Rate risk" value={coverage === 'adequate' ? 'Variable' : `Variable · ${historyCoverageLabel(coverage).toLowerCase()}`} />
      </div>
      {benchmark && view.annualDifference !== null && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Estimated interest difference at current rates
          {view.spread !== null ? ` · ${formatSpreadShort(view.spread)}` : ''}.
          Interest comparison based on planned borrow amount: {formatUsd(view.comparisonPrincipal)}.
        </p>
      )}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button type="button" variant="outline" className="h-11" onClick={onCompare}>Compare alternatives</Button>
        <Button type="button" variant="outline" className="h-11" onClick={onReviewMarket}>Review market</Button>
        <Button type="button" className="h-11 bg-blue-600 text-white hover:bg-blue-700" onClick={onReviewTransaction}>Review transaction</Button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="truncate font-semibold">{value}</p>
    </div>
  );
}
