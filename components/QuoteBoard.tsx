'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatApr, formatUsd } from '@/lib/amount';
import { formatCushion, formatHealthFactor, formatLtv, formatPercent, healthFactorLabel } from '@/lib/finance/format';
import { compactHistoryRows, formatFreshness, formatSpreadShort, historyRows, PAYOFF_RATE_NOTE, RATE_UNCHANGED_NOTE, yearOneInterestLabel } from '@/lib/finance/display';
import { historyCoverage, historyCoverageLabel } from '@/lib/finance/history';
import { badgeClass, marketQuality, scenarioFit } from '@/lib/finance/labels';
import type { FinancingBenchmark } from '@/lib/finance/benchmark';
import type { BorrowScenario } from '@/lib/finance/persist';
import { assessMarket } from '@/lib/finance/riskAssessment';
import { scenarioForVenue } from '@/lib/finance/scenario';
import { useVenueHistory } from '@/components/useVenueHistory';
import {
  availableToBorrowUsd,
  chainLabel,
  collateralLimitLabel,
  protocolLabel,
  shortMarketId,
  wrapperCategories,
  type AssetFilter,
  type Venue,
  type VenueAction,
} from '@/lib/protocol';

const FILTERS: { id: AssetFilter; label: string }[] = [
  { id: 'all', label: 'All BTC' },
  { id: 'direct', label: 'Direct BTC' },
  { id: 'tBTC', label: 'tBTC' },
  { id: 'WBTC', label: 'WBTC' },
  { id: 'cbBTC', label: 'cbBTC' },
];

type Panel = 'rate' | 'liquidity' | 'collateral' | 'config' | 'scenario' | 'benchmark';

export default function QuoteBoard({
  action,
  venues,
  peers,
  selectedId,
  recommendedId,
  filter,
  onFilter,
  onSelect,
  scenario,
  benchmark,
  btcPrice = 0,
  showFilters = true,
  prefetchHistory = false,
  openDetailsId,
  onCloseDetails,
  cardAnchor = false,
}: {
  action: VenueAction;
  venues: Venue[];
  peers?: Venue[];
  selectedId: string | null;
  recommendedId: string | null;
  filter?: AssetFilter;
  onFilter?: (filter: AssetFilter) => void;
  onSelect: (id: string) => void;
  scenario?: BorrowScenario | null;
  benchmark?: FinancingBenchmark | null;
  btcPrice?: number;
  showFilters?: boolean;
  prefetchHistory?: boolean;
  openDetailsId?: string | null;
  onCloseDetails?: () => void;
  cardAnchor?: boolean;
}) {
  const lending = action === 'lend';
  const comparisonSet = peers ?? venues;

  return (
    <section className="space-y-3">
      {showFilters && filter && onFilter && (
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              className={`h-10 ${filter === item.id ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
              variant={filter === item.id ? 'default' : 'outline'}
              onClick={() => onFilter(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
      {venues.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No market passed the safety filters for this view.</p>
      ) : (
        <div className="grid gap-2">
          {venues.map((venue) => (
            <MarketCard
              key={venue.id}
              venue={venue}
              peers={comparisonSet}
              action={action}
              selected={venue.id === selectedId}
              recommended={venue.id === recommendedId}
              onSelect={onSelect}
              scenario={scenario}
              benchmark={benchmark}
              btcPrice={btcPrice}
              prefetchHistory={prefetchHistory}
              forceOpen={openDetailsId === venue.id}
              onCloseDetails={onCloseDetails}
              anchor={cardAnchor}
            />
          ))}
        </div>
      )}
      {lending && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The highlighted market has the highest current supply APY among pools with enough liquidity. Smaller pools stay visible.
        </p>
      )}
    </section>
  );
}

function MarketCard({
  venue,
  peers,
  action,
  selected,
  recommended,
  onSelect,
  scenario,
  benchmark,
  btcPrice,
  prefetchHistory,
  forceOpen,
  onCloseDetails,
  anchor,
}: {
  venue: Venue;
  peers: Venue[];
  action: VenueAction;
  selected: boolean;
  recommended: boolean;
  onSelect: (id: string) => void;
  scenario?: BorrowScenario | null;
  benchmark?: FinancingBenchmark | null;
  btcPrice: number;
  prefetchHistory: boolean;
  forceOpen?: boolean;
  onCloseDetails?: () => void;
  anchor?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = localOpen || Boolean(forceOpen);
  const lending = action === 'lend';
  const available = availableToBorrowUsd(venue);
  const quality = marketQuality(venue);
  const assessment = assessMarket(venue, { action, peers, scenario, benchmark, history: venue.rateHistory });
  const fit = lending ? null : scenarioFit(venue, assessment, scenario, benchmark);
  const view = !lending && scenario ? scenarioForVenue(venue, scenario, venue.priceUsd || btcPrice, benchmark) : null;
  const limit = collateralLimitLabel(venue);
  const { metrics } = useVenueHistory(venue.id, prefetchHistory);
  const compactHistory = compactHistoryRows({
    currentApr: venue.borrowApr,
    ...(venue.rateHistory ?? {}),
    ...(metrics ?? {}),
  });
  const avg7d = compactHistory.find((row) => row.label === '7-day avg');
  const reasons = [...assessment.reasons, ...assessment.cautions].slice(0, 3);

  return (
    <div
      id={anchor ? `market-${venue.id}` : undefined}
      className={`rounded-xl border p-3 text-left transition-colors ${selected ? 'border-blue-500 bg-blue-500/5' : 'border-muted'}`}
    >
      <button type="button" onClick={() => onSelect(venue.id)} className="w-full min-h-11 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold">{protocolLabel(venue.protocol)}</p>
            <p className="truncate text-[11px] text-muted-foreground">{chainLabel(venue.chainId)} · {venue.assetSymbol}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black">{formatApr(lending ? venue.supplyApr : venue.borrowApr)}</p>
            <p className="text-[10px] uppercase text-muted-foreground">{lending ? 'Supply APY' : 'Current APR'}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(quality.level)}`}>{quality.label}</span>
          {fit && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(fit.level)}`}>{fit.label}</span>}
          {recommended && (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
              {lending ? 'Best supply APY' : 'Suggested'}
            </span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {avg7d && <span>7-day avg {avg7d.value}</span>}
          <span>{lending ? 'Liquidity' : 'Available'} {formatUsd(available)}</span>
          {view?.startingLtv !== null && view?.startingLtv !== undefined ? (
            <span>Your LTV {formatLtv(view.startingLtv)}</span>
          ) : (
            !lending && <span>{limit.label} {formatPercent(limit.value, 2, { exact: true })}</span>
          )}
        </div>
        {benchmark && view?.spread !== null && view?.spread !== undefined && (
          <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
            <p>Benchmark APR: {formatApr(benchmark.annualRate)}</p>
            <p>Difference: {formatSpreadShort(view.spread)}</p>
            {view.annualDifference !== null && (
              <p>Estimated interest difference: ~{formatUsd(Math.abs(view.annualDifference))}/year at current rates</p>
            )}
          </div>
        )}
      </button>
      {reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-10"
        onClick={() => {
          if (open) {
            setLocalOpen(false);
            onCloseDetails?.();
          } else {
            setLocalOpen(true);
          }
        }}
      >
        {open ? 'Hide details' : 'Details'}
      </Button>
      {open && (
        <MarketDetails
          venue={venue}
          action={action}
          scenario={scenario}
          benchmark={benchmark}
          btcPrice={btcPrice}
          prefetchHistory={prefetchHistory || open}
        />
      )}
    </div>
  );
}

function MarketDetails({
  venue,
  action,
  scenario,
  benchmark,
  btcPrice,
  prefetchHistory,
}: {
  venue: Venue;
  action: VenueAction;
  scenario?: BorrowScenario | null;
  benchmark?: FinancingBenchmark | null;
  btcPrice: number;
  prefetchHistory: boolean;
}) {
  const { metrics, loading } = useVenueHistory(venue.id, prefetchHistory);
  const [panel, setPanel] = useState<Panel | null>(scenario ? 'scenario' : 'rate');
  const history = historyRows({
    currentApr: venue.borrowApr,
    currentApy: venue.borrowRate?.apy,
    ...(venue.rateHistory ?? {}),
    ...(metrics ?? {}),
  });
  const risk = venue.collateralRisk;
  const liquidity = venue.liquidity;
  const wrappers = wrapperCategories(venue.assetKind);
  const view = action === 'borrow' && scenario ? scenarioForVenue(venue, scenario, venue.priceUsd || btcPrice, benchmark) : null;
  const limit = collateralLimitLabel(venue);

  return (
    <div className="mt-3 space-y-2 border-t pt-3 text-[11px] leading-relaxed">
      <Accordion id="rate" title="Rate history" open={panel} onOpen={setPanel}>
        <p>Source rate {formatApr(venue.borrowRate?.sourceValue ?? venue.borrowApr)} {venue.borrowRate?.sourceRateType ?? 'APR'}</p>
        <p>Normalized APR {formatApr(venue.borrowApr)}</p>
        <p>Normalized APY {venue.borrowRate ? formatApr(venue.borrowRate.apy) : '—'}</p>
        <p>Conversion assumes per-second compounding. Variable rate. Benchmark comparison uses normalized APR.</p>
        <p>{historyCoverageLabel(historyCoverage({ ...(venue.rateHistory ?? {}), ...(metrics ?? {}) }))}</p>
        {loading && history.length <= 1 && <p className="text-muted-foreground">Loading history…</p>}
        {!loading && history.length <= 1 && <p className="text-muted-foreground">Not enough history</p>}
        <div className="mt-2 grid gap-1">
          {history.filter((row) => row.label !== 'Current').map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium">{row.value}</span>
            </div>
          ))}
        </div>
        {formatFreshness(venue.freshness?.fetchedAt) && (
          <p className="mt-1 text-muted-foreground">{formatFreshness(venue.freshness?.fetchedAt)}{venue.freshness?.source ? ` · ${venue.freshness.source}` : ''}</p>
        )}
      </Accordion>
      <Accordion id="liquidity" title="Market liquidity" open={panel} onOpen={setPanel}>
        {liquidity?.totalSupplied !== undefined && <p>Total supplied {formatUsd(liquidity.totalSupplied)}</p>}
        {liquidity?.totalBorrowed !== undefined && <p>Total borrowed {formatUsd(liquidity.totalBorrowed)}</p>}
        <p>Available to borrow {formatUsd(availableToBorrowUsd(venue))}</p>
        {(liquidity?.utilization ?? venue.utilization) !== undefined && (
          <p>Utilization {formatPercent((liquidity?.utilization ?? venue.utilization) ?? 0, 2)}</p>
        )}
      </Accordion>
      <Accordion id="collateral" title="Collateral & liquidation" open={panel} onOpen={setPanel}>
        {view?.startingLtv !== null && view?.startingLtv !== undefined && <p>Your LTV {formatLtv(view.startingLtv)}</p>}
        {view?.healthFactor !== null && view?.healthFactor !== undefined && <p>{healthFactorLabel(view.healthFactorKind)} {formatHealthFactor(view.healthFactor)}</p>}
        {view?.liquidationPrice !== null && view?.liquidationPrice !== undefined && <p>Liquidation ~{formatUsd(view.liquidationPrice)} BTC</p>}
        {view?.distanceToLiquidation !== null && view?.distanceToLiquidation !== undefined && (
          <p>BTC cushion {formatCushion(view.distanceToLiquidation)}</p>
        )}
        <p>Protocol {limit.label} {pct(limit.value)}</p>
        {venue.protocol !== 'morpho' && risk?.liquidationThreshold !== undefined && <p>Liquidation threshold {pct(risk.liquidationThreshold)}</p>}
        {risk?.liquidationPenalty !== undefined && <p>Liquidation penalty {pct(risk.liquidationPenalty)}</p>}
        {risk?.liquidationBonus !== undefined && venue.protocol !== 'morpho' && (
          <p>Liquidation bonus {pct(risk.liquidationBonus > 1 ? risk.liquidationBonus - 1 : risk.liquidationBonus)}</p>
        )}
        {risk?.eMode && <p>E-Mode {risk.eMode.available ? `${risk.eMode.category ?? 'available'}` : 'not applied in this quote'}</p>}
      </Accordion>
      <Accordion id="config" title="Market configuration" open={panel} onOpen={setPanel}>
        <p>{wrappers.simplicity}. {wrappers.custody}. {wrappers.depth}.</p>
        {venue.morpho && (
          <>
            <p>Market {shortMarketId(venue.morpho.marketId)}</p>
            <p className="break-all">Market ID {venue.morpho.marketId}</p>
            <p>Collateral {venue.assetSymbol}</p>
            <p>Loan {venue.loanSymbol}</p>
            <p>Oracle {shortMarketId(venue.morpho.oracle)}</p>
            <p>IRM {shortMarketId(venue.morpho.irm)}</p>
            <p>LLTV {formatPercent(Number(venue.morpho.lltv) / 1e18, 2, { exact: true })}</p>
          </>
        )}
      </Accordion>
      {action === 'borrow' && (
        <Accordion id="scenario" title="My scenario" open={panel} onOpen={setPanel}>
          {view ? (
            <>
              {view.startingLtv !== null && <p>Your LTV {formatLtv(view.startingLtv)}</p>}
              {view.healthFactor !== null && <p>{healthFactorLabel(view.healthFactorKind)} {formatHealthFactor(view.healthFactor)}</p>}
              {view.liquidationPrice !== null && <p>Approximate liquidation level {formatUsd(view.liquidationPrice)}</p>}
              {view.distanceToLiquidation !== null && <p>BTC cushion {formatCushion(view.distanceToLiquidation)}</p>}
              <p>{yearOneInterestLabel(view.interestDeclining)} {formatUsd(view.yearOneInterest)}</p>
              <p className="text-muted-foreground">{RATE_UNCHANGED_NOTE}</p>
              <p>Estimated first-month interest {formatUsd(view.monthOneInterest)}</p>
              {view.healthFactorPrices.map((row) => (
                <p key={row.healthFactor}>BTC price at HF {formatHealthFactor(row.healthFactor)}: {row.price ? formatUsd(row.price) : '—'}</p>
              ))}
              {view.amortization && (
                view.amortization.coversInterest ? (
                  <>
                    <p>Estimated months to payoff {view.amortization.months}</p>
                    <p>Estimated total interest {view.amortization.totalInterest !== null ? formatUsd(view.amortization.totalInterest) : '—'}</p>
                    <p className="text-muted-foreground">{PAYOFF_RATE_NOTE}</p>
                  </>
                ) : (
                  <p className="text-orange-500">Payment does not currently cover estimated interest.</p>
                )
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Enter an intended borrow above to see your LTV and liquidation level.</p>
          )}
        </Accordion>
      )}
      {action === 'borrow' && (
        <Accordion id="benchmark" title="Benchmark comparison" open={panel} onOpen={setPanel}>
          {benchmark && view?.spread !== null && view?.spread !== undefined ? (
            <>
              <p>Current {formatApr(venue.borrowApr)}</p>
              <p>Benchmark {formatApr(benchmark.annualRate)} {benchmark.rateType}</p>
              <p>Difference {formatSpreadShort(view.spread)}</p>
              {view.annualDifference !== null && (
                <p>Estimated interest difference at current rates {formatUsd(view.annualDifference)}</p>
              )}
              <p className="text-muted-foreground">Interest comparison based on planned borrow amount: {formatUsd(view.comparisonPrincipal)}</p>
              {view.benchmarkPayoffBalance !== null && Math.abs(view.benchmarkPayoffBalance - view.comparisonPrincipal) > 0.005 && (
                <p className="text-muted-foreground">Saved payoff balance {formatUsd(view.benchmarkPayoffBalance)} is not used for this comparison.</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Add a financing benchmark above to compare current APR against another option.</p>
          )}
        </Accordion>
      )}
    </div>
  );
}

function Accordion({
  id,
  title,
  open,
  onOpen,
  children,
}: {
  id: Panel;
  title: string;
  open: Panel | null;
  onOpen: (id: Panel | null) => void;
  children: ReactNode;
}) {
  const active = open === id;
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between px-3 text-left text-[11px] font-semibold uppercase text-muted-foreground"
        onClick={() => onOpen(active ? null : id)}
      >
        {title}
        <span>{active ? '–' : '+'}</span>
      </button>
      {active && <div className="space-y-1 border-t px-3 py-2">{children}</div>}
    </div>
  );
}

function pct(value: number): string {
  return formatPercent(value, 2, { exact: true });
}
