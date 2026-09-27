export type TransactionDraft = {
  collateralDelta: number;
  borrowDelta: number;
  repayDelta: number;
  withdrawDelta: number;
};

export const ABOVE_TARGET_MESSAGE = 'Your current position is above the planning target.';

export function emptyTransactionDraft(): TransactionDraft {
  return { collateralDelta: 0, borrowDelta: 0, repayDelta: 0, withdrawDelta: 0 };
}

/** A typed borrow does not carry a collateral amount from the planning scenario. */
export function manualBorrowDraft(borrowUsd: number): TransactionDraft {
  return { ...emptyTransactionDraft(), borrowDelta: borrowUsd };
}

export function projectDraft(
  currentCollateral: number,
  currentDebt: number,
  draft: Pick<TransactionDraft, 'collateralDelta' | 'borrowDelta'>,
) {
  return {
    collateral: currentCollateral + draft.collateralDelta,
    debt: currentDebt + draft.borrowDelta,
  };
}

/** Positive movement from the live position toward the planning target. Never a withdraw or repay. */
export function planningDeltas(input: {
  targetCollateral: number;
  targetDebt: number;
  currentCollateral: number;
  currentDebt: number;
}): TransactionDraft & { aboveTarget: boolean } {
  return {
    collateralDelta: Math.max(input.targetCollateral - input.currentCollateral, 0),
    borrowDelta: Math.max(input.targetDebt - input.currentDebt, 0),
    repayDelta: 0,
    withdrawDelta: 0,
    aboveTarget: input.currentCollateral > input.targetCollateral || input.currentDebt > input.targetDebt,
  };
}

export function positiveRawDelta(target: bigint, current: bigint): bigint {
  return target > current ? target - current : 0n;
}

export function clearCompletedDraft(draft: TransactionDraft, action: 'supply' | 'borrow' | 'repay' | 'withdraw'): TransactionDraft {
  if (action === 'supply') return { ...draft, collateralDelta: 0 };
  if (action === 'borrow') return { ...draft, borrowDelta: 0 };
  if (action === 'repay') return { ...draft, repayDelta: 0 };
  return { ...draft, withdrawDelta: 0 };
}

export function restoreAfterRefresh<T>(scenario: T): { scenario: T; draft: TransactionDraft } {
  return { scenario, draft: emptyTransactionDraft() };
}

export function walletCollateralRequirement(draft: Pick<TransactionDraft, 'collateralDelta'>): number {
  return draft.collateralDelta;
}

export function collateralShortfallBlocks(collateralDelta: number, walletBalance: number): boolean {
  return collateralDelta > walletBalance;
}
