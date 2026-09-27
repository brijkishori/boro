'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatFreshness } from '@/lib/finance/display';
import {
  formatCushionOrNone,
  formatGasFee,
  formatHealthFactorOrNone,
  formatLiquidationOrNone,
  formatLtvOrNone,
  formatTokenAmount,
  formatUsdAdaptive,
  healthFactorLabel,
} from '@/lib/finance/format';
import type { DriftChange } from '@/lib/finance/confirmSafety';
import type { PositionSnapshot, ProposedPositionChange } from '@/lib/finance/positionChange';

function Metric({
  label,
  compact,
  precise,
  source,
}: {
  label: string;
  compact: string;
  precise?: string;
  source?: string;
}) {
  return (
    <div title={precise && precise !== compact ? precise : undefined}>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{compact}</p>
      {source && <p className="text-[10px] text-muted-foreground">{source}</p>}
    </div>
  );
}

function snapshotMetrics(snapshot: PositionSnapshot, loanDecimals: number, assetDecimals: number) {
  const debtRaw = snapshot.totalDebtRaw ? BigInt(snapshot.totalDebtRaw) : null;
  const collateralRaw = snapshot.collateralAmountRaw ? BigInt(snapshot.collateralAmountRaw) : null;
  const debt = snapshot.totalDebt;
  return [
    {
      label: 'Collateral',
      compact: collateralRaw !== null
        ? formatTokenAmount(collateralRaw, assetDecimals, { compact: true, symbol: snapshot.collateralAsset })
        : `${snapshot.collateralAmount} ${snapshot.collateralAsset}`,
      precise: collateralRaw !== null
        ? `${formatTokenAmount(collateralRaw, assetDecimals)} ${snapshot.collateralAsset}${snapshot.collateralValueUsd !== undefined ? ` · ${formatUsdAdaptive(snapshot.collateralValueUsd, 'precise')}` : ''}`
        : undefined,
    },
    {
      label: 'Total debt',
      compact: debtRaw !== null
        ? formatTokenAmount(debtRaw, loanDecimals, { compact: true, symbol: snapshot.debtAsset })
        : formatUsdAdaptive(snapshot.totalDebt, 'compact'),
      precise: debtRaw !== null
        ? `${formatTokenAmount(debtRaw, loanDecimals)} ${snapshot.debtAsset}`
        : `${snapshot.totalDebt} ${snapshot.debtAsset}`,
    },
    {
      label: 'Principal remaining',
      compact: snapshot.principalDebt === undefined ? '—' : `${snapshot.principalDebt} ${snapshot.debtAsset}`,
    },
    {
      label: 'Accrued interest',
      compact: snapshot.accruedInterest === undefined ? '—' : `${snapshot.accruedInterest} ${snapshot.debtAsset}`,
    },
    {
      label: 'LTV',
      compact: formatLtvOrNone(snapshot.ltv, debt),
      source: debt > 0 ? 'Protocol / live calculation' : undefined,
    },
    {
      label: healthFactorLabel(snapshot.healthFactorKind),
      compact: formatHealthFactorOrNone(snapshot.healthFactor, debt),
      source: debt <= 0
        ? undefined
        : snapshot.healthFactorKind === 'app-derived'
          ? 'App-derived Health Factor'
          : 'Protocol health factor',
    },
    {
      label: 'Liquidation price',
      compact: formatLiquidationOrNone(snapshot.liquidationPrice, debt),
    },
    {
      label: 'Liquidation cushion',
      compact: formatCushionOrNone(snapshot.liquidationCushionPercent, debt),
    },
  ];
}

function changeRow(label: string, from: string, to: string) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{from} → {to}</span>
    </div>
  );
}

function signed(value: number, formatted: string) {
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export default function PositionChangeReview({
  change,
  loanDecimals,
  assetDecimals,
  busy,
  awaitingWallet,
  onCancel,
  onConfirm,
  notice,
  driftChanges,
  statusMessage,
  txHash,
  receiptBlock,
  onRetryRefresh,
  planningTarget,
}: {
  change: ProposedPositionChange;
  loanDecimals: number;
  assetDecimals: number;
  busy: boolean;
  awaitingWallet: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  notice?: string;
  driftChanges?: DriftChange[];
  statusMessage?: string;
  txHash?: string;
  receiptBlock?: string;
  onRetryRefresh?: () => void;
  planningTarget?: { collateral: string; debt: string };
}) {
  const blocked = change.blockers.length > 0;
  const current = snapshotMetrics(change.current, loanDecimals, assetDecimals);
  const projected = snapshotMetrics(change.projected, loanDecimals, assetDecimals);
  const debtDelta = change.projected.totalDebt - change.current.totalDebt;
  const collateralDelta = change.projected.collateralAmount - change.current.collateralAmount;
  const repay = change.repayAccounting;
  const currentDebt = change.current.totalDebt;
  const projectedDebt = change.projected.totalDebt;

  return (
    <Card className="border-blue-500/40">
      <CardContent className="space-y-4 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Proposed action</p>
          <p className="text-lg font-bold">{change.actionTitle}</p>
          <p className={`text-xs font-semibold ${change.riskDirection === 'increases' ? 'text-orange-600 dark:text-orange-400' : change.riskDirection === 'decreases' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
            {change.riskNote}
          </p>
          {change.executionIntent === 'planning-scenario' && (
            <p className="text-xs text-muted-foreground">These amounts are the change from your current position toward the planning target.</p>
          )}
          {change.executionIntent === 'modify-current' && (
            <p className="text-xs text-muted-foreground">Modifying the current on-chain position only.</p>
          )}
          {notice && <p className="mt-2 text-xs font-medium text-orange-600 dark:text-orange-400">{notice}</p>}
          {driftChanges && driftChanges.length > 0 && (
            <div className="mt-2 space-y-1 text-xs">
              {driftChanges.map((row) => (
                <p key={`${row.category}:${row.field}`}>{row.field} {row.from} → {row.to}</p>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <p>Protocol {change.protocol}</p>
          <p>Chain {change.networkLabel}</p>
          <p>Market {change.collateralAsset} / {change.debtAsset}</p>
          <p className="break-all">Market ID {change.marketId}</p>
        </div>

        {planningTarget && (
          <div className="rounded-lg border p-3 text-xs">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Planning target</p>
            <p>{planningTarget.collateral} collateral · {planningTarget.debt} debt</p>
            <p className="text-muted-foreground">Reference only. The projected position uses the proposed action.</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Current on-chain position</p>
            <div className="grid grid-cols-2 gap-2">{current.map((row) => <Metric key={row.label} {...row} />)}</div>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Projected after transaction</p>
            <div className="grid grid-cols-2 gap-2">{projected.map((row) => <Metric key={row.label} {...row} />)}</div>
          </div>
        </div>

        <div className="space-y-1 rounded-lg border p-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Change in risk</p>
          {changeRow(
            'Collateral',
            `${change.current.collateralAmount} ${change.current.collateralAsset}`,
            `${change.projected.collateralAmount} ${change.projected.collateralAsset}`,
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Collateral delta</span>
            <span className="font-medium">{signed(collateralDelta, `${Math.abs(collateralDelta)} ${change.current.collateralAsset}`)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total debt delta</span>
            <span className="font-medium">{debtDelta === 0 ? formatUsdAdaptive(0) : signed(debtDelta, formatUsdAdaptive(Math.abs(debtDelta)))}</span>
          </div>
          {changeRow('LTV', formatLtvOrNone(change.current.ltv, currentDebt), formatLtvOrNone(change.projected.ltv, projectedDebt))}
          {changeRow(
            healthFactorLabel(change.projected.healthFactorKind ?? change.current.healthFactorKind),
            formatHealthFactorOrNone(change.current.healthFactor, currentDebt),
            formatHealthFactorOrNone(change.projected.healthFactor, projectedDebt),
          )}
          {changeRow('Liquidation BTC', formatLiquidationOrNone(change.current.liquidationPrice, currentDebt), formatLiquidationOrNone(change.projected.liquidationPrice, projectedDebt))}
          {changeRow('BTC cushion', formatCushionOrNone(change.current.liquidationCushionPercent, currentDebt), formatCushionOrNone(change.projected.liquidationCushionPercent, projectedDebt))}
        </div>

        {repay && (
          <div className="space-y-1 rounded-lg border p-3 text-xs">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Repayment accounting</p>
            <p>Repayment amount {formatTokenAmount(BigInt(repay.repayAmountRaw), loanDecimals, { symbol: change.asset })}</p>
            <p>Estimated interest paid {formatTokenAmount(BigInt(repay.estimatedInterestPaidRaw), loanDecimals, { symbol: change.asset })}</p>
            <p>Estimated principal reduction {formatTokenAmount(BigInt(repay.estimatedPrincipalReductionRaw), loanDecimals, { symbol: change.asset })}</p>
            <p>Estimated principal remaining {formatTokenAmount(BigInt(repay.estimatedPrincipalRemainingRaw), loanDecimals, { symbol: change.asset })}</p>
            <p>Estimated total debt remaining {formatTokenAmount(BigInt(repay.estimatedTotalDebtRemainingRaw), loanDecimals, { symbol: change.asset })}</p>
            {repay.maxRepay && (
              <p className="text-muted-foreground">
                {repay.protocolSafeFullRepay
                  ? 'Full repayment uses the protocol-safe path. Remaining debt is projected at zero.'
                  : 'Wallet balance is below a protocol-safe full repay, so a remainder may stay open.'}
              </p>
            )}
            {change.interestNote && <p className="text-muted-foreground">{change.interestNote}</p>}
          </div>
        )}

        {change.warnings.length > 0 && (
          <div className="space-y-1 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-xs">
            {change.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        )}

        {change.blockers.length > 0 && (
          <div className="space-y-1 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs">
            {change.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
            <p>Confirmation is blocked until this is resolved.</p>
          </div>
        )}

        <div className="space-y-1 text-xs">
          <p>Estimated network fee {formatGasFee(change.estimatedNetworkFeeUsd)}</p>
          <p>{change.approvalRequired ? 'Token approval is required before the position-changing transaction.' : 'No additional token approval is required.'}</p>
          <p>{change.walletTxCount} wallet transaction{change.walletTxCount === 1 ? '' : 's'}</p>
          {change.steps.map((step) => <p key={step.label} className="text-muted-foreground">{step.label}</p>)}
          <p className="text-muted-foreground">
            {formatFreshness(change.fetchedAt) ?? 'Data freshness unknown'}
            {change.isStale ? ' · stale' : ''}
          </p>
        </div>

        {(statusMessage || txHash) && (
          <div className="space-y-1 rounded-lg border p-3 text-xs">
            {statusMessage && <p className="font-medium">{statusMessage}</p>}
            {txHash && <p className="break-all text-muted-foreground">Transaction {txHash}</p>}
            {receiptBlock && <p className="text-muted-foreground">Receipt block {receiptBlock}</p>}
            {onRetryRefresh && (
              <Button type="button" variant="outline" className="mt-2 h-10 w-full" onClick={onRetryRefresh}>
                Retry position refresh
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-12 flex-1" disabled={busy && !awaitingWallet && !onRetryRefresh} onClick={onCancel}>Cancel</Button>
          <Button
            type="button"
            className="h-12 flex-1 bg-blue-600 text-white hover:bg-blue-700"
            disabled={blocked || busy || Boolean(onRetryRefresh)}
            onClick={onConfirm}
          >
            {awaitingWallet ? 'Confirm in wallet…' : busy ? 'Confirming…' : change.confirmLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
