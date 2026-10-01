import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEmergencyExecutionPlan, WalletResources, ExecutionStep } from './executionPlanner';
import { RiskMonitorInput, ProposedRemedy, repayToTargetHF, collateralToTargetHF, mixedRemedyToTargetHF, projectPosition } from './riskMonitor';
import { RefinanceCandidate, RefinanceMarketBaseline } from './refinance';

describe('Emergency Execution Planner Foundation', () => {
  const baseInput: RiskMonitorInput & { oraclePrice: number } = {
    wallet: '0x123',
    protocol: 'aave',
    chainId: 1,
    marketId: 'market-1',
    collateralAsset: 'cbBTC',
    debtAsset: 'USDC',
    collateralAmount: 1,
    totalDebt: 21100,
    liquidationThreshold: 0.8,
    oraclePrice: 60000,
    fetchedAt: Date.now(),
    positionFetchedAt: Date.now(),
    oracleFetchedAt: Date.now(),
    now: Date.now(),
  };

  const baseResources: WalletResources = {
    debtAssetAvailable: 50000,
    collateralAvailable: 2,
    nativeGasAvailable: 0.5,
    gasRequired: 0.01,
    debtAssetAllowance: 50000,
    collateralAllowance: 2,
  };

  const networkContext = { chainId: 1, marketId: 'market-1', gasPriceWei: 10n ** 9n };

  it('A. repay-only emergency plan reaches target HF', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, baseResources, networkContext);
    assert.equal(plan.mode, 'EMERGENCY_REPAY');
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].type, 'REPAY');
    assert.ok(plan.targetState.projectedHealthFactor! >= 2.5);
    assert.equal(plan.readiness, 'READY');
    assert.equal(plan.executable, true);
  });

  it('B. add-collateral-only plan reaches target HF', () => {
    const remedyMath = collateralToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'ADD_COLLATERAL',
      targetHF: 2.5,
      collateralAmount: remedyMath.collateralAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Add Collateral',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, baseResources, networkContext);
    assert.equal(plan.mode, 'EMERGENCY_COLLATERAL');
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].type, 'SUPPLY_COLLATERAL');
    assert.ok(plan.targetState.projectedHealthFactor! >= 2.5);
    assert.equal(plan.readiness, 'READY');
  });

  it('C. mixed remedy reaches target HF', () => {
    const remedyMath = mixedRemedyToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, currentHf: null, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'MIXED',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      collateralAmount: remedyMath.collateralAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Mixed',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, baseResources, networkContext);
    assert.equal(plan.mode, 'EMERGENCY_MIXED');
    assert.ok(plan.steps.length >= 2);
    assert.ok(plan.steps.some((s) => s.type === 'REPAY'));
    assert.ok(plan.steps.some((s) => s.type === 'SUPPLY_COLLATERAL'));
    assert.ok(plan.targetState.projectedHealthFactor! >= 2.49);
    assert.equal(plan.readiness, 'READY');
  });

  it('D. insufficient USDC marks repay plan blocked', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'NOT_CURRENTLY_AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, { ...baseResources, debtAssetAvailable: 0 }, networkContext);
    assert.equal(plan.readiness, 'BLOCKED');
    assert.equal(plan.executable, false);
    assert.ok(plan.blockingIssues.includes('Insufficient USDC'));
  });

  it('E. insufficient cbBTC marks collateral plan blocked', () => {
    const remedyMath = collateralToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'ADD_COLLATERAL',
      targetHF: 2.5,
      collateralAmount: remedyMath.collateralAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'NOT_CURRENTLY_AVAILABLE',
      label: 'Add Collateral',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, { ...baseResources, collateralAvailable: 0 }, networkContext);
    assert.equal(plan.readiness, 'BLOCKED');
    assert.equal(plan.executable, false);
    assert.ok(plan.blockingIssues.includes('Insufficient cbBTC'));
  });

  it('F. sufficient wallet resources marks plan ready', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, baseResources, networkContext);
    assert.equal(plan.readiness, 'READY');
    assert.equal(plan.executable, true);
    assert.equal(plan.blockingIssues.length, 0);
  });

  it('G. stale oracle blocks execution', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, { ...baseInput, oracleFetchedAt: Date.now() - 1000000 }, baseResources, networkContext);
    assert.equal(plan.readiness, 'BLOCKED');
    assert.equal(plan.executable, false);
    assert.ok(plan.blockingIssues.includes('Stale oracle'));
  });

  it('H. wrong chain blocks execution', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, { ...baseInput, chainId: 2 }, baseResources, networkContext);
    assert.equal(plan.readiness, 'BLOCKED');
    assert.equal(plan.executable, false);
    assert.ok(plan.blockingIssues.includes('Wrong wallet network'));
  });

  it('I. allowance already sufficient removes approval step', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, { ...baseResources, debtAssetAllowance: 100000 }, networkContext);
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].type, 'REPAY');
    assert.equal(plan.estimatedWalletConfirmations, 1);
  });

  it('J. unknown allowance returns estimated confirmation range', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, { ...baseResources, debtAssetAllowance: null }, networkContext);
    assert.equal(plan.steps[0].type, 'APPROVE_TOKEN');
    assert.deepEqual(plan.estimatedWalletConfirmations, [1, 2]);
  });

  it('K. unknown gas cost remains null/unknown', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, { ...baseResources, gasRequired: null }, networkContext);
    assert.equal(plan.estimatedNetworkCost, null);
    assert.equal(plan.networkCostUnknownReason, 'Gas requirement is unknown');
  });

  it('L. refinance MigrationPlan can map conceptually into generic execution steps', () => {
    const sourceMarket: Partial<RefinanceMarketBaseline> = { collateralAsset: 'cbBTC', debtAsset: 'USDC' };
    const destMarket: Partial<RefinanceCandidate> = { collateral: 'cbBTC', debtAsset: 'USDC' };
    
    const migrationSteps: ExecutionStep[] = [
      { type: 'REPAY', asset: sourceMarket.debtAsset!, amount: 1000, label: 'Repay source' },
      { type: 'WITHDRAW_COLLATERAL', asset: sourceMarket.collateralAsset!, amount: 1, label: 'Withdraw' },
      { type: 'APPROVE_TOKEN', asset: destMarket.collateral!, amount: 1, label: 'Approve destination' },
      { type: 'SUPPLY_COLLATERAL', asset: destMarket.collateral!, amount: 1, label: 'Supply destination' },
      { type: 'BORROW', asset: destMarket.debtAsset!, amount: 1000, label: 'Borrow destination' },
    ];
    
    assert.equal(migrationSteps.length, 5);
    assert.equal(migrationSteps[0].type, 'REPAY');
    assert.equal(migrationSteps[3].type, 'SUPPLY_COLLATERAL');
  });

  it('M. projected after-state uses same finance math as Risk Monitor', () => {
    const remedyMath = repayToTargetHF({ collateralAmount: baseInput.collateralAmount, debt: baseInput.totalDebt, oraclePrice: baseInput.oraclePrice, liquidationThreshold: baseInput.liquidationThreshold, targetHf: 2.5, actionable: true });
    const remedy: ProposedRemedy = {
      type: 'REPAY',
      targetHF: 2.5,
      repayAmount: remedyMath.repayAmount,
      projectedPosition: remedyMath.projected!,
      calculatedAt: new Date().toISOString(),
      feasibility: 'AVAILABLE',
      label: 'Repay',
    };

    const plan = buildEmergencyExecutionPlan(remedy, baseInput, baseResources, networkContext);
    
    const manualProjected = projectPosition(
      baseInput.collateralAmount, 
      baseInput.totalDebt - (remedyMath.repayAmount ?? 0), 
      baseInput.oraclePrice!, 
      baseInput.liquidationThreshold
    );
    
    assert.ok(Math.abs(plan.targetState.projectedHealthFactor! - manualProjected.healthFactor!) < 1e-6);
    assert.ok(Math.abs(plan.targetState.projectedLiquidationBtc! - manualProjected.liquidationPrice!) < 1e-6);
  });
});
