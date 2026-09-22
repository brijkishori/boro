'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { chainLabel, type ChainId } from '@/lib/protocol';

const SWITCH_TIMEOUT_MS = 60_000;
const TOAST_ID = 'network-switch';

type Pending = { chainId: ChainId; attempt: number } | null;

let pending: Pending = null;
let attempts = 0;
const listeners = new Set<() => void>();

function setPending(next: Pending) {
  pending = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isRejection(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : '';
  return /user rejected|user denied|rejected the request|UserRejected/i.test(text);
}

export function walletUsesPhone(connectorId: string | undefined) {
  return connectorId === 'coinbaseWalletSDK' || connectorId === 'walletConnect';
}

export function useNetworkSwitch() {
  const { chain, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const current = useSyncExternalStore(subscribe, () => pending, () => null);
  const viaPhone = walletUsesPhone(connector?.id);
  const walletName = connector?.id === 'coinbaseWalletSDK' ? 'Coinbase Wallet' : connector?.name ?? 'your wallet';

  useEffect(() => {
    if (current && chain?.id === current.chainId) {
      setPending(null);
      toast.success(`Wallet is on ${chainLabel(current.chainId)}`, { id: TOAST_ID });
    }
  }, [chain?.id, current]);

  async function switchTo(chainId: ChainId): Promise<boolean> {
    if (chain?.id === chainId) return true;
    const attempt = ++attempts;
    setPending({ chainId, attempt });
    const label = chainLabel(chainId);
    toast.loading(
      viaPhone
        ? `Open ${walletName} on your phone and approve the switch to ${label}.`
        : `Approve the switch to ${label} in ${walletName}.`,
      { id: TOAST_ID, duration: SWITCH_TIMEOUT_MS },
    );
    let timer = 0;
    try {
      await Promise.race([
        switchChainAsync({ chainId }),
        new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error('timeout')), SWITCH_TIMEOUT_MS);
        }),
      ]);
      if (pending?.attempt !== attempt) return false;
      setPending(null);
      toast.success(`Wallet is on ${label}`, { id: TOAST_ID });
      return true;
    } catch (error) {
      if (pending?.attempt !== attempt) return false;
      setPending(null);
      if (isRejection(error)) {
        toast.error('Network switch cancelled in the wallet.', { id: TOAST_ID });
      } else if (error instanceof Error && error.message === 'timeout') {
        toast.error(`${walletName} did not answer. Change the network to ${label} inside the wallet, then come back.`, { id: TOAST_ID, duration: 10_000 });
      } else {
        toast.error(`${walletName} could not switch to ${label}. Change the network inside the wallet.`, { id: TOAST_ID, duration: 10_000 });
      }
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function cancel() {
    if (!pending) return;
    setPending(null);
    toast.dismiss(TOAST_ID);
  }

  return {
    switchTo,
    cancel,
    pendingChainId: current?.chainId ?? null,
    viaPhone,
    walletName,
  };
}
