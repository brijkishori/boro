'use client';

import { useMemo, useState } from 'react';
import { formatUsd, formatUsdExact } from '@/lib/amount';
import {
  SIMULATION_HF_CHOICES,
  buildPlannerCards,
  executableNote,
  orderPlannerCards,
  plannerGuidance,
  plannerNeedsCorrection,
  plannerProminent,
  projectCustomAction,
  stressScenario,
  type PlannerCard,
  type PlannerPosition,
} from '@/lib/finance/actionPlanner';
import { formatHealthFactor, formatLtv, formatPercent } from '@/lib/finance/format';
import type { ResourceFeasibility, RiskMonitorReport } from '@/lib/finance/riskMonitor';
import { StatusBadge } from '@/components/RiskStatus';
import { feasibilityStatus, riskSeverityStatus } from '@/lib/finance/riskStatus';

const FEASIBILITY_WORD: Record<ResourceFeasibility, string> = {
  AVAILABLE: 'AVAILABLE',
  PARTIALLY_AVAILABLE: 'PARTIAL',
  NOT_CURRENTLY_AVAILABLE: 'NOT AVAILABLE',
  UNKNOWN: 'UNKNOWN',
};

export default function ActionPlanner({
  report,
  position,
  debtSymbol,
  collateralSymbol,
  chainName,
  refreshing,
  notice,
  primaryDriver,
  onReview,
}: {
  report: RiskMonitorReport;
  position: PlannerPosition;
  debtSymbol: string;
  collateralSymbol: string;
  chainName: string;
  refreshing: boolean;
  notice?: string;
  primaryDriver?: string | null;
  onReview: (card: PlannerCard, context: { targetHf: number; scenarioPrice: number | null; hypothetical: boolean }) => void;
}) {
  const preferred = report.thresholds.preferredHealthFactor;
  const state = report.decision.currentState;
  const safetyFresh = report.domains.position === 'fresh' && report.domains.oracle === 'fresh';
  const [targetChoice, setTargetChoice] = useState<number | 'custom'>(preferred);
  const [customTarget, setCustomTarget] = useState('');
  const [customRepay, setCustomRepay] = useState('');
  const [customCollateral, setCustomCollateral] = useState('');
  const [scenarioText, setScenarioText] = useState('');
  const [explore, setExplore] = useState(false);
  const simulationTarget = targetChoice === 'custom' ? Number(customTarget) : targetChoice;
  const targetHf = Number.isFinite(simulationTarget) && simulationTarget > 0 ? simulationTarget : preferred;
  const scenarioPrice = Number(scenarioText);
  const hypothetical = Number.isFinite(scenarioPrice) && scenarioPrice > 0 && Math.abs(scenarioPrice - position.oraclePrice) / position.oraclePrice > 0.001;
  const needsCorrection = plannerNeedsCorrection(position.healthFactor, preferred, safetyFresh);
  const prominent = plannerProminent(state);
  const showExplore = explore || !needsCorrection;
  const cards = useMemo(() => {
    if (report.remedyMessage || !safetyFresh) return [];
    const source = hypothetical
      ? stressScenario(position, scenarioPrice, targetHf).cards
      : orderPlannerCards(buildPlannerCards(position, targetHf));
    if (!needsCorrection && !explore && !hypothetical && Math.abs(targetHf - preferred) < 1e-9) return [];
    return source;
  }, [explore, hypothetical, needsCorrection, position, preferred, report.remedyMessage, safetyFresh, scenarioPrice, targetHf]);
  const stressed = hypothetical ? stressScenario(position, scenarioPrice, targetHf) : null;
  const custom = projectCustomAction(position, Number(customRepay) || 0, Number(customCollateral) || 0);
  const guidance = plannerGuidance(state, position.healthFactor, preferred);

  return (
    <div className="space-y-3">
      <p className="font-semibold">Action planner</p>
      <p className="text-muted-foreground">These amounts are analysis only. Nothing is sent to the wallet.</p>
      <div className="space-y-1">
        <p className="font-semibold">Current state</p>
        <StatusBadge status={riskSeverityStatus(state)} />
        <p>Current HF {hf(position.healthFactor)} · Preferred HF {formatHealthFactor(preferred)}</p>
        <p>Current debt {formatUsdExact(position.debt)} · Current collateral {token(position.collateralAmount)} {collateralSymbol}</p>
        <p>{guidance}</p>
        {primaryDriver ? <p>Primary driver: {primaryDriver}</p> : null}
        {notice && <p>{notice}</p>}
        {needsCorrection && state === 'NORMAL' && <p>Current position is inside the preferred target.</p>}
        {!needsCorrection && safetyFresh && <p>Current position already exceeds the preferred target.</p>}
      </div>
      {report.remedyMessage && <p>{report.remedyMessage}</p>}
      {cards.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground">Preferred target {formatHealthFactor(preferred)} · Simulation target {formatHealthFactor(targetHf)}. A simulation target does not change alert settings.</p>
          {hypothetical && <p>This view uses the scenario price. Review uses the live position.</p>}
          {cards.map((card) => (
            <RemedyCard
              key={card.type}
              card={card}
              debtSymbol={debtSymbol}
              collateralSymbol={collateralSymbol}
              chainName={chainName}
              refreshing={refreshing}
              onReview={() => onReview(card, { targetHf, scenarioPrice: hypothetical ? scenarioPrice : null, hypothetical })}
              onExplore={() => setExplore(true)}
            />
          ))}
        </div>
      )}
      {(showExplore || !prominent) && (
        <div className="space-y-2">
          {!needsCorrection && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded border px-2 py-1" onClick={() => setExplore(true)}>Explore repayment</button>
              <button type="button" className="rounded border px-2 py-1" onClick={() => setExplore(true)}>Explore collateral addition</button>
              <button type="button" className="rounded border px-2 py-1" onClick={() => setExplore(true)}>Explore target HF</button>
              <button type="button" className="rounded border px-2 py-1" onClick={() => setExplore(true)}>Stress BTC price</button>
            </div>
          )}
          {(explore || needsCorrection) && !prominent && (
            <TargetPicker
              preferred={preferred}
              targetChoice={targetChoice}
              customTarget={customTarget}
              onChoice={setTargetChoice}
              onCustom={setCustomTarget}
            />
          )}
          {(explore || needsCorrection) && (
            <div className="space-y-1 rounded border p-2">
              <p className="font-semibold">{hypothetical ? 'Scenario' : 'Live'}</p>
              <p>Oracle {formatUsd(hypothetical ? scenarioPrice : position.oraclePrice)} · HF {hf(hypothetical ? stressed?.stressed?.healthFactor ?? null : position.healthFactor)} · LTV {ltv(hypothetical ? stressed?.stressed?.ltv ?? null : null, position)}</p>
              <label className="block">Scenario BTC/oracle price
                <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={scenarioText} placeholder={String(position.oraclePrice)} onChange={(event) => setScenarioText(event.target.value)} />
              </label>
              <label className="block">Custom repayment ({debtSymbol})
                <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={customRepay} onChange={(event) => setCustomRepay(event.target.value)} />
              </label>
              <label className="block">Custom collateral addition ({collateralSymbol})
                <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={customCollateral} onChange={(event) => setCustomCollateral(event.target.value)} />
              </label>
              {(Number(customRepay) > 0 || Number(customCollateral) > 0) && (
                <p>Projected debt {formatUsdExact(custom.debt)} · collateral {token(custom.collateralAmount)} {collateralSymbol} · HF {hf(custom.healthFactor)} · LTV {custom.ltv === null ? '—' : formatLtv(custom.ltv)} · liquidation {custom.liquidationPrice === null ? '—' : formatUsd(custom.liquidationPrice)} · cushion {custom.liquidationCushionPercent === null ? '—' : formatPercent(custom.liquidationCushionPercent, 0)}</p>
              )}
            </div>
          )}
        </div>
      )}
      {prominent && (
        <details>
          <summary className="cursor-pointer">Explore a different target or custom amount</summary>
          <div className="mt-2 space-y-2">
            <TargetPicker preferred={preferred} targetChoice={targetChoice} customTarget={customTarget} onChoice={setTargetChoice} onCustom={setCustomTarget} />
            <label className="block">Scenario BTC/oracle price
              <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={scenarioText} placeholder={String(position.oraclePrice)} onChange={(event) => setScenarioText(event.target.value)} />
            </label>
          </div>
        </details>
      )}
    </div>
  );
}

function TargetPicker({
  preferred,
  targetChoice,
  customTarget,
  onChoice,
  onCustom,
}: {
  preferred: number;
  targetChoice: number | 'custom';
  customTarget: string;
  onChoice: (value: number | 'custom') => void;
  onCustom: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p>Simulation target. Preferred target stays {formatHealthFactor(preferred)}.</p>
      <div className="flex flex-wrap gap-2">
        {SIMULATION_HF_CHOICES.map((value) => (
          <button key={value} type="button" className={`rounded border px-2 py-1 ${targetChoice === value ? 'border-foreground font-semibold' : ''}`} onClick={() => onChoice(value)}>{formatHealthFactor(value)}{Math.abs(value - preferred) < 1e-9 ? ' preferred' : ''}</button>
        ))}
        <button type="button" className={`rounded border px-2 py-1 ${targetChoice === 'custom' ? 'border-foreground font-semibold' : ''}`} onClick={() => onChoice('custom')}>Custom</button>
      </div>
      {targetChoice === 'custom' && (
        <input className="h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={customTarget} placeholder="2.50" onChange={(event) => onCustom(event.target.value)} />
      )}
    </div>
  );
}

function RemedyCard({
  card,
  debtSymbol,
  collateralSymbol,
  chainName,
  refreshing,
  onReview,
  onExplore,
}: {
  card: PlannerCard;
  debtSymbol: string;
  collateralSymbol: string;
  chainName: string;
  refreshing: boolean;
  onReview: () => void;
  onExplore: () => void;
}) {
  const note = executableNote(card.feasibility, chainName);
  const repayReady = card.repayAmount > 0 && card.availableDebt !== null && card.availableDebt + 1e-8 >= card.repayAmount;
  const collateralReady = card.collateralAmount > 0 && card.availableCollateral !== null && card.availableCollateral + 1e-8 >= card.collateralAmount;
  const canReview = !refreshing && (card.type === 'REPAY' ? repayReady : card.type === 'ADD_COLLATERAL' ? collateralReady : false);
  return (
    <div className="space-y-1 rounded border p-2">
      <p className="font-semibold">{card.label}</p>
      {card.repayAmount > 0 && <p>Repay {formatUsdExact(card.repayAmount)} {debtSymbol}</p>}
      {card.collateralAmount > 0 && <p>Add {token(card.collateralAmount)} {collateralSymbol}</p>}
      {card.type === 'MIXED' && <p>Step 1: Repay {debtSymbol}. Step 2: Add {collateralSymbol}. Each step is reviewed separately.</p>}
      <p>After: HF {hf(card.projected.healthFactor)} · LTV {card.projected.ltv === null ? '—' : formatLtv(card.projected.ltv)} · Liquidation BTC {card.projected.liquidationPrice === null ? '—' : formatUsd(card.projected.liquidationPrice)} · cushion {card.projected.liquidationCushionPercent === null ? '—' : formatPercent(card.projected.liquidationCushionPercent, 0)}</p>
      {card.repayAmount > 0 && <p>Required {formatUsdExact(card.repayAmount)} {debtSymbol} · Available on {chainName}: {card.availableDebt === null ? 'unknown' : formatUsdExact(card.availableDebt)}{card.debtShortfall ? ` · Shortfall ${formatUsdExact(card.debtShortfall)}` : ''}{card.debtSurplus ? ` · Surplus ${formatUsdExact(card.debtSurplus)}` : ''}</p>}
      {card.collateralAmount > 0 && <p>Required {token(card.collateralAmount)} {collateralSymbol} · Available on {chainName}: {card.availableCollateral === null ? 'unknown' : `${token(card.availableCollateral)} ${collateralSymbol}`}{card.collateralShortfall ? ` · Shortfall ${token(card.collateralShortfall)} ${collateralSymbol}` : ''}</p>}
      {(card.elsewhereDebt || card.elsewhereCollateral) ? <p>Available elsewhere — transfer/bridge required.{card.elsewhereDebt ? ` ${formatUsdExact(card.elsewhereDebt)} ${debtSymbol}` : ''}{card.elsewhereDebt && card.elsewhereCollateral ? ' ·' : ''}{card.elsewhereCollateral ? ` ${token(card.elsewhereCollateral)} ${collateralSymbol}` : ''}</p> : null}
      <p>{card.transactionCount} transaction{card.transactionCount === 1 ? '' : 's'} · resulting HF {hf(card.projected.healthFactor)}</p>
      <p>{FEASIBILITY_WORD[card.feasibility]}</p>
      <StatusBadge status={feasibilityStatus(card.feasibility)} />
      {note && <p>{note}</p>}
      {card.type === 'MIXED' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border px-2 py-1" disabled={refreshing || !repayReady} onClick={onReview}>Review step 1: Repay</button>
          <button type="button" className="rounded border px-2 py-1" disabled>Review step 2 after step 1</button>
        </div>
      ) : (
        <button type="button" className="rounded border px-2 py-1" disabled={refreshing} onClick={() => { if (canReview) onReview(); else onExplore(); }}>{canReview ? (card.type === 'REPAY' ? 'Review repayment' : 'Review collateral addition') : 'Explore'}</button>
      )}
    </div>
  );
}

function hf(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : formatHealthFactor(value);
}

function ltv(value: number | null, position: PlannerPosition) {
  if (value !== null) return formatLtv(value);
  const projected = projectCustomAction(position, 0, 0);
  return projected.ltv === null ? '—' : formatLtv(projected.ltv);
}

function token(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 });
}
