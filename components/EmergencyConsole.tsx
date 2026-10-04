'use client';

import { useMemo, useState } from 'react';
import { formatUsd, formatUsdExact } from '@/lib/amount';
import { formatHealthFactor, formatLtv, formatPercent } from '@/lib/finance/format';
import { RiskMonitorInput, RiskMonitorReport, ProposedRemedy } from '@/lib/finance/riskMonitor';
import type { EarlyWarning } from '@/lib/finance/earlyWarning';
import { buildEmergencyExecutionPlan, WalletResources, ExecutionPlan, PreparedExecution, prepareExecutionReview, deriveHypotheticalPosition } from '@/lib/finance/executionPlanner';
import { StatusBadge } from '@/components/RiskStatus';
import { riskSeverityStatus } from '@/lib/finance/riskStatus';
import { chainLabel, isChainId, type Venue, type ChainId } from '@/lib/protocol';
import { buildPlannerCards, stageRemedyHandoff } from '@/lib/finance/actionPlanner';
import { buildPhase6D1ManualRepayPlan, buildPhase6D1RepayHandoff, phase6D1ManualRepayValidation, phase6D1RepayEligibility } from '@/lib/finance/assistedRepay';
import { buildPhase6D2CollateralHandoff, buildPhase6D2ManualCollateralPlan, phase6D2CollateralEligibility, phase6D2ManualCollateralValidation } from '@/lib/finance/assistedCollateral';
import { buildPhase6D3ManualMixedPlan, buildPhase6D3MixedExecution, phase6D3ManualMixedValidation, phase6D3MixedEligibility, stagePhase6D3MixedExecution } from '@/lib/finance/assistedMixed';
import { publicClient } from '@/lib/rpc';
import { fetchFreshConfirmReads } from '@/lib/finance/fetchConfirm';
import { formatUnits, type Address } from 'viem';
import { useEthUsd } from '@/components/useNetworkFee';

export default function EmergencyConsole({
  report,
  input,
  walletResources,
  networkContext,
  warning,
  initialScenario = null,
  initialExplorePreview = false,
  venue,
}: {
  report: RiskMonitorReport;
  input: RiskMonitorInput;
  walletResources: WalletResources;
  networkContext: { chainId: number; marketId: string; gasPriceWei?: bigint };
  warning?: EarlyWarning;
  initialScenario?: 'WATCH' | 'PREPARE' | 'ACT' | 'URGENT' | null;
  initialExplorePreview?: boolean;
  venue?: Venue;
}) {
  const [explorePreview, setExplorePreview] = useState(initialExplorePreview);
  const [selectedScenario, setSelectedScenario] = useState<'WATCH' | 'PREPARE' | 'ACT' | 'URGENT' | null>(initialScenario);
  const [targetChoice, setTargetChoice] = useState<number>(report.thresholds.preferredHealthFactor || 2.5);
  const [manualRepayInput, setManualRepayInput] = useState('5');
  const [manualCollateralInput, setManualCollateralInput] = useState('0.00001');
  const [manualMixedRepayInput, setManualMixedRepayInput] = useState('5');
  const [manualMixedCollateralInput, setManualMixedCollateralInput] = useState('0.00001');

  const state = report.decision.currentState;
  const isNormal = state === 'NORMAL';
  const isHypothetical = isNormal && selectedScenario !== null;
  const showCards = !isNormal || explorePreview || isHypothetical;

  const scenarioThreshold = useMemo(() => {
    if (!selectedScenario) return null;
    switch (selectedScenario) {
      case 'WATCH': return report.thresholds.watch;
      case 'PREPARE': return report.thresholds.prepare;
      case 'ACT': return report.thresholds.act;
      case 'URGENT': return report.thresholds.urgent;
    }
  }, [selectedScenario, report.thresholds]);

  const hypotheticalPosition = useMemo(() => {
    if (!scenarioThreshold) return null;
    return deriveHypotheticalPosition(input, scenarioThreshold);
  }, [input, scenarioThreshold]);

  const effectiveInput: RiskMonitorInput = useMemo(() => {
    if (!isHypothetical || !hypotheticalPosition) return input;
    return {
      ...input,
      oraclePrice: hypotheticalPosition.oraclePrice,
      healthFactor: hypotheticalPosition.healthFactor,
    };
  }, [input, isHypothetical, hypotheticalPosition]);

  const currentEffectiveHf = isHypothetical
    ? (hypotheticalPosition?.healthFactor ?? null)
    : (report.snapshot.position.healthFactor ?? input.healthFactor ?? null);

  // We need remedies to feed to buildEmergencyExecutionPlan.
  // The planner provides cards for a target HF via buildPlannerCards, but we can also map them to ProposedRemedy.
  const remedies = useMemo(() => {
    // Generate remedies based on targetChoice
    const pos = (isHypothetical && hypotheticalPosition) ? {
      collateralAmount: hypotheticalPosition.collateralAmount,
      debt: hypotheticalPosition.debt,
      oraclePrice: hypotheticalPosition.oraclePrice,
      liquidationThreshold: hypotheticalPosition.liquidationThreshold,
      healthFactor: hypotheticalPosition.healthFactor,
      walletDebt: walletResources.debtAssetAvailable,
      walletCollateral: walletResources.collateralAvailable,
      elsewhereDebt: input.elsewhereDebtAsset ?? null,
      elsewhereCollateral: input.elsewhereCollateral ?? null,
    } : {
      collateralAmount: input.collateralAmount,
      debt: input.totalDebt,
      oraclePrice: input.oraclePrice ?? 0,
      liquidationThreshold: input.liquidationThreshold,
      healthFactor: report.snapshot.position.healthFactor,
      walletDebt: walletResources.debtAssetAvailable,
      walletCollateral: walletResources.collateralAvailable,
      elsewhereDebt: input.elsewhereDebtAsset ?? null,
      elsewhereCollateral: input.elsewhereCollateral ?? null,
    };
    
    // We can use buildPlannerCards for math 
    const cards = buildPlannerCards(pos, targetChoice);
    return cards.map(card => {
      const remedy: ProposedRemedy = {
        label: card.label,
        type: card.type,
        calculatedAt: new Date().toISOString(),
        feasibility: card.feasibility,
        repayAmount: card.repayAmount,
        collateralAmount: card.collateralAmount,
        targetHF: targetChoice,
        projectedPosition: {
          collateralAmount: card.projected.collateralAmount,
          debt: card.projected.debt,
          healthFactor: card.projected.healthFactor,
          liquidationPrice: card.projected.liquidationPrice,
          liquidationCushionPercent: card.projected.liquidationCushionPercent,
          ltv: card.projected.ltv,
        }
      };
      return remedy;
    });
  }, [input, report, targetChoice, walletResources, isHypothetical, hypotheticalPosition]);

  const plans = useMemo(() => {
    return remedies
      .map(r => buildEmergencyExecutionPlan(r, effectiveInput, walletResources, networkContext, { hypothetical: isHypothetical }))
      .filter(plan => {
        // Do not present MIXED remedy if the planner says the required resources are unavailable
        if (plan.mode === 'EMERGENCY_MIXED') {
          const debtAvail = plan.walletResources.debtAssetAvailable ?? 0;
          const collAvail = plan.walletResources.collateralAvailable ?? 0;
          if (debtAvail < plan.requiredAssets.debtAssetRequired || collAvail < plan.requiredAssets.collateralRequired) {
            return false;
          }
        }
        return true;
      });
  }, [remedies, effectiveInput, walletResources, networkContext, isHypothetical]);

  const targetOptions = useMemo(() => {
    const list = [2.0, 2.5, 3.0, report.thresholds.preferredHealthFactor].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
    );
    return Array.from(new Set(list)).sort((a, b) => a - b);
  }, [report.thresholds.preferredHealthFactor]);

  const currentChain: ChainId = isChainId(networkContext.chainId) ? networkContext.chainId : 8453;
  const currentChainName = chainLabel(currentChain);
  const manualRepayAmount = Number(manualRepayInput);
  const manualRepayVisible = Boolean(
    !isHypothetical &&
    venue &&
    venue.protocol === 'morpho' &&
    venue.chainId === 8453 &&
    input.protocol === 'morpho' &&
    input.chainId === 8453 &&
    input.totalDebt > 0,
  );
  const manualRepayValidation = manualRepayVisible
    ? phase6D1ManualRepayValidation({ riskInput: input, repayAmount: manualRepayAmount, venue })
    : null;
  const manualRepayPlan = useMemo(() => {
    if (!manualRepayVisible || !venue || manualRepayValidation) return null;
    return buildPhase6D1ManualRepayPlan({
      riskInput: input,
      walletResources,
      networkContext,
      venue,
      repayAmount: manualRepayAmount,
    });
  }, [input, manualRepayAmount, manualRepayValidation, manualRepayVisible, networkContext, venue, walletResources]);

  const manualCollateralAmount = Number(manualCollateralInput);
  const manualCollateralVisible = Boolean(
    !isHypothetical &&
    venue &&
    venue.protocol === 'morpho' &&
    venue.chainId === 8453 &&
    venue.assetSymbol.toLowerCase() === 'cbbtc' &&
    input.protocol === 'morpho' &&
    input.chainId === 8453 &&
    input.collateralAsset.toLowerCase() === 'cbbtc' &&
    input.totalDebt > 0,
  );
  const manualCollateralValidation = manualCollateralVisible
    ? phase6D2ManualCollateralValidation({ riskInput: input, collateralAmount: manualCollateralAmount, venue })
    : null;
  const manualCollateralPlan = useMemo(() => {
    if (!manualCollateralVisible || !venue || manualCollateralValidation) return null;
    return buildPhase6D2ManualCollateralPlan({
      riskInput: input,
      walletResources,
      networkContext,
      venue,
      collateralAmount: manualCollateralAmount,
    });
  }, [input, manualCollateralAmount, manualCollateralValidation, manualCollateralVisible, networkContext, venue, walletResources]);

  const manualMixedRepayAmount = Number(manualMixedRepayInput);
  const manualMixedCollateralAmount = Number(manualMixedCollateralInput);
  const manualMixedVisible = manualCollateralVisible && manualRepayVisible;
  const manualMixedValidation = manualMixedVisible
    ? phase6D3ManualMixedValidation({
        riskInput: input,
        repayAmount: manualMixedRepayAmount,
        collateralAmount: manualMixedCollateralAmount,
        venue,
      })
    : null;
  const manualMixedPlan = useMemo(() => {
    if (!manualMixedVisible || !venue || manualMixedValidation) return null;
    return buildPhase6D3ManualMixedPlan({
      riskInput: input,
      walletResources,
      networkContext,
      venue,
      repayAmount: manualMixedRepayAmount,
      collateralAmount: manualMixedCollateralAmount,
    });
  }, [input, manualMixedCollateralAmount, manualMixedRepayAmount, manualMixedValidation, manualMixedVisible, networkContext, venue, walletResources]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {!isHypothetical && (
          <p className="font-semibold">{isNormal ? 'EMERGENCY READINESS' : 'CURRENT STATE'}</p>
        )}

        {isHypothetical && (
          <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                HYPOTHETICAL SCENARIO — no on-chain position has changed.
              </span>
              <button
                type="button"
                className="rounded border px-2 py-0.5 text-xs bg-background hover:bg-muted"
                onClick={() => setSelectedScenario(null)}
              >
                Return to live position
              </button>
            </div>
            <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <p className="font-semibold text-foreground">Condition</p>
                <p>{selectedScenario} (HF {formatHealthFactor(scenarioThreshold ?? 0)})</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Stressed BTC price</p>
                <p>{moneyOrDash(hypotheticalPosition?.oraclePrice)}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Live HF</p>
                <p>{hfText(report.snapshot.position.healthFactor)}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Live BTC price</p>
                <p>{moneyOrDash(input.oraclePrice)}</p>
              </div>
            </div>
          </div>
        )}
        
        {!isNormal && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div><p className="text-muted-foreground">HF</p><p>{hfText(report.snapshot.position.healthFactor)}</p></div>
            <div><p className="text-muted-foreground">LTV</p><p>{ltvText(report.snapshot.position.ltv)}</p></div>
            <div><p className="text-muted-foreground">BTC price</p><p>{moneyOrDash(input.oraclePrice)}</p></div>
            <div><p className="text-muted-foreground">Liquidation BTC</p><p>{moneyOrDash(report.snapshot.position.liquidationPrice)}</p></div>
            <div><p className="text-muted-foreground">BTC cushion</p><p>{cushionText(report.snapshot.position.liquidationCushionPercent)}</p></div>
            {report.decision.distanceToNextState !== null && <div><p className="text-muted-foreground">Distance to next boundary</p><p>{formatPercent(report.decision.distanceToNextState, 0)}</p></div>}
          </div>
        )}

        {isNormal ? (
          isHypothetical ? (
            <div className="space-y-1 text-sm border-t pt-2">
              <p className="font-semibold text-xs text-muted-foreground uppercase">
                LIVE POSITION — CURRENT ON-CHAIN STATUS
              </p>
              <div className="flex gap-2 items-center">
                <StatusBadge status={{ tone: 'normal', mark: '●', label: 'Healthy / Ready' }} />
                <span>Current HF {hfText(report.snapshot.position.healthFactor)}</span>
              </div>
              <p className="text-muted-foreground text-xs">No action required on the live position.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex gap-2"><StatusBadge status={{ tone: 'normal', mark: '●', label: 'Ready' }} /></div>
              <p>No emergency action is currently required.</p>
              <p>Current HF: {hfText(report.snapshot.position.healthFactor)}</p>
              <p>Preferred emergency target: {formatHealthFactor(targetChoice)}</p>
              <ul className="text-muted-foreground space-y-1">
                <li>{report.domains.position === 'fresh' ? '✓' : '✕'} Position healthy</li>
                <li>{input.walletDebtAssetBalance !== null && input.walletDebtAssetBalance !== undefined && input.walletDebtAssetBalance > 0 ? '✓' : '✕'} USDC reserve available</li>
                <li>{input.walletCollateralBalance !== null && input.walletCollateralBalance !== undefined && input.walletCollateralBalance > 0 ? '✓' : '✕'} cbBTC reserve available</li>
                <li>{input.nativeGasBalance !== null && input.nativeGasBalance !== undefined && input.nativeGasBalance > 0 ? '✓' : '✕'} Gas available</li>
              </ul>
            </div>
          )
        ) : (
          <div className="space-y-1 mt-2 border-t pt-2">
            <p className="font-semibold">CURRENT GUIDANCE</p>
            <p>{report.decision.guidance}</p>
            <StatusBadge status={riskSeverityStatus(state)} />
          </div>
        )}
      </div>

      {isNormal && (
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">Preview stressed scenario</p>
            {selectedScenario && (
              <button
                type="button"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setSelectedScenario(null)}
              >
                Return to live position
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Analytically test how emergency recovery options respond if market conditions deteriorate.
          </p>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Hypothetical starting condition</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { id: 'WATCH' as const, label: 'WATCH', hf: report.thresholds.watch },
                { id: 'PREPARE' as const, label: 'PREPARE', hf: report.thresholds.prepare },
                { id: 'ACT' as const, label: 'ACT', hf: report.thresholds.act },
                { id: 'URGENT' as const, label: 'URGENT', hf: report.thresholds.urgent },
              ].map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  className={`rounded border p-2 text-left text-xs ${
                    selectedScenario === sc.id
                      ? 'border-foreground font-semibold bg-accent'
                      : 'border-muted-foreground/30 hover:border-foreground/50'
                  }`}
                  onClick={() => setSelectedScenario(sc.id)}
                >
                  <div className="font-semibold">{sc.label}</div>
                  <div className="text-muted-foreground">HF {formatHealthFactor(sc.hf)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCards && (
        <div className="space-y-4">
          {isHypothetical && (
            <div className="space-y-1 border-t pt-2">
              <p className="font-semibold text-sm">HYPOTHETICAL ACTION ANALYSIS</p>
              <div className="text-sm space-y-0.5 text-muted-foreground">
                <p>Starting condition: {selectedScenario} — HF {formatHealthFactor(scenarioThreshold ?? 0)}</p>
                <p>Recovery target: HF {formatHealthFactor(targetChoice)}</p>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <p className="font-semibold">TARGET</p>
            <p>Restore Health Factor to {formatHealthFactor(targetChoice)}</p>
            <div className="flex flex-wrap gap-2">
              {targetOptions.map((val) => (
                <button 
                  key={val} 
                  type="button" 
                  className={`rounded border px-2 py-1 ${targetChoice === val ? 'border-foreground font-semibold' : ''}`} 
                  onClick={() => setTargetChoice(val)}
                >
                  {val === report.thresholds.preferredHealthFactor ? 'Preferred target: ' : ''}HF {formatHealthFactor(val)}
                </button>
              ))}
            </div>
          </div>
          
          {currentEffectiveHf !== null && currentEffectiveHf >= targetChoice ? (
            <div className="rounded border p-3 space-y-2 bg-slate-50/50 dark:bg-slate-900/50">
              <p className="font-semibold">No action required for this target.</p>
              <div className="text-sm space-y-1 text-muted-foreground">
                <p>Current HF: {hfText(currentEffectiveHf)}</p>
                <p>Target HF: {formatHealthFactor(targetChoice)}</p>
                <p>Repay required: $0</p>
                <p>Additional collateral required: 0 {input.collateralAsset}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-semibold">ACTION OPTIONS</p>
              {plans.map((plan) => (
                <EmergencyPlanCard key={plan.id} plan={plan} input={effectiveInput} chainName={currentChainName} venue={venue} />
              ))}
            </div>
          )}
        </div>
      )}

      {isNormal && !explorePreview && !selectedScenario && (
        <button type="button" className="rounded border px-2 py-1" onClick={() => setExplorePreview(true)}>
          Preview emergency options
        </button>
      )}

      {manualRepayVisible && (
        <div className="rounded border p-3 space-y-3">
          <div className="space-y-1">
            <p className="font-semibold">MANUAL ASSISTED PARTIAL REPAYMENT — LIVE POSITION</p>
            <p className="text-xs text-muted-foreground">
              Phase 6D.1 lets you test or make a deliberate Morpho Base partial repayment without waiting for an emergency trigger. Nothing is sent until the prepared review passes and you explicitly confirm in your wallet.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block text-sm">
              Repay amount ({input.debtAsset})
              <input
                className="mt-1 h-9 w-full rounded border bg-background px-2"
                inputMode="decimal"
                value={manualRepayInput}
                onChange={(event) => setManualRepayInput(event.target.value)}
                aria-label={`Manual partial repayment amount in ${input.debtAsset}`}
              />
            </label>
            <div className="flex gap-2">
              {[5, 10, 25].map((amount) => (
                <button key={amount} type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setManualRepayInput(String(amount))}>
                  ${amount}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <p>Current debt: {formatUsdExact(input.totalDebt)} {input.debtAsset}</p>
            <p>Available on {currentChainName}: {formatUsdExact(walletResources.debtAssetAvailable ?? 0)} {input.debtAsset}</p>
          </div>
          {manualRepayValidation ? (
            <p className="text-xs text-red-500">{manualRepayValidation}</p>
          ) : manualRepayPlan ? (
            <EmergencyPlanCard plan={manualRepayPlan} input={input} chainName={currentChainName} venue={venue} />
          ) : null}
        </div>
      )}


      {manualCollateralVisible && (
        <div className="rounded border p-3 space-y-3">
          <div className="space-y-1">
            <p className="font-semibold">MANUAL ASSISTED COLLATERAL ADDITION — LIVE POSITION</p>
            <p className="text-xs text-muted-foreground">
              Phase 6D.2 adds cbBTC to the live Morpho Base loan through the same guarded review path. Nothing is sent until fresh reads, allowance checks, and simulation/approval checks pass, followed by explicit wallet confirmation.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block text-sm">
              Add collateral ({input.collateralAsset})
              <input
                className="mt-1 h-9 w-full rounded border bg-background px-2"
                inputMode="decimal"
                value={manualCollateralInput}
                onChange={(event) => setManualCollateralInput(event.target.value)}
                aria-label={`Manual collateral addition amount in ${input.collateralAsset}`}
              />
            </label>
            <div className="flex gap-2">
              {[0.00001, 0.00005, 0.0001].map((amount) => (
                <button key={amount} type="button" className="rounded border px-2 py-1 text-xs leading-tight" onClick={() => setManualCollateralInput(String(amount))}>
                  <span className="block">{amount}</span>
                  <span className="block text-[10px] text-muted-foreground">≈ {collateralUsdText(amount, input.oraclePrice)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Entered amount: {tokenText(Number(manualCollateralInput) || 0)} {input.collateralAsset} · ≈ {collateralUsdText(Number(manualCollateralInput) || 0, input.oraclePrice)}</p>
            <p>Current collateral: {tokenText(input.collateralAmount)} {input.collateralAsset} · ≈ {collateralUsdText(input.collateralAmount, input.oraclePrice)}</p>
            <p>Available on {currentChainName}: {tokenText(walletResources.collateralAvailable ?? 0)} {input.collateralAsset} · ≈ {collateralUsdText(walletResources.collateralAvailable ?? 0, input.oraclePrice)}</p>
            <p>BTC reference price: {moneyOrDash(input.oraclePrice)} <span className="text-[10px]">(USD equivalents update with live oracle data)</span></p>
          </div>
          {manualCollateralValidation ? (
            <p className="text-xs text-red-500">{manualCollateralValidation}</p>
          ) : manualCollateralPlan ? (
            <EmergencyPlanCard plan={manualCollateralPlan} input={input} chainName={currentChainName} venue={venue} />
          ) : null}
        </div>
      )}


      {manualMixedVisible && (
        <div className="rounded border p-3 space-y-3">
          <div className="space-y-1">
            <p className="font-semibold">MANUAL ASSISTED MIXED RECOVERY — LIVE POSITION</p>
            <p className="text-xs text-muted-foreground">
              Phase 6D.3 combines a partial USDC repayment and a cbBTC collateral addition. It executes as two guarded legs: repayment first, then collateral only after the repayment confirms and the updated position is reconciled. Each leg requires its own explicit wallet confirmation.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Repay ({input.debtAsset})
              <input
                className="mt-1 h-9 w-full rounded border bg-background px-2"
                inputMode="decimal"
                value={manualMixedRepayInput}
                onChange={(event) => setManualMixedRepayInput(event.target.value)}
                aria-label={`Mixed recovery repayment amount in ${input.debtAsset}`}
              />
              <span className="mt-1 block text-[10px] text-muted-foreground">Default smoke-test amount: $5</span>
            </label>
            <label className="block text-sm">
              Add collateral ({input.collateralAsset})
              <input
                className="mt-1 h-9 w-full rounded border bg-background px-2"
                inputMode="decimal"
                value={manualMixedCollateralInput}
                onChange={(event) => setManualMixedCollateralInput(event.target.value)}
                aria-label={`Mixed recovery collateral amount in ${input.collateralAsset}`}
              />
              <span className="mt-1 block text-[10px] text-muted-foreground">≈ {collateralUsdText(manualMixedCollateralAmount || 0, input.oraclePrice)} at the current BTC reference price</span>
            </label>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>USDC available on {currentChainName}: {formatUsdExact(walletResources.debtAssetAvailable ?? 0)}</p>
            <p>cbBTC available on {currentChainName}: {tokenText(walletResources.collateralAvailable ?? 0)} · ≈ {collateralUsdText(walletResources.collateralAvailable ?? 0, input.oraclePrice)}</p>
            <p>BTC reference price: {moneyOrDash(input.oraclePrice)} <span className="text-[10px]">(USD equivalents update with live oracle data)</span></p>
          </div>
          {manualMixedValidation ? (
            <p className="text-xs text-red-500">{manualMixedValidation}</p>
          ) : manualMixedPlan ? (
            <EmergencyPlanCard plan={manualMixedPlan} input={input} chainName={currentChainName} venue={venue} />
          ) : null}
        </div>
      )}

      <div className="border-t pt-2 space-y-1">
        <p className="font-semibold">AVAILABLE NOW — {currentChainName.toUpperCase()}</p>
        <p>{input.debtAsset} {moneyOrDash(input.walletDebtAssetBalance ?? null)}</p>
        <p>{input.collateralAsset} {tokenText(input.walletCollateralBalance ?? 0)} · ≈ {collateralUsdText(input.walletCollateralBalance ?? 0, input.oraclePrice)}</p>
        <p>ETH gas {input.nativeGasBalance !== null && input.nativeGasBalance !== undefined ? input.nativeGasBalance.toFixed(4) : '—'}</p>
        {(input.elsewhereDebtAsset || input.elsewhereCollateral) && (
          <div className="mt-1 pt-1 border-t">
            <p className="font-semibold">OTHER NETWORKS</p>
            {input.elsewhereDebtAsset && <p>{input.debtAsset} {moneyOrDash(input.elsewhereDebtAsset ?? null)}</p>}
            {input.elsewhereCollateral && <p>{input.collateralAsset} {tokenText(input.elsewhereCollateral)}</p>}
            <p className="text-muted-foreground">Available elsewhere — transfer/bridge would be required.</p>
          </div>
        )}
      </div>

      {warning?.pace?.shown && warning.pace.text && (
        <div className="border-t pt-2 space-y-1 text-muted-foreground">
          <p className="font-semibold text-foreground">TIME / URGENCY CONTEXT</p>
          <p>{warning.pace.text}. {warning.pace.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function EmergencyPlanCard({ plan, input, chainName, venue }: { plan: ExecutionPlan, input: RiskMonitorInput, chainName: string, venue?: Venue }) {
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedExecution | null>(null);
  const ethUsd = useEthUsd();
  
  const debtReq = plan.requiredAssets.debtAssetRequired;
  const collReq = plan.requiredAssets.collateralRequired;
  const isMixed = debtReq > 0 && collReq > 0;
  const repayEligibility = prepared && venue && plan.mode === 'EMERGENCY_REPAY'
    ? phase6D1RepayEligibility({ plan, prepared, venue, wallet: input.wallet })
    : undefined;
  const collateralEligibility = prepared && venue && plan.mode === 'EMERGENCY_COLLATERAL'
    ? phase6D2CollateralEligibility({ plan, prepared, venue, wallet: input.wallet })
    : undefined;
  const mixedEligibility = prepared && venue && plan.mode === 'EMERGENCY_MIXED'
    ? phase6D3MixedEligibility({ plan, prepared, venue, wallet: input.wallet })
    : undefined;
  
  async function handlePrepare() {
    setPreparing(true);
    try {
      if (!venue) throw new Error('Verified market definition unavailable');
      if (!input.wallet) throw new Error('Wallet address unavailable');

      if (plan.hypothetical) {
        const freshPosition = {
          debt: plan.sourcePosition.debt,
          collateralAmount: plan.sourcePosition.collateralAmount,
          oraclePrice: plan.sourcePosition.oraclePrice,
        };
        const freshWalletBalances = {
          debtAsset: plan.walletResources.debtAssetAvailable,
          collateralAsset: plan.walletResources.collateralAvailable,
        };
        const client = publicClient(venue.chainId);
        const review = await prepareExecutionReview(
          plan,
          input,
          venue,
          input.wallet as Address,
          client,
          freshPosition,
          freshWalletBalances,
          undefined,
          undefined,
          { hypothetical: true }
        );
        setPrepared(review);
        return;
      }

      const readsDebt = debtReq > 0 ? await fetchFreshConfirmReads({ venue, user: input.wallet as Address, action: 'REPAY' }) : null;
      const readsColl = collReq > 0 ? await fetchFreshConfirmReads({ venue, user: input.wallet as Address, action: 'SUPPLY_COLLATERAL' }) : null;
      const reads = readsDebt || readsColl;
      if (!reads) throw new Error('Could not fetch fresh reads');

      const freshVenue = reads.venue;
      const freshPosition = {
        debt: Number(formatUnits(reads.position.debt, freshVenue.loanDecimals)),
        collateralAmount: Number(formatUnits(reads.position.collateral, freshVenue.assetDecimals)),
        oraclePrice: freshVenue.priceUsd ?? 0,
      };
      const freshWalletBalances = {
        debtAsset: readsDebt ? Number(formatUnits(readsDebt.walletBalance, freshVenue.loanDecimals)) : null,
        collateralAsset: readsColl ? Number(formatUnits(readsColl.walletBalance, freshVenue.assetDecimals)) : null,
      };
      const client = publicClient(freshVenue.chainId);
      const gasPriceWei = await client.getGasPrice().catch(() => undefined);

      const review = await prepareExecutionReview(
        plan,
        input,
        freshVenue,
        input.wallet as Address,
        client,
        freshPosition,
        freshWalletBalances,
        gasPriceWei,
        ethUsd ?? undefined
      );
      setPrepared(review);
    } catch (err) {
      console.error(err);
      setPrepared({
        planId: plan.id,
        preparedAt: Date.now(),
        expiresAt: Date.now() + 300000,
        requiresRevalidationBeforeExecution: true,
        protocol: input.protocol,
        chainId: input.chainId,
        marketId: input.marketId,
        freshBeforeState: plan.sourcePosition,
        transactions: [],
        exactAllowances: {},
        estimatedGas: null,
        estimatedNetworkCost: null,
        networkCostUnknownReason: 'Failed to prepare simulation',
        projectedAfterState: plan.targetState,
        drift: false,
        readiness: 'BLOCKED',
        blockingIssues: [err instanceof Error ? err.message : 'Unknown preparation error'],
        warnings: [],
        requiresUserConfirmation: true,
        executable: false,
      });
    } finally {
      setPreparing(false);
    }
  }

  function continueToRepay() {
    if (!prepared || !venue) return;
    const decision = phase6D1RepayEligibility({ plan, prepared, venue, wallet: input.wallet });
    if (!decision.eligible) return;
    const handoff = buildPhase6D1RepayHandoff({ plan, prepared, venue, wallet: input.wallet });
    stageRemedyHandoff(window.sessionStorage, handoff);
    window.location.assign(`/?tab=repay&market=${encodeURIComponent(venue.id)}`);
  }


  function continueToCollateral() {
    if (!prepared || !venue) return;
    const decision = phase6D2CollateralEligibility({ plan, prepared, venue, wallet: input.wallet });
    if (!decision.eligible) return;
    const handoff = buildPhase6D2CollateralHandoff({ plan, prepared, venue, wallet: input.wallet });
    stageRemedyHandoff(window.sessionStorage, handoff);
    window.location.assign(`/?tab=borrow&market=${encodeURIComponent(venue.id)}`);
  }

  function continueToMixed() {
    if (!prepared || !venue) return;
    const decision = phase6D3MixedEligibility({ plan, prepared, venue, wallet: input.wallet });
    if (!decision.eligible) return;
    const progress = buildPhase6D3MixedExecution({ plan, prepared, venue, wallet: input.wallet });
    stagePhase6D3MixedExecution(window.sessionStorage, progress);
    stageRemedyHandoff(window.sessionStorage, progress.repayHandoff);
    window.location.assign(`/?tab=repay&market=${encodeURIComponent(venue.id)}&mixed=1`);
  }

  if (prepared) {
    return (
      <PreparedReviewUI
        prepared={prepared}
        onCancel={() => setPrepared(null)}
        input={input}
        chainName={chainName}
        phase6D1Eligibility={repayEligibility}
        onContinueToRepay={repayEligibility?.eligible ? continueToRepay : undefined}
        phase6D2Eligibility={collateralEligibility}
        onContinueToCollateral={collateralEligibility?.eligible ? continueToCollateral : undefined}
        phase6D3Eligibility={mixedEligibility}
        onContinueToMixed={mixedEligibility?.eligible ? continueToMixed : undefined}
      />
    );
  }
  
  return (
    <div className="rounded border p-3 space-y-2">
      {isMixed ? (
        <div className="font-semibold">MIXED REMEDY</div>
      ) : (
        <div className="font-semibold">{plan.reason}</div>
      )}

      {isMixed ? (
        <div className="space-y-1">
          <p>This option uses both available assets to reach the selected safety target.</p>
          <p>Repay: {formatUsdExact(debtReq)} {input.debtAsset}</p>
          <p>Add: {tokenText(collReq)} {input.collateralAsset} · ≈ {collateralUsdText(collReq, input.oraclePrice)}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {debtReq > 0 && <p>Required: {formatUsdExact(debtReq)} {input.debtAsset}</p>}
          {collReq > 0 && <p>Required: {tokenText(collReq)} {input.collateralAsset} · ≈ {collateralUsdText(collReq, input.oraclePrice)}</p>}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-muted-foreground text-[10px] uppercase">Projected after action</p>
        <p>HF: {hfText(plan.targetState.projectedHealthFactor)}</p>
        <p>LTV: {formatLtv(plan.targetState.projectedDebt / (plan.targetState.projectedCollateralAmount * (input.oraclePrice ?? 1)))}</p>
        <p>Liquidation BTC: {moneyOrDash(plan.targetState.projectedLiquidationBtc)}</p>
        <p>BTC cushion: {cushionText(plan.targetState.projectedCushion)}</p>
      </div>
      
      <div className="space-y-1 pt-1 border-t">
        <div className="flex gap-2 items-center">
          <span className="font-semibold">Execution readiness:</span>
          <span>{plan.readiness === 'READY' ? 'READY' : plan.readiness === 'NEEDS_ATTENTION' ? 'NEEDS ATTENTION' : 'BLOCKED'}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          <p>Estimated wallet confirmations: {Array.isArray(plan.estimatedWalletConfirmations) ? `${plan.estimatedWalletConfirmations[0]}-${plan.estimatedWalletConfirmations[1]}` : plan.estimatedWalletConfirmations}</p>
          <p>Estimated network cost: {plan.estimatedNetworkCost === null ? 'Unknown' : plan.estimatedNetworkCost}</p>
        </div>
        <div className="text-xs space-y-1">
          {debtReq > 0 && (
            <div className="flex gap-2">
              <span>{input.debtAsset} required: {formatUsdExact(debtReq)}</span>
              <span>Available: {formatUsdExact(plan.walletResources.debtAssetAvailable ?? 0)}</span>
              <span>Status: {plan.walletResources.debtAssetAvailable && plan.walletResources.debtAssetAvailable >= debtReq ? '✓ AVAILABLE' : '✕ INSUFFICIENT'}</span>
              {plan.walletResources.debtAssetAvailable !== null && plan.walletResources.debtAssetAvailable < debtReq && (
                <span className="text-orange-500">Shortfall: {formatUsdExact(debtReq - plan.walletResources.debtAssetAvailable)}</span>
              )}
            </div>
          )}
          {collReq > 0 && (
            <div className="flex gap-2">
              <span>{input.collateralAsset} required: {tokenText(collReq)} (≈ {collateralUsdText(collReq, input.oraclePrice)})</span>
              <span>Available: {tokenText(plan.walletResources.collateralAvailable ?? 0)} (≈ {collateralUsdText(plan.walletResources.collateralAvailable ?? 0, input.oraclePrice)})</span>
              <span>Status: {plan.walletResources.collateralAvailable && plan.walletResources.collateralAvailable >= collReq ? '✓ AVAILABLE' : '✕ INSUFFICIENT'}</span>
              {plan.walletResources.collateralAvailable !== null && plan.walletResources.collateralAvailable < collReq && (
                <span className="text-orange-500">Shortfall: {tokenText(collReq - plan.walletResources.collateralAvailable)} (≈ {collateralUsdText(collReq - plan.walletResources.collateralAvailable, input.oraclePrice)})</span>
              )}
            </div>
          )}
        </div>
        {plan.blockingIssues.length > 0 && (
          <div className="text-red-500 mt-2">
            <span className="font-semibold">BLOCKED:</span>
            <ul className="list-disc pl-4">
              {plan.blockingIssues.map(issue => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        )}
        {plan.warnings.length > 0 && (
          <div className="text-orange-500 mt-2">
            <span className="font-semibold">ATTENTION:</span>
            <ul className="list-disc pl-4">
              {plan.warnings.map(warning => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
      </div>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer font-semibold text-blue-500">Execution steps</summary>
        <div className="mt-2 space-y-2">
          <ol className="list-decimal pl-4 space-y-1 mb-2">
            {plan.steps.map((step, idx) => (
              <li key={idx}>{step.label}</li>
            ))}
          </ol>

          <div className="space-y-1">
            <p className="font-semibold">Readiness Checklist</p>
            <p>Position fresh {isFresh(plan.freshness.positionFetchedAt) ? '✓' : '✕'}</p>
            <p>Oracle fresh {isFresh(plan.freshness.oracleFetchedAt) ? '✓' : '✕'}</p>
            <p>Market fresh {isFresh(plan.freshness.marketFetchedAt) ? '✓' : '✕'}</p>
            <p>Wallet balance fresh {isFresh(plan.freshness.walletFetchedAt) ? '✓' : '✕'}</p>
            <p>Correct chain {plan.blockingIssues.includes('Wrong wallet network') ? '✕' : '✓'}</p>
            <p>Gas available {plan.blockingIssues.includes('Insufficient ETH for gas') ? '✕' : '✓'}</p>
            <p>Allowance known {(debtReq > 0 && plan.walletResources.debtAssetAllowance === null) || (collReq > 0 && plan.walletResources.collateralAllowance === null) ? '?' : '✓'}</p>
            <p>Liquidity available ✓</p>
          </div>

          {(!isFresh(plan.freshness.positionFetchedAt) || !isFresh(plan.freshness.oracleFetchedAt)) && (
            <p className="text-red-500">Refresh required before relying on this plan.</p>
          )}
        </div>
      </details>

      {plan.readiness === 'READY' && !plan.hypothetical ? (
        <button type="button" className="rounded border px-2 py-1" onClick={handlePrepare} disabled={preparing || !venue}>
          {preparing ? 'Refreshing & simulating…' : 'Prepare action review'}
        </button>
      ) : plan.hypothetical ? (
        <button type="button" className="rounded border px-2 py-1" onClick={handlePrepare} disabled={preparing || !venue}>
          {preparing ? 'Preparing projection…' : 'Review hypothetical action'}
        </button>
      ) : null}
      {!venue && <p className="text-[10px] text-muted-foreground">Verified market definition is required before preparing an action.</p>}
    </div>
  );
}

function hfText(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : formatHealthFactor(value);
}

function ltvText(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : formatLtv(value);
}

function moneyOrDash(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : formatUsd(value);
}

function cushionText(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : formatPercent(value, 0);
}

function tokenText(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function collateralUsdText(amount: number, oraclePrice: number | null | undefined) {
  if (!Number.isFinite(amount) || amount < 0 || oraclePrice === null || oraclePrice === undefined || !Number.isFinite(oraclePrice) || oraclePrice <= 0) return '—';
  return formatUsdExact(amount * oraclePrice);
}

function isFresh(timestamp: number | null): boolean {
  if (!timestamp) return false;
  return Date.now() - timestamp < 5 * 60_000;
}

export function PreparedReviewUI({ prepared, onCancel, input, chainName, phase6D1Eligibility, onContinueToRepay, phase6D2Eligibility, onContinueToCollateral, phase6D3Eligibility, onContinueToMixed }: { prepared: PreparedExecution; onCancel: () => void; input: RiskMonitorInput; chainName: string; phase6D1Eligibility?: { eligible: boolean; reason: string | null }; onContinueToRepay?: () => void; phase6D2Eligibility?: { eligible: boolean; reason: string | null }; onContinueToCollateral?: () => void; phase6D3Eligibility?: { eligible: boolean; reason: string | null }; onContinueToMixed?: () => void }) {
  const isReady = prepared.readiness === 'READY' && prepared.executable !== false;
  const actionTitle = prepared.transactions.map((t) => {
    const usdEquivalent = t.asset === input.collateralAsset ? ` (≈ ${collateralUsdText(t.amount, prepared.freshBeforeState.oraclePrice)})` : '';
    return `${t.action} ${t.amount} ${t.asset}${usdEquivalent}`;
  }).join(' & ');

  return (
    <div className="rounded border p-3 space-y-3 bg-slate-50 dark:bg-slate-900">
      <div className="font-semibold text-sm">
        {prepared.hypothetical ? 'EMERGENCY ACTION REVIEW (FINANCIAL PROJECTION)' : 'EMERGENCY ACTION REVIEW'}
      </div>

      {prepared.hypothetical && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200 space-y-1">
          <p className="font-semibold">FINANCIAL PROJECTION</p>
          <p>On-chain transaction simulation unavailable for a hypothetical position.</p>
        </div>
      )}
      
      <div className="space-y-1 text-sm">
        <p className="font-semibold">Action:</p>
        <p>{actionTitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm mt-2">
        <div className="space-y-1">
          <p className="font-semibold text-xs text-muted-foreground uppercase">
            {prepared.hypothetical ? 'STARTING (HYPOTHETICAL)' : 'CURRENT'}
          </p>
          <p>Debt: {formatUsd(prepared.freshBeforeState.debt)}</p>
          <p>Collateral: {tokenText(prepared.freshBeforeState.collateralAmount)} {input.collateralAsset} · ≈ {collateralUsdText(prepared.freshBeforeState.collateralAmount, prepared.freshBeforeState.oraclePrice)}</p>
          <p>HF: {hfText(prepared.freshBeforeState.oraclePrice ? (prepared.freshBeforeState.collateralAmount * prepared.freshBeforeState.oraclePrice * prepared.freshBeforeState.liquidationThreshold) / prepared.freshBeforeState.debt : null)}</p>
          <p>Liquidation BTC: {moneyOrDash(prepared.freshBeforeState.debt / (prepared.freshBeforeState.collateralAmount * prepared.freshBeforeState.liquidationThreshold))}</p>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-xs text-muted-foreground uppercase">PROJECTED</p>
          <p>Debt: {formatUsd(prepared.projectedAfterState.projectedDebt)}</p>
          <p>Collateral: {tokenText(prepared.projectedAfterState.projectedCollateralAmount)} {input.collateralAsset} · ≈ {collateralUsdText(prepared.projectedAfterState.projectedCollateralAmount, prepared.freshBeforeState.oraclePrice)}</p>
          <p>HF: {hfText(prepared.projectedAfterState.projectedHealthFactor)}</p>
          <p>Liquidation BTC: {moneyOrDash(prepared.projectedAfterState.projectedLiquidationBtc)}</p>
          <p>Cushion: {cushionText(prepared.projectedAfterState.projectedCushion)}</p>
        </div>
      </div>

      <div className="space-y-1 text-sm border-t pt-2 mt-2">
        <p className="font-semibold text-xs text-muted-foreground uppercase">
          {prepared.hypothetical ? 'ON-CHAIN SIMULATION' : 'EXECUTION'}
        </p>
        {prepared.hypothetical ? (
          <p className="text-xs text-muted-foreground">
            On-chain transaction simulation unavailable for a hypothetical position.
          </p>
        ) : (
          <>
            <p>Network: {chainName}</p>
            <p>Approval required: {prepared.transactions.some(t => t.approvalRequired) ? 'Yes' : 'No'}</p>
            <p>Protocol action: {prepared.transactions.filter(t => t.action !== 'APPROVE_TOKEN').map(t => t.action).join(', ')}</p>
            <p>Wallet confirmations: {prepared.transactions.length}</p>
            <p>Estimated network cost: {prepared.estimatedNetworkCost !== null ? formatUsd(prepared.estimatedNetworkCost) : 'Unknown'}</p>
            {prepared.transactions.map((t, i) => (
              <p key={i} className="text-xs">
                Simulation {t.action}: {t.simulationStatus === 'PASSED' ? '✓ Passed' : t.simulationStatus === 'FAILED' ? `✕ Failed (${t.revertReason})` : t.approvalRequired ? 'Deferred until approval' : 'Unavailable'}
              </p>
            ))}
          </>
        )}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground border-t pt-2 mt-2">
        <p className="font-semibold text-xs uppercase">DATA</p>
        <p>{prepared.hypothetical ? 'Hypothetical scenario parameters applied' : 'Position updated recently'}</p>
        <p>{prepared.hypothetical ? 'Oracle stressed for starting condition' : 'Oracle updated recently'}</p>
        <p>Wallet balance updated recently</p>
        <p>BTC reference price: {moneyOrDash(prepared.freshBeforeState.oraclePrice)} · collateral USD equivalents are calculated from this fresh oracle value.</p>
      </div>

      {prepared.blockingIssues.length > 0 && (
        <div className="text-red-500 mt-2 text-sm bg-red-50 p-2 rounded border border-red-100">
          <span className="font-semibold">BLOCKED:</span>
          <ul className="list-disc pl-4 mt-1">
            {prepared.blockingIssues.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}

      {isReady ? (
        <div className="pt-3 border-t mt-3">
          <p className="font-semibold text-green-600 mb-2">Ready for execution</p>
          <div className="flex gap-2">
            <button type="button" className="rounded border px-3 py-2 flex-1" onClick={onCancel}>Cancel</button>
            {onContinueToMixed && phase6D3Eligibility?.eligible ? (
              <button type="button" className="rounded border px-3 py-2 bg-foreground text-background flex-1" onClick={onContinueToMixed}>
                Start mixed recovery
              </button>
            ) : onContinueToRepay && phase6D1Eligibility?.eligible ? (
              <button type="button" className="rounded border px-3 py-2 bg-foreground text-background flex-1" onClick={onContinueToRepay}>
                Continue to repayment
              </button>
            ) : onContinueToCollateral && phase6D2Eligibility?.eligible ? (
              <button type="button" className="rounded border px-3 py-2 bg-foreground text-background flex-1" onClick={onContinueToCollateral}>
                Continue to add collateral
              </button>
            ) : (
              <button type="button" className="rounded border px-3 py-2 bg-gray-100 text-gray-400 cursor-not-allowed flex-1" disabled>
                Execute action
              </button>
            )}
          </div>
          {onContinueToMixed && phase6D3Eligibility?.eligible ? (
            <p className="text-[10px] text-muted-foreground mt-2 text-center">Phase 6D.3: Morpho Base mixed recovery executes in two separately confirmed legs. Repayment runs first; collateral is offered only after the repayment confirms and the updated position reconciles.</p>
          ) : onContinueToRepay && phase6D1Eligibility?.eligible ? (
            <p className="text-[10px] text-muted-foreground mt-2 text-center">Phase 6D.1: Morpho Base partial repay only. The repayment screen revalidates the live position again before any wallet request.</p>
          ) : onContinueToCollateral && phase6D2Eligibility?.eligible ? (
            <p className="text-[10px] text-muted-foreground mt-2 text-center">Phase 6D.2: Morpho Base cbBTC collateral addition only. The borrow screen revalidates the live position, balance, allowance, and market again before any wallet request.</p>
          ) : (
            <p className="text-[10px] text-muted-foreground mt-2 text-center">{phase6D3Eligibility?.reason ?? phase6D2Eligibility?.reason ?? phase6D1Eligibility?.reason ?? 'This action remains review-only.'}</p>
          )}
        </div>
      ) : (
        <div className="pt-3 border-t mt-3 flex gap-2">
          <button type="button" className="rounded border px-3 py-2 flex-1" onClick={onCancel}>Back</button>
        </div>
      )}
    </div>
  );
}
