'use client';

import { useEffect } from 'react';
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
import { chainLabel, protocolAppUrl, protocolLabel } from '@/lib/protocol';
import { compareBorrowVsLend, projectedInterest } from '@/lib/opportunities';

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
  const loans = positions.filter((item) => item.venue.action === 'borrow' && (item.snapshot.debt > 0n || item.snapshot.collateral > 0n));
  const waiting = isConnected && loans.length === 0 && (isLoading || ratesLoading || (isFetching && venues.length === 0));
  useEffect(() => {
    if (ready && loans.length > 0) seedOpen(loans);
  }, [loans, ready, seedOpen]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Loans</h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Every open BTC position across Morpho, Aave, Compound, Spark and Moonwell.</p>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => void refresh()}>
            Refresh rates
          </Button>
        </div>
      </div>
      {!isConnected && <p className="text-sm">Connect a wallet to see loans.</p>}
      {waiting && <p className="text-sm text-muted-foreground">Reading positions…</p>}
      {isConnected && !waiting && loans.length === 0 && <p className="text-sm text-muted-foreground">No open loans on this wallet.</p>}

      <Opportunities positions={loans} venues={venues} />
      <BorrowVsLend positions={loans} venues={venues} fetchedAt={payload?.fetchedAt} />

      {loans.map(({ venue, snapshot }) => {
        const debtUsd = Number(formatUnits(snapshot.debt, venue.loanDecimals));
        const collateralUsd = Number(formatUnits(snapshot.collateral, venue.assetDecimals)) * venue.priceUsd;
        const cost = projectedInterest(debtUsd, venue.borrowApr);
        const drop = snapshot.liquidationPrice > 0 && venue.priceUsd > 0 ? Math.max(0, (1 - snapshot.liquidationPrice / venue.priceUsd) * 100) : 0;
        const carry = compareBorrowVsLend([{ venue, snapshot }], venues);
        return (
          <Card key={venue.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{protocolLabel(venue.protocol)} · {venue.assetSymbol} · {chainLabel(venue.chainId)}</p>
                  <p className="text-xs text-muted-foreground">{formatApr(venue.borrowApr)} borrow APR</p>
                </div>
                <p className={`text-lg font-bold ${healthColor(snapshot.healthFactor)}`}>
                  {snapshot.healthFactor === null ? 'No debt' : `HF ${snapshot.healthFactor.toFixed(2)}`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Collateral</p>
                  <p className="font-semibold">{formatToken(snapshot.collateral, venue.assetDecimals)} {venue.assetSymbol}</p>
                  <p className="text-muted-foreground">{formatUsdExact(collateralUsd)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Debt</p>
                  <p className="font-semibold">{formatToken(snapshot.debt, venue.loanDecimals)} USDC</p>
                  <p className="text-muted-foreground">{formatUsdExact(debtUsd)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Liquidation price</p>
                  <p className="font-semibold">{snapshot.liquidationPrice > 0 ? formatUsd(snapshot.liquidationPrice) : '—'}</p>
                  <p className="text-muted-foreground">{drop > 0 ? `BTC can fall ${drop.toFixed(0)}%` : ''}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Interest</p>
                  <p className="font-semibold">{formatUsdExact(cost.month)}/mo</p>
                  <p className="text-muted-foreground">{formatUsdExact(cost.year)}/yr</p>
                </div>
              </div>
              {snapshot.debt > 0n && (
                <div className="rounded-lg border px-3 py-2">
                  <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Principal vs interest</p>
                  <LoanLedger episode={episodeForVenue(episodes, address, venue)} debt={snapshot.debt} decimals={venue.loanDecimals} />
                </div>
              )}
              {carry && snapshot.debt > 0n && (
                <div className="rounded-lg border px-3 py-2 text-xs">
                  <p className="font-semibold">
                    {carry.loopPays ? 'Lending this cash would cover the loan' : 'Do not borrow this just to lend it back'}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Borrow {formatApr(carry.borrow.apr)} ({formatUsdExact(carry.borrow.year)}/yr)
                    {carry.lendUsdc ? ` · lend USDC ${formatApr(carry.lendUsdc.apr)} (${formatUsdExact(carry.lendUsdc.year)}/yr)` : ''}
                    {` · net ${carry.lendUsdc ? `${carry.loopNetYear >= 0 ? '+' : '-'}${formatUsdExact(Math.abs(carry.loopNetYear))}/yr` : '—'}`}
                    {carry.lendBtc && carry.collateralUsd > 0 ? ` · lend ${venue.assetSymbol} instead ${formatApr(carry.lendBtc.apr)} (${formatUsdExact(carry.lendBtc.year)}/yr, no liquidation)` : ''}
                  </p>
                </div>
              )}
              <RateChart venue={venue} />
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
      })}

      {isConnected && address && (events.length > 0 || episodes.length > 0) && (
        <AuditLog wallet={address} events={events} episodes={episodes} durable={durable} />
      )}

      <AlertSettings />
    </div>
  );
}
