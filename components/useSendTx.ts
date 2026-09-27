'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { toast } from 'sonner';
import { attachAuditResult, AUDIT_ACTIONS_SET, buildAuditEvent, persistAuditEvent, type AuditAction, type AuditVenue } from '@/lib/audit';
import { formatToken } from '@/lib/amount';
import { config } from '@/lib/config';
import { writeFreshBalance, writeFreshPosition } from '@/lib/finance/positionCache';
import {
  marketIdForVenue,
  observedHead,
  positionEffectObserved,
  readDirectPosition,
  readDirectTokenBalance,
  reconcileConfirmedTransaction,
  type ReconcilePhase,
} from '@/lib/finance/reconcile';
import {
  canSubmitTransaction,
  createSubmissionGate,
  expectedFromTx,
  isAwaitingWalletPhase,
  isPositionTxAction,
  phaseAfterHashReturned,
  refreshStatusMessage,
  TX_ENRICHMENT_COPY,
  TX_NOT_MINED_COPY,
  TX_POSITION_SYNC_DELAYED_COPY,
  TX_REFRESHING_COPY,
  TX_RETRY_CHECKING_COPY,
  type TxPhase,
} from '@/lib/finance/txSync';
import { findTxByNonce, TX_SUBMITTED_COPY, watchSubmittedTransaction } from '@/lib/finance/txWatch';
import { findReceipt, publicClient } from '@/lib/rpc';
import type { PositionSnapshot } from '@/lib/adapters';
import type { Venue } from '@/lib/protocol';
import { walletUsesPhone } from './useNetworkSwitch';
import { formatEth, formatFeeUsd, recordFee, useEthUsd, weiToUsd } from './useNetworkFee';

export type TxContext = {
  wallet: string;
  venue: AuditVenue;
  amount: bigint;
  amountUsd?: number | null;
  amountKind?: 'loan' | 'asset';
  debt?: bigint;
  collateral?: bigint;
  healthFactor?: number | null;
  closing?: boolean;
  shares?: bigint;
  previewCurrent?: string;
  previewProjected?: string;
  previewAt?: number;
  positionVenue?: Venue;
  user?: string;
};

export type ConfirmedTx = {
  nonce: number;
  action: string;
  snapshot?: PositionSnapshot;
  refreshFailed?: boolean;
};

type WriteArgs = Parameters<ReturnType<typeof useWriteContract>['writeContractAsync']>[0];

const ACTION_LABELS: Record<string, string> = {
  approve: 'Approval',
  reset: 'Approval reset',
  supply: 'Supply',
  borrow: 'Borrow',
  repay: 'Repay',
  withdraw: 'Withdrawal',
  isolate: 'Collateral setting',
  swap: 'Swap',
  mint: 'tBTC mint',
};

export function actionLabel(action: string, extra?: { closing?: boolean }) {
  if (action === 'repay' && extra?.closing) return 'Full repay';
  if (action === 'withdraw' && extra?.closing) return 'Full withdrawal';
  if (action === 'seed') return 'Started tracking';
  return ACTION_LABELS[action] ?? action;
}

function errorText(error: unknown) {
  const shortMessage = error && typeof error === 'object' && 'shortMessage' in error
    ? (error as { shortMessage?: unknown }).shortMessage
    : null;
  const text = typeof shortMessage === 'string' ? shortMessage : error instanceof Error ? error.message : '';
  if (/user rejected|user denied|rejected the request/i.test(text)) return 'Transaction cancelled in the wallet.';
  if (/insufficient funds/i.test(text)) return 'Not enough ETH in this wallet to pay the network fee.';
  if (/chain mismatch|does not match the target chain|ConnectorChainMismatch/i.test(text)) return 'The wallet is on a different network. Switch networks and try again.';
  return text ? (text.length > 160 ? `${text.slice(0, 160)}…` : text) : 'The transaction was not sent.';
}

export type RawTx = {
  to: Address;
  data: Hex;
  value?: bigint;
  chainId: number;
};

function persistReceipt(input: {
  hash: Hex;
  chainId: number;
  action: string;
  receipt: TransactionReceipt;
  ctx: TxContext | null;
  ethUsd: number | null;
}) {
  const l1Fee = 'l1Fee' in input.receipt && typeof input.receipt.l1Fee === 'bigint' ? input.receipt.l1Fee : 0n;
  const feeWei = input.receipt.gasUsed * input.receipt.effectiveGasPrice + l1Fee;
  const usd = input.ethUsd === null ? null : weiToUsd(feeWei, input.ethUsd);
  recordFee({ hash: input.hash, chainId: input.chainId, action: input.action, feeWei: feeWei.toString(), ethUsd: input.ethUsd, at: Date.now() });
  let extra = '';
  if (input.ctx && AUDIT_ACTIONS_SET.has(input.action)) {
    const event = buildAuditEvent({
      hash: input.hash,
      wallet: input.ctx.wallet,
      action: input.action as AuditAction,
      at: Date.now(),
      chainId: input.chainId || input.ctx.venue.chainId,
      venue: input.ctx.venue,
      amount: input.ctx.amount,
      amountUsd: input.ctx.amountUsd,
      amountKind: input.ctx.amountKind,
      debt: input.ctx.debt,
      collateral: input.ctx.collateral,
      healthFactor: input.ctx.healthFactor,
      closing: input.ctx.closing,
      feeWei,
      ethUsd: input.ethUsd,
      previewCurrent: input.ctx.previewCurrent,
      previewProjected: input.ctx.previewProjected,
      previewAt: input.ctx.previewAt,
    });
    persistAuditEvent(event);
    if (event.action === 'repay' && event.interestPaid && event.principalPaid) {
      extra = ` · ${formatToken(BigInt(event.interestPaid), event.decimals)} USDC interest, ${formatToken(BigInt(event.principalPaid), event.decimals)} USDC principal`;
    }
  }
  return { feeWei, usd, extra };
}

export function useSendTx() {
  const { connector, address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const { sendTransactionAsync, isPending: isSending } = useSendTransaction();
  const [hash, setHash] = useState<Hex | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [phase, setPhase] = useState<TxPhase>('idle');
  const [confirmed, setConfirmed] = useState<ConfirmedTx | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [receiptBlockLabel, setReceiptBlockLabel] = useState<string | undefined>();
  const actionRef = useRef('');
  const contextRef = useRef<TxContext | null>(null);
  const handled = useRef('');
  const hashRef = useRef<Hex | undefined>(undefined);
  const phaseRef = useRef<TxPhase>('idle');
  const toastIdRef = useRef<string | number | undefined>(undefined);
  const gateRef = useRef(createSubmissionGate());
  const ethUsdRef = useRef<number | null>(null);
  const { data: receipt, isError } = useWaitForTransactionReceipt({ hash, chainId });
  const ethUsd = useEthUsd();
  ethUsdRef.current = ethUsd;

  function setTxPhase(next: TxPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  async function applyFreshReads(txHash: Hex, snapshot: PositionSnapshot, blockNumber?: bigint) {
    const ctx = contextRef.current;
    const venue = ctx?.positionVenue;
    const user = (ctx?.user ?? ctx?.wallet) as Address | undefined;
    if (!venue || !user) return;
    writeFreshPosition({ venue, user, snapshot, blockNumber });
    try {
      const at = blockNumber;
      const [asset, loan] = await Promise.all([
        readDirectTokenBalance(venue.assetAddress, venue.chainId, user, at),
        readDirectTokenBalance(venue.loanAddress, venue.chainId, user, at),
      ]);
      writeFreshBalance(venue.assetAddress, venue.chainId, user, asset);
      writeFreshBalance(venue.loanAddress, venue.chainId, user, loan);
    } catch {
      // Position is the source of truth; wallet rows refresh from boro:tx as well.
    }
    attachAuditResult(user, txHash, {
      collateral: snapshot.collateral.toString(),
      debt: snapshot.debt.toString(),
      healthFactor: snapshot.healthFactor,
      ltv: snapshot.ltv,
    });
  }

  function noteReconcilePhase(next: ReconcilePhase) {
    if (next === 'RECONCILING_POSITION') setTxPhase('refreshing_position');
    if (next === 'CONFIRMED_ON_CHAIN') setTxPhase('confirmed');
  }

  async function refreshEnrichment(txHash: Hex, blockNumber: bigint, verified: PositionSnapshot) {
    const ctx = contextRef.current;
    const venue = ctx?.positionVenue;
    const user = (ctx?.user ?? ctx?.wallet) as Address | undefined;
    if (!venue || !user) return;
    try {
      const again = await readDirectPosition(venue, user, blockNumber);
      if (again.enrichmentPending) return;
      if (again.snapshot.collateral !== verified.collateral || again.snapshot.debt !== verified.debt) return;
      await applyFreshReads(txHash, again.snapshot, again.blockNumber);
    } catch {
      // Core collateral and debt are already published.
    }
  }

  async function refreshAfterReceipt(txHash: Hex, blockNumber: bigint) {
    const ctx = contextRef.current;
    const action = actionRef.current;
    const venue = ctx?.positionVenue;
    const user = (ctx?.user ?? ctx?.wallet) as Address | undefined;
    if (!ctx || !venue || !user || !isPositionTxAction(action)) {
      return { phase: 'SUCCESS' as const, snapshot: undefined, enrichmentPending: false, blockNumber: undefined as bigint | undefined };
    }
    setNotice(TX_REFRESHING_COPY);
    setTxPhase('refreshing_position');
    toast.dismiss(txHash);
    const expected = expectedFromTx({
      action,
      amount: ctx.amount,
      priorCollateral: ctx.collateral,
      priorDebt: ctx.debt,
      full: ctx.closing,
    });
    if (!expected) {
      return { phase: 'SUCCESS' as const, snapshot: undefined, enrichmentPending: false, blockNumber: undefined as bigint | undefined };
    }
    const result = await reconcileConfirmedTransaction({
      protocol: venue.protocol,
      chainId: venue.chainId,
      marketId: marketIdForVenue(venue),
      wallet: user,
      action: expected.action,
      preCollateral: ctx.collateral ?? 0n,
      preDebt: ctx.debt ?? 0n,
      preShares: ctx.shares,
      expected,
      receiptBlock: blockNumber,
      getBlockNumber: () => observedHead(venue.chainId),
      readOnChain: (block) => readDirectPosition(
        venue,
        user,
        block,
        (snapshot) => positionEffectObserved(snapshot, expected, ctx.shares),
      ),
      onPhase: noteReconcilePhase,
    });
    if (result.blockNumber !== undefined) lastBlock.current = result.blockNumber;
    return result;
  }

  const lastBlock = useRef<bigint | undefined>(undefined);
  const receiptBlock = useRef<bigint | undefined>(undefined);

  async function finishReceipt(txHash: Hex, nextChainId: number, nextReceipt: TransactionReceipt) {
    if (handled.current === txHash) return;
    handled.current = txHash;
    if (nextReceipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
      handled.current = `mismatch:${txHash}`;
      return;
    }
    if (nextReceipt.status !== 'success') {
      setTxPhase('error');
      toast.error('The transaction reverted on-chain. Nothing moved.', { id: txHash });
      gateRef.current.resolve();
      return;
    }
    setTxPhase('confirmed');
    receiptBlock.current = nextReceipt.blockNumber;
    setReceiptBlockLabel(nextReceipt.blockNumber.toString());
    const ctx = contextRef.current;
    const { feeWei, usd, extra } = persistReceipt({
      hash: txHash,
      chainId: nextChainId,
      action: actionRef.current,
      receipt: nextReceipt,
      ctx,
      ethUsd: ethUsdRef.current,
    });
    const action = actionRef.current;
    if (isPositionTxAction(action) && ctx?.positionVenue) {
      const result = await refreshAfterReceipt(txHash, nextReceipt.blockNumber);
      if (result.phase === 'SUCCESS' && result.snapshot) {
        await applyFreshReads(txHash, result.snapshot, lastBlock.current);
        setNotice(result.enrichmentPending ? TX_ENRICHMENT_COPY : undefined);
        setTxPhase('success');
        const feeLine = `Network fee paid: ${formatEth(feeWei)} (${formatFeeUsd(usd)})${extra}`;
        toast.success(`${ACTION_LABELS[action] ?? 'Transaction'} confirmed`, {
          id: txHash,
          duration: 5000,
          description: result.enrichmentPending ? `${feeLine} ${TX_ENRICHMENT_COPY}` : feeLine,
        });
        if (result.enrichmentPending && result.blockNumber !== undefined) {
          void refreshEnrichment(txHash, result.blockNumber, result.snapshot);
        }
        setConfirmed({ nonce: Date.now(), action, snapshot: result.snapshot });
        gateRef.current.resolve();
        window.dispatchEvent(new Event('boro:tx'));
        return;
      }
      const message = TX_POSITION_SYNC_DELAYED_COPY;
      setNotice(message);
      setTxPhase('refresh_failed');
      toast.dismiss(txHash);
      setConfirmed({ nonce: Date.now(), action, refreshFailed: true });
      window.dispatchEvent(new Event('boro:tx'));
      return;
    }
    setTxPhase('success');
    toast.success(`${ACTION_LABELS[action] ?? 'Transaction'} confirmed`, {
      id: txHash,
      duration: 5000,
      description: `Network fee paid: ${formatEth(feeWei)} (${formatFeeUsd(usd)})${extra}`,
    });
    setConfirmed({ nonce: Date.now(), action });
    gateRef.current.resolve();
    window.dispatchEvent(new Event('boro:tx'));
  }

  useEffect(() => {
    if (!hash || !receipt || handled.current === hash) return;
    void finishReceipt(hash, chainId ?? 0, receipt);
    // Receipt handling is owned by start(); this is the fallback if the awaited wait returns later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, receipt, chainId]);

  useEffect(() => {
    if (!hash || !isError || handled.current === `err:${hash}` || handled.current === hash) return;
    handled.current = `err:${hash}`;
    setTxPhase('error');
    toast.error('The transaction reverted on-chain. Nothing moved.', { id: hash });
    gateRef.current.resolve();
  }, [hash, isError]);

  function applyHash(txHash: Hex, nextChainId: number, label: string, toastId: string | number) {
    hashRef.current = txHash;
    gateRef.current.setHash(txHash);
    setChainId(nextChainId);
    setHash(txHash);
    setTxPhase(phaseAfterHashReturned());
    toast.dismiss(toastId);
    toast.loading(`${label} sent. Waiting for the network to confirm…`, { id: txHash });
    setTxPhase('awaiting_receipt');
  }

  async function recoverHashFromChain(
    nextChainId: number,
    to: Address | undefined,
    toastId: string | number,
    startNonce: number,
  ) {
    const account = (contextRef.current?.user ?? contextRef.current?.wallet ?? address) as Address | undefined;
    if (!account || (nextChainId !== 1 && nextChainId !== 8453)) return null;
    const client = publicClient(nextChainId);
    return watchSubmittedTransaction({
      startNonce,
      readNonces: async () => {
        const latest = await client.getTransactionCount({ address: account, blockTag: 'latest' });
        const pending = await client.getTransactionCount({ address: account, blockTag: 'pending' }).catch(() => latest);
        return { latest, pending };
      },
      findHash: () => findTxByNonce({
        getBlockNumber: () => client.getBlockNumber(),
        getBlock: async (blockNumber) => {
          const block = await client.getBlock({ blockNumber, includeTransactions: true });
          return {
            transactions: block.transactions.map((tx) => (
              typeof tx === 'string' ? tx : { hash: tx.hash, from: tx.from, to: tx.to ?? null, nonce: tx.nonce }
            )),
          };
        },
        account,
        startNonce,
        to,
      }),
      onSubmitted: () => {
        if (hashRef.current || phaseRef.current !== 'awaiting_wallet') return;
        setTxPhase('submitted');
        toast.loading(TX_SUBMITTED_COPY, { id: toastId });
      },
      isCancelled: () => Boolean(hashRef.current) || phaseRef.current === 'idle' || phaseRef.current === 'error',
    });
  }

  async function start(action: string, nextChainId: number, sendFn: () => Promise<Hex>, context?: TxContext, to?: Address) {
    if (!canSubmitTransaction(phaseRef.current, hashRef.current) || !gateRef.current.tryBegin()) return;
    actionRef.current = action;
    contextRef.current = context ?? null;
    handled.current = '';
    hashRef.current = undefined;
    setHash(undefined);
    setConfirmed(null);
    setNotice(undefined);
    setReceiptBlockLabel(undefined);
    setTxPhase('awaiting_wallet');
    const label = ACTION_LABELS[action] ?? 'Transaction';
    const prompt = walletUsesPhone(connector?.id)
      ? `Open ${connector?.id === 'coinbaseWalletSDK' ? 'Coinbase Wallet' : 'your wallet app'} on your phone to confirm the ${label.toLowerCase()}.`
      : `Confirm the ${label.toLowerCase()} in your wallet.`;
    const toastId = toast.loading(prompt);
    toastIdRef.current = toastId;
    const account = (context?.user ?? context?.wallet ?? address) as Address | undefined;
    let startNonce: number | undefined;
    if (account && (nextChainId === 1 || nextChainId === 8453)) {
      try {
        startNonce = await publicClient(nextChainId).getTransactionCount({ address: account, blockTag: 'latest' });
      } catch {
        startNonce = undefined;
      }
    }
    try {
      const txHash = await new Promise<Hex>((resolve, reject) => {
        let settled = false;
        sendFn().then((hash) => {
          if (!settled) {
            settled = true;
            resolve(hash);
          }
        }, (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
        if (startNonce === undefined) return;
        void recoverHashFromChain(nextChainId, to, toastId, startNonce).then((hash) => {
          if (hash && !settled) {
            settled = true;
            resolve(hash);
          }
        }).catch(() => undefined);
      });
      applyHash(txHash, nextChainId, label, toastId);
      const nextReceipt = await waitForTransactionReceipt(config, { hash: txHash, chainId: nextChainId as 1 | 8453 });
      await finishReceipt(txHash, nextChainId, nextReceipt);
    } catch (error) {
      if (hashRef.current) {
        if (handled.current !== hashRef.current) {
          toast.loading(`${ACTION_LABELS[actionRef.current] ?? 'Transaction'} sent. Waiting for the network to confirm…`, { id: hashRef.current });
        }
        return;
      }
      toast.error(errorText(error), { id: toastId });
      setTxPhase('error');
      gateRef.current.resolve();
    }
  }

  async function send(action: string, args: WriteArgs, context?: TxContext) {
    await start(action, args.chainId as number, () => writeContractAsync(args), context, args.address);
  }

  async function sendRaw(action: string, tx: RawTx, context?: TxContext) {
    await start(action, tx.chainId, () => sendTransactionAsync({
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      chainId: tx.chainId,
    }), context, tx.to);
  }

  function markRefreshFailed(txHash: Hex, message: string) {
    setNotice(message);
    setTxPhase('refresh_failed');
    toast.dismiss(txHash);
    setConfirmed({ nonce: Date.now(), action: actionRef.current, refreshFailed: true });
  }

  async function retryPositionRefresh() {
    const txHash = hashRef.current;
    const ctx = contextRef.current;
    if (!txHash || !ctx?.positionVenue || phaseRef.current !== 'refresh_failed') return;
    const nextChainId = chainId === 1 || chainId === 8453 ? chainId : ctx.positionVenue.chainId;
    setNotice(TX_RETRY_CHECKING_COPY);
    setTxPhase('refreshing_position');
    try {
      const mined = await findReceipt(nextChainId, txHash);
      if (!mined || mined.status !== 'success') {
        markRefreshFailed(txHash, TX_NOT_MINED_COPY);
        return;
      }
      receiptBlock.current = mined.blockNumber;
      setReceiptBlockLabel(mined.blockNumber.toString());
      const result = await refreshAfterReceipt(txHash, mined.blockNumber);
      if (result.phase === 'SUCCESS' && result.snapshot) {
        await applyFreshReads(txHash, result.snapshot, lastBlock.current);
        setNotice(result.enrichmentPending ? TX_ENRICHMENT_COPY : undefined);
        setTxPhase('success');
        toast.success(`${ACTION_LABELS[actionRef.current] ?? 'Transaction'} confirmed`, {
          id: txHash,
          duration: 5000,
          description: result.enrichmentPending ? TX_ENRICHMENT_COPY : undefined,
        });
        if (result.enrichmentPending && result.blockNumber !== undefined) {
          void refreshEnrichment(txHash, result.blockNumber, result.snapshot);
        }
        setConfirmed({ nonce: Date.now(), action: actionRef.current, snapshot: result.snapshot });
        gateRef.current.resolve();
        window.dispatchEvent(new Event('boro:tx'));
        return;
      }
      markRefreshFailed(txHash, TX_POSITION_SYNC_DELAYED_COPY);
    } catch {
      markRefreshFailed(txHash, TX_POSITION_SYNC_DELAYED_COPY);
    }
  }

  function cancelPending() {
    if (hashRef.current && (phaseRef.current === 'refresh_failed' || phaseRef.current === 'error')) {
      gateRef.current.resolve();
      hashRef.current = undefined;
      setHash(undefined);
      setConfirmed(null);
      setTxPhase('idle');
      return;
    }
    if (hashRef.current) return;
    gateRef.current.unlockIfNoHash();
    toast.dismiss(toastIdRef.current);
    setTxPhase('idle');
  }

  const unresolved = Boolean(hash) && (phase === 'submitted' || phase === 'awaiting_receipt' || phase === 'confirmed' || phase === 'refreshing_position' || phase === 'refresh_failed');
  const inFlight = phase === 'awaiting_wallet' || phase === 'submitted' || phase === 'awaiting_receipt' || phase === 'confirmed' || phase === 'refreshing_position';

  return {
    send,
    sendRaw,
    retryPositionRefresh,
    cancelPending,
    notice,
    isBusy: inFlight || ((isPending || isSending) && phase !== 'success' && phase !== 'error' && phase !== 'idle'),
    isAwaitingWallet: isAwaitingWalletPhase(phase, hash),
    confirmed,
    hash,
    phase,
    receiptBlock: receiptBlockLabel,
    statusMessage: refreshStatusMessage(phase, notice),
    unresolved,
  };
}
