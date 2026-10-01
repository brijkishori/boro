'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatApr, formatUsd } from '@/lib/amount';
import { formatHealthFactor, formatPercent } from '@/lib/finance/format';
import { chainLabel, protocolLabel, type Venue } from '@/lib/protocol';
import { qualifyRefinancePlan } from '@/lib/finance/refinanceAlertQualification';
import {
  buildMigrationPlan,
  calculateRateStability,
  calculateStaticScenario,
  findRefinanceCandidates,
  type RefinanceMarketBaseline,
} from '@/lib/finance/refinance';

interface RefinancePanelProps {
  sourceVenue: Venue;
  allVenues?: Venue[];
  debt: number;
  collateralAmount: number;
  oraclePrice: number;
  liquidationThreshold: number;
  currentApr: number;
  openingApr: number | null;
  healthFactor: number | null;
  ltv: number | null;
  liquidationPrice: number | null;
  liquidationCushion: number | null;
  benchmarkApr?: number | null;
  gasPriceWei?: number | bigint | null;
  ethPriceUsd?: number | null;
  sourceFreshness?: 'fresh' | 'stale' | 'unavailable';
  targetCandidateId?: string | null;
}

export default function RefinancePanel({
  sourceVenue,
  allVenues = [],
  debt,
  collateralAmount,
  oraclePrice,
  liquidationThreshold,
  currentApr,
  openingApr,
  healthFactor,
  ltv,
  liquidationPrice,
  liquidationCushion,
  benchmarkApr,
  gasPriceWei,
  ethPriceUsd,
  sourceFreshness = 'fresh',
  targetCandidateId,
}: RefinancePanelProps) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(targetCandidateId ?? null);
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(targetCandidateId ?? null);
  const [customDaysInput, setCustomDaysInput] = useState<string>('60');
  const [activeScenarioDays, setActiveScenarioDays] = useState<number>(90);

  const [showWrapperChange, setShowWrapperChange] = useState<boolean>(false);
  const [showCrossChain, setShowCrossChain] = useState<boolean>(false);

  // 1. Build canonical source market baseline
  const sourceBaseline: RefinanceMarketBaseline = useMemo(() => ({
    id: sourceVenue.id,
    protocol: sourceVenue.protocol,
    chainId: sourceVenue.chainId,
    marketId: sourceVenue.id,
    collateralAsset: sourceVenue.assetSymbol,
    debtAsset: sourceVenue.loanSymbol,
    collateralAmount,
    collateralValueUsd: collateralAmount * oraclePrice,
    debt,
    currentApr,
    openingApr,
    safety: {
      ltv,
      healthFactor,
      liquidationThreshold,
      liquidationBtc: liquidationPrice,
      liquidationCushion,
    },
    availableLiquidity: sourceVenue.liquidityUsd ?? null,
    utilization: sourceVenue.utilization ?? sourceVenue.liquidity?.utilization ?? null,
    freshness: sourceFreshness,
    oraclePrice,
    stability: calculateRateStability(currentApr, sourceVenue.rateHistory),
  }), [
    collateralAmount,
    currentApr,
    debt,
    healthFactor,
    liquidationCushion,
    liquidationPrice,
    liquidationThreshold,
    ltv,
    openingApr,
    oraclePrice,
    sourceFreshness,
    sourceVenue,
  ]);

  // 2. Discover & classify candidates
  const candidates = useMemo(() => {
    return findRefinanceCandidates(sourceVenue, allVenues);
  }, [allVenues, sourceVenue]);

  // 3. Compute migration plans for all candidates
  const plans = useMemo(() => {
    return candidates.map((candidate) =>
      buildMigrationPlan({
        sourceMarket: sourceBaseline,
        destinationMarket: candidate,
        gasPriceWei,
        ethPriceUsd,
        benchmarkApr,
      }),
    );
  }, [benchmarkApr, candidates, ethPriceUsd, gasPriceWei, sourceBaseline]);

  // Top summary finding
  const comparablePlans = useMemo(() => plans.filter((p) => p.classification === 'SAME_CHAIN_SAME_WRAPPER'), [plans]);
  const wrapperPlans = useMemo(() => plans.filter((p) => p.classification === 'SAME_CHAIN_WRAPPER_CHANGE'), [plans]);
  const crossChainPlans = useMemo(() => plans.filter((p) => p.classification === 'CROSS_CHAIN'), [plans]);

  const bestComparablePlan = useMemo(() => {
    return comparablePlans
      .filter((p) => p.rateDirection === 'lower')
      .sort((a, b) => a.destinationMarket.currentApr - b.destinationMarket.currentApr)[0];
  }, [comparablePlans]);

  const bestOutsidePlan = useMemo(() => {
    return [...wrapperPlans, ...crossChainPlans]
      .filter((p) => p.rateDirection === 'lower')
      .sort((a, b) => a.destinationMarket.currentApr - b.destinationMarket.currentApr)[0];
  }, [wrapperPlans, crossChainPlans]);

  useEffect(() => {
    if (targetCandidateId) {
      setSelectedCandidateId(targetCandidateId);
      setExpandedDetailsId(targetCandidateId);
      if (wrapperPlans.some((p) => p.destinationMarket.id === targetCandidateId)) {
        setShowWrapperChange(true);
      }
      if (crossChainPlans.some((p) => p.destinationMarket.id === targetCandidateId)) {
        setShowCrossChain(true);
      }
    }
  }, [targetCandidateId, wrapperPlans, crossChainPlans]);

  return (
    <div className="space-y-4">
      {/* Purpose Banner */}
      <div className="rounded border bg-card p-3">
        <h3 className="text-sm font-semibold">Refinance &amp; Migration Intelligence</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Would moving this existing loan to another supported market materially improve borrowing economics, and what trade-offs would that introduce?
        </p>
        <div className="mt-2 text-xs">
          {!bestComparablePlan ? (
            <span className="text-muted-foreground">
              Current market has the lowest current APR among directly comparable {chainLabel(sourceVenue.chainId)} {sourceVenue.assetSymbol}/{sourceVenue.loanSymbol} alternatives.
            </span>
          ) : (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              Lowest directly comparable APR: {formatApr(bestComparablePlan.destinationMarket.currentApr)} — {protocolLabel(bestComparablePlan.destinationMarket.protocol)} · {chainLabel(bestComparablePlan.destinationMarket.chainId)}, {bestComparablePlan.rateDifferenceBps} bps below current.
            </span>
          )}
          {bestOutsidePlan && (!bestComparablePlan || bestOutsidePlan.destinationMarket.currentApr < bestComparablePlan.destinationMarket.currentApr) && (
            <div className="mt-1 text-muted-foreground">
              Lower APR exists outside the directly comparable group: {protocolLabel(bestOutsidePlan.destinationMarket.protocol)} · {chainLabel(bestOutsidePlan.destinationMarket.chainId)} · {bestOutsidePlan.destinationMarket.collateral}/{bestOutsidePlan.destinationMarket.debtAsset} — {formatApr(bestOutsidePlan.destinationMarket.currentApr)}. Requires {bestOutsidePlan.classification === 'CROSS_CHAIN' ? 'cross-chain migration' : 'wrapper change'}.
            </div>
          )}
        </div>
      </div>

      {/* Financing Benchmark Bar (Section 16) */}
      {typeof benchmarkApr === 'number' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs">
          <div>
            <span className="text-muted-foreground">Benchmark reference: </span>
            <span className="font-semibold">{formatApr(benchmarkApr)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Current {protocolLabel(sourceVenue.protocol)}: <strong className="font-semibold">{formatApr(currentApr)}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Baseline: Stay in Current Market (Section 14) */}
      <div className="rounded border border-primary/40 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-primary/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-primary">
              BASELINE
            </span>
            <span className="font-semibold">STAY IN CURRENT MARKET</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {protocolLabel(sourceVenue.protocol)} · {chainLabel(sourceVenue.chainId)}
          </span>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          {sourceVenue.assetSymbol} / {sourceVenue.loanSymbol} · Zero migration cost · Current parameters unchanged
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
          <div className="rounded border bg-background/50 p-2">
            <p className="text-muted-foreground">Current APR</p>
            <p className="font-semibold text-foreground">{formatApr(currentApr)}</p>
            {openingApr !== null && (
              <p className="text-[10px] text-muted-foreground">Opened at {formatApr(openingApr)}</p>
            )}
          </div>
          <div className="rounded border bg-background/50 p-2">
            <p className="text-muted-foreground">Safety (HF / LTV)</p>
            <p className="font-semibold">
              {healthFactor !== null ? formatHealthFactor(healthFactor) : '—'} · {ltv !== null ? formatPercent(ltv, 0) : '—'}
            </p>
            <p className="text-[10px] text-muted-foreground">LLTV {formatPercent(liquidationThreshold, 0)}</p>
          </div>
          <div className="rounded border bg-background/50 p-2">
            <p className="text-muted-foreground">Liquidation BTC</p>
            <p className="font-semibold">{liquidationPrice !== null ? formatUsd(liquidationPrice) : '—'}</p>
            <p className="text-[10px] text-muted-foreground">
              {liquidationCushion !== null ? `${formatPercent(liquidationCushion, 0)} cushion` : '—'}
            </p>
          </div>
          <div className="rounded border bg-background/50 p-2">
            <p className="text-muted-foreground">Available Liquidity</p>
            <p className="font-semibold">
              {sourceVenue.liquidityUsd ? formatUsd(sourceVenue.liquidityUsd) : 'Unknown'}
            </p>
            <p className="text-[10px] text-muted-foreground">Migration cost $0.00</p>
          </div>
        </div>

        {/* Stability summary */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>7d avg: {sourceBaseline.stability.avg7d ? formatApr(sourceBaseline.stability.avg7d) : 'Unavailable'}</span>
          <span>30d avg: {sourceBaseline.stability.avg30d ? formatApr(sourceBaseline.stability.avg30d) : 'Unavailable'}</span>
          {!sourceBaseline.stability.hasHistory && (
            <span className="italic">{sourceBaseline.stability.stabilityNote}</span>
          )}
        </div>
      </div>

      {/* Candidate Markets List (Section 4, 14, 15) */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Refinance alternatives
        </h4>

        {plans.length === 0 && (
          <p className="rounded border p-3 text-xs text-muted-foreground">
            No candidate borrowing markets currently available for comparison.
          </p>
        )}

        {(() => {
          const comparablePlans = plans.filter((p) => p.classification === 'SAME_CHAIN_SAME_WRAPPER');
          const wrapperPlans = plans.filter((p) => p.classification === 'SAME_CHAIN_WRAPPER_CHANGE');
          const crossChainPlans = plans.filter((p) => p.classification === 'CROSS_CHAIN');

          const renderPlanCard = (plan: typeof plans[0]) => {
            const isSelected = selectedCandidateId === plan.destinationMarket.id;
            const isDetailsOpen = expandedDetailsId === plan.destinationMarket.id;
            const dest = plan.destinationMarket;
            const qualification = qualifyRefinancePlan(plan);
            const isQualified = qualification.status === 'QUALIFIED_FOR_REVIEW';
            const isTargeted = Boolean(targetCandidateId && dest.id === targetCandidateId);

            return (
              <div
                key={dest.id}
                id={`candidate-${dest.id}`}
                className={`rounded border p-3 transition-colors ${
                  isTargeted
                    ? 'border-primary ring-1 ring-primary bg-card'
                    : isQualified
                      ? 'border-blue-500/40 bg-blue-500/5'
                      : plan.isStale
                        ? 'border-yellow-600/40 bg-yellow-500/5'
                        : 'bg-card'
                }`}
              >
                {/* Header with Title and Classification Badges */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">
                        {protocolLabel(dest.protocol)} · {chainLabel(dest.chainId)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {dest.collateral} / {dest.debtAsset}
                      </span>
                    </div>
                    {/* Factual Badges (Section 12, 15) */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {isQualified && (
                        <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                          QUALIFIED FOR REVIEW
                        </span>
                      )}
                      {plan.factualLabels.map((label) => {
                        const isAlert = label === 'INSUFFICIENT LIQUIDITY' || label === 'LESS LIQUIDATION MARGIN' || label === 'CROSS-CHAIN' || label === 'COLLATERAL WRAPPER CHANGE';
                        const isGood = label === 'LOWER CURRENT RATE' || label === 'MORE LIQUIDATION MARGIN' || label === 'SHORTER BREAK-EVEN' || label === 'DEEPEST LIQUIDITY';
                        return (
                          <span
                            key={label}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              isAlert
                                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                : isGood
                                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Stale Warning (Section 18) */}
                  {plan.isStale && (
                    <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-[10px] font-semibold text-yellow-700 dark:text-yellow-300">
                      Refresh required before relying on this comparison
                    </span>
                  )}
                </div>

                {/* Primary Rate & Economics Grid (Section 5, 7, 8) */}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
                  {/* Rate */}
                  <div className="rounded border bg-background/50 p-2">
                    <p className="text-muted-foreground">Current APR</p>
                    <p className="text-sm font-semibold">{formatApr(dest.currentApr)}</p>
                    <p
                      className={`font-medium ${
                        plan.rateDirection === 'lower'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : plan.rateDirection === 'higher'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {plan.rateDisplay}
                    </p>
                  </div>

                  {/* Annual Gross Difference */}
                  <div className="rounded border bg-background/50 p-2">
                    <p className="text-muted-foreground">Gross Difference</p>
                    <p className="font-semibold">
                      {plan.grossAnnualDifference > 0 ? `+$${plan.grossAnnualDifference.toFixed(0)}/yr` : plan.grossAnnualDifference < 0 ? `-$${Math.abs(plan.grossAnnualDifference).toFixed(0)}/yr` : '$0/yr'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {plan.monthlyDifference > 0 ? `~$${plan.monthlyDifference.toFixed(1)}/mo` : `~$${Math.abs(plan.monthlyDifference).toFixed(1)}/mo`}
                    </p>
                  </div>

                  {/* Migration Cost */}
                  <div className="rounded border bg-background/50 p-2">
                    <p className="text-muted-foreground">Migration Cost</p>
                    <p className="font-semibold">
                      {plan.estimatedCosts.isCostKnown && plan.estimatedCosts.estimatedCostUsd !== null
                        ? formatUsd(plan.estimatedCosts.estimatedCostUsd)
                        : 'Unknown'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      ~{plan.estimatedCosts.transactionCount} transactions
                    </p>
                  </div>

                  {/* Break-even Days */}
                  <div className="rounded border bg-background/50 p-2">
                    <p className="text-muted-foreground">Break-Even</p>
                    <p className="font-semibold">
                      {plan.breakEvenDays !== null
                        ? `~${Math.round(plan.breakEvenDays)} days`
                        : 'Unavailable'}
                    </p>
                    {plan.breakEvenMonths !== null && (
                      <p className="text-[10px] text-muted-foreground">
                        ~{plan.breakEvenMonths.toFixed(1)} months
                      </p>
                    )}
                  </div>
                </div>

                {/* Safety & Liquidity Bar */}
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs text-muted-foreground">
                  <div>
                    <span>Liquidity: </span>
                    <strong className={dest.availableLiquidity < debt ? 'text-amber-600 font-semibold' : 'text-foreground'}>
                      {formatUsd(dest.availableLiquidity)}
                    </strong>
                  </div>
                  <div>
                    <span>Wrapper: </span>
                    <strong className={plan.wrapperChange ? 'text-amber-600 font-semibold' : 'text-foreground'}>
                      {dest.collateral}
                    </strong>
                  </div>
                  <div>
                    <span>Chain: </span>
                    <strong className={plan.chainChange ? 'text-amber-600 font-semibold' : 'text-foreground'}>
                      {chainLabel(dest.chainId)}
                    </strong>
                  </div>
                  <div>
                    <span>Liquidation BTC: </span>
                    <strong className="text-foreground">
                      {plan.destinationSafety.liquidationBtc ? formatUsd(plan.destinationSafety.liquidationBtc) : '—'}
                    </strong>
                  </div>
                </div>

                {/* Rate Disclaimer (Section 5) */}
                <p className="mt-2 text-[10px] text-muted-foreground italic">
                  At current debt and current variable rates — not a forecast or guaranteed savings.
                </p>

                {/* Action Buttons: Compare Details & Model Migration */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    onClick={() => setExpandedDetailsId(isDetailsOpen ? null : dest.id)}
                  >
                    {isDetailsOpen ? 'Hide details' : 'Compare details'}
                  </button>
                  <button
                    type="button"
                    className={`rounded border px-2.5 py-1 text-xs font-medium ${
                      isSelected ? 'border-foreground font-semibold bg-muted' : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedCandidateId(isSelected ? null : dest.id)}
                  >
                    {isSelected ? 'Close scenario model' : 'Model migration'}
                  </button>
                </div>

                {/* Expanded Compare Details View (Section 6, 10, 12, 13) */}
                {isDetailsOpen && (
                  <div className="mt-3 space-y-3 rounded border bg-muted/10 p-3 text-xs">
                    {/* Safety Comparison (Section 10) */}
                    <div>
                      <h5 className="font-semibold text-foreground">Safety Comparison</h5>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <div className="space-y-1 rounded border bg-background/50 p-2">
                          <p className="font-medium text-muted-foreground">Current Market ({protocolLabel(sourceVenue.protocol)})</p>
                          <p>HF: {healthFactor !== null ? formatHealthFactor(healthFactor) : '—'}</p>
                          <p>LTV: {ltv !== null ? formatPercent(ltv, 0) : '—'}</p>
                          <p>Liquidation BTC: {liquidationPrice !== null ? formatUsd(liquidationPrice) : '—'}</p>
                          <p>Cushion: {liquidationCushion !== null ? formatPercent(liquidationCushion, 0) : '—'}</p>
                        </div>
                        <div className="space-y-1 rounded border bg-background/50 p-2">
                          <p className="font-medium text-muted-foreground">Candidate ({protocolLabel(dest.protocol)})</p>
                          <p>Projected HF: {plan.destinationSafety.healthFactor !== null ? formatHealthFactor(plan.destinationSafety.healthFactor) : '—'}</p>
                          <p>Projected LTV: {plan.destinationSafety.ltv !== null ? formatPercent(plan.destinationSafety.ltv, 0) : '—'}</p>
                          <p>Projected Liquidation BTC: {plan.destinationSafety.liquidationBtc !== null ? formatUsd(plan.destinationSafety.liquidationBtc) : '—'}</p>
                          <p>Projected Cushion: {plan.destinationSafety.liquidationCushion !== null ? formatPercent(plan.destinationSafety.liquidationCushion, 0) : '—'}</p>
                        </div>
                      </div>
                      <p className={`mt-2 font-medium ${
                        plan.safetyComparison.marginComparison === 'LESS_MARGIN'
                          ? 'text-amber-600 dark:text-amber-400'
                          : plan.safetyComparison.marginComparison === 'MORE_MARGIN'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground'
                      }`}>
                        {plan.safetyComparison.marginCopy}.
                      </p>
                    </div>

                    {/* Rate Stability (Section 6) */}
                    <div>
                      <h5 className="font-semibold text-foreground">Rate Stability</h5>
                      <div className="mt-1 flex flex-wrap gap-4 text-muted-foreground">
                        <span>Current: <strong>{formatApr(dest.currentApr)}</strong></span>
                        <span>7d avg: <strong>{dest.stability.avg7d !== null ? formatApr(dest.stability.avg7d) : 'Unavailable'}</strong></span>
                        <span>30d avg: <strong>{dest.stability.avg30d !== null ? formatApr(dest.stability.avg30d) : 'Unavailable'}</strong></span>
                      </div>
                      {!dest.stability.hasHistory && (
                        <p className="mt-1 italic text-amber-600 dark:text-amber-400">
                          {dest.stability.stabilityNote}
                        </p>
                      )}
                    </div>

                    {/* Wrapper & Chain Differences (Section 12) */}
                    {(plan.wrapperChange || plan.chainChange) && (
                      <div>
                        <h5 className="font-semibold text-amber-600 dark:text-amber-400">Wrapper &amp; Chain Differences</h5>
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                          {plan.wrapperChange && (
                            <li>
                              Collateral wrapper changes from {sourceVenue.assetSymbol} to {dest.collateral}. Requires DEX swap or unwrapping/wrapping with unknown slippage and swap fee.
                            </li>
                          )}
                          {plan.chainChange && (
                            <li>
                              Destination is on {chainLabel(dest.chainId)}. Requires cross-chain bridge, bridge fees, and destination gas handling.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Migration Funding Reality (Section 13) */}
                    <div className="rounded border bg-background/50 p-2">
                      <h5 className="font-semibold text-foreground">Migration Funding Reality</h5>
                      <p className="mt-1 text-muted-foreground">
                        Collateral cannot simply be withdrawn from {protocolLabel(sourceVenue.protocol)} while debt exists.
                        Source debt (${debt.toLocaleString()}) must be repaid first using wallet USDC, external funds, or a flash refinancing mechanism.
                      </p>
                      <p className="mt-1 font-medium text-amber-600 dark:text-amber-400">
                        Comparison only — execution path not currently supported.
                      </p>
                    </div>
                  </div>
                )}

                {/* Model Migration: Static Holding-Period Scenario (Section 9) */}
                {isSelected && (
                  <div className="mt-3 space-y-3 rounded border border-primary/30 bg-primary/5 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h5 className="font-semibold text-foreground">Static Holding-Period Scenario</h5>
                      <span className="text-[10px] text-muted-foreground">Static-rate scenario — not a forecast</span>
                    </div>

                    {/* Period Selector */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Holding period:</span>
                      {[30, 90, 365].map((period) => (
                        <button
                          key={period}
                          type="button"
                          className={`rounded border px-2 py-0.5 ${
                            activeScenarioDays === period ? 'border-foreground font-semibold bg-muted' : 'hover:bg-muted'
                          }`}
                          onClick={() => setActiveScenarioDays(period)}
                        >
                          {period === 365 ? '1 year' : `${period} days`}
                        </button>
                      ))}
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          max="3650"
                          className="w-16 rounded border px-1.5 py-0.5 text-xs bg-background"
                          value={customDaysInput}
                          onChange={(e) => {
                            setCustomDaysInput(e.target.value);
                            const val = Number(e.target.value);
                            if (val > 0) setActiveScenarioDays(val);
                          }}
                        />
                        <span className="text-muted-foreground">days</span>
                      </div>
                    </div>

                    {/* Scenario Math Calculation */}
                    {(() => {
                      const scenario = calculateStaticScenario(
                        debt,
                        currentApr,
                        dest.currentApr,
                        activeScenarioDays,
                        plan.estimatedCosts.estimatedCostUsd,
                      );
                      return (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="rounded border bg-background p-2">
                              <p className="text-muted-foreground">Stay in Market</p>
                              <p className="font-semibold">{formatUsd(scenario.stayEstimatedInterest)}</p>
                              <p className="text-[10px] text-muted-foreground">at {formatApr(currentApr)}</p>
                            </div>
                            <div className="rounded border bg-background p-2">
                              <p className="text-muted-foreground">Candidate Market</p>
                              <p className="font-semibold">{formatUsd(scenario.candidateEstimatedInterest)}</p>
                              <p className="text-[10px] text-muted-foreground">at {formatApr(dest.currentApr)}</p>
                            </div>
                            <div className="rounded border bg-background p-2">
                              <p className="text-muted-foreground">Gross Saved</p>
                              <p className={`font-semibold ${scenario.grossInterestSaved >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {scenario.grossInterestSaved >= 0 ? `+${formatUsd(scenario.grossInterestSaved)}` : `-${formatUsd(Math.abs(scenario.grossInterestSaved))}`}
                              </p>
                              <p className="text-[10px] text-muted-foreground">Interest difference</p>
                            </div>
                            <div className="rounded border bg-background p-2">
                              <p className="text-muted-foreground">Net Difference</p>
                              <p className="font-semibold">
                                {scenario.netDifference !== null
                                  ? scenario.netDifference >= 0
                                    ? `+${formatUsd(scenario.netDifference)}`
                                    : `-${formatUsd(Math.abs(scenario.netDifference))}`
                                  : 'Unknown'}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {scenario.migrationCost !== null ? `After ${formatUsd(scenario.migrationCost)} cost` : 'Unknown migration cost'}
                              </p>
                            </div>
                          </div>

                          <p className="text-[10px] text-muted-foreground italic">
                            {scenario.disclaimer}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          };

          return (
            <div className="space-y-4">
              {comparablePlans.length > 0 && (
                <div className="space-y-3">
                  {comparablePlans.map(renderPlanCard)}
                </div>
              )}

              {wrapperPlans.length > 0 && (
                <div className="space-y-3">
                  <button
                    onClick={() => setShowWrapperChange(!showWrapperChange)}
                    className="flex w-full items-center gap-2 rounded bg-muted/20 px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-muted-foreground">{showWrapperChange ? '▼' : '▶'}</span>
                    <span>Same-chain wrapper-change markets ({wrapperPlans.length})</span>
                  </button>
                  {showWrapperChange && (
                    <div className="space-y-3">
                      {wrapperPlans.map(renderPlanCard)}
                    </div>
                  )}
                </div>
              )}

              {crossChainPlans.length > 0 && (
                <div className="space-y-3">
                  <button
                    onClick={() => setShowCrossChain(!showCrossChain)}
                    className="flex w-full items-center gap-2 rounded bg-muted/20 px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-muted-foreground">{showCrossChain ? '▼' : '▶'}</span>
                    <span>Cross-chain alternatives ({crossChainPlans.length})</span>
                  </button>
                  {showCrossChain && (
                    <div className="space-y-3">
                      {crossChainPlans.map(renderPlanCard)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
