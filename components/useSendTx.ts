'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import type { Hex } from 'viem';
import { toast } from 'sonner';
import { walletUsesPhone } from './useNetworkSwitch';
import { formatEth, formatFeeUsd, recordFee, useEthUsd, weiToUsd } from './useNetworkFee';

type WriteArgs = Parameters<ReturnType<typeof useWriteContract>['writeContractAsync']>[0];

const ACTION_LABELS: Record<string, string> = {
  approve: 'Approval',
  reset: 'Approval reset',
  supply: 'Supply',
  borrow: 'Borrow',
  repay: 'Repay',
  withdraw: 'Withdrawal',
  isolate: 'Collateral setting',
};

export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? 'Transaction';
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

export function useSendTx() {
  const { connector } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [hash, setHash] = useState<Hex | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [confirmed, setConfirmed] = useState<{ nonce: number; action: string } | null>(null);
  const actionRef = useRef('');
  const handled = useRef('');
  const { data: receipt, isLoading, isSuccess, isError } = useWaitForTransactionReceipt({ hash, chainId });
  const ethUsd = useEthUsd();

  useEffect(() => {
    if (!hash || !isSuccess || !receipt || handled.current === hash) return;
    handled.current = hash;
    const l1Fee = 'l1Fee' in receipt && typeof receipt.l1Fee === 'bigint' ? receipt.l1Fee : 0n;
    const feeWei = receipt.gasUsed * receipt.effectiveGasPrice + l1Fee;
    const usd = ethUsd === null ? null : weiToUsd(feeWei, ethUsd);
    recordFee({ hash, chainId: chainId ?? 0, action: actionRef.current, feeWei: feeWei.toString(), ethUsd, at: Date.now() });
    toast.success(`${ACTION_LABELS[actionRef.current] ?? 'Transaction'} confirmed`, {
      id: hash,
      description: `Network fee paid: ${formatEth(feeWei)} (${formatFeeUsd(usd)})`,
    });
    setConfirmed({ nonce: Date.now(), action: actionRef.current });
  }, [hash, isSuccess, receipt, chainId, ethUsd]);

  useEffect(() => {
    if (!hash || !isError || handled.current === `err:${hash}`) return;
    handled.current = `err:${hash}`;
    toast.error('The transaction reverted on-chain. Nothing moved.', { id: hash });
  }, [hash, isError]);

  async function send(action: string, args: WriteArgs) {
    actionRef.current = action;
    const label = ACTION_LABELS[action] ?? 'Transaction';
    const prompt = walletUsesPhone(connector?.id)
      ? `Open ${connector?.id === 'coinbaseWalletSDK' ? 'Coinbase Wallet' : 'your wallet app'} on your phone to confirm the ${label.toLowerCase()}.`
      : `Confirm the ${label.toLowerCase()} in your wallet.`;
    const toastId = toast.loading(prompt);
    try {
      const txHash = await writeContractAsync(args);
      setChainId(args.chainId);
      setHash(txHash);
      toast.dismiss(toastId);
      toast.loading(`${label} sent. Waiting for the network to confirm…`, { id: txHash });
    } catch (error) {
      toast.error(errorText(error), { id: toastId });
    }
  }

  return { send, isBusy: isPending || isLoading, isAwaitingWallet: isPending, confirmed };
}
