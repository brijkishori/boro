'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { maxUint256 } from 'viem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import UsdAmountField from '@/components/UsdAmountField';
import WrongNetworkActions from '@/components/WrongNetworkActions';
import GasNotice from '@/components/GasNotice';
import FeeBreakdown from '@/components/FeeBreakdown';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { useFreshTokenBalance, usePosition } from '@/components/usePosition';
import { adapterFor, approveCall } from '@/lib/adapters';
import { erc20Abi } from '@/lib/abi';
import { approvalStep, formatToken, formatUsd, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import PositionChangeReview from '@/components/PositionChangeReview';
import {
  buildProposedPositionChange,
  canRequestWallet,
  serializePositionSnapshot,
  type PositionChangeAction,
} from '@/lib/finance/positionChange';
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
import { liveSplit } from '@/lib/audit';
import { tokenUnits, type RemedyHandoff } from '@/lib/finance/actionPlanner';
import { useFeeEstimate } from './useNetworkFee';
import {
  chainLabel,
  isChainId,
  isVenueSafe,
  venueOnChain,
  venueSpender,
  type Venue,
} from '@/lib/protocol';
import { useSendTx } from './useSendTx';
import { useAudit } from './useAudit';
import { LoanLedger } from './LoanLedger';
import { asBig, episodeKey, findOpenEpisode, formatDuration } from '@/lib/audit';

export default function RepayFlow({ quote, venues = [], onSelect, handoff = null }: { quote: Venue | null; venues?: Venue[]; onSelect?: (id: string) => void; handoff?: RemedyHandoff | null }) {
  const { address, chain, isConnected } = useAccount();
  const [repayAmount, setRepayAmount] = useState<bigint | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<bigint | null>(null);
  const [repayEpoch, setRepayEpoch] = useState(0);
  const [withdrawEpoch, setWithdrawEpoch] = useState(0);
  const [maxRepay, setMaxRepay] = useState(false);
  const [maxWithdraw, setMaxWithdraw] = useState(false);
  const [partialPin, setPartialPin] = useState<bigint | undefined>();
  const [handoffSeed, setHandoffSeed] = useState<bigint | null>(null);
  const [handoffKey, setHandoffKey] = useState(0);
  const [handoffNotice, setHandoffNotice] = useState('');
  const appliedHandoff = useRef(false);
  const { send, isBusy, isAwaitingWallet, confirmed, hash, phase, receiptBlock, statusMessage, retryPositionRefresh, cancelPending } = useSendTx();
  const [reviewAction, setReviewAction] = useState<PositionChangeAction | null>(null);
  const [runAfterApproval, setRunAfterApproval] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [driftChanges, setDriftChanges] = useState<DriftChange[]>([]);
  const confirmLock = useRef<ConfirmLock>({ busy: false });
  const reviewedSnapRef = useRef<ConfirmSnapshot | null>(null);
  const lastFreshReadsRef = useRef<Awaited<ReturnType<typeof fetchFreshConfirmReads>> | null>(null);
  const reviewRef = useRef<ReturnType<typeof buildProposedPositionChange> | null>(null);
  const continueRef = useRef<(action: string) => void>(() => {});
  const repayFee = useFeeEstimate(quote?.chainId, 'repay');
  const withdrawFee = useFeeEstimate(quote?.chainId, 'withdraw');
  const { episodes, events, seedOpen } = useAudit(address);

  const safe = quote !== null && isVenueSafe(quote) && quote.action === 'borrow';
  const spender = safe && quote ? venueSpender(quote, 'loan') : null;
  const enabled = Boolean(address && safe);
  const gas = useGasCheck(quote?.chainId, GAS_UNITS.write);
  const marketChainId = quote?.chainId;
  const { snapshot, refetch: refetchPosition } = usePosition(safe ? quote : null, address, enabled);
  const freshLoanBalance = useFreshTokenBalance(quote?.loanAddress, quote?.chainId, address);

  const { data: usdcBalance, isError: usdcError, refetch: refetchUsdc } = useReadContract({
    address: quote?.loanAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 20_000, placeholderData: (previous) => previous },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: quote?.loanAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: Boolean(enabled && spender), refetchInterval: 20_000, placeholderData: (previous) => previous },
  });
  const lastAllowance = useRef(0n);
  if (typeof allowance === 'bigint') lastAllowance.current = allowance;
  const ledgerKey = quote && address ? episodeKey(address, quote) : '';
  const episode = ledgerKey ? findOpenEpisode(episodes, ledgerKey) : null;
  const closedEpisode = ledgerKey ? episodes.find((item) => item.key === ledgerKey && item.status === 'closed') ?? null : null;
  const lastRepay = events.find((event) => event.action === 'repay' && event.episodeKey === ledgerKey);
  const siblings = quote?.aave
    ? venues.filter((venue) => venue.aave && venue.chainId === quote.chainId && venue.id !== quote.id)
    : [];
  const { data: siblingBalances } = useReadContracts({
    contracts: address
      ? siblings.map((venue) => ({ address: venue.aave!.aToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: venue.chainId }))
      : [],
    query: { enabled: Boolean(address && siblings.length > 0 && snapshot.collateral === 0n) },
  });
  const heldElsewhere = snapshot.collateral === 0n
    ? siblings.find((_, index) => {
        const value = siblingBalances?.[index]?.result;
        return typeof value === 'bigint' && value > 0n;
      })
    : undefined;

  useEffect(() => {
    if (heldElsewhere && snapshot.ready && snapshot.collateral === 0n && snapshot.debt === 0n && onSelect) {
      onSelect(heldElsewhere.id);
    }
  }, [heldElsewhere, onSelect, snapshot.collateral, snapshot.debt, snapshot.ready]);

  const debt = snapshot.debt;
  const cappedDebt = debt;

  useEffect(() => {
    if (!confirmed || confirmed.refreshFailed) return;
    if (confirmed.action === 'repay') {
      setRepayAmount(null);
      setRepayEpoch((value) => value + 1);
      setMaxRepay(false);
      setPartialPin(undefined);
    }
    if (confirmed.action === 'withdraw') {
      setWithdrawAmount(null);
      setWithdrawEpoch((value) => value + 1);
    }
    if (confirmed.action === 'repay' || confirmed.action === 'withdraw') {
      setReviewAction(null);
      setRunAfterApproval(false);
    }
    void refetchUsdc();
    void refetchAllowance();
    void refetchPosition();
  }, [confirmed, refetchAllowance, refetchPosition, refetchUsdc]);

  useEffect(() => {
    if (!confirmed || !runAfterApproval) return;
    continueRef.current(confirmed.action);
  }, [confirmed, runAfterApproval]);

  useEffect(() => {
    if (appliedHandoff.current || !handoff || !quote || handoff.type !== 'REPAY' || handoff.marketId !== quote.id) return;
    if (!(handoff.repayAmount && handoff.repayAmount > 0)) return;
    const units = tokenUnits(handoff.repayAmount, quote.loanDecimals);
    appliedHandoff.current = true;
    setHandoffSeed(units);
    setHandoffKey(1);
    setRepayAmount(units);
    setReviewAction('REPAY');
    reviewedSnapRef.current = null;
    if (handoff.notice) setHandoffNotice(handoff.notice);
  }, [handoff, quote]);


  useEffect(() => {
    if (!quote || snapshot.debt <= 0n) return;
    seedOpen([{ venue: quote, snapshot }]);
  }, [quote, seedOpen, snapshot]);

  if (!quote || !safe || !spender) {
    return <p className="text-sm text-muted-foreground">Choose the borrow market you want to repay.</p>;
  }

  const wallet = freshLoanBalance ?? usdcBalance ?? 0n;
  const collateral = snapshot.collateral;
  const closingDebt = maxRepay || (repayAmount !== null && cappedDebt > 0n && repayAmount >= cappedDebt);
  const neededApproval = closingDebt ? cappedDebt : (repayAmount ?? 0n);
  const approveAmount = closingDebt ? maxUint256 : neededApproval;
  const step = approvalStep(typeof allowance === 'bigint' ? allowance : lastAllowance.current, neededApproval);
  const wrongChain = isConnected && chain?.id !== quote.chainId;
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isChainId(connectedChainId) ? connectedChainId : null;
  const alternate = wrongChain && walletChainId ? venueOnChain(venues, quote, walletChainId) : null;
  const repayTooBig = repayAmount !== null && repayAmount > wallet;
  const shares = snapshot.extra?.shares ?? 0n;
  const shortfall = cappedDebt > wallet ? cappedDebt - wallet : 0n;
  const withdrawMax = snapshot.withdrawMax;
  const hasDebt = snapshot.debt > 0n;
  const withdrawTooBig = withdrawAmount !== null && withdrawAmount > withdrawMax;

  const split = liveSplit(episode, cappedDebt);
  const protocolSafeFullRepay = Boolean(maxRepay && wallet > cappedDebt + cappedDebt / 10_000n);
  const protocolSafeFullWithdraw = Boolean(maxWithdraw && !hasDebt && collateral > 0n);
  const pendingReview = reviewAction
    ? buildProposedPositionChange({
      action: reviewAction,
      venue: quote,
      amount: reviewAction === 'REPAY' ? (repayAmount ?? 0n) : (protocolSafeFullWithdraw ? collateral : (withdrawAmount ?? 0n)),
      currentCollateral: collateral,
      currentDebt: cappedDebt,
      spendableBalance: reviewAction === 'REPAY' ? wallet : collateral,
      priceUsd: quote.priceUsd,
      wrongNetwork: wrongChain,
      approvalNeeded: reviewAction === 'REPAY' && (step === 'approve' || step === 'reset'),
      resetNeeded: reviewAction === 'REPAY' && step === 'reset',
      maxRepay: reviewAction === 'REPAY' ? maxRepay : false,
      protocolSafeFullRepay: reviewAction === 'REPAY' ? protocolSafeFullRepay : false,
      maxWithdraw: reviewAction === 'WITHDRAW_COLLATERAL' ? maxWithdraw : false,
      protocolSafeFullWithdraw: reviewAction === 'WITHDRAW_COLLATERAL' ? protocolSafeFullWithdraw : false,
      withdrawMax,
      principalRemaining: split.principalRemaining,
      interestRemaining: split.interestRemaining,
      estimatedNetworkFeeUsd: (reviewAction === 'REPAY' ? repayFee.usd : withdrawFee.usd) ?? undefined,
      fetchedAt: quote.freshness?.fetchedAt,
      executionIntent: 'modify-current',
    })
    : null;
  reviewRef.current = pendingReview;
  if (pendingReview && reviewAction && !reviewedSnapRef.current) {
    reviewedSnapRef.current = buildConfirmSnapshot({
      action: reviewAction,
      venue: quote,
      change: pendingReview,
      currentCollateral: collateral,
      currentDebt: cappedDebt,
      walletBalance: reviewAction === 'REPAY' ? wallet : collateral,
      plannedAmount: reviewAction === 'REPAY' ? (repayAmount ?? 0n) : (withdrawAmount ?? 0n),
      fetchedAt: quote.freshness?.fetchedAt ?? Date.now(),
    });
  }

  function ledger(amount: bigint, amountKind: 'loan' | 'asset' = 'loan', closing = false) {
    const preview = reviewRef.current;
    return {
      wallet: address!,
      venue: quote!,
      amount,
      amountUsd: tokenAmountUsd(amount, amountKind === 'loan' ? quote!.loanDecimals : quote!.assetDecimals, amountKind === 'loan' ? 1 : quote!.priceUsd),
      amountKind,
      debt: snapshot.debt,
      collateral: snapshot.collateral,
      healthFactor: snapshot.healthFactor,
      shares: snapshot.extra?.shares,
      closing,
      previewCurrent: preview ? serializePositionSnapshot(preview.current) : undefined,
      previewProjected: preview ? serializePositionSnapshot(preview.projected) : undefined,
      previewAt: preview ? Date.now() : undefined,
      positionVenue: quote ?? undefined,
      user: address,
    };
  }

  async function approve(amount: bigint) {
    await send(amount === 0n ? 'reset' : 'approve', approveCall(quote!, spender!, amount, 'loan'), ledger(neededApproval));
  }

  async function repay() {
    if (!address || !repayAmount || repayAmount <= 0n) return;
    const change = reviewRef.current;
    if (change && !canRequestWallet(change)) return;
    const full = protocolSafeFullRepay;
    const call = adapterFor(quote!).buildRepay(quote!, address, repayAmount, full, { shares });
    if (call) await send('repay', call, ledger(repayAmount, 'loan', full));
  }

  async function withdraw() {
    if (!address || !withdrawAmount || withdrawAmount <= 0n || withdrawAmount > withdrawMax) return;
    const change = reviewRef.current;
    if (change && !canRequestWallet(change)) return;
    const call = adapterFor(quote!).buildWithdraw(quote!, address, withdrawAmount, 'borrow', { shares });
    if (call) await send('withdraw', call, ledger(withdrawAmount, 'asset', maxWithdraw || (collateral > 0n && withdrawAmount >= collateral)));
  }

  async function executeReviewedAction() {
    if (reviewAction === 'REPAY') await repay();
    if (reviewAction === 'WITHDRAW_COLLATERAL') await withdraw();
  }

  async function confirmReview() {
    const change = reviewRef.current;
    if (!change || !quote || !address || !reviewAction || !canRequestWallet(change)) return;
    setConfirmError('');
    const reviewed = reviewedSnapRef.current ?? buildConfirmSnapshot({
      action: reviewAction,
      venue: quote,
      change,
      currentCollateral: collateral,
      currentDebt: cappedDebt,
      walletBalance: reviewAction === 'REPAY' ? wallet : collateral,
      plannedAmount: reviewAction === 'REPAY' ? (repayAmount ?? 0n) : (withdrawAmount ?? 0n),
      fetchedAt: quote.freshness?.fetchedAt ?? Date.now(),
    });
    const decision = await runConfirmGuard({
      reviewed,
      lock: confirmLock.current,
      loadFresh: async () => {
        const reads = await withConfirmTimeout(fetchFreshConfirmReads({
          venue: quote,
          user: address,
          action: reviewAction,
        }));
        lastFreshReadsRef.current = reads;
        return snapshotFromFreshReads(reads, {
          action: reviewAction,
          venue: reads.venue,
          amount: reviewAction === 'REPAY' ? (repayAmount ?? 0n) : (protocolSafeFullWithdraw ? reads.position.collateral : (withdrawAmount ?? 0n)),
          currentCollateral: reads.position.collateral,
          currentDebt: reads.position.debt,
          spendableBalance: reviewAction === 'REPAY' ? reads.walletBalance : reads.position.collateral,
          priceUsd: reads.venue.priceUsd,
          wrongNetwork: isConnected && chain?.id !== reads.venue.chainId,
          maxRepay: reviewAction === 'REPAY' ? maxRepay : false,
          protocolSafeFullRepay: reviewAction === 'REPAY' ? protocolSafeFullRepay : false,
          maxWithdraw: reviewAction === 'WITHDRAW_COLLATERAL' ? maxWithdraw : false,
          protocolSafeFullWithdraw: reviewAction === 'WITHDRAW_COLLATERAL' && !reads.position.debt,
          withdrawMax: reads.position.withdrawMax,
          fetchedAt: reads.fetchedAt,
        }).snapshot;
      },
    });
    if (decision.status === 'busy') return;
    if (decision.status === 'failed') {
      setConfirmError(decision.message || CONFIRM_FAIL_MESSAGE);
      return;
    }
    if (decision.status === 'rereview') {
      reviewedSnapRef.current = decision.fresh;
      setDriftChanges(decision.changes);
      setConfirmError(CONFIRM_DRIFT_MESSAGE);
      return;
    }
    if (!decision.invokeWallet) return;
    const first = change.steps[0]?.kind;
    setRunAfterApproval(first !== 'action');
    requestWalletAfterConfirm(decision, () => {
      void (async () => {
        if (first === 'reset') await approve(0n);
        else if (first === 'approve') await approve(approveAmount);
        else await executeReviewedAction();
      })();
    });
  }

  continueRef.current = (action) => {
    if (action === 'reset') {
      void approve(approveAmount);
      return;
    }
    if (action === 'approve') void executeReviewedAction();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="rounded-lg border bg-muted/40 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">USDC in your wallet · {chainLabel(quote.chainId)}</p>
            {!isConnected ? (
              <p className="text-lg font-bold">Connect a wallet to see USDC</p>
            ) : usdcError ? (
              <p className="text-lg font-bold">Could not read USDC on {chainLabel(quote.chainId)}</p>
            ) : usdcBalance === undefined ? (
              <p className="text-lg font-bold">Reading USDC…</p>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight">{formatToken(wallet, quote.loanDecimals)} USDC</p>
                <p className="text-sm text-muted-foreground">{formatUsdExact(tokenAmountUsd(wallet, quote.loanDecimals, 1) ?? 0)}</p>
              </>
            )}
          </div>
          {(cappedDebt > 0n || closedEpisode) && (
            <div className="rounded-lg border px-3 py-2">
              <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Principal vs interest</p>
              {cappedDebt > 0n ? (
                <LoanLedger episode={episode} debt={cappedDebt} decimals={quote.loanDecimals} compact />
              ) : closedEpisode ? (
                <p className="text-xs font-semibold">
                  This loan is closed. Interest paid over {formatDuration(closedEpisode.openedAt, closedEpisode.closedAt)}:{' '}
                  {formatToken(asBig(closedEpisode.interestPaid), quote.loanDecimals)} USDC
                </p>
              ) : null}
              {lastRepay?.interestPaid && lastRepay.principalPaid && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Last repay: {formatToken(asBig(lastRepay.interestPaid), quote.loanDecimals)} USDC interest, {formatToken(asBig(lastRepay.principalPaid), quote.loanDecimals)} USDC principal
                  {lastRepay.closing ? ' · loan closed' : ''}
                </p>
              )}
            </div>
          )}
          <UsdAmountField
            label="Repay USDC"
            symbol="USDC"
            decimals={quote.loanDecimals}
            priceUsd={1}
            balance={cappedDebt}
            balanceLabel="Debt"
            percents={[25, 50, 75, 100]}
            percentLabel={(percent) => (percent === 100 ? 'Full repayment' : `${percent}%`)}
            epoch={repayEpoch}
            pinned={maxRepay ? undefined : partialPin}
            seed={handoffSeed}
            seedKey={handoffKey}
            invalid={repayTooBig}
            disabled={cappedDebt === 0n}
            onAmount={setRepayAmount}
            onEdit={() => {
              setMaxRepay(false);
              setPartialPin(undefined);
            }}
            onPercent={(percent, slice) => {
              if (percent === 100 && shortfall > 0n) {
                setMaxRepay(false);
                setPartialPin(wallet);
                setRepayAmount(wallet);
                return;
              }
              setPartialPin(undefined);
              setRepayAmount(slice);
              setMaxRepay(percent === 100);
            }}
          />
          {isConnected && usdcBalance !== undefined && cappedDebt > 0n && shortfall > 0n && (
            <p className="text-xs leading-relaxed text-orange-600 dark:text-orange-400">
              Interest has grown the debt to {formatToken(cappedDebt, quote.loanDecimals)} USDC, and the wallet holds {formatToken(wallet, quote.loanDecimals)} USDC.
              {wallet > 0n
                ? ` Clear debt repays all ${formatToken(wallet, quote.loanDecimals)} USDC now and leaves ${formatToken(shortfall, quote.loanDecimals)} USDC owed. Add a little USDC on ${chainLabel(quote.chainId)} to clear it completely.`
                : ` Add USDC on ${chainLabel(quote.chainId)} to repay.`}
            </p>
          )}
          {(quote.protocol === 'aave' || quote.protocol === 'spark') && (
            <p className="text-xs text-muted-foreground">Pool debt {formatUsd(tokenAmountUsd(cappedDebt, quote.loanDecimals, 1) ?? 0)}</p>
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
            <GasNotice chainId={quote.chainId} symbol={'USDC'} neededEth={gas.neededEth} balanceEth={gas.balanceEth} />
          ) : repayTooBig ? (
            <Button className="h-12 w-full" disabled>Not enough USDC</Button>
          ) : (
            <Button className="h-12 w-full bg-blue-600 text-white" disabled={isBusy || cappedDebt === 0n || !repayAmount || repayAmount <= 0n} onClick={() => { reviewedSnapRef.current = null; setConfirmError(''); setDriftChanges([]); setReviewAction('REPAY'); }}>
              {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : 'Review repayment'}
            </Button>
          )}
          {pendingReview && reviewAction === 'REPAY' && (
            <PositionChangeReview
              change={pendingReview}
              loanDecimals={quote.loanDecimals}
              assetDecimals={quote.assetDecimals}
              busy={isBusy || confirmLock.current.busy}
              awaitingWallet={isAwaitingWallet}
              notice={confirmError || handoffNotice || undefined}
              driftChanges={driftChanges}
              statusMessage={statusMessage}
              txHash={hash}
              receiptBlock={receiptBlock}
              onRetryRefresh={phase === 'refresh_failed' ? () => void retryPositionRefresh() : undefined}
              onCancel={() => {
                cancelPending();
                setReviewAction(null);
                setRunAfterApproval(false);
                setConfirmError('');
                setDriftChanges([]);
                reviewedSnapRef.current = null;
              }}
              onConfirm={() => void confirmReview()}
            />
          )}
          {isConnected && (
            <FeeBreakdown
              quote={quote}
              actions={[...(step !== 'none' ? ['approve'] : []), 'repay', 'withdraw']}
              interest={{ apr: quote.borrowApr, principalUsd: tokenAmountUsd(cappedDebt, quote.loanDecimals, 1) ?? 0, label: 'Interest while debt stays open' }}
            />
          )}
          {(quote.protocol === 'aave' || quote.protocol === 'spark') && <p className="text-[11px] leading-relaxed text-muted-foreground">Shared-pool debt is reported for the whole account on this network. The repay amount is capped by that reported debt.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <UsdAmountField
            label={`Withdraw ${quote.assetSymbol}`}
            symbol={quote.assetSymbol}
            decimals={quote.assetDecimals}
            priceUsd={quote.priceUsd}
            balance={withdrawMax}
            balanceLabel={hasDebt ? 'Safe to withdraw' : 'Full supplied balance'}
            percents={[25, 50, 75, 100]}
            percentLabel={(percent) => (percent === 100 && !hasDebt ? 'Full supplied balance' : `${percent}%`)}
            epoch={withdrawEpoch}
            invalid={withdrawTooBig}
            disabled={withdrawMax === 0n}
            onAmount={setWithdrawAmount}
            onEdit={() => setMaxWithdraw(false)}
            onPercent={(percent, slice) => {
              setWithdrawAmount(slice);
              setMaxWithdraw(percent === 100 && !hasDebt);
            }}
          />
          {hasDebt && collateral > 0n && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {formatToken(collateral, quote.assetDecimals)} {quote.assetSymbol} is supplied. While debt is open, the app lets you withdraw only what keeps the loan inside 90% of the pool&apos;s borrowing limit. Repay the debt to withdraw everything.
            </p>
          )}
          <Button className="h-12 w-full bg-indigo-600 text-white" disabled={isBusy || wrongChain || !isConnected || withdrawMax === 0n || !withdrawAmount || withdrawAmount <= 0n || withdrawTooBig} onClick={() => { reviewedSnapRef.current = null; setConfirmError(''); setDriftChanges([]); setReviewAction('WITHDRAW_COLLATERAL'); }}>
            {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : withdrawMax === 0n && collateral > 0n ? 'Repay debt to withdraw' : `Review withdrawal`}
          </Button>
          {pendingReview && reviewAction === 'WITHDRAW_COLLATERAL' && (
            <PositionChangeReview
              change={pendingReview}
              loanDecimals={quote.loanDecimals}
              assetDecimals={quote.assetDecimals}
              busy={isBusy || confirmLock.current.busy}
              awaitingWallet={isAwaitingWallet}
              notice={confirmError || undefined}
              driftChanges={driftChanges}
              statusMessage={statusMessage}
              txHash={hash}
              receiptBlock={receiptBlock}
              onRetryRefresh={phase === 'refresh_failed' ? () => void retryPositionRefresh() : undefined}
              onCancel={() => {
                cancelPending();
                setReviewAction(null);
                setRunAfterApproval(false);
                setConfirmError('');
                setDriftChanges([]);
                reviewedSnapRef.current = null;
              }}
              onConfirm={() => void confirmReview()}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
