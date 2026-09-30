import {
  collateralToTargetHF,
  mixedRemedyToTargetHF,
  projectPosition,
  repayToTargetHF,
  resourceFeasibility,
  type ProjectedRiskPosition,
  type ResourceFeasibility,
  type RiskSeverity,
} from '@/lib/finance/riskMonitor';

export const SIMULATION_HF_CHOICES = [2, 2.25, 2.5, 3] as const;
export const HANDOFF_STORAGE_KEY = 'boro:remedy-handoff:v1';
export const PLANNER_HISTORY_KEY = 'boro:planner-history:v1';
export const HYPOTHETICAL_NOTICE = 'This action is based on your chosen hypothetical scenario.';
export const DRIFT_NOTICE = 'Market conditions changed. Remedy updated.';

export type RemedyKind = 'REPAY' | 'ADD_COLLATERAL' | 'MIXED';
export type FreshnessMark = 'fresh' | 'stale' | 'unavailable';

export type PlannerPosition = {
  collateralAmount: number;
  debt: number;
  oraclePrice: number;
  liquidationThreshold: number;
  healthFactor: number | null;
  walletDebt: number | null;
  walletCollateral: number | null;
  elsewhereDebt: number | null;
  elsewhereCollateral: number | null;
};

export type PlannerCard = {
  type: RemedyKind;
  label: string;
  repayAmount: number;
  collateralAmount: number;
  projected: ProjectedRiskPosition;
  feasibility: ResourceFeasibility;
  availableDebt: number | null;
  availableCollateral: number | null;
  debtShortfall: number | null;
  debtSurplus: number | null;
  collateralShortfall: number | null;
  collateralSurplus: number | null;
  elsewhereDebt: number | null;
  elsewhereCollateral: number | null;
  transactionCount: number;
};

export type RemedyHandoff = {
  id: string;
  type: RemedyKind;
  protocol: string;
  chainId: number;
  marketId: string;
  wallet: string;
  calculatedAt: string;
  sourceBlock?: string;
  scenarioOraclePrice?: number;
  hypothetical: boolean;
  targetHF: number;
  repayAmount?: number;
  collateralAmount?: number;
  currentPosition: ProjectedRiskPosition;
  projectedPosition: ProjectedRiskPosition;
  currentOraclePrice: number;
  freshness: {
    position: FreshnessMark;
    oracle: FreshnessMark;
    walletBalances: FreshnessMark;
  };
  notice?: string;
};

export type PlannerHistoryEntry = {
  at: string;
  riskState: string;
  healthFactor: number | null;
  oraclePrice: number | null;
  targetHF: number;
  repay: number;
  collateral: number;
};

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

const FEASIBILITY_RANK: Record<ResourceFeasibility, number> = {
  AVAILABLE: 0,
  PARTIALLY_AVAILABLE: 1,
  NOT_CURRENTLY_AVAILABLE: 2,
  UNKNOWN: 3,
};

export function plannerNeedsCorrection(healthFactor: number | null, preferredHf: number, safetyFresh: boolean) {
  return safetyFresh && healthFactor !== null && Number.isFinite(healthFactor) && healthFactor <= preferredHf;
}

export function plannerGuidance(state: RiskSeverity, healthFactor: number | null, preferredHf: number) {
  const hf = healthFactor === null || !Number.isFinite(healthFactor) ? null : healthFactor;
  const below = hf !== null && hf <= preferredHf;
  if (state === 'DATA_WARNING') return 'Fresh position or oracle data is unavailable. Verify before acting.';
  if (state === 'NO_DEBT') return 'No open debt. No corrective action is required.';
  if (state === 'NORMAL' || !below) return 'No corrective action required.';
  if (state === 'WATCH') return 'Monitoring recommended. No mandatory corrective action based solely on the configured threshold.';
  if (state === 'PREPARE') return `Current HF ${hf.toFixed(2)} is below preferred HF ${preferredHf.toFixed(2)}. Prepare a corrective action.`;
  return `Current HF ${hf.toFixed(2)} is below preferred HF ${preferredHf.toFixed(2)}. A corrective action is recommended.`;
}

export function plannerProminent(state: RiskSeverity) {
  return state === 'ACT' || state === 'URGENT' || state === 'LIQUIDATION_BOUNDARY';
}

function gap(required: number, available: number | null) {
  if (available === null) return { shortfall: null, surplus: null };
  return {
    shortfall: Math.max(required - available, 0),
    surplus: Math.max(available - required, 0),
  };
}

function combineFeasibility(repay: ResourceFeasibility, collateral: ResourceFeasibility): ResourceFeasibility {
  if (repay === 'UNKNOWN' || collateral === 'UNKNOWN') return 'UNKNOWN';
  if (repay === 'AVAILABLE' && collateral === 'AVAILABLE') return 'AVAILABLE';
  if (repay === 'NOT_CURRENTLY_AVAILABLE' && collateral === 'NOT_CURRENTLY_AVAILABLE') return 'NOT_CURRENTLY_AVAILABLE';
  return 'PARTIALLY_AVAILABLE';
}

function cardFrom(
  type: RemedyKind,
  label: string,
  repayAmount: number,
  collateralAmount: number,
  projected: ProjectedRiskPosition | null,
  position: PlannerPosition,
): PlannerCard | null {
  if (!projected) return null;
  if (repayAmount <= 1e-8 && collateralAmount <= 1e-12) return null;
  const debtGap = gap(repayAmount, position.walletDebt);
  const collateralGap = gap(collateralAmount, position.walletCollateral);
  const repayFeasibility = resourceFeasibility(repayAmount, position.walletDebt);
  const collateralFeasibility = resourceFeasibility(collateralAmount, position.walletCollateral);
  return {
    type,
    label,
    repayAmount,
    collateralAmount,
    projected,
    feasibility: type === 'MIXED' ? combineFeasibility(repayFeasibility, collateralFeasibility) : (type === 'REPAY' ? repayFeasibility : collateralFeasibility),
    availableDebt: position.walletDebt,
    availableCollateral: position.walletCollateral,
    debtShortfall: debtGap.shortfall,
    debtSurplus: debtGap.surplus,
    collateralShortfall: collateralGap.shortfall,
    collateralSurplus: collateralGap.surplus,
    elsewhereDebt: position.elsewhereDebt,
    elsewhereCollateral: position.elsewhereCollateral,
    transactionCount: type === 'MIXED' ? 2 : 1,
  };
}

/** Same-chain balances only. Assets on another chain stay in the elsewhere fields. */
export function buildPlannerCards(position: PlannerPosition, targetHf: number): PlannerCard[] {
  if (!(position.oraclePrice > 0) || !(position.liquidationThreshold > 0) || !(targetHf > 0)) return [];
  const shared = {
    collateralAmount: position.collateralAmount,
    debt: position.debt,
    oraclePrice: position.oraclePrice,
    liquidationThreshold: position.liquidationThreshold,
    targetHf,
    actionable: true as const,
  };
  const repay = repayToTargetHF(shared);
  const collateral = collateralToTargetHF(shared);
  const mixed = mixedRemedyToTargetHF({ ...shared, currentHf: position.healthFactor });
  return [
    cardFrom('REPAY', 'Repay', repay.repayAmount, 0, repay.projected, position),
    cardFrom('ADD_COLLATERAL', 'Add collateral', 0, collateral.collateralAmount, collateral.projected, position),
    cardFrom('MIXED', 'Balanced remedy', mixed.repayAmount, mixed.collateralAmount, mixed.projected, position),
  ].filter((item): item is PlannerCard => item !== null);
}

export function orderPlannerCards(cards: PlannerCard[]) {
  return [...cards].sort((a, b) => (
    FEASIBILITY_RANK[a.feasibility] - FEASIBILITY_RANK[b.feasibility]
    || a.transactionCount - b.transactionCount
  ));
}

export function correctiveCards(position: PlannerPosition, preferredHf: number, safetyFresh: boolean) {
  if (!plannerNeedsCorrection(position.healthFactor, preferredHf, safetyFresh)) return [];
  return orderPlannerCards(buildPlannerCards(position, preferredHf));
}

export function projectCustomAction(position: PlannerPosition, repayAmount: number, collateralAmount: number) {
  const repay = Number.isFinite(repayAmount) ? Math.max(repayAmount, 0) : 0;
  const added = Number.isFinite(collateralAmount) ? Math.max(collateralAmount, 0) : 0;
  return projectPosition(
    position.collateralAmount + added,
    Math.max(position.debt - repay, 0),
    position.oraclePrice,
    position.liquidationThreshold,
  );
}

export function stressScenario(position: PlannerPosition, scenarioPrice: number, targetHf: number) {
  const live = projectPosition(position.collateralAmount, position.debt, position.oraclePrice, position.liquidationThreshold);
  if (!(scenarioPrice > 0)) return { live, stressed: null, cards: [] as PlannerCard[] };
  const stressed = projectPosition(position.collateralAmount, position.debt, scenarioPrice, position.liquidationThreshold);
  const cards = orderPlannerCards(buildPlannerCards({ ...position, oraclePrice: scenarioPrice, healthFactor: stressed.healthFactor }, targetHf));
  return { live, stressed, cards };
}

export function executableNote(feasibility: ResourceFeasibility, chainName: string) {
  if (feasibility !== 'AVAILABLE') return null;
  return `Executable with currently available ${chainName} balances`;
}

export function materialAmountDrift(previous: number, next: number) {
  const base = Math.max(Math.abs(previous), Math.abs(next));
  if (!(base > 0)) return false;
  return Math.abs(previous - next) / base > 0.005;
}

export function reviewDecision(input: {
  previous: PlannerCard;
  next: PlannerCard | null;
  hypothetical: boolean;
}) {
  const drifted = input.next === null
    || materialAmountDrift(input.previous.repayAmount, input.next.repayAmount)
    || materialAmountDrift(input.previous.collateralAmount, input.next.collateralAmount);
  if (drifted) return { proceed: false, message: DRIFT_NOTICE };
  return {
    proceed: true,
    message: input.hypothetical ? HYPOTHETICAL_NOTICE : null,
  };
}

export function buildRemedyHandoff(input: {
  card: PlannerCard;
  position: PlannerPosition;
  identity: { protocol: string; chainId: number; marketId: string; wallet: string };
  targetHF: number;
  calculatedAt: string;
  sourceBlock?: string;
  scenarioOraclePrice?: number;
  hypothetical: boolean;
  freshness: RemedyHandoff['freshness'];
  notice?: string | null;
}): RemedyHandoff {
  const currentPosition = projectPosition(
    input.position.collateralAmount,
    input.position.debt,
    input.position.oraclePrice,
    input.position.liquidationThreshold,
  );
  const projectedPosition = input.hypothetical
    ? projectCustomAction(input.position, input.card.repayAmount, input.card.collateralAmount)
    : input.card.projected;
  return {
    id: `${input.card.type}:${input.identity.marketId}:${input.calculatedAt}`,
    type: input.card.type,
    protocol: input.identity.protocol,
    chainId: input.identity.chainId,
    marketId: input.identity.marketId,
    wallet: input.identity.wallet,
    calculatedAt: input.calculatedAt,
    sourceBlock: input.sourceBlock,
    scenarioOraclePrice: input.scenarioOraclePrice,
    hypothetical: input.hypothetical,
    targetHF: input.targetHF,
    repayAmount: input.card.repayAmount > 0 ? input.card.repayAmount : undefined,
    collateralAmount: input.card.collateralAmount > 0 ? input.card.collateralAmount : undefined,
    currentPosition,
    projectedPosition,
    currentOraclePrice: input.position.oraclePrice,
    freshness: input.freshness,
    notice: input.notice ?? undefined,
  };
}

export function tokenUnits(amount: number, decimals: number) {
  if (!Number.isFinite(amount) || amount <= 0 || decimals < 0 || decimals > 18) return 0n;
  const text = amount.toFixed(decimals);
  const [whole, frac = ''] = text.split('.');
  const digits = `${whole}${frac.padEnd(decimals, '0').slice(0, decimals)}`.replace(/^-/, '');
  return BigInt(whole.startsWith('-') ? '0' : digits);
}

function isKind(value: unknown): value is RemedyKind {
  return value === 'REPAY' || value === 'ADD_COLLATERAL' || value === 'MIXED';
}

function isPosition(value: unknown): value is ProjectedRiskPosition {
  if (!value || typeof value !== 'object') return false;
  const row = value as ProjectedRiskPosition;
  return typeof row.debt === 'number' && typeof row.collateralAmount === 'number';
}

export function parseRemedyHandoff(raw: string): RemedyHandoff | null {
  try {
    const value = JSON.parse(raw) as Partial<RemedyHandoff>;
    if (!isKind(value.type) || typeof value.marketId !== 'string' || typeof value.repayAmount === 'string' || typeof value.collateralAmount === 'string') return null;
    if (typeof value.targetHF !== 'number' || typeof value.currentOraclePrice !== 'number') return null;
    if (!isPosition(value.currentPosition) || !isPosition(value.projectedPosition)) return null;
    if (typeof value.chainId !== 'number' || typeof value.wallet !== 'string') return null;
    return value as RemedyHandoff;
  } catch {
    return null;
  }
}

export function stageRemedyHandoff(storage: StorageLike, handoff: RemedyHandoff) {
  storage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  return handoff;
}

export function takeRemedyHandoff(storage: StorageLike) {
  const raw = storage.getItem(HANDOFF_STORAGE_KEY);
  storage.removeItem?.(HANDOFF_STORAGE_KEY);
  return raw ? parseRemedyHandoff(raw) : null;
}

export function appendPlannerHistory(storage: StorageLike, entry: PlannerHistoryEntry, limit = 20) {
  const current = storage.getItem(PLANNER_HISTORY_KEY);
  const prior = current ? JSON.parse(current) as PlannerHistoryEntry[] : [];
  const next = [entry, ...(Array.isArray(prior) ? prior : [])].slice(0, limit);
  storage.setItem(PLANNER_HISTORY_KEY, JSON.stringify(next));
  return next;
}
