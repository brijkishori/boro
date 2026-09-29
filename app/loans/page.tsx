'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Opportunities from '@/components/Opportunities';
import BorrowVsLend from '@/components/BorrowVsLend';
import AlertSettings from '@/components/AlertSettings';
import { useLoanBook } from '@/components/useLoanBook';
import AuditLog from '@/components/AuditLog';
import { LoanRateStatus } from '@/components/LoanRateStatus';
import { MetricHint } from '@/components/MetricHint';
import { formatApr, formatToken, formatUsd, formatUsdExact } from '@/lib/amount';
import { formatAccountingAmount, formatTokenAmount } from '@/lib/finance/format';
import { formatCushion, formatHealthFactor, formatLtv } from '@/lib/finance/format';
import { asBig, formatDuration, loanLifecycle } from '@/lib/audit';
import { formatEth, formatFeeUsd, weiToUsd } from '@/components/useNetworkFee';
import { chainLabel, protocolAppUrl, protocolLabel } from '@/lib/protocol';
import { portfolioDebtSummary } from '@/lib/finance/portfolio';
import { METRIC_HINTS, portfolioSummaryLabels, type ActiveLoanView } from '@/lib/finance/loanView';
import { StatusBadge } from '@/components/RiskStatus';
import { riskSeverityStatus } from '@/lib/finance/riskStatus';
import type { OpenPosition } from '@/components/useAllPositions';
import { episodeForVenue } from '@/components/useAudit';

export default function LoansPage() {
  const book = useLoanBook();
  const { address, isConnected, active, idle, views, audit, venues, borrowMarkets } = book;
  const summary = portfolioDebtSummary(active, audit.events);
  const labels = portfolioSummaryLabels(views.length);
  const sole = views.length === 1 ? views[0] : null;
  const waiting = isConnected && borrowMarkets.length === 0 && (book.positions.isLoading || book.loading || (book.positions.isFetching && venues.length === 0));
  const { ready, seedOpen } = audit;
  useEffect(() => {
    if (ready && active.length > 0) seedOpen(active);
  }, [active, ready, seedOpen]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Loans</h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">What you owe, and whether anything needs attention.</p>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => void book.refresh()}>
            Refresh rates
          </Button>
        </div>
      </div>
      {!isConnected && <p className="text-sm">Connect a wallet to see loans.</p>}
      {waiting && <p className="text-sm text-muted-foreground">Reading positions…</p>}
      {isConnected && !waiting && active.length === 0 && <p className="text-sm text-muted-foreground">No open debt on this wallet.</p>}

      {summary && (
        <PortfolioSummary
          labels={labels}
          summary={summary}
          sole={sole}
          views={views}
        />
      )}

      {views.map((view) => {
        const position = active.find((item) => item.venue.id === view.id);
        if (!position) return null;
        return (
          <ActiveLoanCard
            key={view.id}
            view={view}
            position={position}
            episode={episodeForVenue(audit.episodes, address, position.venue)}
            events={audit.events}
            detailed={views.length > 1}
          />
        );
      })}

      {idle.length > 0 && (
        <details className="rounded-xl border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Supplied positions with no debt · {idle.length}</summary>
          <div className="mt-3 space-y-2 text-xs">
            {idle.map(({ venue, snapshot }) => (
              <div key={venue.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <p className="font-semibold">{protocolLabel(venue.protocol)} · {venue.assetSymbol} · {chainLabel(venue.chainId)}</p>
                <p className="text-muted-foreground">{formatToken(snapshot.collateral, venue.assetDecimals)} {venue.assetSymbol} · no debt</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <Opportunities positions={active} venues={venues} compact />
      <BorrowVsLend
        positions={active}
        venues={venues}
        fetchedAt={book.payload?.fetchedAt}
        openingRate={sole?.rate.openingApr !== null ? sole?.rate : undefined}
      />

      {isConnected && address && (audit.events.length > 0 || audit.episodes.length > 0) && (
        <AuditLog wallet={address} events={audit.events} episodes={audit.episodes} durable={audit.durable} />
      )}

      <AlertSettings loans={active} />
    </div>
  );
}

function named(views: ActiveLoanView[], pick: (view: ActiveLoanView) => number | null, best: 'min' | 'max') {
  let chosen: ActiveLoanView | null = null;
  for (const view of views) {
    const value = pick(view);
    if (value === null) continue;
    if (!chosen) chosen = view;
    else {
      const current = pick(chosen);
      if (current === null) chosen = view;
      else if (best === 'min' ? value < current : value > current) chosen = view;
    }
  }
  return chosen ? `${protocolLabel(chosen.protocol)} · ${chainLabel(chosen.chainId)}` : '';
}

function PortfolioSummary({
  labels,
  summary,
  sole,
  views,
}: {
  labels: ReturnType<typeof portfolioSummaryLabels>;
  summary: NonNullable<ReturnType<typeof portfolioDebtSummary>>;
  sole: ActiveLoanView | null;
  views: ActiveLoanView[];
}) {
  const healthName = sole ? '' : named(views, (view) => view.healthFactor, 'min');
  const ltvName = sole ? '' : named(views, (view) => view.ltv, 'max');
  const liquidationName = sole ? '' : named(views, (view) => view.liquidationPriceUsd > 0 ? view.liquidationPriceUsd : null, 'max');
  const cushionName = sole ? '' : named(views, (view) => view.liquidationCushion, 'min');
  const rows = [
    { label: labels.collateral, value: formatUsdExact(sole ? sole.collateralUsd : summary.totalCollateralUsd) },
    { label: labels.debt, value: formatUsdExact(sole ? sole.totalDebtUsd : summary.totalDebtUsd) },
    { label: labels.health, value: sole ? (sole.healthFactor === null ? '—' : formatHealthFactor(sole.healthFactor)) : (summary.worstHealthFactor === null ? '—' : formatHealthFactor(summary.worstHealthFactor)), hint: METRIC_HINTS.healthFactor, note: healthName },
    { label: labels.ltv, value: sole ? formatLtv(sole.ltv) : (summary.highestLtv === null ? '—' : formatLtv(summary.highestLtv)), hint: METRIC_HINTS.ltv, note: ltvName },
    { label: labels.liquidation, value: sole ? (sole.liquidationPriceUsd > 0 ? formatUsd(sole.liquidationPriceUsd) : '—') : (summary.nearestLiquidationPrice === null ? '—' : formatUsd(summary.nearestLiquidationPrice)), hint: METRIC_HINTS.liquidationPrice, note: liquidationName },
    { label: labels.cushion, value: sole ? (sole.liquidationCushion === null ? '—' : formatCushion(sole.liquidationCushion)) : (summary.smallestCushion === null ? '—' : formatCushion(summary.smallestCushion)), hint: METRIC_HINTS.liquidationDecline, note: cushionName },
    { label: labels.monthly, value: summary.estimatedMonthlyInterest === null ? '—' : formatUsdExact(summary.estimatedMonthlyInterest) },
    ...(sole ? [{ label: labels.accrued, value: sole.accruedUnpaidUsd === null ? '—' : formatUsdExact(sole.accruedUnpaidUsd) }] : []),
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Portfolio debt summary</p>
        {sole && (
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">APR since opening</p>
            <LoanRateStatus status={sole.rate} />
          </div>
        )}
        {!sole && <p className="text-xs"><span className="text-muted-foreground">{labels.apr} </span><span className="font-semibold">{summary.weightedBorrowApr === null ? '—' : formatApr(summary.weightedBorrowApr)}</span></p>}
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {rows.map((row) => (
            <div key={row.label}>
              <MetricHint label={row.label} hint={'hint' in row ? row.hint : undefined} />
              <p className="font-semibold">{row.value}</p>
              {'note' in row && row.note ? <p className="text-muted-foreground">{row.note}</p> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ActiveLoanCard({
  view,
  position,
  episode,
  events,
  detailed,
}: {
  view: ActiveLoanView;
  position: OpenPosition;
  episode: ReturnType<typeof episodeForVenue>;
  events: ReturnType<typeof useLoanBook>['audit']['events'];
  detailed: boolean;
}) {
  const { venue } = position;
  const lifecycle = loanLifecycle(episode, events, position.snapshot.debt);
  const feeUsd = lifecycle
    ? events.filter((event) => event.episodeKey === episode?.key).reduce((sum, event) => sum + (event.ethUsd === null ? 0 : weiToUsd(asBig(event.feeWei), event.ethUsd)), 0)
    : 0;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-bold">{protocolLabel(venue.protocol)} · {chainLabel(venue.chainId)}</p>
          <p className="text-xs text-muted-foreground">{view.assetSymbol} / {view.loanSymbol}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Collateral</p>
            <p className="font-semibold">{formatTokenAmount(position.snapshot.collateral, view.assetDecimals, { displayDecimals: view.assetDecimals >= 8 ? 4 : 2, symbol: view.assetSymbol, trim: false })}</p>
            <p className="text-muted-foreground">{formatUsdExact(view.collateralUsd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total debt</p>
            <p className="font-semibold">{formatUsdExact(view.totalDebtUsd)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Risk</span>
          <StatusBadge status={riskSeverityStatus(view.riskState)} />
          <span>HF {view.healthFactor === null ? '—' : formatHealthFactor(view.healthFactor)}</span>
        </div>
        <LoanRateStatus status={view.rate} />
        {detailed && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <MetricHint label="LTV" hint={METRIC_HINTS.ltv} />
              <p className="font-semibold">{formatLtv(view.ltv)}</p>
            </div>
            <div>
              <MetricHint label="Liquidation BTC" hint={METRIC_HINTS.liquidationPrice} />
              <p className="font-semibold">{view.liquidationPriceUsd > 0 ? formatUsd(view.liquidationPriceUsd) : '—'}</p>
            </div>
            <div>
              <MetricHint label="BTC decline to liquidation" hint={METRIC_HINTS.liquidationDecline} />
              <p className="font-semibold">{view.liquidationCushion === null ? '—' : formatCushion(view.liquidationCushion)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Accrued unpaid interest</p>
              <p className="font-semibold">{view.accruedUnpaidUsd === null ? '—' : formatUsdExact(view.accruedUnpaidUsd)}</p>
            </div>
          </div>
        )}
        {lifecycle && (
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold">Loan lifecycle</summary>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <Life label="Opened" value={new Date(lifecycle.openedAt).toLocaleDateString()} />
              <Life label="Duration" value={formatDuration(lifecycle.openedAt, null)} />
              <Life label="Opening principal" hint={METRIC_HINTS.openingPrincipal} value={formatAccountingAmount(lifecycle.originalPrincipal, venue.loanDecimals, venue.loanSymbol)} />
              <Life label="Borrowed after opening" hint={METRIC_HINTS.borrowedAfterOpening} value={formatAccountingAmount(lifecycle.additionalBorrowing, venue.loanDecimals, venue.loanSymbol)} />
              <Life label="Principal repaid" value={formatAccountingAmount(lifecycle.principalRepaid, venue.loanDecimals, venue.loanSymbol)} />
              <Life label="Current principal" hint={METRIC_HINTS.currentPrincipal} value={formatAccountingAmount(lifecycle.currentPrincipal, venue.loanDecimals, venue.loanSymbol)} />
              <Life label="Interest accrued" value={formatAccountingAmount(lifecycle.interestAccrued, venue.loanDecimals, venue.loanSymbol)} />
              <Life label="Interest paid" value={formatAccountingAmount(lifecycle.interestPaid, venue.loanDecimals, venue.loanSymbol)} />
              <Life label="Current accrued interest" value={formatAccountingAmount(lifecycle.currentAccruedInterest, venue.loanDecimals, venue.loanSymbol)} />
              <Life label="Network fees" value={feeUsd > 0 ? formatFeeUsd(feeUsd) : formatEth(lifecycle.networkFeeWei)} />
            </div>
          </details>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/risk?market=${encodeURIComponent(view.id)}`}>Open Risk Monitor</Link>
          </Button>
          <Button asChild size="sm" className="bg-blue-600 text-white hover:bg-blue-700">
            <Link href={`/?tab=repay&market=${encodeURIComponent(venue.id)}`}>Repay or withdraw</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={protocolAppUrl(venue)} target="_blank" rel="noreferrer">Open {protocolLabel(venue.protocol)}</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Life({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <MetricHint label={label} hint={hint} />
      <p className="font-semibold">{value}</p>
    </div>
  );
}
