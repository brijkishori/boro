import type { MigrationPlan } from '@/lib/finance/refinance';
import type { Venue } from '@/lib/protocol';

export const PHASE6D4_FUNDING_BUFFER_BPS = 2; // 0.02%
export const PHASE6D4_STORAGE_KEY = 'boro:phase6d4-refinance:v1';

export type Phase6D4RefinanceStage =
  | 'REPAY_SOURCE_PENDING'
  | 'REPAY_SOURCE_SUBMITTED'
  | 'WITHDRAW_SOURCE_PENDING'
  | 'WITHDRAW_SOURCE_SUBMITTED'
  | 'SUPPLY_DESTINATION_PENDING'
  | 'SUPPLY_DESTINATION_SUBMITTED'
  | 'BORROW_DESTINATION_PENDING'
  | 'BORROW_DESTINATION_SUBMITTED'
  | 'COMPLETE';

export type Phase6D4ExecutionStep = {
  order: number;
  action: 'REPAY_SOURCE' | 'WITHDRAW_SOURCE' | 'SUPPLY_DESTINATION' | 'BORROW_DESTINATION';
  marketId: string;
  label: string;
  amount: number;
  asset: string;
};

export type Phase6D4Readiness = {
  eligible: boolean;
  reason: string | null;
  blockingIssues: string[];
  warnings: string[];
  sourceDebt: number;
  sourceDebtFundingBuffer: number;
  sourceDebtFundingRequired: number;
  walletDebtAssetAvailable: number | null;
  fundingShortfall: number | null;
  collateralToMove: number;
  destinationBorrowTarget: number;
  estimatedWalletConfirmations: [number, number];
  steps: Phase6D4ExecutionStep[];
};

export type Phase6D4RefinanceProgress = {
  id: string;
  createdAt: number;
  wallet: string;
  sourceVenueId: string;
  destinationVenueId: string;
  sourceChainId: number;
  destinationChainId: number;
  debtTarget: number;
  collateralTarget: number;
  stage: Phase6D4RefinanceStage;
  submittedHash?: string;
  lastUpdatedAt: number;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

function fundingBuffer(debt: number) {
  if (!(debt > 0) || !Number.isFinite(debt)) return 0;
  return Math.max(1, debt * (PHASE6D4_FUNDING_BUFFER_BPS / 10_000));
}

export function buildPhase6D4Readiness(input: {
  plan: MigrationPlan;
  sourceVenue: Venue;
  walletDebtAssetAvailable: number | null;
  walletFresh: boolean;
  qualificationPassed: boolean;
}): Phase6D4Readiness {
  const { plan, sourceVenue } = input;
  const destination = plan.destinationMarket;
  const debt = Math.max(plan.debt, 0);
  const buffer = fundingBuffer(debt);
  const required = debt + buffer;
  const available = input.walletFresh ? input.walletDebtAssetAvailable : null;
  const shortfall = available === null ? null : Math.max(required - available, 0);
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (!(debt > 0)) blockingIssues.push('No open source debt to refinance.');
  if (sourceVenue.protocol !== 'morpho') blockingIssues.push('Phase 6D.4 initially supports Morpho as the source market only.');
  if (sourceVenue.chainId !== 8453 || destination.chainId !== 8453) blockingIssues.push('Phase 6D.4 initially supports Base-to-Base refinancing only.');
  if (plan.classification !== 'SAME_CHAIN_SAME_WRAPPER') blockingIssues.push('Wrapper-change and cross-chain migrations are not executable in Phase 6D.4.');
  if (sourceVenue.assetSymbol.toLowerCase() !== destination.collateral.toLowerCase()) blockingIssues.push('Source and destination collateral wrappers must match.');
  if (sourceVenue.loanSymbol.toLowerCase() !== destination.debtAsset.toLowerCase()) blockingIssues.push('Source and destination debt assets must match.');
  if (plan.rateDirection !== 'lower') blockingIssues.push('Destination does not currently have a lower borrow rate.');
  if (!input.qualificationPassed) blockingIssues.push('Candidate does not currently meet the actionable refinance qualification rules.');
  if (plan.liquiditySufficiency !== 'SUFFICIENT') blockingIssues.push('Destination liquidity is insufficient for the planned debt.');
  if (plan.isStale || plan.freshness !== 'fresh') blockingIssues.push('Source or destination market data is not fresh enough for execution planning.');
  if (!input.walletFresh) blockingIssues.push('Fresh source-chain USDC wallet balance is required.');
  if (available !== null && available < required) {
    blockingIssues.push(`Self-funded refinance requires ${required.toFixed(2)} USDC before source repayment; current wallet balance is ${available.toFixed(2)} USDC.`);
  }

  warnings.push('This is a staged self-funded migration, not an atomic or flash-loan refinance.');
  warnings.push('The source debt must be fully repaid before source collateral can be withdrawn.');
  warnings.push('Every position-changing leg requires fresh revalidation and explicit wallet confirmation.');

  const steps: Phase6D4ExecutionStep[] = [
    {
      order: 1,
      action: 'REPAY_SOURCE',
      marketId: sourceVenue.id,
      label: `Fully repay source ${sourceVenue.loanSymbol} debt`,
      amount: debt,
      asset: sourceVenue.loanSymbol,
    },
    {
      order: 2,
      action: 'WITHDRAW_SOURCE',
      marketId: sourceVenue.id,
      label: `Withdraw source ${sourceVenue.assetSymbol} collateral`,
      amount: plan.collateral,
      asset: sourceVenue.assetSymbol,
    },
    {
      order: 3,
      action: 'SUPPLY_DESTINATION',
      marketId: destination.id,
      label: `Supply ${destination.collateral} to destination`,
      amount: plan.collateral,
      asset: destination.collateral,
    },
    {
      order: 4,
      action: 'BORROW_DESTINATION',
      marketId: destination.id,
      label: `Borrow ${destination.debtAsset} on destination`,
      amount: debt,
      asset: destination.debtAsset,
    },
  ];

  return {
    eligible: blockingIssues.length === 0,
    reason: blockingIssues[0] ?? null,
    blockingIssues,
    warnings,
    sourceDebt: debt,
    sourceDebtFundingBuffer: buffer,
    sourceDebtFundingRequired: required,
    walletDebtAssetAvailable: available,
    fundingShortfall: shortfall,
    collateralToMove: plan.collateral,
    destinationBorrowTarget: debt,
    estimatedWalletConfirmations: [4, 6],
    steps,
  };
}

export function buildPhase6D4Progress(input: {
  readiness: Phase6D4Readiness;
  wallet: string;
  sourceVenueId: string;
  destinationVenueId: string;
  sourceChainId: number;
  destinationChainId: number;
  now?: number;
}): Phase6D4RefinanceProgress {
  if (!input.readiness.eligible) {
    throw new Error(input.readiness.reason ?? 'Refinance execution is not ready.');
  }
  const now = input.now ?? Date.now();
  return {
    id: `refi-${now}-${input.sourceVenueId}-${input.destinationVenueId}`,
    createdAt: now,
    wallet: input.wallet,
    sourceVenueId: input.sourceVenueId,
    destinationVenueId: input.destinationVenueId,
    sourceChainId: input.sourceChainId,
    destinationChainId: input.destinationChainId,
    debtTarget: input.readiness.destinationBorrowTarget,
    collateralTarget: input.readiness.collateralToMove,
    stage: 'REPAY_SOURCE_PENDING',
    lastUpdatedAt: now,
  };
}

export function savePhase6D4Progress(storage: StorageLike, progress: Phase6D4RefinanceProgress) {
  storage.setItem(PHASE6D4_STORAGE_KEY, JSON.stringify(progress));
  return progress;
}

export function readPhase6D4Progress(storage: StorageLike): Phase6D4RefinanceProgress | null {
  const raw = storage.getItem(PHASE6D4_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Phase6D4RefinanceProgress;
    return parsed?.id && parsed?.stage ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPhase6D4Progress(storage: StorageLike) {
  storage.removeItem?.(PHASE6D4_STORAGE_KEY);
}

const NEXT_PENDING: Record<Extract<Phase6D4RefinanceStage, `${string}_SUBMITTED`>, Phase6D4RefinanceStage> = {
  REPAY_SOURCE_SUBMITTED: 'WITHDRAW_SOURCE_PENDING',
  WITHDRAW_SOURCE_SUBMITTED: 'SUPPLY_DESTINATION_PENDING',
  SUPPLY_DESTINATION_SUBMITTED: 'BORROW_DESTINATION_PENDING',
  BORROW_DESTINATION_SUBMITTED: 'COMPLETE',
};

export function markPhase6D4Submitted(
  storage: StorageLike,
  expectedPendingStage: Extract<Phase6D4RefinanceStage, `${string}_PENDING`>,
  submittedStage: Extract<Phase6D4RefinanceStage, `${string}_SUBMITTED`>,
  hash: string,
  now = Date.now(),
) {
  const current = readPhase6D4Progress(storage);
  if (!current || current.stage !== expectedPendingStage) return current;
  return savePhase6D4Progress(storage, {
    ...current,
    stage: submittedStage,
    submittedHash: hash,
    lastUpdatedAt: now,
  });
}

export function advancePhase6D4AfterVerifiedReceipt(
  storage: StorageLike,
  submittedStage: Extract<Phase6D4RefinanceStage, `${string}_SUBMITTED`>,
  now = Date.now(),
) {
  const current = readPhase6D4Progress(storage);
  if (!current || current.stage !== submittedStage) return current;
  return savePhase6D4Progress(storage, {
    ...current,
    stage: NEXT_PENDING[submittedStage],
    submittedHash: undefined,
    lastUpdatedAt: now,
  });
}

export function phase6D4ReloadRequiresManualVerification(progress: Phase6D4RefinanceProgress | null) {
  return Boolean(progress && progress.stage.endsWith('_SUBMITTED'));
}
