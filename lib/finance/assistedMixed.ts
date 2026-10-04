import { buildEmergencyExecutionPlan, type ExecutionPlan, type PreparedExecution, type WalletResources } from '@/lib/finance/executionPlanner';
import { projectPosition, type ProposedRemedy, type RiskMonitorInput } from '@/lib/finance/riskMonitor';
import type { RemedyHandoff } from '@/lib/finance/actionPlanner';
import { protocolMarketId, type Venue } from '@/lib/protocol';

export const PHASE_6D3_MIXED_STORAGE_KEY = 'boro:phase6d3-mixed:v1';

export type Phase6D3Eligibility = {
  eligible: boolean;
  reason: string | null;
  repayAmount: number | null;
  collateralAmount: number | null;
};

export type Phase6D3Stage =
  | 'REPAY_PENDING'
  | 'REPAY_SUBMITTED'
  | 'COLLATERAL_PENDING'
  | 'COLLATERAL_SUBMITTED'
  | 'COMPLETE';

export type Phase6D3MixedProgress = {
  version: 1;
  id: string;
  stage: Phase6D3Stage;
  marketId: string;
  chainId: number;
  wallet: string;
  repayHandoff: RemedyHandoff;
  collateralHandoff: RemedyHandoff;
  createdAt: number;
  updatedAt: number;
  submittedHash?: string;
};

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

export function phase6D3ManualMixedValidation(input: {
  riskInput: RiskMonitorInput;
  repayAmount: number;
  collateralAmount: number;
  venue?: Venue;
}): string | null {
  const { riskInput, repayAmount, collateralAmount, venue } = input;
  if (!venue) return 'Verified market definition is required.';
  if (venue.protocol !== 'morpho' || !venue.morpho || riskInput.protocol !== 'morpho') return 'Phase 6D.3 supports Morpho mixed recovery only.';
  if (venue.chainId !== 8453 || riskInput.chainId !== 8453) return 'Phase 6D.3 is limited to Morpho on Base.';
  if (venue.assetSymbol.toLowerCase() !== 'cbbtc' || riskInput.collateralAsset.toLowerCase() !== 'cbbtc') return 'Phase 6D.3 is limited to cbBTC collateral.';
  if (!riskInput.wallet) return 'Wallet is not connected.';
  if (!Number.isFinite(repayAmount) || repayAmount <= 0) return 'Enter a repayment amount greater than $0.';
  if (!Number.isFinite(collateralAmount) || collateralAmount <= 0) return 'Enter a collateral amount greater than 0.';
  if (!(riskInput.totalDebt > 0)) return 'No live debt is available for mixed recovery.';
  if (repayAmount >= riskInput.totalDebt - 1e-8) return 'Full repayment remains disabled in Phase 6D.3.';
  return null;
}

export function buildPhase6D3ManualMixedPlan(input: {
  riskInput: RiskMonitorInput;
  walletResources: WalletResources;
  networkContext: { chainId: number; marketId: string; gasPriceWei?: bigint };
  venue?: Venue;
  repayAmount: number;
  collateralAmount: number;
}): ExecutionPlan {
  const validation = phase6D3ManualMixedValidation({
    riskInput: input.riskInput,
    repayAmount: input.repayAmount,
    collateralAmount: input.collateralAmount,
    venue: input.venue,
  });

  const projectedDebt = Math.max(0, input.riskInput.totalDebt - Math.max(0, input.repayAmount));
  const projectedCollateral = input.riskInput.collateralAmount + Math.max(0, input.collateralAmount);
  const projected = projectPosition(
    projectedCollateral,
    projectedDebt,
    input.riskInput.oraclePrice ?? 0,
    input.riskInput.liquidationThreshold,
  );
  const remedy: ProposedRemedy = {
    type: 'MIXED',
    targetHF: projected.healthFactor ?? input.riskInput.healthFactor ?? 0,
    repayAmount: Math.max(0, input.repayAmount),
    collateralAmount: Math.max(0, input.collateralAmount),
    projectedPosition: projected,
    calculatedAt: new Date().toISOString(),
    sourceBlock: input.riskInput.sourceBlock,
    feasibility: 'AVAILABLE',
    label: 'Manual assisted mixed recovery',
  };

  const plan = buildEmergencyExecutionPlan(
    remedy,
    input.riskInput,
    input.walletResources,
    input.networkContext,
    { hypothetical: false },
  );

  if (!validation) return plan;
  return {
    ...plan,
    readiness: 'BLOCKED',
    blockingIssues: Array.from(new Set([validation, ...plan.blockingIssues])),
    executable: false,
  };
}

export function phase6D3MixedEligibility(input: {
  plan: ExecutionPlan;
  prepared: PreparedExecution;
  venue: Venue;
  wallet: string;
  now?: number;
}): Phase6D3Eligibility {
  const { plan, prepared, venue } = input;
  const now = input.now ?? Date.now();
  const repayAmount = plan.requiredAssets.debtAssetRequired;
  const collateralAmount = plan.requiredAssets.collateralRequired;
  const fail = (reason: string): Phase6D3Eligibility => ({ eligible: false, reason, repayAmount, collateralAmount });

  if (plan.hypothetical || prepared.hypothetical) return { eligible: false, reason: 'Hypothetical scenarios cannot be executed.', repayAmount: null, collateralAmount: null };
  if (venue.protocol !== 'morpho' || !venue.morpho) return { eligible: false, reason: 'Phase 6D.3 supports Morpho mixed recovery only.', repayAmount: null, collateralAmount: null };
  if (venue.chainId !== 8453) return { eligible: false, reason: 'Phase 6D.3 is limited to Morpho on Base.', repayAmount: null, collateralAmount: null };
  if (venue.assetSymbol.toLowerCase() !== 'cbbtc') return { eligible: false, reason: 'Phase 6D.3 is limited to cbBTC collateral.', repayAmount: null, collateralAmount: null };
  if (plan.mode !== 'EMERGENCY_MIXED') return fail('Phase 6D.3 requires a mixed repay + collateral plan.');
  if (!(repayAmount > 0) || !(collateralAmount > 0)) return fail('Both repayment and collateral amounts are required.');
  if (!(prepared.freshBeforeState.debt > 0)) return fail('No open debt is available for mixed recovery.');
  if (repayAmount >= prepared.freshBeforeState.debt - 1e-8) return fail('Full repayment remains disabled in Phase 6D.3.');
  if (prepared.protocol !== 'morpho' || prepared.chainId !== venue.chainId || prepared.marketId.toLowerCase() !== protocolMarketId(venue).toLowerCase()) {
    return fail('Prepared market identity does not match the live Morpho market.');
  }
  if (!input.wallet) return fail('Wallet is not connected.');
  if (prepared.readiness !== 'READY' || prepared.executable === false || prepared.blockingIssues.length > 0) return fail('Prepared execution is blocked and must be refreshed.');
  if (prepared.expiresAt <= now) return fail('Prepared review expired. Refresh and simulate again.');

  const repayTx = prepared.transactions.find((tx) => tx.action === 'REPAY');
  const supplyTx = prepared.transactions.find((tx) => tx.action === 'SUPPLY_COLLATERAL');
  if (!repayTx || !supplyTx) return fail('Prepared review does not contain both mixed-recovery transactions.');
  if (repayTx.simulationStatus === 'FAILED') return fail('Repay simulation failed.');
  if (supplyTx.simulationStatus === 'FAILED') return fail('Collateral-supply simulation failed.');
  if (prepared.transactions.some((tx) => tx.action === 'APPROVE_TOKEN' && tx.simulationStatus === 'FAILED')) return fail('Token approval simulation failed.');

  return { eligible: true, reason: null, repayAmount, collateralAmount };
}

export function buildPhase6D3MixedExecution(input: {
  plan: ExecutionPlan;
  prepared: PreparedExecution;
  venue: Venue;
  wallet: string;
  now?: number;
}): Phase6D3MixedProgress {
  const eligibility = phase6D3MixedEligibility(input);
  if (!eligibility.eligible || eligibility.repayAmount === null || eligibility.collateralAmount === null) {
    throw new Error(eligibility.reason ?? 'Phase 6D.3 mixed recovery is not eligible.');
  }

  const { plan, prepared, venue, wallet } = input;
  const current = projectPosition(
    prepared.freshBeforeState.collateralAmount,
    prepared.freshBeforeState.debt,
    prepared.freshBeforeState.oraclePrice,
    prepared.freshBeforeState.liquidationThreshold,
  );
  const afterRepay = projectPosition(
    prepared.freshBeforeState.collateralAmount,
    Math.max(0, prepared.freshBeforeState.debt - eligibility.repayAmount),
    prepared.freshBeforeState.oraclePrice,
    prepared.freshBeforeState.liquidationThreshold,
  );
  const finalProjected = projectPosition(
    prepared.freshBeforeState.collateralAmount + eligibility.collateralAmount,
    Math.max(0, prepared.freshBeforeState.debt - eligibility.repayAmount),
    prepared.freshBeforeState.oraclePrice,
    prepared.freshBeforeState.liquidationThreshold,
  );
  const id = `PHASE_6D3_MIXED:${venue.id}:${prepared.preparedAt}`;
  const common = {
    protocol: venue.protocol,
    chainId: venue.chainId,
    marketId: venue.id,
    wallet,
    calculatedAt: new Date(prepared.preparedAt).toISOString(),
    hypothetical: false as const,
    targetHF: plan.targetState.targetHealthFactor ?? finalProjected.healthFactor ?? 0,
    currentOraclePrice: prepared.freshBeforeState.oraclePrice,
    freshness: {
      position: 'fresh' as const,
      oracle: 'fresh' as const,
      walletBalances: 'fresh' as const,
    },
  };

  const repayHandoff: RemedyHandoff = {
    ...common,
    id: `${id}:REPAY`,
    type: 'REPAY',
    repayAmount: eligibility.repayAmount,
    currentPosition: current,
    projectedPosition: afterRepay,
    notice: 'Phase 6D.3 step 1 of 2: repay first. This screen revalidates the live Morpho position, USDC balance, allowance, and market before requesting the wallet. The collateral step will not start until this repayment confirms and reconciles.',
  };
  const collateralHandoff: RemedyHandoff = {
    ...common,
    id: `${id}:COLLATERAL`,
    type: 'ADD_COLLATERAL',
    collateralAmount: eligibility.collateralAmount,
    currentPosition: afterRepay,
    projectedPosition: finalProjected,
    notice: 'Phase 6D.3 step 2 of 2: add cbBTC collateral. The repayment has confirmed. This screen revalidates the updated position, cbBTC balance, allowance, oracle, and market before requesting the wallet.',
  };
  const now = input.now ?? Date.now();

  return {
    version: 1,
    id,
    stage: 'REPAY_PENDING',
    marketId: venue.id,
    chainId: venue.chainId,
    wallet,
    repayHandoff,
    collateralHandoff,
    createdAt: now,
    updatedAt: now,
  };
}

function validProgress(value: unknown): value is Phase6D3MixedProgress {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Phase6D3MixedProgress>;
  return item.version === 1
    && typeof item.id === 'string'
    && typeof item.marketId === 'string'
    && typeof item.wallet === 'string'
    && typeof item.chainId === 'number'
    && typeof item.stage === 'string'
    && Boolean(item.repayHandoff)
    && Boolean(item.collateralHandoff);
}

export function stagePhase6D3MixedExecution(storage: StorageLike, progress: Phase6D3MixedProgress) {
  storage.setItem(PHASE_6D3_MIXED_STORAGE_KEY, JSON.stringify(progress));
}

export function readPhase6D3MixedExecution(storage: StorageLike): Phase6D3MixedProgress | null {
  const raw = storage.getItem(PHASE_6D3_MIXED_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validProgress(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStage(storage: StorageLike, progress: Phase6D3MixedProgress, stage: Phase6D3Stage, submittedHash?: string) {
  const next: Phase6D3MixedProgress = {
    ...progress,
    stage,
    updatedAt: Date.now(),
    ...(submittedHash ? { submittedHash } : { submittedHash: undefined }),
  };
  stagePhase6D3MixedExecution(storage, next);
  return next;
}

export function markPhase6D3RepaySubmitted(storage: StorageLike, id: string, hash: string) {
  const progress = readPhase6D3MixedExecution(storage);
  if (!progress || progress.id !== id || (progress.stage !== 'REPAY_PENDING' && progress.stage !== 'REPAY_SUBMITTED')) return progress;
  return writeStage(storage, progress, 'REPAY_SUBMITTED', hash);
}

export function advancePhase6D3AfterRepay(storage: StorageLike, id: string) {
  const progress = readPhase6D3MixedExecution(storage);
  if (!progress || progress.id !== id || (progress.stage !== 'REPAY_PENDING' && progress.stage !== 'REPAY_SUBMITTED')) return progress;
  return writeStage(storage, progress, 'COLLATERAL_PENDING');
}

export function markPhase6D3CollateralSubmitted(storage: StorageLike, id: string, hash: string) {
  const progress = readPhase6D3MixedExecution(storage);
  if (!progress || progress.id !== id || (progress.stage !== 'COLLATERAL_PENDING' && progress.stage !== 'COLLATERAL_SUBMITTED')) return progress;
  return writeStage(storage, progress, 'COLLATERAL_SUBMITTED', hash);
}

export function completePhase6D3MixedExecution(storage: StorageLike, id: string) {
  const progress = readPhase6D3MixedExecution(storage);
  if (!progress || progress.id !== id || (progress.stage !== 'COLLATERAL_PENDING' && progress.stage !== 'COLLATERAL_SUBMITTED')) return progress;
  return writeStage(storage, progress, 'COMPLETE');
}

export function clearPhase6D3MixedExecution(storage: StorageLike) {
  storage.removeItem?.(PHASE_6D3_MIXED_STORAGE_KEY);
}
