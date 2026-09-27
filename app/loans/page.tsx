'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Opportunities from '@/components/Opportunities';
import BorrowVsLend from '@/components/BorrowVsLend';
import RateChart from '@/components/RateChart';
import AlertSettings from '@/components/AlertSettings';
import { useRates } from '@/components/useRates';
import { useAllPositions } from '@/components/useAllPositions';
import { useAudit, episodeForVenue } from '@/components/useAudit';
import AuditLog from '@/components/AuditLog';
import { LoanLedger } from '@/components/LoanLedger';
import { formatApr, formatToken, formatUsd, formatUsdExact } from '@/lib/amount';
import { formatCushion, formatHealthFactor, formatLtv } from '@/lib/finance/format';
import { asBig, formatDuration, loanLifecycle } from '@/lib/audit';
import { formatEth, formatFeeUsd, weiToUsd } from '@/components/useNetworkFee';
import { chainLabel, protocolAppUrl, protocolLabel, type Venue } from '@/lib/protocol';
import { compareBorrowVsLend, projectedInterest } from '@/lib/opportunities';
import { activeDebtPositions, portfolioDebtSummary, zeroDebtMarkets } from '@/lib/finance/portfolio';
import { venueBorrowDisplay, venueYield } from '@/lib/finance/yield';
import type { OpenPosition } from '@/components/useAllPositions';

function healthColor(value: number | null) {
  if (value === null) return 'text-muted-foreground';
  if (value < 1.2) return 'text-red-500';
  if (value < 1.5) return 'text-orange-500';
  return 'text-emerald-600';
}

export default function LoansPage() {
  const { address, isConnected } = useAccount();
  const { payload, loading: ratesLoading, refresh } = useRates();
  const venues = payload?.venues ?? [];
  const { positions, isLoading, isFetching } = useAllPositions(venues, address);
  const { events, episodes, durable, ready, seedOpen } = useAudit(address);
  const borrowMarkets = positions.filter((item) => item.venue.action === 'borrow' && (item.snapshot.debt > 0n || item.snapshot.collateral > 0n));
  const active = activeDebtPositions(borrowMarkets);
  const idle = zeroDebtMarkets(borrowMarkets);
  const summary = useMemo(() => portfolioDebtSummary(active, events), [active, events]);
  const waiting = isConnected && borrowMarkets.length === 0 && (isLoading || ratesLoading || (isFetching && venues.length === 0));
  useEffect(() => {
    if (ready && active.length > 0) seedOpen(active);
  }, [active, ready, seedOpen]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Loans</h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Open BTC-backed debt first, then watched markets.</p>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => void refresh()}>
            Refresh rates
          </Button>
        </div>
      </div>
      {!isConnected && <p className="text-sm">Connect a wallet to see loans.</p>}
      {waiting && <p className="text-sm text-muted-foreground">Reading positions…</p>}
      {isConnected && !waiting && active.length === 0 && <p className="text-sm text-muted-foreground">No open debt on this wallet.</p>}

      {summary && <PortfolioSummary summary={summary} />}

      {active.map((position) => (
        <ActiveLoanCard
          key={position.venue.id}
          position={position}
          venues={venues}
          episode={episodeForVenue(episodes, address, position.venue)}
          events={events}
        />
      ))}

      {idle.length > 0 && (
        <details className="rounded-xl border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Supplied markets with no debt · {idle.length}</summary>
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
      <BorrowVsLend positions={active} venues={venues} fetchedAt={payload?.fetchedAt} />

      {isConnected && address && (events.length > 0 || episodes.length > 0) && (
        <AuditLog wallet={address} events={events} episodes={episodes} durable={durable} />
      )}

      <AlertSettings loans={active} />
    </div>
  );
}

function PortfolioSummary({ summary }: { summary: NonNullable<ReturnType<typeof portfolioDebtSummary>> }) {
  const rows: Array<{ label: string; value: string; hide?: boolean }> = [
    { label: 'Collateral', value: formatUsdExact(summary.totalCollateralUsd) },
    { label: 'Debt', value: formatUsdExact(summary.totalDebtUsd) },
    { label: 'Weighted borrow APR', value: summary.weightedBorrowApr === null ? '—' : formatApr(summary.weightedBorrowApr) },
    { label: 'Est. monthly interest', value: summary.estimatedMonthlyInterest === null ? '—' : formatUsdExact(summary.estimatedMonthlyInterest) },
    { label: 'Highest LTV', value: summary.highestLtv === null ? '' : formatLtv(summary.highestLtv), hide: summary.highestLtv === null },
    { label: 'Worst health factor', value: summary.worstHealthFactor === null ? '' : formatHealthFactor(summary.worstHealthFactor), hide: summary.worstHealthFactor === null },
    { label: 'Nearest liquidation', value: summary.nearestLiquidationPrice === null ? '' : formatUsd(summary.nearestLiquidationPrice), hide: summary.nearestLiquidationPrice === null },
    { label: 'Smallest BTC cushion', value: summary.smallestCushion === null ? '' : formatCushion(summary.smallestCushion), hide: summary.smallestCushion === null },
    { label: 'Interest paid MTD', value: summary.interestPaidMonthToDate === null ? '' : formatUsdExact(summary.interestPaidMonthToDate), hide: summary.interestPaidMonthToDate === null },
    { label: 'Interest paid YTD', value: summary.interestPaidYearToDate === null ? '' : formatUsdExact(summary.interestPaidYearToDate), hide: summary.interestPaidYearToDate === null },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Portfolio debt summary</p>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {rows.filter((row) => !row.hide).map((row) => (
            <div key={row.label}>
              <p className="text-muted-foreground">{row.label}</p>
              <p className="font-semibold">{row.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ActiveLoanCard({
  position,
  venues,
  episode,
  events,
}: {
  position: OpenPosition;
  venues: Venue[];
  episode: ReturnType<typeof episodeForVenue>;
  events: ReturnType<typeof useAudit>['events'];
}) {
  const { venue, snapshot } = position;
  const debtUsd = Number(formatUnits(snapshot.debt, venue.loanDecimals));
  const collateralAmount = Number(formatUnits(snapshot.collateral, venue.assetDecimals));
  const collateralUsd = collateralAmount * venue.priceUsd;
  const borrow = venueBorrowDisplay(venue);
  const yieldQuote = venueYield(venue);
  const cost = borrow ? projectedInterest(debtUsd, borrow.value) : null;
  const drop = snapshot.liquidationPrice > 0 && venue.priceUsd > 0 ? Math.max(0, (1 - snapshot.liquidationPrice / venue.priceUsd) * 100) : 0;
  const carry = compareBorrowVsLend([position], venues);
  const lifecycle = loanLifecycle(episode, events, snapshot.debt);
  const feeUsd = lifecycle
    ? events.filter((event) => event.episodeKey === episode?.key).reduce((sum, event) => sum + (event.ethUsd === null ? 0 : weiToUsd(asBig(event.feeWei), event.ethUsd)), 0)
    : 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold">{protocolLabel(venue.protocol)} · {chainLabel(venue.chainId)}</p>
            <p className="text-xs text-muted-foreground">{venue.assetSymbol} / {venue.loanSymbol}</p>
          </div>
          <p className={`text-lg font-bold ${healthColor(snapshot.healthFactor)}`}>
            {snapshot.healthFactor === null
              ? `${formatLtv(snapshot.ltv)} LTV`
              : `${venue.protocol === 'aave' || venue.protocol === 'spark' ? 'Health Factor' : 'App-derived Health Factor'} ${formatHealthFactor(snapshot.healthFactor)}`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Collateral</p>
            <p className="font-semibold">{formatToken(snapshot.collateral, venue.assetDecimals)} {venue.assetSymbol}</p>
            <p className="text-muted-foreground">{formatUsdExact(collateralUsd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total debt</p>
            <p className="font-semibold">{formatToken(snapshot.debt, venue.loanDecimals)} {venue.loanSymbol}</p>
            <p className="text-muted-foreground">{formatUsdExact(debtUsd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Current APR</p>
            <p className="font-semibold">{borrow ? formatApr(borrow.value) : '—'}</p>
            <p className="text-muted-foreground">
              {borrow?.source ?? '—'}
              {borrow?.isStale ? ' · stale' : ''}
              {venue.rateHistory?.avg7d !== undefined ? ` · 7d ${formatApr(venue.rateHistory.avg7d)}` : ''}
              {venue.rateHistory?.avg30d !== undefined ? ` · 30d ${formatApr(venue.rateHistory.avg30d)}` : ''}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Liquidation</p>
            <p className="font-semibold">{snapshot.liquidationPrice > 0 ? formatUsd(snapshot.liquidationPrice) : '—'}</p>
            <p className="text-muted-foreground">{drop > 0 ? `${formatCushion(drop / 100)} BTC cushion` : ''}</p>
          </div>
        </div>
        {cost && (
          <p className="text-xs text-muted-foreground">
            Estimated interest {formatUsdExact(cost.month)}/mo · {formatUsdExact(cost.year)}/yr at the current APR
            {borrow?.rateType ? ` (${borrow.rateType})` : ''}.
          </p>
        )}
        {yieldQuote.rewardApy !== undefined && (
          <p className="text-xs text-muted-foreground">
            Base supply {yieldQuote.baseSupplyApr !== undefined ? formatApr(yieldQuote.baseSupplyApr) : '—'} APR
            {yieldQuote.baseSupplyApy !== undefined ? ` / ${formatApr(yieldQuote.baseSupplyApy)} APY` : ''}
            · reward APY {formatApr(yieldQuote.rewardApy)} shown separately
            {yieldQuote.rewardTokens?.length ? ` (${yieldQuote.rewardTokens.join(', ')})` : ''}.
          </p>
        )}
        {snapshot.debt > 0n && (
          <div className="rounded-lg border px-3 py-2">
            <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Principal vs interest</p>
            <LoanLedger episode={episode} debt={snapshot.debt} decimals={venue.loanDecimals} />
          </div>
        )}
        {lifecycle && (
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold">Loan lifecycle</summary>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <Life label="Opened" value={new Date(lifecycle.openedAt).toLocaleDateString()} />
              <Life label="Duration" value={formatDuration(lifecycle.openedAt, null)} />
              <Life label="Original principal" value={`${formatToken(lifecycle.originalPrincipal, venue.loanDecimals)} ${venue.loanSymbol}`} />
              <Life label="Additional borrowing" value={`${formatToken(lifecycle.additionalBorrowing, venue.loanDecimals)} ${venue.loanSymbol}`} />
              <Life label="Principal repaid" value={`${formatToken(lifecycle.principalRepaid, venue.loanDecimals)} ${venue.loanSymbol}`} />
              <Life label="Interest accrued" value={`${formatToken(lifecycle.interestAccrued, venue.loanDecimals)} ${venue.loanSymbol}`} />
              <Life label="Interest paid" value={`${formatToken(lifecycle.interestPaid, venue.loanDecimals)} ${venue.loanSymbol}`} />
              <Life label="Current principal" value={`${formatToken(lifecycle.currentPrincipal, venue.loanDecimals)} ${venue.loanSymbol}`} />
              <Life label="Current accrued interest" value={`${formatToken(lifecycle.currentAccruedInterest, venue.loanDecimals)} ${venue.loanSymbol}`} />
              <Life label="Network fees" value={feeUsd > 0 ? formatFeeUsd(feeUsd) : formatEth(lifecycle.networkFeeWei)} />
            </div>
          </details>
        )}
        {carry && (
          <div className="rounded-lg border px-3 py-2 text-xs">
            <p className="font-semibold">Gross carry at current variable rates</p>
            <p className="mt-1 text-muted-foreground">
              Borrow {formatApr(carry.borrow.apr)} ({formatUsdExact(carry.borrow.year)}/yr)
              {carry.lendUsdc ? ` · base lend ${formatApr(carry.lendUsdc.apr)} (${formatUsdExact(carry.lendUsdc.year)}/yr)` : ''}
              {` · net ${carry.lendUsdc ? `${carry.loopNetYear >= 0 ? '+' : '-'}${formatUsdExact(Math.abs(carry.loopNetYear))}/yr` : '—'}`}
            </p>
            <p className="mt-1 text-muted-foreground">Excludes taxes, transaction costs, reward-token price changes and additional protocol risk.</p>
          </div>
        )}
        <RateChart venue={venue} collapsed />
        <div className="flex flex-wrap gap-2">
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

function Life({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
