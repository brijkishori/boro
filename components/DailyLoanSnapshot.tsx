'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatApr, formatToken, formatUsd, formatUsdExact } from '@/lib/amount';
import { formatCushion, formatHealthFactor, formatLtv, formatPercent } from '@/lib/finance/format';
import { monthlyInterest } from '@/lib/finance/rates';
import { movementBpsText } from '@/lib/finance/openingApr';
import { formatFreshness } from '@/lib/finance/display';
import { chainLabel, protocolLabel, type Venue } from '@/lib/protocol';
import { portfolioDebtSummary, type OpenDebtPosition } from '@/lib/finance/portfolio';
import type { ActiveLoanView, LoanRateStatus } from '@/lib/finance/loanView';
import { StatusBadge } from '@/components/RiskStatus';
import { riskSeverityStatus } from '@/lib/finance/riskStatus';
import { currentRiskDecision, resolveRiskThresholds, type CurrentRiskDecision, type RiskSeverity } from '@/lib/finance/riskMonitor';
import type { WalletHolding } from '@/components/useWalletHoldings';

export function loanUrgencyRank(riskState: RiskSeverity): number {
  switch (riskState) {
    case 'LIQUIDATION_BOUNDARY':
      return 6;
    case 'URGENT':
      return 5;
    case 'ACT':
      return 4;
    case 'PREPARE':
      return 3;
    case 'WATCH':
      return 2;
    case 'DATA_WARNING':
      return 1;
    case 'NORMAL':
      return 0;
    case 'NO_DEBT':
      return -1;
    default:
      return 0;
  }
}

export function sortLoansByUrgency(views: ActiveLoanView[]): ActiveLoanView[] {
  return [...views].sort((a, b) => {
    const rankDiff = loanUrgencyRank(b.riskState) - loanUrgencyRank(a.riskState);
    if (rankDiff !== 0) return rankDiff;
    const hfA = a.healthFactor ?? 999;
    const hfB = b.healthFactor ?? 999;
    return hfA - hfB;
  });
}

export function formatAprChangeText(rate: LoanRateStatus): string {
  if (rate.openingApr === null) return 'Opening APR not captured';
  const openText = formatApr(rate.openingApr);
  const deltaBps = rate.deltaBps ?? 0;
  if (Math.abs(deltaBps) < 0.5) {
    return `→ approximately unchanged from opening ${openText}`;
  }
  const bps = movementBpsText(deltaBps);
  const unit = Math.abs(deltaBps) === 1 ? 'bp' : 'bps';
  if (deltaBps < 0) {
    return `↓ ${bps} ${unit} from opening ${openText}`;
  }
  return `↑ ${bps} ${unit} from opening ${openText}`;
}

export function formatMonthlyInterest(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `~$${Math.round(value).toLocaleString('en-US')}/mo`;
}

export function loanGuidanceText(riskState: RiskSeverity): string {
  const status = riskSeverityStatus(riskState);
  const detail = status.detail ?? 'No action required';
  return detail.endsWith('.') ? detail : `${detail}.`;
}

export function formatNextAttentionPoint(
  decision?: CurrentRiskDecision | null,
): string {
  if (
    !decision ||
    !decision.nextRiskState ||
    decision.nextBtcPrice === null ||
    !Number.isFinite(decision.nextBtcPrice) ||
    decision.nextBtcPrice <= 0 ||
    decision.distanceToNextState === null ||
    !Number.isFinite(decision.distanceToNextState)
  ) {
    return 'Next attention point: unavailable';
  }

  const boundaryPrice = formatUsd(decision.nextBtcPrice);
  const distance = formatPercent(Math.abs(decision.distanceToNextState), 0);
  return `Next attention point: ${decision.nextRiskState} at BTC ${boundaryPrice} · ${distance} below current BTC`;
}

export function loanActionStyle(riskState: RiskSeverity): {
  variant: 'default' | 'outline';
  className: string;
} {
  switch (riskState) {
    case 'PREPARE':
      return {
        variant: 'default',
        className: 'h-8 bg-amber-600 text-xs text-white hover:bg-amber-700',
      };
    case 'ACT':
      return {
        variant: 'default',
        className: 'h-8 bg-orange-600 text-xs text-white hover:bg-orange-700',
      };
    case 'URGENT':
    case 'LIQUIDATION_BOUNDARY':
      return {
        variant: 'default',
        className: 'h-8 bg-red-600 text-xs text-white hover:bg-red-700',
      };
    case 'NORMAL':
    case 'WATCH':
    case 'DATA_WARNING':
    case 'NO_DEBT':
    default:
      return {
        variant: 'outline',
        className: 'h-8 text-xs',
      };
  }
}

export function findFreshestTimestamp(
  active: OpenDebtPosition[] = [],
  fallbackAt?: number | null,
): number | null {
  let freshest: number | null = null;
  for (const item of active) {
    const candidate = (item as { observedAt?: number | null }).observedAt ?? item.venue?.freshness?.fetchedAt ?? null;
    if (typeof candidate === 'number' && candidate > 0) {
      if (freshest === null || candidate > freshest) {
        freshest = candidate;
      }
    }
  }
  if (freshest !== null) return freshest;
  if (typeof fallbackAt === 'number' && fallbackAt > 0) return fallbackAt;
  return null;
}

export function LoanCard({
  view,
  position,
  onRepay,
}: {
  view: ActiveLoanView;
  position?: OpenDebtPosition;
  onRepay?: (venue: Venue) => void;
}) {
  const estMonthly = view.rate.currentApr !== null
    ? formatMonthlyInterest(monthlyInterest(view.totalDebtUsd, view.rate.currentApr))
    : '—';
  const guidance = loanGuidanceText(view.riskState);
  const collateralDisplay = position
    ? `${formatToken(position.snapshot.collateral, view.assetDecimals)} ${view.assetSymbol}`
    : `${view.collateralAmount} ${view.assetSymbol}`;

  const decision = view.decision ?? (
    position ? currentRiskDecision({
      healthFactor: view.healthFactor,
      debt: view.totalDebtUsd,
      collateralAmount: view.collateralAmount,
      oraclePrice: position.venue.priceUsd > 0 ? position.venue.priceUsd : null,
      liquidationThreshold: position.venue.collateralRisk?.liquidationLtv
        ?? position.venue.collateralRisk?.liquidationThreshold
        ?? position.venue.maxLtv,
      thresholds: resolveRiskThresholds({}),
      safetyFresh: view.fresh,
    }) : null
  );

  const nextAttention = formatNextAttentionPoint(decision);
  const actionStyle = loanActionStyle(view.riskState);

  return (
    <Card className="border bg-card">
      <CardContent className="space-y-3 p-4">
        {/* Protocol · Chain and Collateral / debt pair */}
        <div className="flex items-start justify-between gap-2 border-b pb-2">
          <div>
            <p className="text-sm font-bold text-foreground">
              {`${protocolLabel(view.protocol)} · ${chainLabel(view.chainId)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {`${view.assetSymbol} / ${view.loanSymbol}`}
            </p>
          </div>
          <StatusBadge status={riskSeverityStatus(view.riskState)} />
        </div>

        {/* Debt and Collateral amount + USD value */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Debt</p>
            <p className="text-sm font-semibold">{formatUsdExact(view.totalDebtUsd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Collateral</p>
            <p className="text-sm font-semibold">
              {`${collateralDisplay} · ${formatUsd(view.collateralUsd)}`}
            </p>
          </div>
        </div>

        {/* HF + existing risk status, LTV, Liquidation BTC, BTC cushion */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">HF</p>
            <p className="font-semibold">
              {`${view.healthFactor === null ? '—' : formatHealthFactor(view.healthFactor)} · ${riskSeverityStatus(view.riskState).label}`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">LTV</p>
            <p className="font-semibold">{formatLtv(view.ltv)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Liquidation BTC</p>
            <p className="font-semibold">
              {view.liquidationPriceUsd > 0 ? formatUsd(view.liquidationPriceUsd) : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">BTC cushion</p>
            <p className="font-semibold">
              {view.liquidationCushion === null ? '—' : formatCushion(view.liquidationCushion)}
            </p>
          </div>
        </div>

        {/* Current APR, Opening APR, APR change with arrow, Estimated monthly interest */}
        <div className="grid grid-cols-2 gap-3 border-t pt-2 text-xs">
          <div>
            <p className="text-muted-foreground">APR</p>
            <p className="font-semibold">
              {view.rate.currentApr === null ? '—' : formatApr(view.rate.currentApr)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatAprChangeText(view.rate)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Interest</p>
            <p className="font-semibold">{estMonthly}</p>
          </div>
        </div>

        {/* Next attention point */}
        <p className="text-xs text-muted-foreground">
          {nextAttention}
        </p>

        {/* Current guidance */}
        <div className="rounded bg-muted/40 px-2.5 py-1.5 text-xs text-foreground">
          <p>{guidance}</p>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link href="/loans">View loan</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link href={`/risk?market=${encodeURIComponent(view.id)}`}>Risk monitor</Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant={actionStyle.variant}
            className={actionStyle.className}
            onClick={position && onRepay ? () => onRepay(position.venue) : undefined}
          >
            <Link href={`/?tab=repay&market=${encodeURIComponent(view.id)}`}>Repay / withdraw</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PortfolioStatusCard({
  views,
  summary,
  updatedAt,
}: {
  views: ActiveLoanView[];
  summary: ReturnType<typeof portfolioDebtSummary>;
  updatedAt?: number | null;
}) {
  const sorted = sortLoansByUrgency(views);
  const mostUrgent = sorted[0];
  const mostUrgentState: RiskSeverity = mostUrgent ? mostUrgent.riskState : 'NORMAL';
  const statusPresentation = riskSeverityStatus(mostUrgentState);
  const totalDebtText = summary ? formatUsdExact(summary.totalDebtUsd) : '$0.00';
  const monthlyInterestText = summary?.estimatedMonthlyInterest != null
    ? formatMonthlyInterest(summary.estimatedMonthlyInterest)
    : '—';
  const freshnessText = formatFreshness(updatedAt ?? undefined);

  return (
    <Card className="border bg-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Portfolio status</p>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={statusPresentation} />
            </div>
          </div>
          {freshnessText ? (
            <p className="text-xs font-medium text-muted-foreground">{freshnessText}</p>
          ) : null}
        </div>

        <div className={`grid gap-3 text-xs ${views.length > 1 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          <div>
            <p className="text-muted-foreground">Open loans</p>
            <p className="text-base font-bold">{views.length}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total debt</p>
            <p className="text-base font-bold">{totalDebtText}</p>
          </div>
          {views.length > 1 && (
            <div>
              <p className="text-muted-foreground">Weighted current APR</p>
              <p className="text-base font-bold">
                {summary?.weightedBorrowApr != null ? formatApr(summary.weightedBorrowApr) : '—'}
              </p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground">Estimated monthly interest</p>
            <p className="text-base font-bold">{monthlyInterestText}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WalletReservesCard({
  holdings,
}: {
  holdings?: {
    rows: WalletHolding[];
    ready: boolean;
    isConnected: boolean;
  };
}) {
  const rows = holdings?.rows ?? [];
  const baseUsdc = rows.find((r) => r.chainId === 8453 && r.symbol === 'USDC');
  const baseCbBtc = rows.find((r) => r.chainId === 8453 && r.symbol === 'cbBTC');
  const baseEth = rows.find((r) => r.chainId === 8453 && r.kind === 'native');
  const otherRows = rows.filter((r) => r.chainId !== 8453);

  return (
    <Card className="border bg-card">
      <CardContent className="space-y-3 p-4 text-xs">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          WALLET & EMERGENCY RESERVES
        </p>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">Base</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border bg-muted/20 p-2">
              <p className="text-[10px] text-muted-foreground">USDC</p>
              <p className="font-semibold">{baseUsdc ? baseUsdc.amountText : '0'} USDC</p>
              <p className="text-[10px] text-muted-foreground">{baseUsdc?.usdText ?? '$0.00'}</p>
            </div>
            <div className="rounded border bg-muted/20 p-2">
              <p className="text-[10px] text-muted-foreground">cbBTC</p>
              <p className="font-semibold">{baseCbBtc ? baseCbBtc.amountText : '0'} cbBTC</p>
              <p className="text-[10px] text-muted-foreground">{baseCbBtc?.usdText ?? '$0.00'}</p>
            </div>
            <div className="rounded border bg-muted/20 p-2">
              <p className="text-[10px] text-muted-foreground">ETH gas</p>
              <p className="font-semibold">{baseEth ? baseEth.amountText : '0'} ETH</p>
              <p className="text-[10px] text-muted-foreground">{baseEth?.usdText ?? '$0.00'}</p>
            </div>
          </div>
        </div>

        <details className="pt-1">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
            Other networks
          </summary>
          <div className="mt-2 space-y-1 rounded border bg-muted/10 p-2">
            {otherRows.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No assets detected on other networks.</p>
            ) : (
              otherRows.map((r) => (
                <div key={r.key} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{`${r.network} · ${r.symbol}`}</span>
                  <span className="font-medium">
                    {`${r.amountText} ${r.symbol} `}
                    <span className="text-muted-foreground">{`(${r.usdText})`}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

export default function DailyLoanSnapshot({
  views,
  active,
  isConnected,
  holdings,
  fetchedAt,
  onCompareMarkets,
  onRepayLoan,
}: {
  views: ActiveLoanView[];
  active: OpenDebtPosition[];
  isConnected: boolean;
  holdings?: {
    rows: WalletHolding[];
    ready: boolean;
    isConnected: boolean;
  };
  fetchedAt?: number | null;
  onCompareMarkets?: () => void;
  onRepayLoan?: (venue: Venue) => void;
}) {
  const summary = portfolioDebtSummary(active);
  const sortedViews = sortLoansByUrgency(views);
  const freshestTimestamp = findFreshestTimestamp(active, fetchedAt);

  if (views.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="border bg-card">
          <CardContent className="space-y-2 p-4 text-center sm:text-left">
            <p className="text-base font-bold text-foreground">No open loans.</p>
            <p className="text-xs text-muted-foreground">
              {isConnected
                ? 'You currently have no active debt positions on connected networks.'
                : 'Connect a wallet to view your active debt snapshot.'}
            </p>
          </CardContent>
        </Card>

        <WalletReservesCard holdings={holdings} />

        <div className="flex justify-start">
          <Button
            type="button"
            size="lg"
            className="h-11 bg-blue-600 font-semibold text-white hover:bg-blue-700"
            onClick={onCompareMarkets}
          >
            Compare borrowing markets
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Portfolio Status Summary */}
      <PortfolioStatusCard views={sortedViews} summary={summary} updatedAt={freshestTimestamp} />

      {/* 2. One compact card per open loan, ordered most urgent first */}
      <div className="space-y-3">
        {sortedViews.map((view) => {
          const position = active.find((item) => item.venue.id === view.id);
          return (
            <LoanCard
              key={view.id}
              view={view}
              position={position}
              onRepay={onRepayLoan}
            />
          );
        })}
      </div>

      {/* 3. Wallet Information below loans */}
      <WalletReservesCard holdings={holdings} />
    </div>
  );
}
