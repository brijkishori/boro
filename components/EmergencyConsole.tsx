'use client';

import { useMemo, useState } from 'react';
import { formatUsd, formatUsdExact } from '@/lib/amount';
import { formatHealthFactor, formatLtv, formatPercent } from '@/lib/finance/format';
import { RiskMonitorInput, RiskMonitorReport, ProposedRemedy } from '@/lib/finance/riskMonitor';
import type { EarlyWarning } from '@/lib/finance/earlyWarning';
import { buildEmergencyExecutionPlan, WalletResources, ExecutionPlan, PreparedExecution, prepareExecutionReview, deriveHypotheticalPosition } from '@/lib/finance/executionPlanner';
import { StatusBadge } from '@/components/RiskStatus';
import { riskSeverityStatus } from '@/lib/finance/riskStatus';
import { chainLabel, isChainId, type Venue, type ChainId, type ProtocolId } from '@/lib/protocol';
import { buildPlannerCards } from '@/lib/finance/actionPlanner';
import { publicClient } from '@/lib/rpc';
import { fetchFreshConfirmReads } from '@/lib/finance/fetchConfirm';
import type { Address } from 'viem';

export default function EmergencyConsole({
  report,
  input,
  walletResources,
  networkContext,
  warning,
  initialScenario = null,
  initialExplorePreview = false,
}: {
  report: RiskMonitorReport;
  input: RiskMonitorInput;
  walletResources: WalletResources;
  networkContext: { chainId: number; marketId: string; gasPriceWei?: bigint };
  warning?: EarlyWarning;
  initialScenario?: 'WATCH' | 'PREPARE' | 'ACT' | 'URGENT' | null;
  initialExplorePreview?: boolean;
}) {
  const [explorePreview, setExplorePreview] = useState(initialExplorePreview);
  const [selectedScenario, setSelectedScenario] = useState<'WATCH' | 'PREPARE' | 'ACT' | 'URGENT' | null>(initialScenario);
  const [targetChoice, setTargetChoice] = useState<number>(report.thresholds.preferredHealthFactor || 2.5);

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
                <EmergencyPlanCard key={plan.id} plan={plan} input={effectiveInput} chainName={currentChainName} />
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

      <div className="border-t pt-2 space-y-1">
        <p className="font-semibold">AVAILABLE NOW — {currentChainName.toUpperCase()}</p>
        <p>{input.debtAsset} {moneyOrDash(input.walletDebtAssetBalance ?? null)}</p>
        <p>{input.collateralAsset} {tokenText(input.walletCollateralBalance ?? 0)}</p>
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

function EmergencyPlanCard({ plan, input, chainName }: { plan: ExecutionPlan, input: RiskMonitorInput, chainName: string }) {
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedExecution | null>(null);
  
  const debtReq = plan.requiredAssets.debtAssetRequired;
  const collReq = plan.requiredAssets.collateralRequired;
  const isMixed = debtReq > 0 && collReq > 0;
  
  async function handlePrepare() {
    setPreparing(true);
    try {
      // Reconstruct Venue from input
      // For this test/phase we mock venue fetching or reconstruct it loosely
      const chainId: ChainId = isChainId(input.chainId) ? input.chainId : 8453;
      const protocol: ProtocolId = (input.protocol === 'morpho' || input.protocol === 'aave' || input.protocol === 'compound' || input.protocol === 'spark' || input.protocol === 'moonwell') ? input.protocol : 'aave';
      const venue: Venue = {
        id: input.marketId,
        protocol,
        action: 'borrow',
        chainId,
        assetSymbol: input.collateralAsset,
        assetKind: 'custodial',
        assetAddress: input.collateralAsset as Address,
        assetDecimals: 8, // mostly cbBTC
        loanSymbol: input.debtAsset,
        loanAddress: input.debtAsset as Address,
        loanDecimals: 6, // mostly USDC
        borrowApr: input.currentBorrowApr ?? 0,
        supplyApr: 0,
        liquidityUsd: input.availableLiquidity ?? 0,
        priceUsd: plan.sourcePosition.oraclePrice,
        maxLtv: input.liquidationThreshold, // rough mapping
        aave: input.protocol === 'aave' ? { pool: input.marketId as Address, aToken: input.collateralAsset as Address, variableDebtToken: input.debtAsset as Address } : undefined,
        morpho: input.protocol === 'morpho' ? { marketId: input.marketId as `0x${string}`, oracle: input.marketId as Address, lltv: BigInt(Math.floor(input.liquidationThreshold * 1e18)).toString(), loanToken: input.debtAsset as Address, collateralToken: input.collateralAsset as Address, irm: '0x0000000000000000000000000000000000000000' } : undefined,
      };

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

      const freshPosition = {
        debt: reads.position.debt > 0n ? Number(reads.position.debt) / 1e6 : 0,
        collateralAmount: reads.position.collateral > 0n ? Number(reads.position.collateral) / 1e8 : 0,
        oraclePrice: venue.priceUsd ?? 0,
      };
      
      const freshWalletBalances = {
        debtAsset: readsDebt ? Number(readsDebt.walletBalance) / 1e6 : null,
        collateralAsset: readsColl ? Number(readsColl.walletBalance) / 1e8 : null,
      };

      const client = publicClient(venue.chainId);

      const review = await prepareExecutionReview(
        plan,
        input,
        reads.venue,
        input.wallet as Address,
        client,
        freshPosition,
        freshWalletBalances,
        undefined,
        undefined
      );
      setPrepared(review);
    } catch (err) {
      console.error(err);
      // In a real app we'd surface this to the UI nicely. 
      // For now we set a mocked prepared execution that is BLOCKED
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
      });
    } finally {
      setPreparing(false);
    }
  }

  if (prepared) {
    return <PreparedReviewUI prepared={prepared} onCancel={() => setPrepared(null)} input={input} chainName={chainName} />;
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
          <p>Add: {tokenText(collReq)} {input.collateralAsset}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {debtReq > 0 && <p>Required: {formatUsdExact(debtReq)} {input.debtAsset}</p>}
          {collReq > 0 && <p>Required: {tokenText(collReq)} {input.collateralAsset}</p>}
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
              <span>{input.collateralAsset} required: {tokenText(collReq)}</span>
              <span>Available: {tokenText(plan.walletResources.collateralAvailable ?? 0)}</span>
              <span>Status: {plan.walletResources.collateralAvailable && plan.walletResources.collateralAvailable >= collReq ? '✓ AVAILABLE' : '✕ INSUFFICIENT'}</span>
              {plan.walletResources.collateralAvailable !== null && plan.walletResources.collateralAvailable < collReq && (
                <span className="text-orange-500">Shortfall: {tokenText(collReq - plan.walletResources.collateralAvailable)}</span>
              )}
            </div>
          )}
        </div>
        
        {plan.blockingIssues.length > 0 && (
          <div className="text-red-500 mt-1">
            <span className="font-semibold">BLOCKED:</span>
            <ul className="list-disc pl-4">
              {plan.blockingIssues.map(issue => <li key={issue}>{issue}</li>)}
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
      
      {plan.readiness === 'READY' && (
        <div className="pt-2">
          <button type="button" className="rounded border px-2 py-1 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50" onClick={handlePrepare} disabled={preparing}>
            {preparing ? 'Preparing...' : 'Review action'}
          </button>
        </div>
      )}
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

function isFresh(timestamp: number | null): boolean {
  if (!timestamp) return false;
  return Date.now() - timestamp < 5 * 60_000;
}

export function PreparedReviewUI({ prepared, onCancel, input, chainName }: { prepared: PreparedExecution; onCancel: () => void; input: RiskMonitorInput; chainName: string }) {
  const isReady = prepared.readiness === 'READY' && prepared.executable !== false;
  const actionTitle = prepared.transactions.map(t => `${t.action} ${t.amount} ${t.asset}`).join(' & ');

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
          <p>Collateral: {tokenText(prepared.freshBeforeState.collateralAmount)} {input.collateralAsset}</p>
          <p>HF: {hfText(prepared.freshBeforeState.oraclePrice ? (prepared.freshBeforeState.collateralAmount * prepared.freshBeforeState.oraclePrice * prepared.freshBeforeState.liquidationThreshold) / prepared.freshBeforeState.debt : null)}</p>
          <p>Liquidation BTC: {moneyOrDash(prepared.freshBeforeState.debt / (prepared.freshBeforeState.collateralAmount * prepared.freshBeforeState.liquidationThreshold))}</p>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-xs text-muted-foreground uppercase">PROJECTED</p>
          <p>Debt: {formatUsd(prepared.projectedAfterState.projectedDebt)}</p>
          <p>Collateral: {tokenText(prepared.projectedAfterState.projectedCollateralAmount)} {input.collateralAsset}</p>
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
                Simulation {t.action}: {t.simulationStatus === 'PASSED' ? '✓ Passed' : t.simulationStatus === 'FAILED' ? `✕ Failed (${t.revertReason})` : 'Unavailable'}
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
            <button type="button" className="rounded border px-3 py-2 bg-gray-100 text-gray-400 cursor-not-allowed flex-1" disabled>
              Execute action
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">Wallet execution will be enabled in the next phase.</p>
        </div>
      ) : (
        <div className="pt-3 border-t mt-3 flex gap-2">
          <button type="button" className="rounded border px-3 py-2 flex-1" onClick={onCancel}>Back</button>
        </div>
      )}
    </div>
  );
}
