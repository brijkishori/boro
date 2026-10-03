import { ProposedRemedy, RiskMonitorInput } from '@/lib/finance/riskMonitor';
import { priceAtHealthFactor } from '@/lib/finance/liquidation';
import { erc20Abi } from '@/lib/abi';
import { parseUnits, type Address, type PublicClient } from 'viem';
import { protocolMarketId, type Venue } from '@/lib/protocol';
import { adapterFor, approveCall } from '@/lib/adapters';

export type ActionStepType =
  | 'REPAY'
  | 'ADD_COLLATERAL'
  | 'WITHDRAW_COLLATERAL'
  | 'SUPPLY_COLLATERAL'
  | 'BORROW'
  | 'APPROVE_TOKEN'
  | 'SWAP'
  | 'BRIDGE';

export type ExecutionStep = {
  type: ActionStepType;
  asset: string;
  amount: number;
  label: string;
};

export type ExecutionReadiness = 'READY' | 'NEEDS_ATTENTION' | 'BLOCKED';

export type WalletResources = {
  debtAssetAvailable: number | null;
  collateralAvailable: number | null;
  nativeGasAvailable: number | null;
  gasRequired: number | null;
  debtAssetAllowance: number | null;
  collateralAllowance: number | null;
};

export type PlanFreshness = {
  positionFetchedAt: number | null;
  oracleFetchedAt: number | null;
  marketFetchedAt: number | null;
  walletFetchedAt: number | null;
  calculatedAt: number;
  requiresRevalidationBeforeExecution: boolean;
};

export type AvailabilityStatus = 'AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'INSUFFICIENT' | 'UNKNOWN';

export type ExecutionPlan = {
  id: string;
  reason: string;
  mode: 'EMERGENCY_REPAY' | 'EMERGENCY_COLLATERAL' | 'EMERGENCY_MIXED' | 'REFINANCE_MIGRATION' | 'ONE_CLICK_EXECUTION';
  createdAt: number;

  sourcePosition: {
    debt: number;
    collateralAmount: number;
    oraclePrice: number;
    liquidationThreshold: number;
  };

  targetState: {
    targetHealthFactor: number | null;
    projectedDebt: number;
    projectedCollateralAmount: number;
    projectedHealthFactor: number | null;
    projectedLiquidationBtc: number | null;
    projectedCushion: number | null;
  };

  steps: ExecutionStep[];

  requiredAssets: {
    debtAssetRequired: number;
    collateralRequired: number;
  };

  walletResources: WalletResources;

  estimatedNetworkCost: number | null;
  networkCostUnknownReason: string | null;

  estimatedWalletConfirmations: number | [number, number];

  readiness: ExecutionReadiness;
  blockingIssues: string[];
  warnings: string[];
  
  freshness: PlanFreshness;
  executable: boolean;
  hypothetical?: boolean;
};

export type PreparedTransaction = {
  action: ActionStepType;
  targetContract: string;
  asset: string;
  amount: number;
  approvalRequired: boolean;
  estimatedGas: number | null;
  simulationStatus: 'PASSED' | 'FAILED' | 'UNAVAILABLE';
  revertReason?: string;
};

export type PreparedExecution = {
  planId: string;
  preparedAt: number;
  expiresAt: number;
  requiresRevalidationBeforeExecution: boolean;

  protocol: string;
  chainId: number;
  marketId: string;

  freshBeforeState: {
    debt: number;
    collateralAmount: number;
    oraclePrice: number;
    liquidationThreshold: number;
  };

  transactions: PreparedTransaction[];

  exactAllowances: Record<string, number | null>;
  estimatedGas: number | null;
  estimatedNetworkCost: number | null;
  networkCostUnknownReason: string | null;

  projectedAfterState: {
    targetHealthFactor: number | null;
    projectedDebt: number;
    projectedCollateralAmount: number;
    projectedHealthFactor: number | null;
    projectedLiquidationBtc: number | null;
    projectedCushion: number | null;
  };

  drift: boolean;
  driftReason?: string;

  readiness: 'READY' | 'BLOCKED';
  blockingIssues: string[];
  warnings: string[];

  requiresUserConfirmation: true;
  executable?: boolean;
  hypothetical?: boolean;
};

export function deriveHypotheticalPosition(
  input: RiskMonitorInput,
  targetStartingHf: number
): {
  oraclePrice: number;
  healthFactor: number;
  collateralAmount: number;
  debt: number;
  liquidationThreshold: number;
} {
  const collateralAmount = input.collateralAmount;
  const debt = input.totalDebt;
  const liquidationThreshold = input.liquidationThreshold;

  const stressedPrice = priceAtHealthFactor(collateralAmount, debt, liquidationThreshold, targetStartingHf) ?? (input.oraclePrice ?? 0);

  return {
    oraclePrice: stressedPrice,
    healthFactor: targetStartingHf,
    collateralAmount,
    debt,
    liquidationThreshold,
  };
}

function hasHexData(obj: unknown): obj is { data: `0x${string}` } {
  if (typeof obj !== 'object' || obj === null) return false;
  if (!('data' in obj)) return false;
  return typeof obj.data === 'string' && obj.data.startsWith('0x');
}

export async function prepareExecutionReview(
  plan: ExecutionPlan,
  input: RiskMonitorInput,
  venue: Venue,
  user: Address,
  client: PublicClient,
  freshPosition: { debt: number; collateralAmount: number; oraclePrice: number },
  freshWalletBalances: { debtAsset: number | null; collateralAsset: number | null },
  gasPriceWei?: bigint,
  ethPriceUsd?: number,
  options?: { hypothetical?: boolean }
): Promise<PreparedExecution> {
  const isHypothetical = options?.hypothetical ?? plan.hypothetical ?? false;
  const transactions: PreparedTransaction[] = [];
  const exactAllowances: Record<string, number | null> = {};
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  
  let totalGasUnits = 0n;
  let estimatedNetworkCost: number | null = null;
  let networkCostUnknownReason: string | null = null;
  let readiness: 'READY' | 'BLOCKED' = 'READY';

  // 1. Verify chain and canonical market identity
  if (venue.chainId !== input.chainId) {
    blockingIssues.push('Wrong wallet network');
    readiness = 'BLOCKED';
  }
  if (protocolMarketId(venue).toLowerCase() !== input.marketId.toLowerCase()) {
    blockingIssues.push('Market identity changed');
    readiness = 'BLOCKED';
  }

  // Drift check logic...
  let drift = false;
  let driftReason: string | undefined;

  const debtDrift = Math.abs(plan.sourcePosition.debt - freshPosition.debt) / (plan.sourcePosition.debt || 1);
  const collDrift = Math.abs(plan.sourcePosition.collateralAmount - freshPosition.collateralAmount) / (plan.sourcePosition.collateralAmount || 1);
  const priceDrift = Math.abs(plan.sourcePosition.oraclePrice - freshPosition.oraclePrice) / (plan.sourcePosition.oraclePrice || 1);

  if (debtDrift > 0.001 || collDrift > 0.001) {
    drift = true;
    driftReason = 'Position changed';
  } else if (!isHypothetical && priceDrift > 0.005) {
    drift = true;
    driftReason = 'Oracle price moved';
  }

  const debtReq = plan.requiredAssets.debtAssetRequired;
  const collReq = plan.requiredAssets.collateralRequired;

  if (debtReq > 0 && freshWalletBalances.debtAsset !== null && freshWalletBalances.debtAsset < debtReq) {
    drift = true;
    driftReason = 'Insufficient current USDC';
  }

  if (collReq > 0 && freshWalletBalances.collateralAsset !== null && freshWalletBalances.collateralAsset < collReq) {
    drift = true;
    driftReason = 'Insufficient current cbBTC';
  }

  if (drift) {
    blockingIssues.push(driftReason!);
    readiness = 'BLOCKED';
  }

  for (const step of plan.steps) {
    if (step.type === 'APPROVE_TOKEN') continue;

    let writeCall = null;
    let spender: Address | null = null;
    let tokenAddress: Address | null = null;
    let amountBigInt = 0n;
    
    // We only support REPAY and SUPPLY_COLLATERAL for this phase
    if (step.type === 'REPAY') {
      tokenAddress = venue.loanAddress;
      amountBigInt = parseUnits(step.amount.toFixed(venue.loanDecimals), venue.loanDecimals);
      writeCall = adapterFor(venue).buildRepay(venue, user, amountBigInt, false);
      if (writeCall) spender = writeCall.address;
    } else if (step.type === 'SUPPLY_COLLATERAL') {
      tokenAddress = venue.assetAddress;
      amountBigInt = parseUnits(step.amount.toFixed(venue.assetDecimals), venue.assetDecimals);
      writeCall = adapterFor(venue).buildSupply(venue, user, amountBigInt, 'borrow');
      if (writeCall) spender = writeCall.address;
    }

    if (!writeCall || !spender || !tokenAddress) {
      blockingIssues.push('Execution path not yet supported for this action.');
      readiness = 'BLOCKED';
      continue;
    }

    // Exact allowance check
    let allowance: bigint | null = null;
    try {
      allowance = (await client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [user, spender],
      })) as bigint;
      
      const decimals = step.type === 'REPAY' ? venue.loanDecimals : venue.assetDecimals;
      exactAllowances[step.asset] = Number(allowance) / (10 ** decimals);

      if (allowance < amountBigInt) {
        let approvalGas: bigint | null = null;
        let approvalStatus: PreparedTransaction['simulationStatus'] = isHypothetical ? 'UNAVAILABLE' : 'PASSED';
        let approvalReason: string | undefined;
        if (!isHypothetical) {
          try {
            const approval = approveCall(venue, spender, amountBigInt, step.type === 'REPAY' ? 'loan' : 'asset');
            const sim = await client.simulateContract({
              account: user,
              address: approval.address,
              abi: approval.abi,
              functionName: approval.functionName,
              args: approval.args,
            });
            try {
              const requestData = hasHexData(sim.request) ? sim.request.data : undefined;
              approvalGas = await client.estimateGas({
                account: user,
                to: approval.address,
                ...(requestData ? { data: requestData } : {}),
              });
              totalGasUnits += approvalGas;
            } catch {}
          } catch (e: unknown) {
            approvalStatus = 'FAILED';
            approvalReason = e instanceof Error ? e.message : String(e);
            blockingIssues.push('Approval simulation reverted');
            readiness = 'BLOCKED';
          }
        }
        transactions.push({
          action: 'APPROVE_TOKEN',
          targetContract: tokenAddress,
          asset: step.asset,
          amount: step.amount,
          approvalRequired: false,
          estimatedGas: approvalGas ? Number(approvalGas) : null,
          simulationStatus: approvalStatus,
          revertReason: approvalReason,
        });
      }
    } catch {
      blockingIssues.push('Allowance read failed');
      readiness = 'BLOCKED';
    }

    // Simulation. If approval is required, the protocol call is intentionally deferred:
    // the existing RepayFlow will confirm approval first and revalidate live state before repay.
    let simStatus: PreparedTransaction['simulationStatus'] = 'UNAVAILABLE';
    let revertReason: string | undefined;
    let gasUsed: bigint | null = null;
    const approvalRequired = allowance !== null && allowance < amountBigInt;

    if (!isHypothetical && !approvalRequired) {
      try {
        const sim = await client.simulateContract({
          account: user,
          address: writeCall.address,
          abi: writeCall.abi,
          functionName: writeCall.functionName,
          args: writeCall.args,
        });
        simStatus = 'PASSED';
        
        try {
          const requestData = hasHexData(sim.request) ? sim.request.data : undefined;
          gasUsed = await client.estimateGas({
            account: user,
            to: writeCall.address,
            ...(requestData ? { data: requestData } : {}),
          });
          totalGasUnits += gasUsed;
        } catch {}

      } catch (e: unknown) {
        simStatus = 'FAILED';
        revertReason = e instanceof Error ? e.message : String(e);
        blockingIssues.push('Simulation reverted');
        readiness = 'BLOCKED';
      }
    } else if (!isHypothetical && approvalRequired) {
      warnings.push(`${step.label} simulation deferred until token approval is confirmed.`);
    }

    transactions.push({
      action: step.type,
      targetContract: writeCall.address,
      asset: step.asset,
      amount: step.amount,
      approvalRequired,
      estimatedGas: gasUsed ? Number(gasUsed) : null,
      simulationStatus: simStatus,
      revertReason,
    });
  }

  // Gas calculation
  if (totalGasUnits > 0n && gasPriceWei) {
    const ethCost = Number(totalGasUnits * gasPriceWei) / 1e18;
    if (ethPriceUsd) {
      estimatedNetworkCost = ethCost * ethPriceUsd;
    } else {
      networkCostUnknownReason = 'ETH price unavailable';
    }
  } else {
    networkCostUnknownReason = 'Gas estimate unavailable';
  }
  
  if (networkCostUnknownReason && totalGasUnits > 0n) {
    blockingIssues.push('Gas estimate unavailable');
    readiness = 'BLOCKED';
  }

  if (transactions.some(t => t.simulationStatus === 'FAILED')) {
    readiness = 'BLOCKED';
  }

  if (isHypothetical) {
    blockingIssues.push('Hypothetical scenario — live position must be re-evaluated.');
    readiness = 'BLOCKED';
  }

  return {
    planId: plan.id,
    preparedAt: Date.now(),
    expiresAt: Date.now() + 5 * 60_000,
    requiresRevalidationBeforeExecution: true,
    
    protocol: input.protocol,
    chainId: input.chainId,
    marketId: input.marketId,

    freshBeforeState: {
      debt: freshPosition.debt,
      collateralAmount: freshPosition.collateralAmount,
      oraclePrice: freshPosition.oraclePrice,
      liquidationThreshold: plan.sourcePosition.liquidationThreshold,
    },
    
    transactions,
    exactAllowances,
    estimatedGas: Number(totalGasUnits),
    estimatedNetworkCost,
    networkCostUnknownReason,
    
    projectedAfterState: plan.targetState,
    
    drift,
    driftReason,
    
    readiness,
    blockingIssues,
    warnings,
    
    requiresUserConfirmation: true,
    executable: !isHypothetical && readiness === 'READY' && blockingIssues.length === 0,
    hypothetical: isHypothetical,
  };
}

export function determineResourceStatus(required: number, available: number | null): AvailabilityStatus {
  if (!(required > 0)) return 'AVAILABLE';
  if (available === null || !Number.isFinite(available)) return 'UNKNOWN';
  if (available >= required - 1e-12) return 'AVAILABLE';
  if (available > 0) return 'PARTIALLY_AVAILABLE';
  return 'INSUFFICIENT';
}

export function buildEmergencyExecutionPlan(
  remedy: ProposedRemedy,
  input: RiskMonitorInput,
  walletResources: WalletResources,
  networkContext: { chainId: number; marketId: string; gasPriceWei?: bigint },
  options?: { hypothetical?: boolean }
): ExecutionPlan {
  const isHypothetical = options?.hypothetical ?? false;
  const steps: ExecutionStep[] = [];
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  let mode: ExecutionPlan['mode'] = 'EMERGENCY_REPAY';

  const repayRequired = remedy.repayAmount ?? 0;
  const collateralRequired = remedy.collateralAmount ?? 0;

  if (repayRequired > 0 && collateralRequired > 0) {
    mode = 'EMERGENCY_MIXED';
  } else if (collateralRequired > 0) {
    mode = 'EMERGENCY_COLLATERAL';
  }

  // Confirmations Logic
  let minConfirmations = 0;
  let maxConfirmations = 0;

  if (repayRequired > 0) {
    if (walletResources.debtAssetAllowance === null) {
      minConfirmations += 1;
      maxConfirmations += 2;
      steps.push({ type: 'APPROVE_TOKEN', asset: input.debtAsset, amount: repayRequired, label: `Approve ${input.debtAsset}` });
    } else if (walletResources.debtAssetAllowance < repayRequired) {
      minConfirmations += 2;
      maxConfirmations += 2;
      steps.push({ type: 'APPROVE_TOKEN', asset: input.debtAsset, amount: repayRequired, label: `Approve ${input.debtAsset}` });
    } else {
      minConfirmations += 1;
      maxConfirmations += 1;
    }
    steps.push({ type: 'REPAY', asset: input.debtAsset, amount: repayRequired, label: `Repay ${input.debtAsset}` });
  }

  if (collateralRequired > 0) {
    if (walletResources.collateralAllowance === null) {
      minConfirmations += 1;
      maxConfirmations += 2;
      steps.push({ type: 'APPROVE_TOKEN', asset: input.collateralAsset, amount: collateralRequired, label: `Approve ${input.collateralAsset}` });
    } else if (walletResources.collateralAllowance < collateralRequired) {
      minConfirmations += 2;
      maxConfirmations += 2;
      steps.push({ type: 'APPROVE_TOKEN', asset: input.collateralAsset, amount: collateralRequired, label: `Approve ${input.collateralAsset}` });
    } else {
      minConfirmations += 1;
      maxConfirmations += 1;
    }
    steps.push({ type: 'SUPPLY_COLLATERAL', asset: input.collateralAsset, amount: collateralRequired, label: `Add ${input.collateralAsset} collateral` });
  }

  const confirmations: number | [number, number] = minConfirmations === maxConfirmations 
    ? minConfirmations 
    : [minConfirmations, maxConfirmations];

  const debtStatus = determineResourceStatus(repayRequired, walletResources.debtAssetAvailable);
  if (debtStatus === 'INSUFFICIENT' || debtStatus === 'PARTIALLY_AVAILABLE') {
    blockingIssues.push(`Insufficient ${input.debtAsset}`);
  }

  const collateralStatus = determineResourceStatus(collateralRequired, walletResources.collateralAvailable);
  if (collateralStatus === 'INSUFFICIENT' || collateralStatus === 'PARTIALLY_AVAILABLE') {
    blockingIssues.push(`Insufficient ${input.collateralAsset}`);
  }

  const gasStatus = determineResourceStatus(walletResources.gasRequired ?? 0, walletResources.nativeGasAvailable);
  if (gasStatus === 'INSUFFICIENT') {
    blockingIssues.push(`Insufficient ETH for gas`);
  }

  // Network cost (we could use gasRequired logic here or let it be supplied)
  let estimatedNetworkCost: number | null = null;
  let networkCostUnknownReason: string | null = null;
  if (walletResources.gasRequired === null) {
    networkCostUnknownReason = 'Gas requirement is unknown';
  } else if (!networkContext.gasPriceWei) {
    networkCostUnknownReason = 'Gas price is unavailable';
  } else {
    // If we have gasRequired in ETH already, and we don't have ETH price here, we might just pass the ETH cost or need USD cost.
    // The requirement says "return known estimated cost or Unknown + missing reason."
    // If we assume estimatedNetworkCost is in ETH or USD based on existing helpers, we'll keep it simple: we need to pass a known cost.
    // Let's pass it as unknown for now unless gasRequired is provided. 
    estimatedNetworkCost = walletResources.gasRequired;
  }

  // Freshness & related blockers
  const isPositionFresh = input.positionFetchedAt && (input.now ?? Date.now()) - input.positionFetchedAt < 5 * 60_000;
  if (!isPositionFresh || input.positionReadFailed) {
    blockingIssues.push('Stale position');
  }

  const isOracleFresh = input.oracleFetchedAt && (input.now ?? Date.now()) - input.oracleFetchedAt < 5 * 60_000;
  if (!isOracleFresh || !(input.oraclePrice && input.oraclePrice > 0)) {
    blockingIssues.push('Stale oracle');
  }

  // Assuming chain Correctness is validated externally or we can add it here if mismatched
  if (input.chainId !== networkContext.chainId) {
    blockingIssues.push('Wrong wallet network');
  }

  let readiness: ExecutionReadiness = 'READY';
  if (blockingIssues.length > 0) {
    readiness = 'BLOCKED';
  } else if (debtStatus === 'UNKNOWN' || collateralStatus === 'UNKNOWN' || gasStatus === 'UNKNOWN') {
    readiness = 'NEEDS_ATTENTION';
    warnings.push('Some wallet balances or allowances are unknown.');
  }

  return {
    id: `plan-${mode}-${Date.now()}`,
    reason: remedy.label,
    mode,
    createdAt: Date.now(),
    sourcePosition: {
      debt: input.totalDebt,
      collateralAmount: input.collateralAmount,
      oraclePrice: input.oraclePrice ?? 0,
      liquidationThreshold: input.liquidationThreshold,
    },
    targetState: {
      targetHealthFactor: remedy.targetHF,
      projectedDebt: remedy.projectedPosition.debt,
      projectedCollateralAmount: remedy.projectedPosition.collateralAmount,
      projectedHealthFactor: remedy.projectedPosition.healthFactor,
      projectedLiquidationBtc: remedy.projectedPosition.liquidationPrice,
      projectedCushion: remedy.projectedPosition.liquidationCushionPercent,
    },
    steps,
    requiredAssets: {
      debtAssetRequired: repayRequired,
      collateralRequired,
    },
    walletResources,
    estimatedNetworkCost,
    networkCostUnknownReason,
    estimatedWalletConfirmations: confirmations,
    readiness,
    blockingIssues,
    warnings,
    freshness: {
      positionFetchedAt: input.positionFetchedAt ?? null,
      oracleFetchedAt: input.oracleFetchedAt ?? null,
      marketFetchedAt: input.fetchedAt ?? null,
      walletFetchedAt: input.walletFetchedAt ?? null,
      calculatedAt: Date.now(),
      requiresRevalidationBeforeExecution: true,
    },
    executable: !isHypothetical && readiness === 'READY' && blockingIssues.length === 0,
    hypothetical: isHypothetical,
  };
}
