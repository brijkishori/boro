'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { fetchFreshPosition, fetchFreshRates, fetchFreshTokenBalance, venueFromPayload } from '@/lib/finance/fetchConfirm';
import { writeFreshPosition } from '@/lib/finance/positionCache';
import { publicClient } from '@/lib/rpc';
import type { OpenPosition } from '@/components/useAllPositions';
import { GAS_UNITS, shortEth, useGasCheck } from '@/components/useGasCheck';
import { erc20Abi } from '@/lib/abi';
import type { AuditEvent } from '@/lib/audit';
import { formatApr, formatUsd, formatUsdExact } from '@/lib/amount';
import type { FinancingBenchmark } from '@/lib/finance/benchmark';
import { formatHealthFactor, formatLtv, formatPercent } from '@/lib/finance/format';
import {
  benchmarkComparisonCopy,
  loanRateHistory,
  movementSentence,
} from '@/lib/finance/openingApr';
import {
  benchmarkStatus,
  feasibilityStatus,
  marketStressPresentation,
  readinessStatus,
  riskSeverityStatus,
} from '@/lib/finance/riskStatus';
import { AprChangeLine, StatusBadge } from '@/components/RiskStatus';
import RateChart from '@/components/RateChart';
import { LoanRateStatus } from '@/components/LoanRateStatus';
import { buildLoanRateStatus } from '@/lib/finance/loanView';
import { readRecommendedPlans, subscribeRecommendedPlans } from '@/lib/finance/recommendedAlertStore';
import { alertMarketKey } from '@/lib/finance/recommendedAlerts';
import {
  buildRiskMonitor,
  evaluateSimulation,
  openSimulation,
  rateScenarios,
  resetSimulation,
  simulateApr,
  type ProjectedRiskPosition,
  type RiskMonitorInput,
  type SimulationMode,
  type SimulationState,
} from '@/lib/finance/riskMonitor';
import { availableToBorrowUsd, CHAINS, chainLabel, protocolMarketId, sameAssetOnOtherChain, type ChainId, type Venue } from '@/lib/protocol';
import { ETH_USD_FEED, feedAbi, parseFeedUsd } from '@/lib/prices';
import { useRates } from '@/components/useRates';
import RefinancePanel from '@/components/RefinancePanel';
import ActionPlanner from '@/components/ActionPlanner';
import EmergencyConsole from '@/components/EmergencyConsole';
import EarlyWarningCard, { MarketIntelligence, RateTrendDetail } from '@/components/EarlyWarningCard';
import { alertForDriver, buildEarlyWarning, type TrendSample } from '@/lib/finance/earlyWarning';
import { readTrendSamples, sameTrendSamples, writeTrendSample } from '@/lib/finance/trendStore';
import {
  appendPlannerHistory,
  buildPlannerCards,
  buildRemedyHandoff,
  correctiveCards,
  DRIFT_NOTICE,
  projectCustomAction,
  reviewDecision,
  stageRemedyHandoff,
  type PlannerCard,
  type PlannerPosition,
} from '@/lib/finance/actionPlanner';

const NO_CONFIG = {
  preferredHealthFactor: null as number | null,
  watch: null as number | null,
  prepare: null as number | null,
  act: null as number | null,
  urgent: null as number | null,
  utilizationWatch: null as number | null,
  utilizationHigh: null as number | null,
  benchmarkApr: null as number | null,
  benchmarkType: null as string | null,
};
const configCache = new Map<string, { fingerprint: string; value: typeof NO_CONFIG }>();

function storedConfig(marketKey: string, venueId: string) {
  if (typeof window === 'undefined') return NO_CONFIG;
  const item = (key: string) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const plansRaw = item('simplebtc_recommended_alerts');
  const benchRaw = item('simplebtc_benchmark');
  const alertsRaw = item('simplebtc_loan_alerts');
  const fingerprint = `${plansRaw ?? ''}|${benchRaw ?? ''}|${alertsRaw ?? ''}`;
  const id = `${marketKey}|${venueId}`;
  const hit = configCache.get(id);
  if (hit?.fingerprint === fingerprint) return hit.value;
  const plans = readRecommendedPlans();
  const plan = plans.find((item) => item.marketKey === marketKey);
  const ruleThreshold = (ruleId: string) => {
    const threshold = plan?.rules.find((rule) => rule.id === ruleId)?.threshold;
    return typeof threshold === 'number' ? threshold : null;
  };
  let watch = ruleThreshold('hf-watch');
  if (!plan && alertsRaw) {
    try {
      const rules = JSON.parse(alertsRaw) as Array<{ venueId?: string; healthFactorThreshold?: number }>;
      const match = rules.find((rule) => rule.venueId === venueId);
      if (typeof match?.healthFactorThreshold === 'number') watch = match.healthFactorThreshold;
    } catch {
      watch = null;
    }
  }
  let benchmarkApr: number | null = null;
  let benchmarkType: string | null = null;
  if (benchRaw) {
    try {
      const benchmark = JSON.parse(benchRaw) as Partial<FinancingBenchmark>;
      if (typeof benchmark.annualRate === 'number') benchmarkApr = benchmark.annualRate;
      if (benchmark.rateType === 'fixed' || benchmark.rateType === 'variable') benchmarkType = benchmark.rateType;
    } catch {
      benchmarkApr = null;
    }
  }
  const value = {
    preferredHealthFactor: plan?.preferredHealthFactor ?? null,
    watch,
    prepare: ruleThreshold('hf-prepare'),
    act: ruleThreshold('hf-act'),
    urgent: ruleThreshold('hf-urgent'),
    utilizationWatch: ruleThreshold('utilization-watch'),
    utilizationHigh: ruleThreshold('utilization-high'),
    benchmarkApr,
    benchmarkType,
  };
  configCache.set(id, { fingerprint, value });
  return value;
}

function subscribeConfig(onStoreChange: () => void) {
  const stop = subscribeRecommendedPlans(onStoreChange);
  const onStorage = () => onStoreChange();
  window.addEventListener('storage', onStorage);
  return () => {
    stop();
    window.removeEventListener('storage', onStorage);
  };
}

function tokenAmount(value: bigint | undefined, decimals: number) {
  if (value === undefined) return null;
  return Number(formatUnits(value, decimals));
}

function readBalance(result: { status?: string; result?: unknown } | undefined, decimals: number) {
  if (result?.status !== 'success' || typeof result.result !== 'bigint') return null;
  return tokenAmount(result.result, decimals);
}


function amountText(value: number) {
  if (!Number.isFinite(value)) return '';
  return value.toLocaleString('en-US', { maximumFractionDigits: 8, useGrouping: false });
}

function tokenText(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function ageText(at: number | null) {
  if (!at) return 'unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

function moneyOrDash(value: number | null) {
  return value === null ? '—' : formatUsd(value);
}

function hfText(value: number | null) {
  return value === null ? '—' : formatHealthFactor(value);
}

function ltvText(value: number | null) {
  return value === null ? '—' : formatLtv(value);
}

function cushionText(value: number | null) {
  return value === null ? '—' : formatPercent(value, 0);
}

function PositionFacts({
  title,
  priceLabel,
  price,
  position,
}: {
  title: string;
  priceLabel: string;
  price: number | null;
  position: ProjectedRiskPosition | null;
}) {
  return (
    <section className="space-y-1">
      <p className="font-semibold">{title}</p>
      <p>{priceLabel} {moneyOrDash(price)}</p>
      <p>Debt {position ? formatUsdExact(position.debt) : '—'}</p>
      <p>Collateral {position ? tokenText(position.collateralAmount) : '—'}</p>
      <p>LTV {ltvText(position?.ltv ?? null)}</p>
      <p>HF {hfText(position?.healthFactor ?? null)}</p>
      <p>Liquidation BTC {moneyOrDash(position?.liquidationPrice ?? null)}</p>
      <p>Liquidation cushion {cushionText(position?.liquidationCushionPercent ?? null)}</p>
    </section>
  );
}

export default function RiskMonitor({
  headline,
  position,
  principal,
  accruedInterest,
  events,
  episodeKey,
  referenceBtcUsd = null,
  wrapperBtcUsd = null,
  venues,
}: {
  headline?: {
    healthFactor: number | null;
    ltv: number;
    liquidationPriceUsd: number;
  } | null;
  position: OpenPosition;
  principal: number | null;
  accruedInterest: number | null;
  events: AuditEvent[];
  episodeKey: string | null;
  referenceBtcUsd?: number | null;
  wrapperBtcUsd?: number | null;
  venues?: Venue[];
}) {
  const { address } = useAccount();
  const ratesHook = useRates();
  const allVenues = venues && venues.length > 0 ? venues : (ratesHook.payload?.venues ?? []);
  const { data: ethPriceData } = useReadContract({
    address: ETH_USD_FEED,
    abi: feedAbi,
    functionName: 'latestRoundData',
    chainId: 1,
    query: { refetchInterval: 60_000 },
  });
  const ethPriceUsd = useMemo(() => {
    const parsed = parseFeedUsd(ethPriceData as readonly [bigint, bigint, bigint, bigint, bigint] | undefined);
    return parsed > 0 ? parsed : null;
  }, [ethPriceData]);
  const { venue, snapshot } = position;
  const marketKey = alertMarketKey({
    wallet: address ?? '',
    chainId: venue.chainId,
    protocol: venue.protocol,
    marketId: protocolMarketId(venue),
  });
  const config = useSyncExternalStore(
    subscribeConfig,
    () => storedConfig(marketKey, venue.id),
    () => NO_CONFIG,
  );
  const gas = useGasCheck(venue.chainId, GAS_UNITS.write);
  const otherChain: ChainId = venue.chainId === 1 ? 8453 : 1;
  const otherCollateral = useMemo(
    () => sameAssetOnOtherChain(venue.chainId, venue.assetSymbol),
    [venue.assetSymbol, venue.chainId],
  );
  const otherUsdc = CHAINS[otherChain].usdc;
  const { data: balances, dataUpdatedAt: balancesUpdatedAt } = useReadContracts({
    contracts: address ? [
      { address: venue.loanAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: venue.chainId },
      { address: venue.assetAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: venue.chainId },
      { address: otherUsdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: otherChain },
      ...(otherCollateral ? [{ address: otherCollateral.address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as [Address], chainId: otherCollateral.chainId }] : []),
    ] : [],
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  });
  const [aprInput, setAprInput] = useState('');
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [tab, setTab] = useState<'safety' | 'rates' | 'readiness' | 'planner' | 'emergency' | 'whatif' | 'refinance' | 'market'>('safety');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [liveOverride, setLiveOverride] = useState<{
    venue: OpenPosition['venue'];
    snapshot: OpenPosition['snapshot'];
    usdc: number;
    collateral: number;
    gas: number | null;
    at: number;
    blockNumber: bigint;
  } | null>(null);
  const router = useRouter();
  const stressTabSet = useRef(false);
  const [plannerNotice, setPlannerNotice] = useState('');
  const trendId = `${(address ?? 'signed-out').toLowerCase()}:${venue.chainId}:${venue.id}`;
  const [positionSamples, setPositionSamples] = useState<TrendSample[]>([]);
  const [marketSamples, setMarketSamples] = useState<TrendSample[]>([]);
  const shownVenue = liveOverride?.venue ?? venue;
  const shownSnapshot = liveOverride?.snapshot ?? snapshot;

  const liveInput = useMemo<RiskMonitorInput>(() => ({
    wallet: address ?? '',
    protocol: shownVenue.protocol,
    chainId: shownVenue.chainId,
    marketId: protocolMarketId(shownVenue),
    collateralAsset: shownVenue.assetSymbol,
    debtAsset: shownVenue.loanSymbol,
    collateralAmount: Number(formatUnits(shownSnapshot.collateral, shownVenue.assetDecimals)),
    totalDebt: Number(formatUnits(shownSnapshot.debt, shownVenue.loanDecimals)),
    principal,
    accruedInterest,
    healthFactor: shownSnapshot.healthFactor,
    healthFactorKind: shownVenue.protocol === 'aave' || shownVenue.protocol === 'spark' ? 'native' : 'app-derived',
    liquidationThreshold: shownVenue.collateralRisk?.liquidationLtv ?? shownVenue.collateralRisk?.liquidationThreshold ?? shownVenue.maxLtv,
    currentBorrowApr: shownVenue.borrowApr,
    sourceRate: shownVenue.borrowRate?.sourceValue ?? shownVenue.borrowApr,
    rateType: shownVenue.borrowRate?.sourceRateType ?? 'APR',
    avg1h: null,
    avg6h: null,
    avg24h: shownVenue.rateHistory?.avg24h ?? null,
    avg7d: shownVenue.rateHistory?.avg7d ?? null,
    avg30d: shownVenue.rateHistory?.avg30d ?? null,
    utilization: shownVenue.utilization ?? shownVenue.liquidity?.utilization ?? null,
    availableLiquidity: availableToBorrowUsd(shownVenue),
    oraclePrice: shownVenue.priceUsd,
    fetchedAt: shownVenue.freshness?.fetchedAt ?? null,
    positionFetchedAt: liveOverride?.at ?? position.observedAt ?? null,
    oracleFetchedAt: shownSnapshot.ready ? (liveOverride?.at ?? position.observedAt ?? null) : null,
    rateFetchedAt: shownVenue.freshness?.fetchedAt ?? null,
    walletFetchedAt: liveOverride?.at ?? (balancesUpdatedAt > 0 ? balancesUpdatedAt : null),
    collateralWalletFetchedAt: liveOverride?.at ?? (balancesUpdatedAt > 0 ? balancesUpdatedAt : null),
    gasFetchedAt: liveOverride?.at ?? gas.updatedAt,
    source: shownVenue.freshness?.source ?? null,
    positionReadFailed: !shownSnapshot.ready,
    walletDebtAssetBalance: liveOverride ? liveOverride.usdc : readBalance(balances?.[0], shownVenue.loanDecimals),
    walletCollateralBalance: liveOverride ? liveOverride.collateral : readBalance(balances?.[1], shownVenue.assetDecimals),
    nativeGasBalance: liveOverride?.gas ?? (gas.balanceEth === null ? null : Number(gas.balanceEth)),
    gasRequired: gas.neededEth === null ? null : Number(gas.neededEth),
    elsewhereDebtAsset: readBalance(balances?.[2], otherUsdc.decimals),
    elsewhereCollateral: otherCollateral ? readBalance(balances?.[3], otherCollateral.decimals) : null,
    benchmarkApr: config.benchmarkApr,
    benchmarkType: config.benchmarkType,
    sourceBlock: shownVenue.freshness?.blockNumber === undefined ? undefined : BigInt(shownVenue.freshness.blockNumber),
    thresholds: config,
  }), [accruedInterest, address, balances, balancesUpdatedAt, config, gas.balanceEth, gas.neededEth, gas.updatedAt, liveOverride, otherCollateral, otherUsdc.decimals, position.observedAt, principal, shownSnapshot, shownVenue]);

  const report = useMemo(() => buildRiskMonitor(liveInput), [liveInput]);
  const plannerPosition = useMemo<PlannerPosition>(() => ({
    collateralAmount: liveInput.collateralAmount,
    debt: liveInput.totalDebt,
    oraclePrice: liveInput.oraclePrice ?? 0,
    liquidationThreshold: liveInput.liquidationThreshold,
    healthFactor: report.snapshot.position.healthFactor,
    walletDebt: report.domains.walletBalance === 'fresh' ? liveInput.walletDebtAssetBalance ?? null : null,
    walletCollateral: report.domains.collateralBalance === 'fresh' ? liveInput.walletCollateralBalance ?? null : null,
    elsewhereDebt: liveInput.elsewhereDebtAsset ?? null,
    elsewhereCollateral: liveInput.elsewhereCollateral ?? null,
  }), [liveInput, report]);
  const correction = useMemo(
    () => correctiveCards(plannerPosition, report.thresholds.preferredHealthFactor, report.domains.position === 'fresh' && report.domains.oracle === 'fresh'),
    [plannerPosition, report],
  );
  useEffect(() => {
    if (stressTabSet.current) return;
    const state = report.decision.currentState;
    if (state === 'ACT' || state === 'URGENT' || state === 'LIQUIDATION_BOUNDARY') {
      stressTabSet.current = true;
      setTab('planner');
    }
  }, [report.decision.currentState]);
  useEffect(() => {
    setPositionSamples(readTrendSamples(window.localStorage, trendId));
  }, [trendId]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rates/history?venue=${encodeURIComponent(venue.id)}&range=7d`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { points?: Array<{ t?: number; borrow?: number; utilization?: number; liquidity?: number }> } | null) => {
        if (cancelled || !body?.points) return;
        setMarketSamples(body.points.flatMap((point) => {
          if (typeof point.t !== 'number' || !Number.isFinite(point.t)) return [];
          return [{
            t: point.t > 10_000_000_000 ? point.t : point.t * 1000,
            apr: typeof point.borrow === 'number' ? point.borrow : undefined,
            utilization: typeof point.utilization === 'number' ? point.utilization : undefined,
            liquidity: typeof point.liquidity === 'number' ? point.liquidity : undefined,
          }];
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [venue.id]);
  const positionFresh = report.domains.position === 'fresh' && report.domains.oracle === 'fresh';
  const trendHf = report.snapshot.position.healthFactor;
  const trendLtv = report.snapshot.position.ltv;
  const trendCushion = report.snapshot.position.liquidationCushionPercent;
  const trendOracle = report.snapshot.market.oraclePrice;
  const trendApr = report.snapshot.market.currentBorrowApr;
  const trendUtilization = report.snapshot.market.utilization;
  const trendLiquidity = report.snapshot.market.availableLiquidity;
  useEffect(() => {
    if (!address || !positionFresh) return;
    const sample: TrendSample = {
      t: Date.now(),
      hf: trendHf ?? undefined,
      ltv: trendLtv ?? undefined,
      cushion: trendCushion ?? undefined,
      oracle: trendOracle ?? undefined,
      apr: trendApr ?? undefined,
      utilization: trendUtilization ?? undefined,
      liquidity: trendLiquidity ?? undefined,
      reference: referenceBtcUsd && referenceBtcUsd > 0 ? referenceBtcUsd : undefined,
      wrapper: wrapperBtcUsd && wrapperBtcUsd > 0 ? wrapperBtcUsd : undefined,
    };
    try {
      const next = writeTrendSample(window.localStorage, trendId, sample);
      setPositionSamples((current) => (sameTrendSamples(current, next) ? current : next));
    } catch {
      // The trend log is analysis history. A storage failure leaves the live position unchanged.
    }
  }, [address, positionFresh, referenceBtcUsd, trendApr, trendCushion, trendHf, trendId, trendLiquidity, trendLtv, trendOracle, trendUtilization, wrapperBtcUsd]);
  const rateHistory = useMemo(() => loanRateHistory(events, episodeKey ?? ''), [episodeKey, events]);
  const warning = useMemo(() => buildEarlyWarning({
    healthFactor: report.snapshot.position.healthFactor,
    ltv: report.snapshot.position.ltv,
    cushion: report.snapshot.position.liquidationCushionPercent,
    debt: liveInput.totalDebt,
    collateralAmount: liveInput.collateralAmount,
    liquidationThreshold: liveInput.liquidationThreshold,
    oraclePrice: liveInput.oraclePrice ?? null,
    borrowApr: liveInput.currentBorrowApr ?? null,
    openingApr: rateHistory.opening?.normalizedBorrowApr ?? null,
    avg1h: liveInput.avg1h,
    avg6h: liveInput.avg6h,
    avg24h: liveInput.avg24h,
    avg7d: liveInput.avg7d,
    utilization: liveInput.utilization ?? null,
    availableLiquidity: liveInput.availableLiquidity ?? null,
    referenceBtc: referenceBtcUsd,
    wrapperPrice: wrapperBtcUsd,
    samples: positionSamples,
    marketSamples,
    safetyFresh: report.domains.position === 'fresh' && report.domains.oracle === 'fresh',
    positionFreshness: report.domains.position,
    oracleFreshness: report.domains.oracle,
    rateFreshness: report.domains.borrowRate,
    marketFreshness: report.domains.liquidity,
    thresholds: report.thresholds,
  }), [liveInput, marketSamples, positionSamples, rateHistory.opening, referenceBtcUsd, report, wrapperBtcUsd]);
  const alertLabel = alertForDriver(
    warning.driver,
    readRecommendedPlans().find((plan) => plan.marketKey === marketKey)?.rules.map((rule) => ({ id: rule.id, enabled: rule.enabled })) ?? [],
  ).label;
  const rate = useMemo(
    () => buildLoanRateStatus({
      currentApr: liveInput.currentBorrowApr ?? null,
      openingApr: rateHistory.opening?.normalizedBorrowApr ?? null,
      benchmarkApr: liveInput.benchmarkApr ?? null,
      debtUsd: liveInput.totalDebt,
      lifecycleId: episodeKey,
    }),
    [episodeKey, liveInput.benchmarkApr, liveInput.currentBorrowApr, liveInput.totalDebt, rateHistory.opening],
  );
  const movement = rate.movement;
  const openingApr = rateHistory.opening?.normalizedBorrowApr ?? null;
  const scenarios = rateScenarios(liveInput.totalDebt, liveInput.currentBorrowApr ?? null, liveInput.benchmarkApr ?? null, openingApr);
  const selectedApr = aprInput.trim() === '' ? (liveInput.currentBorrowApr ?? null) : Number(aprInput) / 100;
  const aprSim = selectedApr !== null && Number.isFinite(selectedApr) && selectedApr >= 0 && selectedApr < 1
    ? simulateApr(liveInput, selectedApr)
    : null;
  const simulationView = simulation ? evaluateSimulation(simulation, liveInput) : null;

  async function refreshLive() {
    if (!address) return null;
    setRefreshing(true);
    setRefreshError('');
    try {
      const payload = await fetchFreshRates();
      const nextVenue = venueFromPayload(payload, venue);
      if (!nextVenue) throw new Error('market-missing');
      const client = publicClient(nextVenue.chainId);
      const [positionRead, usdc, collateralBalance, gasWei] = await Promise.all([
        fetchFreshPosition(nextVenue, address),
        fetchFreshTokenBalance(nextVenue.loanAddress, nextVenue.chainId, address),
        fetchFreshTokenBalance(nextVenue.assetAddress, nextVenue.chainId, address),
        client.getBalance({ address }),
      ]);
      writeFreshPosition({
        venue: nextVenue,
        user: address,
        snapshot: positionRead.snapshot,
        blockNumber: positionRead.blockNumber,
      });
      const next = {
        venue: nextVenue,
        snapshot: positionRead.snapshot,
        usdc: Number(formatUnits(usdc, nextVenue.loanDecimals)),
        collateral: Number(formatUnits(collateralBalance, nextVenue.assetDecimals)),
        gas: Number(formatUnits(gasWei, 18)),
        at: Date.now(),
        blockNumber: positionRead.blockNumber,
      };
      setLiveOverride(next);
      return next;
    } catch {
      setRefreshError('Live position, oracle, rate, or wallet data could not be refreshed.');
      return null;
    } finally {
      setRefreshing(false);
    }
  }

  async function reviewRemedy(card: PlannerCard, context: { targetHf: number; scenarioPrice: number | null; hypothetical: boolean }) {
    setPlannerNotice('');
    const fresh = await refreshLive();
    if (!fresh || !address) return;
    const freshPosition: PlannerPosition = {
      collateralAmount: Number(formatUnits(fresh.snapshot.collateral, fresh.venue.assetDecimals)),
      debt: Number(formatUnits(fresh.snapshot.debt, fresh.venue.loanDecimals)),
      oraclePrice: fresh.venue.priceUsd,
      liquidationThreshold: liveInput.liquidationThreshold,
      healthFactor: fresh.snapshot.healthFactor,
      walletDebt: fresh.usdc,
      walletCollateral: fresh.collateral,
      elsewhereDebt: liveInput.elsewhereDebtAsset ?? null,
      elsewhereCollateral: liveInput.elsewhereCollateral ?? null,
    };
    const priced = context.hypothetical && context.scenarioPrice
      ? { ...freshPosition, oraclePrice: context.scenarioPrice, healthFactor: null }
      : freshPosition;
    const next = buildPlannerCards(priced, context.targetHf).find((item) => item.type === card.type) ?? null;
    const decision = reviewDecision({ previous: card, next, hypothetical: context.hypothetical });
    if (!decision.proceed || !next) {
      setPlannerNotice(decision.message ?? DRIFT_NOTICE);
      return;
    }
    const step = next.type === 'MIXED'
      ? { ...next, type: 'REPAY' as const, label: 'Repay', collateralAmount: 0, transactionCount: 1, projected: projectCustomAction(freshPosition, next.repayAmount, 0) }
      : next;
    const handoff = buildRemedyHandoff({
      card: step,
      position: freshPosition,
      identity: { protocol: fresh.venue.protocol, chainId: fresh.venue.chainId, marketId: fresh.venue.id, wallet: address },
      targetHF: context.targetHf,
      calculatedAt: new Date().toISOString(),
      sourceBlock: fresh.blockNumber.toString(),
      scenarioOraclePrice: context.scenarioPrice ?? undefined,
      hypothetical: context.hypothetical,
      freshness: { position: 'fresh', oracle: fresh.venue.priceUsd > 0 ? 'fresh' : 'unavailable', walletBalances: 'fresh' },
      notice: decision.message,
    });
    stageRemedyHandoff(window.sessionStorage, handoff);
    appendPlannerHistory(window.sessionStorage, {
      at: handoff.calculatedAt,
      riskState: report.decision.currentState,
      healthFactor: freshPosition.healthFactor,
      oraclePrice: freshPosition.oraclePrice,
      targetHF: context.targetHf,
      repay: step.repayAmount,
      collateral: step.collateralAmount,
    });
    router.push(`/?tab=${step.type === 'ADD_COLLATERAL' ? 'borrow' : 'repay'}&market=${encodeURIComponent(fresh.venue.id)}`);
  }

  function startSimulation(mode: SimulationMode) {
    setSimulation((current) => (
      current?.mode === mode
        ? current
        : openSimulation(mode, liveInput.oraclePrice ?? null, report.thresholds.preferredHealthFactor)
    ));
  }

  return (
    <div className="rounded-lg border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-foreground">Risk monitor</p>
        <StatusBadge status={riskSeverityStatus(report.decision.currentState)} />
      </div>
      <EarlyWarningCard warning={warning} alertLabel={alertLabel} onOpenPlanner={() => setTab('planner')} />
      {report.decision.currentState === 'NO_DEBT' && <p className="mt-1 text-muted-foreground">Liquidation alerts are not active for this market.</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground">HF</p>
          <p className="font-semibold">{hfText(headline ? headline.healthFactor : report.snapshot.position.healthFactor)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">LTV</p>
          <p className="font-semibold">{ltvText(headline ? headline.ltv : report.snapshot.position.ltv)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Liquidation</p>
          <p className="font-semibold">{moneyOrDash(headline ? (headline.liquidationPriceUsd > 0 ? headline.liquidationPriceUsd : null) : report.snapshot.position.liquidationPrice)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Watch begins</p>
          <p className="font-semibold">{moneyOrDash(report.ladder.find((step) => step.severity === 'WATCH')?.oraclePrice ?? null)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Distance</p>
          <p className="font-semibold">{report.watchDeclinePercent === null ? '—' : formatPercent(report.watchDeclinePercent, 0)}</p>
        </div>
      </div>
      <div className="mt-2">
        <p className="text-muted-foreground">Borrow rate</p>
        <LoanRateStatus status={rate} />
        {rate.benchmarkApr !== null && (
          <p className="mt-1">
            <span className="text-muted-foreground">Benchmark </span>
            <span className="font-semibold">{formatApr(rate.benchmarkApr)}</span>
            {' · '}
            {benchmarkComparisonCopy(rate.currentApr, rate.benchmarkApr)}
          </p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span>Market stress</span>
        <StatusBadge status={marketStressPresentation(report.marketStress)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span>Readiness</span>
        <StatusBadge status={readinessStatus(report.readinessDecision.readinessState)} />
      </div>
      <p className="mt-1">Action · {report.decision.guidance}</p>
      <div className="mt-2 space-y-1 text-muted-foreground">
        <p>{report.overall === 'LIVE' ? '● Live data' : report.overall === 'PARTIAL' ? '● Partial · core safety data is live' : report.overall === 'STALE' ? 'Core safety data is stale' : 'A required live input is unavailable'}</p>
        <p>Live position updated: {ageText(report.snapshot.market.fetchedAt)}</p>
        <p>Oracle updated: {ageText(liveInput.oracleFetchedAt ?? null)}</p>
        <p>Rate updated: {ageText(liveInput.rateFetchedAt ?? null)}</p>
      </div>
      <button type="button" className="mt-2 rounded border px-2 py-1" disabled={refreshing || !address} onClick={() => void refreshLive()}>{refreshing ? 'Refreshing live data…' : 'Refresh live data'}</button>
      {refreshError && <p className="mt-1 text-orange-800 dark:text-orange-300">{refreshError}</p>}
      {correction.length > 0 && (
        <div className="mt-3 space-y-1 rounded border p-2 sm:hidden">
          <p className="font-semibold">{report.decision.currentState}</p>
          <p>HF {hfText(report.snapshot.position.healthFactor)} · target {formatHealthFactor(report.thresholds.preferredHealthFactor)}</p>
          {correction.filter((item) => item.type !== 'MIXED').map((item) => (
            <p key={item.type}>{item.type === 'REPAY' ? `Repay ${formatUsdExact(item.repayAmount)} ${venue.loanSymbol}` : `Add ${item.collateralAmount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${venue.assetSymbol}`} · {item.feasibility === 'AVAILABLE' ? 'AVAILABLE' : item.feasibility === 'PARTIALLY_AVAILABLE' ? 'PARTIAL' : item.feasibility === 'UNKNOWN' ? 'UNKNOWN' : 'NOT AVAILABLE'}</p>
          ))}
          <button type="button" className="rounded border px-2 py-1" onClick={() => setTab('planner')}>Open action planner</button>
        </div>
      )}
      <div className="mt-3 flex gap-1 overflow-x-auto pb-1" role="tablist">
        {([
          ['safety', 'Safety'],
          ['rates', 'Rates'],
          ['readiness', 'Readiness'],
          ['planner', 'Action Planner'],
          ['emergency', 'Emergency Actions'],
          ['whatif', 'What If'],
          ['refinance', 'Refinance'],
          ['market', 'Market'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`shrink-0 rounded border px-2 py-1 ${tab === id ? 'border-foreground font-semibold' : 'text-muted-foreground'}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'whatif' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="rounded border px-2 py-1" onClick={() => startSimulation('repay')}>Simulate repayment</button>
          <button type="button" className="rounded border px-2 py-1" onClick={() => startSimulation('collateral')}>Simulate collateral addition</button>
        </div>
      )}
      {tab === 'whatif' && simulation && simulationView && (
        <div className="mt-2 space-y-2 rounded border px-2 py-2">
          <p className="font-semibold">SIMULATION — NO TRANSACTION WILL BE SENT</p>
          <p className="text-muted-foreground">This uses a copy of the live position. The loan, alerts, and wallet are unchanged.</p>
          <label className="block">Scenario BTC price
            <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={simulation.scenarioPrice} onChange={(event) => setSimulation({ ...simulation, scenarioPrice: event.target.value })} />
          </label>
          <p className="text-muted-foreground">Changing the scenario BTC price does not change the liquidation price. Repayment and added collateral do.</p>
          <label className="block">{simulation.mode === 'repay' ? `Repayment amount (${venue.loanSymbol})` : `Additional collateral (${venue.assetSymbol})`}
            <input
              className="mt-1 h-8 w-full rounded border bg-background px-2"
              inputMode="decimal"
              value={simulation.preset === 'custom' ? simulation.amount : amountText(simulationView.actionAmount)}
              onChange={(event) => setSimulation({ ...simulation, preset: 'custom', amount: event.target.value })}
            />
          </label>
          <label className="block">Target HF
            <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={simulation.targetHf} onChange={(event) => setSimulation({ ...simulation, targetHf: event.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'restore', amount: '' })}>Restore preferred HF</button>
            {simulation.mode === 'repay' ? (
              <>
                <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'debt-10', amount: '' })}>10% of debt</button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'debt-25', amount: '' })}>25% of debt</button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'debt-50', amount: '' })}>50% of debt</button>
              </>
            ) : (
              <>
                <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'coll-0.05', amount: '' })}>0.05 {venue.assetSymbol}</button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'coll-0.10', amount: '' })}>0.10 {venue.assetSymbol}</button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'coll-0.25', amount: '' })}>0.25 {venue.assetSymbol}</button>
              </>
            )}
            <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation({ ...simulation, preset: 'custom' })}>Custom</button>
          </div>
          <PositionFacts title="Scenario before action" priceLabel="BTC/oracle price" price={simulationView.scenarioPrice} position={simulationView.before} />
          <section>
            <p className="font-semibold">{simulation.mode === 'repay' ? 'Proposed repayment' : 'Proposed collateral addition'}</p>
            <p>{simulation.mode === 'repay' ? `Repay ${amountText(simulationView.actionAmount)} ${venue.loanSymbol}` : `Add ${amountText(simulationView.actionAmount)} ${venue.assetSymbol}`}</p>
          </section>
          <PositionFacts title="Projected after action" priceLabel="BTC/oracle price" price={simulationView.scenarioPrice} position={simulationView.after} />
          <section className="space-y-1">
            <p>{simulation.mode === 'repay' ? venue.loanSymbol : venue.assetSymbol} currently available on {chainLabel(venue.chainId)}: {simulationView.available === null ? 'not loaded' : simulation.mode === 'repay' ? formatUsdExact(simulationView.available) : tokenText(simulationView.available)}</p>
            <p>Amount required: {simulation.mode === 'repay' ? formatUsdExact(simulationView.actionAmount) : tokenText(simulationView.actionAmount)}</p>
            <p>{simulationView.shortfall === null ? 'Shortfall not loaded' : simulationView.shortfall > 0 ? `Shortfall ${simulation.mode === 'repay' ? formatUsdExact(simulationView.shortfall) : tokenText(simulationView.shortfall)}` : `Surplus ${simulation.mode === 'repay' ? formatUsdExact(simulationView.surplus ?? 0) : tokenText(simulationView.surplus ?? 0)}`}</p>
            <StatusBadge status={feasibilityStatus(simulationView.feasibility)} />
            {simulationView.elsewhere !== null && simulationView.elsewhere > 0 && (
              <p>Available elsewhere — transfer/bridge required. {simulation.mode === 'repay' ? formatUsdExact(simulationView.elsewhere) : tokenText(simulationView.elsewhere)} on {chainLabel(otherChain)}.</p>
            )}
          </section>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation(resetSimulation(simulation, liveInput.oraclePrice ?? null, report.thresholds.preferredHealthFactor))}>Reset to live position</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => setSimulation(null)}>Close simulation</button>
          </div>
        </div>
      )}
      <div className="mt-2 space-y-3">
          <section className={tab === 'market' ? 'space-y-1' : 'hidden'}>
            <p className="font-semibold">Market data</p>
            <p className="text-muted-foreground">{report.snapshot.market.source ?? 'Market data'}</p>
            <p>BTC/oracle {report.snapshot.market.oraclePrice === null ? '—' : formatUsd(report.snapshot.market.oraclePrice)}</p>
            {report.domains.borrowRate !== 'fresh' && <p>Current borrow rate is not fresh.</p>}
            {report.domains.rateHistory === 'unavailable' && <p>24h and 7d rate history are unavailable. The current APR is unaffected.</p>}
          </section>
          <section className={tab === 'safety' ? 'space-y-2' : 'hidden'}>
            <StatusBadge status={riskSeverityStatus(report.decision.currentState)} />
            <p>{report.decision.guidance}</p>
            <p>HF {hfText(report.snapshot.position.healthFactor)} · Preferred minimum {formatHealthFactor(report.thresholds.preferredHealthFactor)}</p>
            {report.decision.nextRiskState && report.decision.nextHf !== null && (
              <div>
                <p className="font-semibold">Next boundary</p>
                <p>{report.decision.nextRiskState} at HF {formatHealthFactor(report.decision.nextHf)}</p>
                <p>BTC distance {report.decision.distanceToNextState === null ? 'unavailable' : formatPercent(report.decision.distanceToNextState, 0)}</p>
                <p>The position reaches {report.decision.nextRiskState} at BTC {report.decision.nextBtcPrice === null ? 'unavailable' : formatUsd(report.decision.nextBtcPrice)}.</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span>HF trend</span>
              <span>{warning.hfDirection ?? 'unavailable'}</span>
              <span>{warning.snapshot.position.hfChange24h === undefined ? '24h unavailable' : `${warning.snapshot.position.hfChange24h > 0 ? '+' : ''}${warning.snapshot.position.hfChange24h.toFixed(2)} over 24h`}</span>
            </div>
            {warning.pace.shown && warning.pace.text && <p>{warning.pace.label}: {warning.pace.text}. {warning.pace.disclaimer}</p>}
            <details>
              <summary className="cursor-pointer">View all thresholds</summary>
              <div className="mt-2 space-y-1">
                {report.ladder.map((step) => (
                  <div key={step.severity} className="space-y-0.5">
                    <StatusBadge status={riskSeverityStatus(step.severity)} />
                    <p className="pl-4 text-foreground">
                      HF {formatHealthFactor(step.healthFactor)}
                      {' · '}BTC {step.oraclePrice === null ? '—' : formatUsd(step.oraclePrice)}
                      {step.priceDeclinePercent !== null && ` · ${formatPercent(step.priceDeclinePercent, 0)} from the current oracle`}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </section>
          <section className={tab === 'rates' ? 'space-y-1' : 'hidden'}>
            <p className="font-semibold">Borrow-rate health</p>
            <LoanRateStatus status={rate} />
            <p>{report.domains.borrowRate === 'fresh' ? 'Current APR is fresh.' : 'Current APR is not fresh.'}</p>
            <p>{movementSentence(movement)}</p>
            {movement.annualDifference !== null && (
              <p>Annualized impact at current debt {movement.annualDifference >= 0 ? '+' : '-'}{formatUsdExact(Math.abs(movement.annualDifference))}/yr · {movement.monthlyDifference !== null && movement.monthlyDifference >= 0 ? '+' : '-'}{formatUsdExact(Math.abs(movement.monthlyDifference ?? 0))}/mo. This is not guaranteed future interest.</p>
            )}
            {rateHistory.latestBorrow && (
              <p>APR at most recent borrow {formatApr(rateHistory.latestBorrow.normalizedBorrowApr)}. The opening APR is unchanged.</p>
            )}
            <p>
              24h average {report.snapshot.market.avg24h === null ? 'unavailable' : formatApr(report.snapshot.market.avg24h)}
              {' · '}7d average {report.snapshot.market.avg7d === null ? 'unavailable' : formatApr(report.snapshot.market.avg7d)}
              {report.snapshot.market.avg30d !== null && ` · 30d average ${formatApr(report.snapshot.market.avg30d)}`}
            </p>
            <RateTrendDetail warning={warning} />
            <div className="flex flex-wrap items-center gap-1">
              <span>Versus financing benchmark</span>
              <StatusBadge status={benchmarkStatus(report.rateStatus)} />
            </div>
            <p>{benchmarkComparisonCopy(movement.currentApr, report.snapshot.benchmark.benchmarkApr)}</p>
            {report.snapshot.market.sourceRate !== null && (
              <p className="text-muted-foreground">Source rate {formatApr(report.snapshot.market.sourceRate)} {report.snapshot.market.rateType ?? ''}. Comparisons use normalized APR.</p>
            )}
            <RateChart venue={venue} />
          </section>
          <section className={tab === 'market' ? '' : 'hidden'}>
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-semibold">Market stress</span>
              <StatusBadge status={marketStressPresentation(report.marketStress)} />
            </div>
            <MarketIntelligence warning={warning} />
          </section>
          <section className={tab === 'readiness' ? 'space-y-2' : 'hidden'}>
            <p className="font-semibold">Current situation</p>
            <StatusBadge status={riskSeverityStatus(report.readinessDecision.currentSafetyState)} />
            <p>{report.readinessDecision.explanation}</p>
            <p className="text-muted-foreground">Position safety and emergency readiness are different. A healthy loan can still be only partly prepared if this wallet cannot restore the preferred health factor during stress.</p>
            <p className="font-semibold">Contingency readiness</p>
            <p>If the position reaches PREPARE (HF {formatHealthFactor(report.thresholds.prepare)}):</p>
            <p>To restore preferred HF {formatHealthFactor(report.thresholds.preferredHealthFactor)}: repay {report.readinessDecision.repayNeededAtScenario === null ? '—' : `${formatUsdExact(report.readinessDecision.repayNeededAtScenario)} ${venue.loanSymbol}`} or add {report.readinessDecision.collateralNeededAtScenario === null ? '—' : `${tokenText(report.readinessDecision.collateralNeededAtScenario)} ${venue.assetSymbol}`}</p>
            <p>Available immediately on {chainLabel(venue.chainId)}: {report.readinessDecision.availableUSDC === null ? 'USDC unknown' : formatUsdExact(report.readinessDecision.availableUSDC)} · {report.readinessDecision.availableCollateral === null ? 'collateral unknown' : `${tokenText(report.readinessDecision.availableCollateral)} ${venue.assetSymbol}`}</p>
            <StatusBadge status={readinessStatus(report.readinessDecision.readinessState)} />
            <details>
              <summary className="cursor-pointer">View additional stress levels</summary>
              <div className="mt-2 space-y-2">
                {report.stress.filter((level) => level.severity !== 'PREPARE').map((level) => (
                  <div key={level.severity}>
                    <div className="flex flex-wrap items-center gap-1">
                      <span>Readiness at</span>
                      <StatusBadge status={riskSeverityStatus(level.severity)} />
                      <span>/ HF {formatHealthFactor(level.stressHf)}</span>
                    </div>
                    <p>Repayment required to restore {formatHealthFactor(level.targetHf)}: {level.repayRequired === null ? '—' : `${formatUsdExact(level.repayRequired)} ${venue.loanSymbol}`}</p>
                    <p>Or collateral required: {level.collateralRequired === null ? '—' : `${tokenText(level.collateralRequired)} ${venue.assetSymbol}`}</p>
                    <StatusBadge status={readinessStatus(level.status)} />
                  </div>
                ))}
              </div>
            </details>
            <p>Gas {shortEth(gas.balanceEth)} · needed about {shortEth(gas.neededEth)}</p>
            {(report.snapshot.resources.elsewhereDebtAsset || report.snapshot.resources.elsewhereCollateral) && (
              <p>Available elsewhere — transfer/bridge required. {otherUsdc.symbol} {report.snapshot.resources.elsewhereDebtAsset ?? 0} · collateral {report.snapshot.resources.elsewhereCollateral ?? 0} on {chainLabel(otherChain)}.</p>
            )}
          </section>
          <section className={tab === 'planner' ? '' : 'hidden'}>
            <ActionPlanner
              report={report}
              position={plannerPosition}
              debtSymbol={venue.loanSymbol}
              collateralSymbol={venue.assetSymbol}
              chainName={chainLabel(venue.chainId)}
              refreshing={refreshing}
              notice={plannerNotice}
              primaryDriver={warning.driver}
              onReview={(card, context) => void reviewRemedy(card, context)}
            />
          </section>
          <section className={tab === 'emergency' ? '' : 'hidden'}>
            <EmergencyConsole
              report={report}
              input={liveInput}
              walletResources={{
                debtAssetAvailable: liveInput.walletDebtAssetBalance ?? null,
                collateralAvailable: liveInput.walletCollateralBalance ?? null,
                nativeGasAvailable: liveInput.nativeGasBalance ?? null,
                gasRequired: liveInput.gasRequired ?? null,
                debtAssetAllowance: null, // to be estimated later
                collateralAllowance: null, // to be estimated later
              }}
              networkContext={{ chainId: venue.chainId, marketId: venue.id, gasPriceWei: undefined }}
              warning={warning}
            />
          </section>
          <section className={tab === 'whatif' ? 'space-y-2' : 'hidden'}>
            <p className="font-semibold">What-if simulator</p>
            <p className="text-muted-foreground">Scenario APR does not change HF or LTV. Scenarios, not forecasts.</p>
            <label className="block">Scenario APR %
              <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={aprInput} placeholder={liveInput.currentBorrowApr == null ? '' : String(liveInput.currentBorrowApr * 100)} onChange={(event) => setAprInput(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              {scenarios.map((row) => (
                <button key={row.label} type="button" className="rounded border px-2 py-1" onClick={() => setAprInput(String(row.apr * 100))}>{row.label}</button>
              ))}
              {openingApr === null && (
                <button type="button" className="rounded border px-2 py-1" disabled>Opening APR not captured</button>
              )}
            </div>
            {aprSim && selectedApr !== null && (
              <div className="space-y-1">
                <p>
                  At {formatApr(selectedApr)}: {formatUsdExact(aprSim.monthlyInterest ?? 0)}/mo · {formatUsdExact(aprSim.annualInterest ?? 0)}/yr.
                  {' '}HF stays {hfText(aprSim.snapshot.position.healthFactor)}.
                </p>
                <AprChangeLine status={buildLoanRateStatus({ currentApr: selectedApr, openingApr, debtUsd: liveInput.totalDebt, benchmarkApr: liveInput.benchmarkApr })} />
                <p>Versus financing benchmark: {benchmarkComparisonCopy(selectedApr, liveInput.benchmarkApr ?? null)}</p>
              </div>
            )}
            <div className="space-y-1">
              {scenarios.map((row) => (
                <p key={row.label}>{row.label} {formatApr(row.apr)} · {formatUsdExact(row.monthlyInterest)}/mo · {formatUsdExact(row.annualInterest)}/yr · vs benchmark {row.spreadToBenchmark === null ? '—' : formatApr(row.spreadToBenchmark)} · vs opening {row.differenceVsOpening === null ? '—' : formatApr(row.differenceVsOpening)}</p>
              ))}
            </div>
          </section>
          <section className={tab === 'refinance' ? '' : 'hidden'}>
            <RefinancePanel
              sourceVenue={shownVenue}
              allVenues={allVenues}
              debt={liveInput.totalDebt}
              collateralAmount={liveInput.collateralAmount}
              oraclePrice={liveInput.oraclePrice ?? 0}
              liquidationThreshold={liveInput.liquidationThreshold}
              currentApr={liveInput.currentBorrowApr ?? 0}
              openingApr={openingApr}
              healthFactor={report.snapshot.position.healthFactor}
              ltv={report.snapshot.position.ltv}
              liquidationPrice={report.snapshot.position.liquidationPrice}
              liquidationCushion={report.snapshot.position.liquidationCushionPercent}
              benchmarkApr={liveInput.benchmarkApr}
              gasPriceWei={gas.feePerGas}
              ethPriceUsd={ethPriceUsd}
              sourceFreshness={report.domains.position === 'fresh' && report.domains.oracle === 'fresh' ? 'fresh' : 'stale'}
            />
          </section>
      </div>
    </div>
  );
}
