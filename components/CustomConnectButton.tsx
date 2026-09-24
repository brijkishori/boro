'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useConnect, useDisconnect, useReconnect } from 'wagmi';
import { base, mainnet } from 'wagmi/chains';
import { UserRejectedRequestError } from 'viem';
import { toast } from 'sonner';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import WalletQr from '@/components/WalletQr';
import { readStoredNetwork } from '@/components/NetworkFilter';
import { useNetworkSwitch } from '@/components/useNetworkSwitch';
import { config } from '@/lib/config';
import {
  WALLET_CHOICES,
  WALLET_RDNS,
  coinbaseLinkFromStorage,
  coinbaseSessionId,
  inAppWalletId,
  isPhone,
  isScannableUri,
  isWalletConnectUri,
  openWalletDapp,
  openWalletUrl,
  phoneFallbackHref,
  phoneOpenHref,
  walletDappUrl,
  type WalletChoice,
} from '@/lib/wallets';

type Device = 'mobile' | 'desktop';

function connectChain(): { chainId?: 1 | 8453 } {
  const view = readStoredNetwork();
  return view === 'all' ? {} : { chainId: view };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The wallet did not respond.')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function Overlay({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? document.body : null,
  );
  useEffect(() => {
    setRoot(document.body);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  if (!root) return null;
  return createPortal(children, root);
}

function failureMessage(error: unknown, name: string) {
  if (error instanceof UserRejectedRequestError) return 'Connection cancelled. Choose a wallet to try again.';
  const text = error instanceof Error ? error.message : 'Could not connect that wallet.';
  if (/user rejected|user denied|rejected the request|closed the window/i.test(text)) {
    return 'Connection cancelled. Choose a wallet to try again.';
  }
  if (/provider not found|not installed|no provider|not been detected/i.test(text)) {
    return `${name} is not available in this browser.`;
  }
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

export default function CustomConnectButton() {
  const { address, chain, isConnected, status } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect, disconnectAsync } = useDisconnect();
  const { reconnect } = useReconnect();
  const network = useNetworkSwitch();
  const [showTerms, setShowTerms] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [phone, setPhone] = useState(false);
  const autoOpened = useRef(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [restoreSettled, setRestoreSettled] = useState(false);
  const [qrWallet, setQrWallet] = useState<WalletChoice | null>(null);
  const [handoff, setHandoff] = useState<WalletChoice | null>(null);
  const [uri, setUri] = useState('');
  const [openReady, setOpenReady] = useState(false);
  const qrAttempt = useRef(0);
  const expectingUri = useRef(false);
  const coinbaseReset = useRef<Promise<void>>(Promise.resolve());

  const walletConnect = useMemo(
    () => connectors.find((connector) => connector.id === 'walletConnect') ?? null,
    [connectors],
  );
  const coinbaseMobile = useMemo(
    () => connectors.find((connector) => connector.id === 'coinbaseWalletSDK') ?? null,
    [connectors],
  );

  useEffect(() => {
    setAccepted(window.localStorage.getItem('simplebtc_terms_accepted') === 'true');
    const onPhone = isPhone();
    setPhone(onPhone);
    setDevice(onPhone ? 'mobile' : 'desktop');
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let done = 0;
    const retry = () => {
      if (!cancelled && config.state.status !== 'connected') void reconnect();
    };
    const storage = config.storage;
    if (!storage) {
      setRestoreSettled(true);
      return;
    }
    void Promise.resolve(storage.getItem('recentConnectorId')).then((recent: string | null) => {
      if (cancelled) return;
      if (!recent || (isPhone() && recent === 'coinbaseWalletSDK')) {
        setRestoreSettled(true);
        return;
      }
      timer = window.setTimeout(retry, 700);
      window.addEventListener('eip6963:announceProvider', retry);
      done = window.setTimeout(() => {
        if (!cancelled) setRestoreSettled(true);
      }, 1_600);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(done);
      window.removeEventListener('eip6963:announceProvider', retry);
    };
  }, [reconnect]);

  useEffect(() => {
    if (!isConnected) return;
    qrAttempt.current += 1;
    expectingUri.current = false;
    setShowWallets(false);
    setQrWallet(null);
    setHandoff(null);
    setUri('');
    setPendingId(null);
  }, [isConnected]);

  useEffect(() => {
    setOpenReady(false);
    if (!isScannableUri(uri)) return;
    const timer = window.setTimeout(() => setOpenReady(true), 800);
    return () => window.clearTimeout(timer);
  }, [uri]);

  useEffect(() => {
    if (!walletConnect) return;
    const onMessage = (message: { type: string; data?: unknown }) => {
      if (!expectingUri.current) return;
      if (message.type === 'display_uri' && typeof message.data === 'string' && isWalletConnectUri(message.data)) {
        setUri(message.data);
      }
    };
    walletConnect.emitter.on('message', onMessage);
    return () => {
      walletConnect.emitter.off('message', onMessage);
    };
  }, [walletConnect]);

  useEffect(() => {
    const found = new Set<string>();
    const mark = (id: string | undefined) => {
      if (id) found.add(id);
    };
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { rdns?: string; name?: string } }>).detail;
      mark(detail?.info?.rdns ? WALLET_RDNS[detail.info.rdns] : undefined);
      setInstalled([...found]);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const browser = window as Window & { coinbaseWalletExtension?: unknown; ethereum?: Record<string, unknown> };
    if (browser.coinbaseWalletExtension) mark('coinbaseExtension');
    const ethereum = browser.ethereum;
    if (ethereum) {
      if (ethereum.isRabby) mark('rabby');
      else if (ethereum.isBraveWallet) mark('braveWallet');
      else if (ethereum.isPhantom) mark('phantom');
      else if (ethereum.isRainbow) mark('rainbow');
      else if (ethereum.isTrust || ethereum.isTrustWallet) mark('trustWallet');
      else if (ethereum.isOkxWallet) mark('okxWallet');
      else if (ethereum.isZerion) mark('zerion');
      else if (ethereum.isCoinbaseWallet) mark('coinbaseExtension');
      else if (ethereum.isMetaMask) mark('metaMask');
      setInstalled([...found]);
    }
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  const visible = more ? WALLET_CHOICES : WALLET_CHOICES.filter((choice) => choice.primary);

  function openFlow() {
    setError('');
    setQrWallet(null);
    setUri('');
    if (accepted) setShowWallets(true);
    else setShowTerms(true);
  }

  function waitForNewCoinbaseSession(previousId: string) {
    const started = Date.now();
    return new Promise<void>((resolve) => {
      const tick = () => {
        const next = coinbaseSessionId();
        if ((next && next !== previousId) || Date.now() - started > 2_500) resolve();
        else window.setTimeout(tick, 50);
      };
      tick();
    });
  }

  async function stopQr() {
    const cancellingCoinbase = qrWallet?.id === 'coinbase';
    const previous = cancellingCoinbase ? coinbaseSessionId() : '';
    qrAttempt.current += 1;
    expectingUri.current = false;
    setQrWallet(null);
    setHandoff(null);
    setUri('');
    setPendingId(null);
    const reset = (async () => {
      if (cancellingCoinbase) await coinbaseMobile?.disconnect().catch(() => undefined);
      await walletConnect?.disconnect().catch(() => undefined);
      if (previous) await waitForNewCoinbaseSession(previous);
    })();
    coinbaseReset.current = reset;
    await reset;
  }

  async function startCoinbaseQr(choice: WalletChoice) {
    const attempt = ++qrAttempt.current;
    expectingUri.current = false;
    setQrWallet(choice);
    setUri('');
    setError('');
    if (!coinbaseMobile) {
      setError('Coinbase Wallet connection is unavailable. Refresh the page and try again.');
      return;
    }
    setPendingId(coinbaseMobile.uid);
    try {
      await coinbaseReset.current;
      if (qrAttempt.current !== attempt) return;
      await withTimeout(coinbaseMobile.getProvider(), 8_000);
      let link = coinbaseLinkFromStorage(base.id);
      const started = Date.now();
      while (!link && Date.now() - started < 2_500) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        if (qrAttempt.current !== attempt) return;
        link = coinbaseLinkFromStorage(base.id);
      }
      if (qrAttempt.current !== attempt) return;
      if (!link) {
        if (phone) {
          setError('Coinbase Wallet could not start a session. Close and try again.');
          setPendingId(null);
          return;
        }
        const extension = connectors.find((item) => item.id === 'coinbaseExtension') ?? coinbaseMobile;
        setQrWallet(null);
        setUri('');
        await withTimeout(connectAsync({ connector: extension, ...connectChain() }), 20_000);
        if (qrAttempt.current === attempt) toast.success(`${choice.name} connected`);
        return;
      }
      setUri(link);
      await connectAsync({ connector: coinbaseMobile, ...connectChain() });
      if (qrAttempt.current === attempt) toast.success(`${choice.name} connected`);
    } catch (caught) {
      if (qrAttempt.current !== attempt) return;
      setError(failureMessage(caught, choice.name));
      setPendingId(null);
    }
  }

  async function startQr(choice: WalletChoice) {
    const attempt = ++qrAttempt.current;
    expectingUri.current = true;
    setQrWallet(choice);
    setUri('');
    setError('');
    if (!walletConnect) {
      setError('Mobile connection is unavailable. Refresh the page and try again.');
      return;
    }
    setPendingId(walletConnect.uid);
    try {
      await walletConnect.disconnect().catch(() => undefined);
      if (qrAttempt.current !== attempt) return;
      await connectAsync({ connector: walletConnect, ...connectChain() });
      if (qrAttempt.current === attempt) toast.success(`${choice.name} connected`);
    } catch (caught) {
      if (qrAttempt.current !== attempt) return;
      setError(failureMessage(caught, choice.name));
      setPendingId(null);
    }
  }

  async function connectInjected(choice: WalletChoice) {
    const connector = connectors.find((item) => item.id === choice.desktopId);
    if (!connector) return false;
    setPendingId(connector.uid);
    const provider = await withTimeout(connector.getProvider(), 2_500);
    if (!provider) throw new Error(`${choice.name} is not available in this browser.`);
    await withTimeout(connectAsync({ connector, ...connectChain() }), 20_000);
    toast.success(`${choice.name} connected`);
    return true;
  }

  function openInWalletApp(choice: WalletChoice) {
    const dapp = walletDappUrl(choice.id);
    if (dapp && openWalletUrl(dapp)) {
      setHandoff(choice);
      setPendingId(choice.id);
      setError('');
      return true;
    }
    return false;
  }

  async function choose(choice: WalletChoice) {
    setError('');
    const injectedHere = installed.includes(choice.desktopId) || inAppWalletId() === choice.id;
    if (injectedHere) {
      try {
        await connectInjected(choice);
        return;
      } catch (caught) {
        const message = failureMessage(caught, choice.name);
        if (/cancelled/i.test(message)) {
          setError(message);
          setPendingId(null);
          return;
        }
      }
    }
    if (phone) {
      if (openWalletDapp(choice.id)) return;
      setError(`Open this site inside ${choice.name}, then tap Connect again.`);
      return;
    }
    if (choice.id === 'coinbase') await startCoinbaseQr(choice);
    else await startQr(choice);
  }

  useEffect(() => {
    if (autoOpened.current || isConnected) return;
    const tryInApp = () => {
      if (autoOpened.current || isConnected) return true;
      const inApp = inAppWalletId();
      if (!inApp) return false;
      const choice = WALLET_CHOICES.find((item) => item.id === inApp);
      if (!choice) return false;
      autoOpened.current = true;
      window.localStorage.setItem('simplebtc_terms_accepted', 'true');
      setAccepted(true);
      void connectInjected(choice).catch((caught) => {
        autoOpened.current = false;
        setError(failureMessage(caught, choice.name));
        setPendingId(null);
      });
      return true;
    };
    if (tryInApp()) return;
    const timer = window.setInterval(() => {
      if (tryInApp()) window.clearInterval(timer);
    }, 300);
    const stop = window.setTimeout(() => window.clearInterval(timer), 4_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [isConnected]);

  function switchNetwork() {
    if (network.pendingChainId) {
      network.cancel();
      return;
    }
    void network.switchTo(chain?.id === base.id ? mainnet.id : base.id);
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success('Address copied');
    } catch {
      toast.error('Could not copy the address');
    }
  }

  return (
    <>
      {isConnected && address ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 gap-1.5 px-2 text-xs font-bold sm:h-10 sm:px-3 sm:text-sm"
            title={network.pendingChainId ? 'Stop waiting for the wallet' : `Switch to ${chain?.id === base.id ? 'Ethereum' : 'Base'}`}
            onClick={switchNetwork}
          >
            {network.pendingChainId ? (
              <span>Approve…</span>
            ) : (
              <>
                <span className={`h-2 w-2 rounded-full ${chain?.id === base.id || chain?.id === mainnet.id ? 'bg-blue-500' : 'bg-red-500'}`} />
                <span>{chain?.id === base.id ? 'Base' : chain?.id === mainnet.id ? 'ETH' : '!'}</span>
                <span aria-hidden className="hidden text-muted-foreground sm:inline">⇄</span>
              </>
            )}
          </Button>
          <Button type="button" variant="outline" className="h-9 min-w-0 shrink px-2 text-xs font-bold sm:h-10 sm:px-3 sm:text-sm" title="Copy address" onClick={() => void copyAddress()}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate">{`${address.slice(0, 4)}…${address.slice(-4)}`}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="hidden h-10 shrink-0 font-bold sm:inline-flex"
            onClick={() => void disconnectAsync().catch(() => disconnect())}
          >
            Disconnect
          </Button>
        </div>
      ) : !restoreSettled || status === 'reconnecting' ? (
        <Button type="button" variant="outline" className="h-9 px-2 text-xs font-bold sm:h-10 sm:px-3 sm:text-sm" disabled>
          Restoring…
        </Button>
      ) : (
        <Button type="button" onClick={openFlow} className="h-9 bg-blue-600 px-2.5 text-xs font-bold text-white hover:bg-blue-700 sm:h-10 sm:px-4 sm:text-sm">
          Connect
        </Button>
      )}

      {showTerms && (
        <Overlay>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Terms of service"
          className="fixed inset-0 z-[9999] flex h-[100dvh] max-h-[100dvh] items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <Card className="max-h-[min(85dvh,100%)] w-full max-w-lg overflow-y-auto rounded-xl border-muted shadow-2xl dark:bg-zinc-950">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <CardTitle className="text-2xl font-bold tracking-tight">
                Welcome to Simple<span className="text-blue-500">BTC</span> Borrow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6 text-sm text-muted-foreground">
              <p>Before you can connect your wallet, you must review and accept our Terms of Service.</p>
              <div className="h-32 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed text-foreground">
                <p><strong>1. Non-Custodial:</strong> This is a UI for Morpho and Aave. We do not hold or control your funds, and we do not generate Bitcoin deposit addresses.</p>
                <p><strong>2. Assumption of Risk:</strong> You are strictly responsible for monitoring your Health Factor and managing liquidation risks.</p>
                <p><strong>3. Not Financial Advice:</strong> You are acting entirely at your own risk. This interface is not a registered financial institution.</p>
                <p>Please read the full Terms of Service for complete legal details.</p>
              </div>
              <div className="flex items-start space-x-3 pt-4">
                <input
                  type="checkbox"
                  id="terms-checkbox"
                  className="mt-0.5 h-5 w-5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={hasAgreed}
                  onChange={(event) => setHasAgreed(event.target.checked)}
                />
                <label htmlFor="terms-checkbox" className="cursor-pointer font-medium leading-tight text-foreground">
                  I have read, understand, and explicitly agree to be bound by the <Link href="/terms" target="_blank" className="text-blue-500 hover:underline">Terms of Service</Link>.
                </label>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end space-x-3 border-t bg-muted/10 pt-4">
              <Button variant="ghost" onClick={() => setShowTerms(false)}>Cancel</Button>
              <Button
                className="bg-blue-600 font-bold text-white hover:bg-blue-700"
                disabled={!hasAgreed}
                onClick={() => {
                  localStorage.setItem('simplebtc_terms_accepted', 'true');
                  setAccepted(true);
                  setShowTerms(false);
                  setShowWallets(true);
                }}
              >
                Accept & Connect
              </Button>
            </CardFooter>
          </Card>
        </div>
        </Overlay>
      )}

      {showWallets && (
        <Overlay>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Connect a wallet"
          className="fixed inset-0 z-[9999] flex h-[100dvh] max-h-[100dvh] items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <Card className="max-h-[min(85dvh,100%)] w-full max-w-md overflow-y-auto rounded-xl border-muted shadow-2xl dark:bg-zinc-950">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-xl font-bold">{qrWallet ? (phone ? `Connect ${qrWallet.name}` : `Scan with ${qrWallet.name}`) : 'Connect a wallet'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {!qrWallet && !phone && (
                <>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
                    {(['mobile', 'desktop'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`h-11 rounded-md text-sm font-bold ${device === option ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                        onClick={() => {
                          setDevice(option);
                          setError('');
                        }}
                      >
                        {option === 'mobile' ? 'Phone QR' : 'This browser'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {device === 'mobile'
                      ? 'Scan the code with the wallet app on your phone.'
                      : 'Use a wallet already in this browser. If it is missing, a phone QR code opens instead.'}
                  </p>
                </>
              )}
              {phone && !qrWallet && !handoff && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {inAppWalletId()
                    ? 'This page is already inside a wallet. Tap that wallet to finish connecting.'
                    : 'Tap a wallet. This page opens inside the app, then the wallet asks you to approve.'}
                </p>
              )}
              {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
              {handoff && !qrWallet ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold">Opening {handoff.name}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    The wallet app should open with this page. Approve the connection there. If nothing happened, tap Open again.
                  </p>
                  <Button
                    type="button"
                    className="h-11 w-full bg-blue-600 font-bold text-white hover:bg-blue-700"
                    onClick={() => openWalletUrl(walletDappUrl(handoff.id))}
                  >
                    Open {handoff.name}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-full"
                    onClick={() => {
                      setHandoff(null);
                      setPendingId(null);
                    }}
                  >
                    Choose a different wallet
                  </Button>
                </div>
              ) : qrWallet ? (
                <div className="flex flex-col items-center gap-3">
                  {phone ? (
                    <>
                      <p className="text-sm font-semibold">Keep this page open</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {isScannableUri(uri)
                          ? `Tap Open ${qrWallet.name}. The wallet should show Connect / Approve. If it only opens the home screen, come back and tap Open again.`
                          : `Preparing a link for ${qrWallet.name}…`}
                      </p>
                      {openReady && phoneOpenHref(qrWallet.id, uri) ? (
                        <>
                          <Button asChild className="h-11 w-full bg-blue-600 font-bold text-white hover:bg-blue-700">
                            <a href={phoneOpenHref(qrWallet.id, uri)}>
                              Open {qrWallet.name}
                            </a>
                          </Button>
                          {phoneFallbackHref(qrWallet.id, uri) ? (
                            <a
                              href={phoneFallbackHref(qrWallet.id, uri)}
                              className="text-xs font-semibold text-blue-600 underline-offset-2 hover:underline"
                            >
                              Didn’t see Approve? Try the app link
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <Button type="button" className="h-11 w-full bg-blue-600 font-bold text-white hover:bg-blue-700" disabled>
                          Preparing…
                        </Button>
                      )}
                    </>
                  ) : isScannableUri(uri) ? (
                    <WalletQr uri={uri} />
                  ) : (
                    <p className="py-16 text-sm text-muted-foreground">Creating a secure connection code…</p>
                  )}
                  {!phone && (
                    <ol className="w-full list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                      <li>Open {qrWallet.name} on your phone.</li>
                      <li>{qrWallet.id === 'coinbase' ? 'Tap the scan icon and scan this code.' : 'Use its scanner and scan this code.'}</li>
                      <li>Approve the connection. It can use Base and Ethereum only.</li>
                    </ol>
                  )}
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {phone ? 'If the wallet did not open, tap Open. Closing this window cancels the request.' : 'The code is created in this browser. Closing this window cancels it.'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {visible.map((choice) => {
                    const ready = installed.includes(choice.desktopId) || inAppWalletId() === choice.id;
                    return (
                      <Button
                        key={choice.id}
                        type="button"
                        variant="outline"
                        className="h-12 justify-between font-bold"
                        disabled={pendingId !== null}
                        onClick={() => void choose(choice)}
                      >
                        <span>{choice.name}</span>
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {ready ? 'Installed' : phone ? 'Open app' : device === 'mobile' ? 'QR code' : 'Extension'}
                        </span>
                      </Button>
                    );
                  })}
                  <Button type="button" variant="ghost" className="h-11 text-xs font-semibold" onClick={() => setMore((value) => !value)}>
                    {more ? 'Show Coinbase and MetaMask' : 'More wallets'}
                  </Button>
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-between border-t pt-4">
              {qrWallet || handoff ? (
                <Button variant="ghost" onClick={() => { setHandoff(null); void stopQr(); }}>Back</Button>
              ) : <span />}
              <Button variant="ghost" onClick={() => { void stopQr(); setShowWallets(false); setError(''); }}>Close</Button>
            </CardFooter>
          </Card>
        </div>
        </Overlay>
      )}

    </>
  );
}
