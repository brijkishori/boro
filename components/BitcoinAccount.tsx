'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { isBitcoinMainnetAddress, isTbtcRecoveryAddress } from '@/lib/btc';
import {
  BTC_ADDRESS_EVENT,
  connectInjectedBitcoinAddress,
  hasBitcoinWallet,
  readBitcoinAddress,
  rememberBitcoinAddress,
  storedBitcoinAddress,
} from '@/lib/bitcoin-wallet';
import { cancelBitcoinPairing, pairBitcoinWallet } from '@/lib/bitcoin-wc';
import { inAppWalletId, isCoinbaseDappBrowser, isPhone, openWalletUrl, phoneFallbackHref, phoneOpenHref, scannableWalletUri } from '@/lib/wallets';

type Snapshot = {
  address: string;
  confirmedSats: number;
  unconfirmedSats: number;
};

type BitcoinAccountValue = {
  address: string;
  confirmedSats: number;
  unconfirmedSats: number;
  sats: number;
  loading: boolean;
  connecting: boolean;
  awaitingAddress: boolean;
  pairingUri: string;
  scanUri: string;
  hint: string;
  error: string;
  wallet: boolean;
  canMint: boolean;
  phone: boolean;
  openHref: string;
  fallbackHref: string;
  connect: () => Promise<void>;
  pairOther: () => Promise<void>;
  readClipboard: () => Promise<string>;
  cancel: () => void;
  apply: (nextAddress: string) => Promise<string>;
  reload: (nextAddress?: string) => Promise<string>;
};

const BitcoinAccountContext = createContext<BitcoinAccountValue | null>(null);

const COINBASE_HINT = 'Coinbase Wallet can open a scanned code without sending Bitcoin back here. In the wallet open Bitcoin → Receive, copy the bc1q… address, then paste it below.';

export function BitcoinAccountProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState('');
  const [confirmedSats, setConfirmedSats] = useState(0);
  const [unconfirmedSats, setUnconfirmedSats] = useState(0);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pairingUri, setPairingUri] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [wallet, setWallet] = useState(false);
  const [phone, setPhone] = useState(false);
  const [awaitingAddress, setAwaitingAddress] = useState(false);
  const [otherWallet, setOtherWallet] = useState(false);
  const attempt = useRef(0);

  const load = useCallback(async (nextAddress?: string) => {
    const trimmed = (nextAddress ?? storedBitcoinAddress() ?? '').trim();
    if (!isBitcoinMainnetAddress(trimmed)) {
      setAddress('');
      setConfirmedSats(0);
      setUnconfirmedSats(0);
      return '';
    }
    setAddress(trimmed);
    rememberBitcoinAddress(trimmed);
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/btc?address=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
      const body = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not read that Bitcoin address.');
      setConfirmedSats(body.confirmedSats);
      setUnconfirmedSats(body.unconfirmedSats);
      return trimmed;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that Bitcoin address.');
      return trimmed;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setWallet(hasBitcoinWallet() || isCoinbaseDappBrowser());
    setPhone(isPhone());
    void (async () => {
      const saved = storedBitcoinAddress() || (await readBitcoinAddress());
      if (saved) await load(saved);
    })();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      const saved = storedBitcoinAddress();
      if (saved) void load(saved);
    };
    window.addEventListener(BTC_ADDRESS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(BTC_ADDRESS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [load]);

  const takeAddress = useCallback(async (nextAddress: string) => {
    const trimmed = nextAddress.trim();
    if (!isBitcoinMainnetAddress(trimmed)) return '';
    setAwaitingAddress(false);
    setOtherWallet(false);
    setPairingUri('');
    setHint('');
    cancelBitcoinPairing();
    return load(trimmed);
  }, [load]);

  useEffect(() => {
    if (!awaitingAddress || address) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void navigator.clipboard?.readText().then((text) => {
        if (isBitcoinMainnetAddress(text.trim())) void takeAddress(text);
      }).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [address, awaitingAddress, takeAddress]);

  const cancel = useCallback(() => {
    attempt.current += 1;
    cancelBitcoinPairing();
    setConnecting(false);
    setAwaitingAddress(false);
    setOtherWallet(false);
    setPairingUri('');
    setHint('');
  }, []);

  const readClipboard = useCallback(async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!isBitcoinMainnetAddress(text)) {
        setHint('Copy the bc1q… address from Coinbase Wallet → Bitcoin → Receive, then tap Paste from clipboard.');
        return '';
      }
      const next = await takeAddress(text);
      if (next) toast.success('Bitcoin ready', { description: next });
      return next;
    } catch {
      setHint('Allow clipboard access, or paste the address into the field.');
      return '';
    }
  }, [takeAddress]);

  const connect = useCallback(async () => {
    const id = ++attempt.current;
    setConnecting(true);
    setError('');
    setHint('Looking for a Bitcoin wallet…');
    setPairingUri('');
    setOtherWallet(false);
    setAwaitingAddress(false);
    try {
      const injected = await connectInjectedBitcoinAddress();
      if (attempt.current !== id) return;
      if (injected) {
        await load(injected);
        toast.success('Bitcoin ready', { description: injected });
        setHint('');
        return;
      }
      setAwaitingAddress(true);
      setHint(COINBASE_HINT);
      void navigator.clipboard?.readText().then((text) => {
        if (attempt.current !== id) return;
        if (isBitcoinMainnetAddress(text.trim())) void takeAddress(text).then((next) => {
          if (next) toast.success('Bitcoin ready', { description: next });
        });
      }).catch(() => undefined);
    } catch (err) {
      if (attempt.current !== id) return;
      setAwaitingAddress(true);
      setHint(err instanceof Error && err.message ? err.message : COINBASE_HINT);
    } finally {
      if (attempt.current === id) setConnecting(false);
    }
  }, [load, takeAddress]);

  const pairOther = useCallback(async () => {
    const id = ++attempt.current;
    setConnecting(true);
    setError('');
    setHint('Opening a Bitcoin pairing for UniSat, OKX, or Phantom…');
    setPairingUri('');
    setOtherWallet(true);
    setAwaitingAddress(false);
    try {
      const next = await pairBitcoinWallet((uri) => {
        if (attempt.current !== id) return;
        setPairingUri(uri);
        setHint('Scan with UniSat, OKX, or Phantom. Coinbase Wallet will not finish this pairing.');
        const href = phoneOpenHref(inAppWalletId() ?? 'okxWallet', uri);
        if (isPhone() && href) openWalletUrl(href);
      });
      if (attempt.current !== id) return;
      await load(next);
      toast.success('Bitcoin ready', { description: next });
      setHint('');
      setPairingUri('');
      setOtherWallet(false);
    } catch (err) {
      if (attempt.current !== id) return;
      setPairingUri('');
      setOtherWallet(false);
      setAwaitingAddress(true);
      const text = err instanceof Error ? err.message : '';
      if (/user rejected|user denied|rejected the request|cancelled/i.test(text)) {
        setHint('Bitcoin approval was cancelled. Paste the receive address from the wallet instead.');
      } else {
        setHint(text || COINBASE_HINT);
      }
    } finally {
      if (attempt.current === id) setConnecting(false);
    }
  }, [load]);

  const apply = useCallback(async (nextAddress: string) => {
    const trimmed = nextAddress.trim();
    if (!isBitcoinMainnetAddress(trimmed)) {
      setHint('Paste a Bitcoin receive address from the wallet app.');
      return '';
    }
    attempt.current += 1;
    cancelBitcoinPairing();
    setConnecting(false);
    setPairingUri('');
    setOtherWallet(false);
    const next = await takeAddress(trimmed);
    if (next) toast.success('Bitcoin ready', { description: next });
    return next;
  }, [takeAddress]);

  const walletChoice = otherWallet ? (inAppWalletId() ?? 'okxWallet') : (inAppWalletId() ?? 'coinbase');
  const value = useMemo<BitcoinAccountValue>(() => ({
    address,
    confirmedSats,
    unconfirmedSats,
    sats: confirmedSats + Math.max(0, unconfirmedSats),
    loading,
    connecting,
    awaitingAddress,
    pairingUri,
    scanUri: pairingUri ? (otherWallet ? pairingUri : scannableWalletUri(walletChoice, pairingUri)) : '',
    hint,
    error,
    wallet,
    canMint: isTbtcRecoveryAddress(address),
    phone,
    openHref: pairingUri ? phoneOpenHref(walletChoice, pairingUri) : '',
    fallbackHref: pairingUri ? phoneFallbackHref(walletChoice, pairingUri) : '',
    connect,
    pairOther,
    readClipboard,
    cancel,
    apply,
    reload: load,
  }), [address, apply, awaitingAddress, cancel, confirmedSats, connect, connecting, error, hint, load, loading, pairingUri, pairOther, phone, readClipboard, unconfirmedSats, wallet, walletChoice, otherWallet]);

  return <BitcoinAccountContext.Provider value={value}>{children}</BitcoinAccountContext.Provider>;
}

export function useBitcoinAccount() {
  const value = useContext(BitcoinAccountContext);
  if (!value) throw new Error('BitcoinAccountProvider is missing.');
  return value;
}
