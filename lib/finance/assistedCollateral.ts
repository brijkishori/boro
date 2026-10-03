import { buildEmergencyExecutionPlan, type ExecutionPlan, type PreparedExecution, type WalletResources } from '@/lib/finance/executionPlanner';
import { projectPosition, type ProposedRemedy, type RiskMonitorInput } from '@/lib/finance/riskMonitor';
import type { RemedyHandoff } from '@/lib/finance/actionPlanner';
import { protocolMarketId, type Venue } from '@/lib/protocol';

export type Phase6D2Eligibility = {
  eligible: boolean;
  reason: string | null;
  collateralAmount: number | null;
};

export function phase6D2ManualCollateralValidation(input: {
  riskInput: RiskMonitorInput;
  collateralAmount: number;
  venue?: Venue;
}): string | null {
  const { riskInput, collateralAmount, venue } = input;
  if (!venue) return 'Verified market definition is required.';
  if (venue.protocol !== 'morpho' || !venue.morpho || riskInput.protocol !== 'morpho') return 'Phase 6D.2 supports Morpho collateral addition only.';
  if (venue.chainId !== 8453 || riskInput.chainId !== 8453) return 'Phase 6D.2 is limited to Morpho on Base.';
  if (venue.assetSymbol.toLowerCase() !== 'cbbtc' || riskInput.collateralAsset.toLowerCase() !== 'cbbtc') return 'Phase 6D.2 is limited to cbBTC collateral.';
  if (!riskInput.wallet) return 'Wallet is not connected.';
  if (!Number.isFinite(collateralAmount) || collateralAmount <= 0) return 'Enter a collateral amount greater than 0.';
  if (!(riskInput.totalDebt > 0)) return 'No live debt is available to protect with additional collateral.';
  return null;
}

export function buildPhase6D2ManualCollateralPlan(input: {
  riskInput: RiskMonitorInput;
  walletResources: WalletResources;
  networkContext: { chainId: number; marketId: string; gasPriceWei?: bigint };
  venue?: Venue;
  collateralAmount: number;
}): ExecutionPlan {
  const validation = phase6D2ManualCollateralValidation({
    riskInput: input.riskInput,
    collateralAmount: input.collateralAmount,
    venue: input.venue,
  });

  const projected = projectPosition(
    input.riskInput.collateralAmount + Math.max(0, input.collateralAmount),
    input.riskInput.totalDebt,
    input.riskInput.oraclePrice ?? 0,
    input.riskInput.liquidationThreshold,
  );
  const remedy: ProposedRemedy = {
    type: 'ADD_COLLATERAL',
    targetHF: projected.healthFactor ?? input.riskInput.healthFactor ?? 0,
    repayAmount: 0,
    collateralAmount: Math.max(0, input.collateralAmount),
    projectedPosition: projected,
    calculatedAt: new Date().toISOString(),
    sourceBlock: input.riskInput.sourceBlock,
    feasibility: 'AVAILABLE',
    label: 'Manual assisted collateral addition',
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

export function phase6D2CollateralEligibility(input: {
  plan: ExecutionPlan;
  prepared: PreparedExecution;
  venue: Venue;
  wallet: string;
  now?: number;
}): Phase6D2Eligibility {
  const { plan, prepared, venue } = input;
  const now = input.now ?? Date.now();
  const collateralAmount = plan.requiredAssets.collateralRequired;

  if (plan.hypothetical || prepared.hypothetical) return { eligible: false, reason: 'Hypothetical scenarios cannot be executed.', collateralAmount: null };
  if (venue.protocol !== 'morpho' || !venue.morpho) return { eligible: false, reason: 'Phase 6D.2 supports Morpho collateral addition only.', collateralAmount: null };
  if (venue.chainId !== 8453) return { eligible: false, reason: 'Phase 6D.2 is limited to Morpho on Base.', collateralAmount: null };
  if (venue.assetSymbol.toLowerCase() !== 'cbbtc') return { eligible: false, reason: 'Phase 6D.2 is limited to cbBTC collateral.', collateralAmount: null };
  if (plan.mode !== 'EMERGENCY_COLLATERAL' || plan.requiredAssets.debtAssetRequired > 0) return { eligible: false, reason: 'Phase 6D.2 supports collateral-only plans.', collateralAmount: null };
  if (!(collateralAmount > 0) || !(prepared.freshBeforeState.debt > 0)) return { eligible: false, reason: 'No collateral addition is available for an open loan.', collateralAmount: null };
  if (prepared.protocol !== 'morpho' || prepared.chainId !== venue.chainId || prepared.marketId.toLowerCase() !== protocolMarketId(venue).toLowerCase()) {
    return { eligible: false, reason: 'Prepared market identity does not match the live Morpho market.', collateralAmount };
  }
  if (!input.wallet) return { eligible: false, reason: 'Wallet is not connected.', collateralAmount };
  if (prepared.readiness !== 'READY' || prepared.executable === false || prepared.blockingIssues.length > 0) {
    return { eligible: false, reason: 'Prepared execution is blocked and must be refreshed.', collateralAmount };
  }
  if (prepared.expiresAt <= now) return { eligible: false, reason: 'Prepared review expired. Refresh and simulate again.', collateralAmount };

  const supplyTx = prepared.transactions.find((tx) => tx.action === 'SUPPLY_COLLATERAL');
  if (!supplyTx) return { eligible: false, reason: 'Prepared review does not contain a collateral-supply transaction.', collateralAmount };
  if (supplyTx.simulationStatus === 'FAILED') return { eligible: false, reason: 'Collateral-supply simulation failed.', collateralAmount };

  const approvalTx = prepared.transactions.find((tx) => tx.action === 'APPROVE_TOKEN');
  if (approvalTx?.simulationStatus === 'FAILED') return { eligible: false, reason: 'Collateral approval simulation failed.', collateralAmount };

  return { eligible: true, reason: null, collateralAmount };
}

export function buildPhase6D2CollateralHandoff(input: {
  plan: ExecutionPlan;
  prepared: PreparedExecution;
  venue: Venue;
  wallet: string;
  now?: number;
}): RemedyHandoff {
  const eligibility = phase6D2CollateralEligibility(input);
  if (!eligibility.eligible || eligibility.collateralAmount === null) {
    throw new Error(eligibility.reason ?? 'Phase 6D.2 collateral addition is not eligible.');
  }

  const { plan, prepared, venue, wallet } = input;
  const projected = projectPosition(
    prepared.projectedAfterState.projectedCollateralAmount,
    prepared.freshBeforeState.debt,
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
    id: `PHASE_6D2_COLLATERAL:${venue.id}:${prepared.preparedAt}`,
    type: 'ADD_COLLATERAL',
    protocol: venue.protocol,
    chainId: venue.chainId,
    marketId: venue.id,
    wallet,
    calculatedAt: new Date(prepared.preparedAt).toISOString(),
    hypothetical: false,
    targetHF: plan.targetState.targetHealthFactor ?? projected.healthFactor ?? 0,
    collateralAmount: eligibility.collateralAmount,
    currentPosition: current,
    projectedPosition: projected,
    currentOraclePrice: prepared.freshBeforeState.oraclePrice,
    freshness: {
      position: 'fresh',
      oracle: 'fresh',
      walletBalances: 'fresh',
    },
    notice: 'Prepared Morpho cbBTC collateral addition passed live review. The borrow screen will revalidate the position, cbBTC balance, allowance, and market again before requesting the wallet.',
  };
}
