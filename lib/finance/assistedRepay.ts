import type { ExecutionPlan, PreparedExecution } from '@/lib/finance/executionPlanner';
import { projectPosition } from '@/lib/finance/riskMonitor';
import type { RemedyHandoff } from '@/lib/finance/actionPlanner';
import { protocolMarketId, type Venue } from '@/lib/protocol';

export type Phase6D1Eligibility = {
  eligible: boolean;
  reason: string | null;
  repayAmount: number | null;
};

export function phase6D1RepayEligibility(input: {
  plan: ExecutionPlan;
  prepared: PreparedExecution;
  venue: Venue;
  wallet: string;
  now?: number;
}): Phase6D1Eligibility {
  const { plan, prepared, venue } = input;
  const now = input.now ?? Date.now();
  const repayAmount = plan.requiredAssets.debtAssetRequired;

  if (plan.hypothetical || prepared.hypothetical) return { eligible: false, reason: 'Hypothetical scenarios cannot be executed.', repayAmount: null };
  if (venue.protocol !== 'morpho' || !venue.morpho) return { eligible: false, reason: 'Phase 6D.1 supports Morpho partial repay only.', repayAmount: null };
  if (venue.chainId !== 8453) return { eligible: false, reason: 'Phase 6D.1 is limited to Morpho on Base.', repayAmount: null };
  if (plan.mode !== 'EMERGENCY_REPAY' || plan.requiredAssets.collateralRequired > 0) return { eligible: false, reason: 'Phase 6D.1 supports repay-only plans.', repayAmount: null };
  if (!(repayAmount > 0) || !(prepared.freshBeforeState.debt > 0)) return { eligible: false, reason: 'No repay amount is available.', repayAmount: null };
  if (repayAmount >= prepared.freshBeforeState.debt - 1e-8) return { eligible: false, reason: 'Full repayment remains disabled in Phase 6D.1.', repayAmount };
  if (prepared.protocol !== 'morpho' || prepared.chainId !== venue.chainId || prepared.marketId.toLowerCase() !== protocolMarketId(venue).toLowerCase()) {
    return { eligible: false, reason: 'Prepared market identity does not match the live Morpho market.', repayAmount };
  }
  if (!input.wallet) return { eligible: false, reason: 'Wallet is not connected.', repayAmount };
  if (prepared.readiness !== 'READY' || prepared.executable === false || prepared.blockingIssues.length > 0) {
    return { eligible: false, reason: 'Prepared execution is blocked and must be refreshed.', repayAmount };
  }
  if (prepared.expiresAt <= now) return { eligible: false, reason: 'Prepared review expired. Refresh and simulate again.', repayAmount };

  const repayTx = prepared.transactions.find((tx) => tx.action === 'REPAY');
  if (!repayTx) return { eligible: false, reason: 'Prepared review does not contain a repay transaction.', repayAmount };
  if (repayTx.simulationStatus === 'FAILED') return { eligible: false, reason: 'Repay simulation failed.', repayAmount };

  return { eligible: true, reason: null, repayAmount };
}

export function buildPhase6D1RepayHandoff(input: {
  plan: ExecutionPlan;
  prepared: PreparedExecution;
  venue: Venue;
  wallet: string;
  now?: number;
}): RemedyHandoff {
  const eligibility = phase6D1RepayEligibility(input);
  if (!eligibility.eligible || eligibility.repayAmount === null) {
    throw new Error(eligibility.reason ?? 'Phase 6D.1 repay is not eligible.');
  }

  const { plan, prepared, venue, wallet } = input;
  const projected = projectPosition(
    prepared.freshBeforeState.collateralAmount,
    prepared.projectedAfterState.projectedDebt,
    prepared.freshBeforeState.oraclePrice,
    prepared.freshBeforeState.liquidationThreshold,
  );
  const current = projectPosition(
    prepared.freshBeforeState.collateralAmount,
    prepared.freshBeforeState.debt,
    prepared.freshBeforeState.oraclePrice,
    prepared.freshBeforeState.liquidationThreshold,
  );

  return {
    id: `PHASE_6D1_REPAY:${venue.id}:${prepared.preparedAt}`,
    type: 'REPAY',
    protocol: venue.protocol,
    chainId: venue.chainId,
    marketId: venue.id,
    wallet,
    calculatedAt: new Date(prepared.preparedAt).toISOString(),
    hypothetical: false,
    targetHF: plan.targetState.targetHealthFactor ?? projected.healthFactor ?? 0,
    repayAmount: eligibility.repayAmount,
    currentPosition: current,
    projectedPosition: projected,
    currentOraclePrice: prepared.freshBeforeState.oraclePrice,
    freshness: {
      position: 'fresh',
      oracle: 'fresh',
      walletBalances: 'fresh',
    },
    notice: 'Prepared Morpho repay passed live review. The repayment screen will revalidate the position, balance, allowance, and market again before requesting the wallet.',
  };
}
