'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatFreshness } from '@/lib/finance/display';
import {
  formatCushionOrNone,
  formatGasFee,
  formatHealthFactorOrNone,
  formatLiquidationOrNone,
  formatLtv,
  formatLtvOrNone,
  formatRate,
  formatUsdAdaptive,
  healthFactorLabel,
} from '@/lib/finance/format';
import type { LoanReadiness } from '@/lib/finance/readiness';
import { chainLabel, protocolLabel } from '@/lib/protocol';

export default function LoanReadinessReview({
  readiness,
  onCancel,
  onAcknowledge,
}: {
  readiness: LoanReadiness;
  onCancel: () => void;
  onAcknowledge: () => void;
}) {
  const [checked, setChecked] = useState<boolean[]>(() => readiness.acknowledgments.map(() => false));
  const allChecked = checked.length > 0 && checked.every(Boolean);
  const debt = readiness.borrowAmount;

  return (
    <Card className="border-amber-500/40">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Loan readiness review</p>
          <p className="text-sm font-semibold">Checklist before a material borrow. This is not the transaction confirmation.</p>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <p>Protocol {protocolLabel(readiness.protocol)}</p>
          <p>Chain {chainLabel(readiness.chainId)}</p>
          <p>Market {readiness.market}</p>
          <p className="break-all">Market ID {readiness.marketId}</p>
          <p>Collateral wrapper {readiness.collateralWrapper}</p>
          <p>Borrow asset {readiness.borrowAsset}</p>
          <p>Collateral {readiness.collateralAmount} {readiness.collateralWrapper}</p>
          <p>Collateral USD {readiness.collateralUsd === null ? '—' : formatUsdAdaptive(readiness.collateralUsd, 'precise')}</p>
          <p>Borrow amount {formatUsdAdaptive(readiness.borrowAmount, 'precise')}</p>
          <p>Starting LTV {formatLtvOrNone(readiness.startingLtv, debt)}</p>
          <p>Liquidation threshold {readiness.liquidationBound === null ? '—' : formatLtv(readiness.liquidationBound)}</p>
          <p>Liquidation BTC {formatLiquidationOrNone(readiness.liquidationPrice, debt)}</p>
          <p>BTC decline to liquidation {formatCushionOrNone(readiness.cushion, debt)}</p>
          <p>{healthFactorLabel(readiness.healthFactorKind)} {formatHealthFactorOrNone(readiness.healthFactor, debt)}</p>
          <p>Current normalized APR {formatRate(readiness.currentApr)}</p>
          {readiness.avg7d !== undefined && <p>7-day average {formatRate(readiness.avg7d)}</p>}
          {readiness.avg30d !== undefined && <p>30-day average {formatRate(readiness.avg30d)}</p>}
          <p>History confidence {readiness.historyConfidence}</p>
          <p>Available borrowing liquidity {formatUsdAdaptive(readiness.availableLiquidityUsd)}</p>
          {readiness.utilization !== undefined && <p>Utilization {formatLtv(readiness.utilization)}</p>}
          {readiness.benchmarkApr !== undefined && <p>Benchmark financing APR {formatRate(readiness.benchmarkApr)}</p>}
          {readiness.spread !== null && readiness.spread !== undefined && <p>Current rate spread {formatLtv(Math.abs(readiness.spread))}</p>}
          <p>Wallet collateral available {readiness.walletCollateral} {readiness.collateralWrapper}</p>
          {readiness.repaymentAvailable !== undefined && <p>Repayment asset available {formatUsdAdaptive(readiness.repaymentAvailable)}</p>}
          <p>Estimated transaction fees {formatGasFee(readiness.estimatedFeeUsd)}</p>
          <p>{formatFreshness(readiness.fetchedAt) ?? 'Data freshness unknown'}</p>
        </div>
        <div className="space-y-2">
          {readiness.acknowledgments.map((text, index) => (
            <label key={text} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked[index] ?? false}
                onChange={(event) => setChecked((current) => current.map((value, i) => (i === index ? event.target.checked : value)))}
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel}>Cancel</Button>
          <Button type="button" className="h-11 flex-1 bg-blue-600 text-white hover:bg-blue-700" disabled={!allChecked} onClick={onAcknowledge}>
            Acknowledge and continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
