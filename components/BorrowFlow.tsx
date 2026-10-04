'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import UsdAmountField from '@/components/UsdAmountField';
import WrongNetworkActions from '@/components/WrongNetworkActions';
import GasNotice from '@/components/GasNotice';
import FeeBreakdown from '@/components/FeeBreakdown';
import CoinbaseTransferButton from '@/components/CoinbaseTransferButton';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { useFreshTokenBalance, usePosition } from '@/components/usePosition';
import { adapterFor, approveCall } from '@/lib/adapters';
import { erc20Abi } from '@/lib/abi';
import { approvalStep, formatToken, formatUsd, formatUsdExact, parseAmount, tokenAmountUsd, tokenPriceUsd } from '@/lib/amount';
import {
  formatCushionOrNone,
  formatHealthFactorOrNone,
  formatLiquidationOrNone,
  formatLtv,
  formatLtvOrNone,
  formatTokenAmount,
  healthFactorLabel,
} from '@/lib/finance/format';
import {
  buildProposedPositionChange,
  canRequestWallet,
  serializePositionSnapshot,
  type ExecutionIntent,
  type PositionChangeAction,
} from '@/lib/finance/positionChange';
import { projectAfterTransaction, tokenShortfall } from '@/lib/finance/projection';
import { tokenUnits, type RemedyHandoff } from '@/lib/finance/actionPlanner';
import { ABOVE_TARGET_MESSAGE, positiveRawDelta } from '@/lib/finance/transactionDraft';
import {
  CONFIRM_DRIFT_MESSAGE,
  CONFIRM_FAIL_MESSAGE,
  buildConfirmSnapshot,
  requestWalletAfterConfirm,
  runConfirmGuard,
  type ConfirmLock,
  type ConfirmSnapshot,
  type DriftChange,
} from '@/lib/finance/confirmSafety';
import { fetchFreshConfirmReads, snapshotFromFreshReads, withConfirmTimeout } from '@/lib/finance/fetchConfirm';
import { publicClient } from '@/lib/rpc';
import { buildLoanReadiness, isMaterialTransaction } from '@/lib/finance/readiness';
import PositionChangeReview from '@/components/PositionChangeReview';
import LoanReadinessReview from '@/components/LoanReadinessReview';
import { useFeeEstimate } from './useNetworkFee';
import {
  chainLabel,
  isChainId,
  isVenueSafe,
  sameAssetOnOtherChain,
  protocolLabel,
  venueConfidence,
  venueOnChain,
  venueSpender,
  type Venue,
} from '@/lib/protocol';
import { useSendTx } from './useSendTx';

const RATE_MAX_AGE_MS = 3 * 60_000;

export default function BorrowFlow({
  quote,
  fetchedAt,
  venues = [],
  onSelect,
  initialCollateral,
  initialBorrowUsd,
  handoff = null,
  onAssistedSubmitted,
  onAssistedComplete,
}: {
  quote: Venue | null;
  fetchedAt: number;
  venues?: Venue[];
  onSelect?: (id: string) => void;
  initialCollateral?: number;
  initialBorrowUsd?: number;
  handoff?: RemedyHandoff | null;
  onAssistedSubmitted?: (hash: string) => void;
  onAssistedComplete?: () => void;
}) {
  const { address, chain, isConnected } = useAccount();
  const [supplyAmount, setSupplyAmount] = useState<bigint | null>(null);
  const [borrowAmount, setBorrowAmount] = useState<bigint | null>(null);
  const [supplyEpoch, setSupplyEpoch] = useState(0);
  const [borrowEpoch, setBorrowEpoch] = useState(0);
  const [drop, setDrop] = useState(0);
  const { send, isBusy, isAwaitingWallet, confirmed, hash, phase, receiptBlock, statusMessage, retryPositionRefresh, cancelPending } = useSendTx();
  const [reviewAction, setReviewAction] = useState<PositionChangeAction | null>(null);
  const [runAfterApproval, setRunAfterApproval] = useState(false);
  const [intent, setIntent] = useState<ExecutionIntent>('modify-current');
  const [planningLoaded, setPlanningLoaded] = useState(false);
  const [supplySeed, setSupplySeed] = useState<bigint | null>(null);
  const [borrowSeed, setBorrowSeed] = useState<bigint | null>(null);
  const [supplySeedKey, setSupplySeedKey] = useState(0);
  const [borrowSeedKey, setBorrowSeedKey] = useState(0);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readinessAcked, setReadinessAcked] = useState(false);
  const [confirmVenue, setConfirmVenue] = useState<Venue | null>(null);
  const [confirmCollateral, setConfirmCollateral] = useState<bigint | null>(null);
  const [confirmDebt, setConfirmDebt] = useState<bigint | null>(null);
  const [confirmBalance, setConfirmBalance] = useState<bigint | null>(null);
  const [confirmBorrowRoom, setConfirmBorrowRoom] = useState<bigint | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [handoffNotice, setHandoffNotice] = useState('');
  const appliedHandoff = useRef(false);
  const assistedSubmittedHash = useRef('');
  const assistedCompleteNonce = useRef(0);
  const [driftChanges, setDriftChanges] = useState<DriftChange[]>([]);
  const confirmLock = useRef<ConfirmLock>({ busy: false });
  const reviewedSnapRef = useRef<ConfirmSnapshot | null>(null);
  const execVenueRef = useRef<Venue | null>(null);
  const lastFreshReadsRef = useRef<Awaited<ReturnType<typeof fetchFreshConfirmReads>> | null>(null);
  const reviewRef = useRef<ReturnType<typeof buildProposedPositionChange> | null>(null);
  const continueRef = useRef<(action: string) => void>(() => {});
  const supplyFee = useFeeEstimate(quote?.chainId, 'supply');
  const borrowFee = useFeeEstimate(quote?.chainId, 'borrow');

  const safe = quote !== null && isVenueSafe(quote) && quote.action === 'borrow';
  const spender = safe && quote ? venueSpender(quote) : null;
  const enabled = Boolean(address && safe);
  const gas = useGasCheck(quote?.chainId, GAS_UNITS.write);
  const marketChainId = quote?.chainId;
  const otherAsset = quote ? sameAssetOnOtherChain(quote.chainId, quote.assetSymbol) : null;
  const { snapshot, refetch: refetchPosition } = usePosition(safe ? quote : null, address, enabled);
  const freshAssetBalance = useFreshTokenBalance(quote?.assetAddress, quote?.chainId, address);

  const { data: balance, isError: balanceError, refetch: refetchBalance } = useReadContract({
    address: quote?.assetAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 20_000 },
  });
  const { data: otherBalance, refetch: refetchOther } = useReadContract({
    address: otherAsset?.address,
    chainId: otherAsset?.chainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address && otherAsset ? [address] : undefined,
    query: { enabled: Boolean(enabled && otherAsset), refetchInterval: 20_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: quote?.assetAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: Boolean(enabled && spender), refetchInterval: 20_000 },
  });
  function refetchAll() {
    void refetchBalance();
    void refetchOther();
    void refetchAllowance();
    void refetchPosition();
  }

  useEffect(() => {
    if (!confirmed) return;
    if (confirmed.snapshot) {
      setConfirmCollateral(confirmed.snapshot.collateral);
      setConfirmDebt(confirmed.snapshot.debt);
      setConfirmBorrowRoom(confirmed.snapshot.borrowRoom);
    }
    if (confirmed.refreshFailed) return;
    if (confirmed.action === 'reset' && runAfterApproval && reviewAction) {
      return;
    }
    if (confirmed.action === 'approve' && runAfterApproval && reviewAction) {
      return;
    }
    if (confirmed.action === 'supply') {
      setSupplyAmount(null);
      setSupplyEpoch((value) => value + 1);
      if (reviewAction === 'SUPPLY_COLLATERAL') {
        setReviewAction(null);
        setRunAfterApproval(false);
      }
    }
    if (confirmed.action === 'borrow') {
      setBorrowAmount(null);
      setBorrowEpoch((value) => value + 1);
      if (reviewAction === 'BORROW') {
        setReviewAction(null);
        setRunAfterApproval(false);
      }
    }
    refetchAll();
    // refetch identities change every render; the confirmation nonce is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed]);

  useEffect(() => {
    if (!confirmed || !runAfterApproval) return;
    continueRef.current(confirmed.action);
  }, [confirmed, runAfterApproval]);

  useEffect(() => {
    if (!handoff || handoff.type !== 'ADD_COLLATERAL' || !onAssistedSubmitted || !hash || assistedSubmittedHash.current === hash) return;
    assistedSubmittedHash.current = hash;
    onAssistedSubmitted(hash);
  }, [handoff, hash, onAssistedSubmitted]);

  useEffect(() => {
    if (!handoff || handoff.type !== 'ADD_COLLATERAL' || !onAssistedComplete || !confirmed || confirmed.refreshFailed || confirmed.action !== 'supply' || !confirmed.snapshot) return;
    if (assistedCompleteNonce.current === confirmed.nonce) return;
    assistedCompleteNonce.current = confirmed.nonce;
    onAssistedComplete();
  }, [confirmed, handoff, onAssistedComplete]);

  useEffect(() => {
    if (appliedHandoff.current || !handoff || !quote || handoff.type !== 'ADD_COLLATERAL' || handoff.marketId !== quote.id) return;
    if (!(handoff.collateralAmount && handoff.collateralAmount > 0)) return;
    const units = tokenUnits(handoff.collateralAmount, quote.assetDecimals);
    appliedHandoff.current = true;
    setSupplySeed(units);
    setSupplySeedKey(1);
    setSupplyAmount(units);
    setReviewAction('SUPPLY_COLLATERAL');
    reviewedSnapRef.current = null;
    if (handoff.notice) setHandoffNotice(handoff.notice);
  }, [handoff, quote]);


  if (!quote || !safe || !spender) {
    return <p className="text-sm text-muted-foreground">Choose a borrow market above to continue.</p>;
  }

  const hasExistingPosition = snapshot.collateral > 0n || snapshot.debt > 0n;
  const hasPlanningPins = Boolean((initialCollateral && initialCollateral > 0) || (initialBorrowUsd && initialBorrowUsd > 0));

  const walletBalance = freshAssetBalance ?? confirmBalance ?? balance ?? 0n;
  const currentAllowance = allowance ?? 0n;
  const reviewVenue = confirmVenue ?? quote;
  const price = tokenPriceUsd(reviewVenue.assetSymbol, reviewVenue.priceUsd);
  const existingCollateral = confirmCollateral ?? snapshot.collateral;
  const existingDebt = confirmDebt ?? snapshot.debt;
  const targetCollateralRaw = initialCollateral && initialCollateral > 0
    ? parseAmount(initialCollateral.toFixed(quote.assetDecimals), quote.assetDecimals) ?? 0n
    : 0n;
  const targetDebtRaw = initialBorrowUsd && initialBorrowUsd > 0
    ? parseAmount(initialBorrowUsd.toFixed(quote.loanDecimals), quote.loanDecimals) ?? 0n
    : 0n;
  const collateralGap = positiveRawDelta(targetCollateralRaw, existingCollateral);
  const borrowGap = positiveRawDelta(targetDebtRaw, existingDebt);
  const planningAboveTarget = (targetCollateralRaw > 0n && existingCollateral > targetCollateralRaw)
    || (targetDebtRaw > 0n && existingDebt > targetDebtRaw);
  const borrowRoom = confirmBorrowRoom ?? snapshot.borrowRoom;
  const stale = Date.now() - fetchedAt > RATE_MAX_AGE_MS;
  const wrongChain = isConnected && chain?.id !== quote.chainId;
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isChainId(connectedChainId) ? connectedChainId : null;
  const alternate = wrongChain && walletChainId ? venueOnChain(venues, quote, walletChainId) : null;
  const marketMissing = false;
  const oracleReady = snapshot.ready;
  const supplyTooBig = supplyAmount !== null && supplyAmount > walletBalance;
  const minBorrow = snapshot.extra?.minBorrow ?? 0n;
  const belowMin = borrowAmount !== null && minBorrow > 0n && borrowAmount < minBorrow;
  const borrowTooBig = borrowAmount !== null && borrowAmount > borrowRoom;
  const step = approvalStep(currentAllowance, supplyAmount ?? 0n);
  const pendingSupply = supplyAmount !== null && supplyAmount > 0n;
  const needsEnter = quote.protocol === 'moonwell' && snapshot.extra?.enteredMarket === false && existingCollateral > 0n;

  const confidence = venueConfidence(quote);
  const collateralTokens = Number(formatUnits(existingCollateral, quote.assetDecimals));
  const collateralUsd = tokenAmountUsd(existingCollateral, quote.assetDecimals, price);
  const supplyUsd = supplyAmount && supplyAmount > 0n ? tokenAmountUsd(supplyAmount, quote.assetDecimals, price) : null;
  const estimatedBorrowUsd = supplyUsd !== null ? supplyUsd * quote.maxLtv * 0.9 : null;
  const debtUsd = Number(formatUnits(existingDebt, quote.loanDecimals));
  const proposedSupply = supplyAmount && supplyAmount > 0n ? Number(formatUnits(supplyAmount, quote.assetDecimals)) : 0;
  const proposedBorrow = borrowAmount && borrowAmount > 0n ? Number(formatUnits(borrowAmount, quote.loanDecimals)) : 0;
  const hasProposal = proposedSupply > 0 || proposedBorrow > 0;
  const { current, projected } = projectAfterTransaction({
    venue: reviewVenue,
    priceUsd: reviewVenue.priceUsd,
    currentCollateralAmount: collateralTokens,
    currentDebtUsd: debtUsd,
    supplyAmount: proposedSupply,
    borrowUsd: proposedBorrow,
  });
  const requiredSupply = proposedSupply;
  const availableTokens = Number(formatUnits(walletBalance, quote.assetDecimals));
  const shortfall = tokenShortfall(requiredSupply, availableTokens);
  const displayPosition = hasProposal ? projected : current;
  const liquidationPrice = displayPosition.liquidationPrice ?? snapshot.liquidationPrice;
  const simulatedPrice = quote.priceUsd * (1 - drop / 100);
  const simCollateral = displayPosition.collateralAmount;
  const simDebt = displayPosition.debtUsd;
  const simulatedLtv = simCollateral > 0 && simulatedPrice > 0 ? (simDebt / (simCollateral * simulatedPrice)) * 100 : 0;

  const pendingReview = reviewAction
    ? buildProposedPositionChange({
      action: reviewAction,
      venue: reviewVenue,
      amount: reviewAction === 'SUPPLY_COLLATERAL' ? (supplyAmount ?? 0n) : (borrowAmount ?? 0n),
      currentCollateral: existingCollateral,
      currentDebt: existingDebt,
      spendableBalance: walletBalance,
      priceUsd: reviewVenue.priceUsd,
      wrongNetwork: wrongChain,
      approvalNeeded: reviewAction === 'SUPPLY_COLLATERAL' && (step === 'approve' || step === 'reset'),
      resetNeeded: reviewAction === 'SUPPLY_COLLATERAL' && step === 'reset',
      needsEnterMarket: reviewAction === 'BORROW' && needsEnter,
      borrowRoom,
      minBorrow,
      estimatedNetworkFeeUsd: (reviewAction === 'SUPPLY_COLLATERAL' ? supplyFee.usd : borrowFee.usd) ?? undefined,
      fetchedAt: reviewVenue.freshness?.fetchedAt ?? fetchedAt,
      executionIntent: planningLoaded ? 'planning-scenario' : 'modify-current',
    })
    : null;
  reviewRef.current = pendingReview;
  if (pendingReview && reviewAction && !reviewedSnapRef.current) {
    reviewedSnapRef.current = buildConfirmSnapshot({
      action: reviewAction,
      venue: reviewVenue,
      change: pendingReview,
      currentCollateral: existingCollateral,
      currentDebt: existingDebt,
      walletBalance,
      plannedAmount: reviewAction === 'SUPPLY_COLLATERAL' ? (supplyAmount ?? 0n) : (borrowAmount ?? 0n),
      fetchedAt: reviewVenue.freshness?.fetchedAt ?? fetchedAt,
    });
  }

  function ledger(amount: bigint, amountKind: 'loan' | 'asset' = 'asset') {
    const preview = reviewRef.current;
    return {
      wallet: address!,
      venue: quote!,
      amount,
      amountUsd: tokenAmountUsd(amount, amountKind === 'loan' ? quote!.loanDecimals : quote!.assetDecimals, amountKind === 'loan' ? 1 : price),
      amountKind,
      debt: snapshot.debt,
      collateral: snapshot.collateral,
      healthFactor: snapshot.healthFactor,
      shares: snapshot.extra?.shares,
      previewCurrent: preview ? serializePositionSnapshot(preview.current) : undefined,
      previewProjected: preview ? serializePositionSnapshot(preview.projected) : undefined,
      previewAt: preview ? Date.now() : undefined,
      positionVenue: quote ?? undefined,
      user: address,
    };
  }

  function executionVenue() {
    return execVenueRef.current ?? confirmVenue ?? quote!;
  }

  async function approve(amount: bigint) {
    const market = executionVenue();
    await send(amount === 0n ? 'reset' : 'approve', approveCall(market, spender!, amount), ledger(amount));
  }

  async function supply() {
    if (!address || !supplyAmount || supplyAmount <= 0n) return;
    const change = reviewRef.current;
    if (change && !canRequestWallet(change)) return;
    const market = executionVenue();
    const call = adapterFor(market).buildSupply(market, address, supplyAmount, 'borrow');
    if (call) await send('supply', call, ledger(supplyAmount));
  }

  async function borrow() {
    if (!address || !borrowAmount || borrowAmount <= 0n || borrowAmount > borrowRoom) return;
    const change = reviewRef.current;
    if (change && !canRequestWallet(change)) return;
    const market = executionVenue();
    const adapter = adapterFor(market);
    if (needsEnter && adapter.buildEnterMarket) {
      const enter = adapter.buildEnterMarket(market);
      if (enter) await send('supply', enter, ledger(0n));
      return;
    }
    const call = adapter.buildBorrow(market, address, borrowAmount);
    if (call) await send('borrow', call, ledger(borrowAmount, 'loan'));
  }

  async function executeReviewedAction() {
    if (reviewAction === 'SUPPLY_COLLATERAL') await supply();
    if (reviewAction === 'BORROW') await borrow();
  }

  async function confirmReview() {
    const change = reviewRef.current;
    const market = reviewVenue;
    if (!change || !market || !address || !reviewAction || !canRequestWallet(change)) return;
    setConfirmError('');
    const reviewed = reviewedSnapRef.current ?? buildConfirmSnapshot({
      action: reviewAction,
      venue: market,
      change,
      currentCollateral: existingCollateral,
      currentDebt: existingDebt,
      walletBalance,
      plannedAmount: reviewAction === 'SUPPLY_COLLATERAL' ? (supplyAmount ?? 0n) : (borrowAmount ?? 0n),
      fetchedAt: market.freshness?.fetchedAt ?? fetchedAt,
    });
    const decision = await runConfirmGuard({
      reviewed,
      lock: confirmLock.current,
      loadFresh: async () => {
        const reads = await withConfirmTimeout(fetchFreshConfirmReads({
          venue: market,
          user: address,
          action: reviewAction,
        }));
        lastFreshReadsRef.current = reads;
        const built = snapshotFromFreshReads(reads, {
          action: reviewAction,
          venue: reads.venue,
          amount: reviewAction === 'SUPPLY_COLLATERAL' ? (supplyAmount ?? 0n) : (borrowAmount ?? 0n),
          currentCollateral: reads.position.collateral,
          currentDebt: reads.position.debt,
          spendableBalance: reads.walletBalance,
          priceUsd: reads.venue.priceUsd,
          wrongNetwork: isConnected && chain?.id !== reads.venue.chainId,
          approvalNeeded: reviewAction === 'SUPPLY_COLLATERAL' && (step === 'approve' || step === 'reset'),
          resetNeeded: reviewAction === 'SUPPLY_COLLATERAL' && step === 'reset',
          needsEnterMarket: reviewAction === 'BORROW' && needsEnter,
          borrowRoom: reads.position.borrowRoom,
          minBorrow: reads.position.extra?.minBorrow ?? minBorrow,
          fetchedAt: reads.fetchedAt,
        });
        return built.snapshot;
      },
    });
    if (decision.status === 'busy') return;
    if (decision.status === 'failed') {
      setConfirmError(decision.message || CONFIRM_FAIL_MESSAGE);
      return;
    }
    if (decision.status === 'rereview') {
      const reads = lastFreshReadsRef.current;
      if (!reads) {
        setConfirmError(CONFIRM_FAIL_MESSAGE);
        return;
      }
      applyFreshReads(reads);
      reviewedSnapRef.current = decision.fresh;
      setDriftChanges(decision.changes);
      setConfirmError(CONFIRM_DRIFT_MESSAGE);
      return;
    }
    if (!decision.invokeWallet) return;
    if (lastFreshReadsRef.current) applyFreshReads(lastFreshReadsRef.current);
    execVenueRef.current = lastFreshReadsRef.current?.venue ?? confirmVenue ?? market;
    const borrowUsd = reviewAction === 'BORROW' ? tokenNumberSafe(borrowAmount, market.loanDecimals) : 0;
    if (reviewAction === 'BORROW' && isMaterialTransaction(borrowUsd) && !readinessAcked) {
      setReadinessOpen(true);
      return;
    }
    const first = change.steps[0]?.kind;
    setRunAfterApproval(first !== 'action');
    requestWalletAfterConfirm(decision, () => {
      void (async () => {
        if (first === 'reset') await approve(0n);
        else if (first === 'approve') await approve(supplyAmount ?? 0n);
        else await executeReviewedAction();
      })();
    });
  }

  async function revalidateSupplyAfterApproval() {
    const change = reviewRef.current;
    const market = executionVenue();
    if (!change || !market || !address || reviewAction !== 'SUPPLY_COLLATERAL' || !supplyAmount || supplyAmount <= 0n) return;

    setConfirmError('');
    const reviewed = reviewedSnapRef.current ?? buildConfirmSnapshot({
      action: 'SUPPLY_COLLATERAL',
      venue: market,
      change,
      currentCollateral: existingCollateral,
      currentDebt: existingDebt,
      walletBalance,
      plannedAmount: supplyAmount,
      fetchedAt: market.freshness?.fetchedAt ?? fetchedAt,
    });

    const freshReadsRef: { current: Awaited<ReturnType<typeof fetchFreshConfirmReads>> | null } = { current: null };
    const decision = await runConfirmGuard({
      reviewed,
      lock: confirmLock.current,
      loadFresh: async () => {
        const reads = await withConfirmTimeout(fetchFreshConfirmReads({
          venue: market,
          user: address,
          action: 'SUPPLY_COLLATERAL',
        }));
        freshReadsRef.current = reads;
        const built = snapshotFromFreshReads(reads, {
          action: 'SUPPLY_COLLATERAL',
          venue: reads.venue,
          amount: supplyAmount,
          currentCollateral: reads.position.collateral,
          currentDebt: reads.position.debt,
          spendableBalance: reads.walletBalance,
          priceUsd: reads.venue.priceUsd,
          wrongNetwork: isConnected && chain?.id !== reads.venue.chainId,
          approvalNeeded: false,
          resetNeeded: false,
          needsEnterMarket: false,
          borrowRoom: reads.position.borrowRoom,
          minBorrow: reads.position.extra?.minBorrow ?? minBorrow,
          fetchedAt: reads.fetchedAt,
        });
        return built.snapshot;
      },
    });

    const freshReads = freshReadsRef.current;

    if (decision.status === 'busy') return;
    if (decision.status === 'failed') {
      setRunAfterApproval(false);
      setConfirmError(decision.message || CONFIRM_FAIL_MESSAGE);
      return;
    }
    if (decision.status === 'rereview') {
      setRunAfterApproval(false);
      if (freshReads) applyFreshReads(freshReads);
      reviewedSnapRef.current = decision.fresh;
      setDriftChanges(decision.changes);
      setConfirmError(CONFIRM_DRIFT_MESSAGE);
      return;
    }
    if (!decision.invokeWallet || !freshReads) return;

    const freshVenue = freshReads.venue;
    const call = adapterFor(freshVenue).buildSupply(freshVenue, address, supplyAmount, 'borrow');
    if (!call) {
      setRunAfterApproval(false);
      setConfirmError('Unable to prepare the collateral-supply transaction after approval.');
      return;
    }

    try {
      await publicClient(freshVenue.chainId).simulateContract({
        account: address,
        address: call.address,
        abi: call.abi,
        functionName: call.functionName as never,
        args: call.args as never,
      });
    } catch (error) {
      setRunAfterApproval(false);
      setConfirmError(error instanceof Error ? `Collateral supply simulation failed after approval: ${error.message}` : 'Collateral supply simulation failed after approval.');
      return;
    }

    applyFreshReads(freshReads);
    execVenueRef.current = freshVenue;
    reviewedSnapRef.current = decision.fresh;
    setRunAfterApproval(false);
    requestWalletAfterConfirm(decision, () => { void supply(); });
  }

  function applyFreshReads(reads: Awaited<ReturnType<typeof fetchFreshConfirmReads>>) {
    setConfirmVenue(reads.venue);
    setConfirmCollateral(reads.position.collateral);
    setConfirmDebt(reads.position.debt);
    setConfirmBalance(reads.walletBalance);
    setConfirmBorrowRoom(reads.position.borrowRoom);
    execVenueRef.current = reads.venue;
  }

  function tokenNumberSafe(amount: bigint | null, decimals: number) {
    if (!amount) return 0;
    return Number(formatUnits(amount, decimals));
  }

  continueRef.current = (action) => {
    if (action === 'reset' && supplyAmount) {
      void approve(supplyAmount);
      return;
    }
    if (action === 'approve' && reviewAction === 'SUPPLY_COLLATERAL') {
      void revalidateSupplyAfterApproval();
      return;
    }
    if (action === 'approve' || (action === 'supply' && reviewAction === 'BORROW')) {
      void executeReviewedAction();
    }
  };

  function chooseModifyPosition() {
    setIntent('modify-current');
    if (!planningLoaded) return;
    setPlanningLoaded(false);
    setSupplyAmount(null);
    setBorrowAmount(null);
    setSupplyEpoch((value) => value + 1);
    setBorrowEpoch((value) => value + 1);
  }

  function loadPlanningChanges() {
    setIntent('planning-scenario');
    setPlanningLoaded(true);
    setSupplySeed(collateralGap);
    setBorrowSeed(borrowGap);
    setSupplySeedKey((value) => value + 1);
    setBorrowSeedKey((value) => value + 1);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Selected market</p>
          <p className="text-sm font-semibold">{protocolLabel(quote.protocol)} · {chainLabel(quote.chainId)} · {quote.assetSymbol} / {quote.loanSymbol}</p>
          <p className="text-xs text-muted-foreground">Review amounts below. No transaction is sent until you confirm in your wallet.</p>
          {hasPlanningPins && (
            <div className="mt-2 rounded-lg border p-3 text-xs">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Planning target</p>
              <p>{initialCollateral && initialCollateral > 0 ? `${initialCollateral} ${quote.assetSymbol}` : `0 ${quote.assetSymbol}`} collateral · {formatUsd(initialBorrowUsd ?? 0)} debt</p>
              <p className="text-muted-foreground">Reference only. It is not sent unless you load the suggested change.</p>
            </div>
          )}
          {hasPlanningPins && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={intent === 'modify-current' ? 'default' : 'outline'}
                className={`h-10 text-xs ${intent === 'modify-current' ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
                onClick={chooseModifyPosition}
              >
                Modify current position
              </Button>
              <Button
                type="button"
                variant={intent === 'planning-scenario' ? 'default' : 'outline'}
                className={`h-10 text-xs ${intent === 'planning-scenario' ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
                onClick={() => setIntent('planning-scenario')}
              >
                Use planning scenario
              </Button>
            </div>
          )}
          {hasPlanningPins && intent === 'planning-scenario' && (
            <div className="mt-2 space-y-2 text-xs">
              <p>Suggested additional collateral: {formatToken(collateralGap, quote.assetDecimals)} {quote.assetSymbol}</p>
              <p>Suggested additional borrow: {formatUsdExact(Number(formatUnits(borrowGap, quote.loanDecimals)))}</p>
              {planningAboveTarget && <p>{ABOVE_TARGET_MESSAGE} Choose repay or withdraw yourself. Nothing is withdrawn or repaid automatically.</p>}
              {(collateralGap > 0n || borrowGap > 0n) && (
                <Button type="button" variant="outline" className="h-10 w-full text-xs" onClick={loadPlanningChanges}>
                  Load these changes
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Current on-chain positions · {chainLabel(quote.chainId)}</p>
          {!isConnected ? (
            <p className="text-lg font-bold">Connect a wallet to see {quote.assetSymbol}</p>
          ) : balanceError ? (
            <p className="text-lg font-bold">Could not read {quote.assetSymbol} on {chainLabel(quote.chainId)}</p>
          ) : balance === undefined ? (
            <p className="text-lg font-bold">Reading {quote.assetSymbol}…</p>
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight">{formatToken(walletBalance, quote.assetDecimals)} {quote.assetSymbol}</p>
              {tokenAmountUsd(walletBalance, quote.assetDecimals, price) !== null && (
                <p className="text-sm text-muted-foreground">{formatUsdExact(tokenAmountUsd(walletBalance, quote.assetDecimals, price) ?? 0)}</p>
              )}
              {walletBalance === 0n && existingCollateral === 0n && (
                <p className="mt-1 text-xs text-muted-foreground">This address has no {quote.assetSymbol} on {chainLabel(quote.chainId)}.</p>
              )}
              {walletBalance === 0n && quote.chainId === 8453 && quote.assetSymbol === 'cbBTC' && (
                <CoinbaseTransferButton className="mt-2 h-9 bg-blue-600 text-xs text-white hover:bg-blue-700" />
              )}
              {walletBalance > 0n && existingCollateral === 0n && (
                <p className="mt-1 text-xs text-muted-foreground">This {quote.assetSymbol} is still in your wallet. Supply it below to borrow against it.</p>
              )}
            </>
          )}
          {otherAsset && otherBalance !== undefined && otherBalance > 0n && (
            <p className="mt-2 text-xs text-muted-foreground">
              You also hold {formatToken(otherBalance, otherAsset.decimals)} {quote.assetSymbol} on {chainLabel(otherAsset.chainId)}. Choose a {chainLabel(otherAsset.chainId)} market to use that balance.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Current on-chain position</p>
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Supplied collateral</p><p className="text-lg font-bold">{formatToken(existingCollateral, quote.assetDecimals)} {quote.assetSymbol}</p>{existingCollateral === 0n ? <p className="text-xs text-muted-foreground">Nothing supplied yet</p> : collateralUsd !== null && <p className="text-xs text-muted-foreground">{formatUsdExact(collateralUsd)}</p>}</CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Debt</p><p className="text-lg font-bold text-red-500">{formatUsdExact(debtUsd)}</p><p className="text-xs text-muted-foreground">{formatToken(existingDebt, quote.loanDecimals)} {quote.loanSymbol}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">LTV</p><p className="text-lg font-bold">{formatLtvOrNone(current.ltv ?? snapshot.ltv, debtUsd)}</p>{<p className="text-xs text-muted-foreground">{healthFactorLabel(current.healthFactorKind)} {formatHealthFactorOrNone(current.healthFactor, debtUsd)}</p>}</CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Liquidation</p><p className="text-lg font-bold">{formatLiquidationOrNone(current.liquidationPrice ?? snapshot.liquidationPrice, debtUsd)}</p><p className="text-xs text-muted-foreground">{formatCushionOrNone(current.distanceToLiquidation, debtUsd) === 'N/A' ? 'N/A' : `BTC cushion ${formatCushionOrNone(current.distanceToLiquidation, debtUsd)}`}</p></CardContent></Card>
        </div>
      </div>

      {hasProposal && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Proposed change</p>
          <p className="text-sm font-medium">+{formatTokenAmount(supplyAmount && supplyAmount > 0n ? supplyAmount : 0n, quote.assetDecimals, { compact: true, symbol: quote.assetSymbol })} · +{formatUsdExact(proposedBorrow)}</p>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Projected after transaction</p>
          <div className="grid grid-cols-2 gap-3">
            <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Collateral after supply</p><p className="text-lg font-bold">{formatTokenAmount(supplyAmount && supplyAmount > 0n ? existingCollateral + supplyAmount : existingCollateral, quote.assetDecimals, { compact: true, symbol: quote.assetSymbol })}</p>{projected.collateralUsd !== null && <p className="text-xs text-muted-foreground">{formatUsdExact(projected.collateralUsd)}</p>}</CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Debt after borrow</p><p className="text-lg font-bold text-red-500">{formatUsdExact(projected.debtUsd)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Projected LTV</p><p className="text-lg font-bold">{formatLtvOrNone(projected.ltv, projected.debtUsd)}</p><p className="text-xs text-muted-foreground">{healthFactorLabel(projected.healthFactorKind)} {formatHealthFactorOrNone(projected.healthFactor, projected.debtUsd)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Projected liquidation</p><p className="text-lg font-bold">{formatLiquidationOrNone(projected.liquidationPrice, projected.debtUsd)}</p><p className="text-xs text-muted-foreground">{formatCushionOrNone(projected.distanceToLiquidation, projected.debtUsd) === 'N/A' ? 'N/A' : `BTC cushion ${formatCushionOrNone(projected.distanceToLiquidation, projected.debtUsd)}`}</p></CardContent></Card>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className={`text-xs font-bold ${confidence.level === 'cautious' ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{confidence.label}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{confidence.detail} Borrowing stays capped at 90% of this pool&apos;s maximum LTV.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <UsdAmountField
            kind="collateral"
            symbol={quote.assetSymbol}
            decimals={quote.assetDecimals}
            priceUsd={quote.priceUsd}
            balance={balance === undefined ? undefined : walletBalance}
            epoch={supplyEpoch}
            invalid={supplyTooBig}
            delta={hasExistingPosition}
            seed={supplySeed}
            seedKey={supplySeedKey}
            onAmount={setSupplyAmount}
          />
          {supplyUsd !== null && estimatedBorrowUsd !== null && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              This supply is about {formatUsdExact(supplyUsd)}. After it confirms, the 90% safety cap on the {formatLtv(quote.maxLtv)} maximum LTV is about {formatUsdExact(estimatedBorrowUsd)} USDC.
            </p>
          )}

          <div className="border-t pt-4">
            <UsdAmountField
              kind="borrow"
              symbol={quote.loanSymbol}
              decimals={quote.loanDecimals}
              priceUsd={1}
              balance={borrowRoom}
              balanceLabel="Safe to borrow"
              epoch={borrowEpoch}
              invalid={borrowTooBig}
              delta={hasExistingPosition}
              seed={borrowSeed}
              seedKey={borrowSeedKey}
              onAmount={setBorrowAmount}
            />
            <p className="mt-2 text-xs text-muted-foreground">The borrow limit uses collateral already supplied, at 90% of this pool&apos;s maximum.</p>
          </div>

          {stale && <p className="text-xs font-medium text-orange-500">Rates are older than 3 minutes. Refresh before sending a transaction.</p>}
          {needsEnter && <p className="text-xs font-medium text-orange-500">Moonwell needs one extra confirmation to enable this collateral before the first borrow.</p>}
          {belowMin && minBorrow > 0n && <p className="text-xs font-medium text-orange-500">Compound&apos;s minimum borrow is {formatToken(minBorrow, quote.loanDecimals)} USDC.</p>}
          {!oracleReady && <p className="text-xs font-medium text-orange-500">Waiting for the on-chain oracle before borrow is enabled.</p>}
          {pendingSupply && borrowRoom > 0n && <p className="text-xs text-muted-foreground">Borrow now uses only collateral already supplied. Supply first to raise the limit.</p>}
          {pendingSupply && borrowRoom === 0n && <p className="text-xs text-muted-foreground">Supply first. Borrowing opens once the supply confirms.</p>}
          {borrowAmount !== null && Number(formatUnits(borrowAmount, quote.loanDecimals)) > quote.liquidityUsd && (
            <p className="text-xs font-medium text-orange-500">This borrow is larger than the liquidity available in the selected market.</p>
          )}

          {!isConnected ? (
            <Button className="h-12 w-full" disabled>Connect a wallet to continue</Button>
          ) : wrongChain ? (
            <WrongNetworkActions
              walletName={chain?.name ?? 'another network'}
              marketChainId={quote.chainId}
              alternate={alternate}
              onUseAlternate={onSelect}
            />
          ) : !gas.enough ? (
            <GasNotice chainId={quote.chainId} symbol={quote.assetSymbol} neededEth={gas.neededEth} balanceEth={gas.balanceEth} />
          ) : (
            <div className="space-y-2">
              {supplyTooBig && shortfall && (
                <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-xs">
                  <p>Additional collateral required: {formatTokenAmount(parseAmount(String(shortfall.required), quote.assetDecimals) ?? 0n, quote.assetDecimals, { symbol: quote.assetSymbol })}</p>
                  <p>Available on selected network: {formatToken(walletBalance, quote.assetDecimals)} {quote.assetSymbol}</p>
                  <p>Shortfall: {formatToken(walletBalance < (supplyAmount ?? 0n) ? (supplyAmount ?? 0n) - walletBalance : 0n, quote.assetDecimals)} {quote.assetSymbol}</p>
                  {otherAsset && otherBalance !== undefined && otherBalance > 0n && (
                    <p className="mt-1 text-muted-foreground">
                      Additional {formatToken(otherBalance, otherAsset.decimals)} {quote.assetSymbol} is on {chainLabel(otherAsset.chainId)}. Choose a {chainLabel(otherAsset.chainId)} market to use it — this app does not move it.
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button className="h-12 flex-1 bg-indigo-600 text-white hover:bg-indigo-700" disabled={isBusy || stale || marketMissing || supplyTooBig || !supplyAmount || supplyAmount <= 0n} onClick={() => { reviewedSnapRef.current = null; setConfirmError(''); setDriftChanges([]); setReviewAction('SUPPLY_COLLATERAL'); }}>{supplyTooBig ? `Insufficient ${quote.assetSymbol}` : isAwaitingWallet ? 'Confirm…' : isBusy ? 'Confirming…' : 'Review supply'}</Button>
                <Button className="h-12 flex-1 bg-blue-600 text-white hover:bg-blue-700" disabled={isBusy || stale || !oracleReady || !borrowAmount || borrowAmount <= 0n || borrowTooBig || belowMin} onClick={() => { reviewedSnapRef.current = null; setConfirmError(''); setDriftChanges([]); setReviewAction('BORROW'); }}>{isAwaitingWallet ? 'Confirm…' : isBusy ? 'Confirming…' : 'Review borrow'}</Button>
              </div>
            </div>
          )}
          {readinessOpen && pendingReview && reviewAction === 'BORROW' && (
            <LoanReadinessReview
              readiness={buildLoanReadiness({
                venue: reviewVenue,
                collateralAmount: projected.collateralAmount,
                collateralUsd: projected.collateralUsd,
                borrowAmount: projected.debtUsd,
                startingLtv: projected.ltv,
                liquidationBound: quote.maxLtv,
                liquidationPrice: projected.liquidationPrice,
                cushion: projected.distanceToLiquidation,
                healthFactor: projected.healthFactor,
                healthFactorKind: projected.healthFactorKind,
                walletCollateral: availableTokens,
                estimatedFeeUsd: borrowFee.usd ?? undefined,
              })}
              onCancel={() => setReadinessOpen(false)}
              onAcknowledge={() => {
                setReadinessAcked(true);
                setReadinessOpen(false);
                void confirmReview();
              }}
            />
          )}
          {pendingReview && !readinessOpen && (
            <PositionChangeReview
              change={pendingReview}
              loanDecimals={reviewVenue.loanDecimals}
              assetDecimals={reviewVenue.assetDecimals}
              busy={isBusy || confirmLock.current.busy}
              awaitingWallet={isAwaitingWallet}
              notice={confirmError || handoffNotice || undefined}
              driftChanges={driftChanges}
              statusMessage={statusMessage}
              txHash={hash}
              receiptBlock={receiptBlock}
              planningTarget={hasPlanningPins ? {
                collateral: `${initialCollateral && initialCollateral > 0 ? initialCollateral : 0} ${quote.assetSymbol}`,
                debt: formatUsd(initialBorrowUsd ?? 0),
              } : undefined}
              onRetryRefresh={phase === 'refresh_failed' ? () => void retryPositionRefresh() : undefined}
              onCancel={() => {
                cancelPending();
                setReviewAction(null);
                setRunAfterApproval(false);
                setReadinessAcked(false);
                setReadinessOpen(false);
                setConfirmError('');
                setDriftChanges([]);
                setConfirmVenue(null);
                setConfirmCollateral(null);
                setConfirmDebt(null);
                setConfirmBalance(null);
                setConfirmBorrowRoom(null);
                reviewedSnapRef.current = null;
                lastFreshReadsRef.current = null;
                execVenueRef.current = null;
              }}
              onConfirm={() => void confirmReview()}
            />
          )}

          {isConnected && (
            <FeeBreakdown
              quote={quote}
              actions={[
                ...(pendingSupply && step !== 'none' ? ['approve'] : []),
                ...(pendingSupply ? ['supply'] : []),
                ...(borrowAmount && borrowAmount > 0n ? ['borrow'] : []),
                ...(!pendingSupply && !(borrowAmount && borrowAmount > 0n) ? ['supply', 'borrow'] : []),
              ]}
              interest={{
                apr: quote.borrowApr,
                principalUsd: debtUsd + (tokenAmountUsd(borrowAmount ?? 0n, quote.loanDecimals, 1) ?? 0),
                label: borrowAmount && borrowAmount > 0n ? 'Interest after this borrow' : 'Interest on current debt',
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Liquidation price</span>
            <span className="font-bold">
              {displayPosition.debtUsd > 0 && liquidationPrice > 0
                ? formatUsd(liquidationPrice)
                : displayPosition.debtUsd > 0
                  ? '—'
                  : hasProposal
                    ? 'No projected debt'
                    : 'No current debt'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>BTC drop</span><span>-{drop}%</span>
          </div>
          <Slider value={[drop]} max={90} step={1} onValueChange={(value) => setDrop(value[0] ?? 0)} />
          <p className={`text-xs font-semibold ${simulatedLtv >= quote.maxLtv * 100 ? 'text-red-500' : 'text-muted-foreground'}`}>
            At {formatUsd(simulatedPrice)}, LTV would be {formatLtv(simulatedLtv / 100)} against a {formatLtv(quote.maxLtv)} maximum.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
