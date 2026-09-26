export type WalletChoice = {
  id: string;
  name: string;
  desktopId: string;
  primary: boolean;
};

export const WALLET_CHOICES: WalletChoice[] = [
  { id: 'coinbase', name: 'Coinbase Wallet', desktopId: 'coinbaseExtension', primary: true },
  { id: 'metaMask', name: 'MetaMask', desktopId: 'metaMask', primary: true },
  { id: 'rainbow', name: 'Rainbow', desktopId: 'rainbow', primary: false },
  { id: 'rabby', name: 'Rabby', desktopId: 'rabby', primary: false },
  { id: 'trustWallet', name: 'Trust Wallet', desktopId: 'trustWallet', primary: false },
  { id: 'phantom', name: 'Phantom', desktopId: 'phantom', primary: false },
  { id: 'okxWallet', name: 'OKX Wallet', desktopId: 'okxWallet', primary: false },
  { id: 'braveWallet', name: 'Brave Wallet', desktopId: 'braveWallet', primary: false },
  { id: 'zerion', name: 'Zerion', desktopId: 'zerion', primary: false },
];

export const WALLET_RDNS: Record<string, string> = {
  'io.metamask': 'metaMask',
  'com.coinbase.wallet': 'coinbaseExtension',
  'me.rainbow': 'rainbow',
  'io.rabby': 'rabby',
  'com.trustwallet.app': 'trustWallet',
  'app.phantom': 'phantom',
  'com.okex.wallet': 'okxWallet',
  'com.brave.wallet': 'braveWallet',
  'io.zerion.wallet': 'zerion',
};

const COINBASE_HOST = 'www.walletlink.org';
const COINBASE_ORIGIN = 'https://www.walletlink.org';
const COINBASE_STORAGE = `-walletlink:${COINBASE_ORIGIN}:`;

export function isWalletConnectUri(uri: string) {
  return /^wc:[A-Za-z0-9]+@2\?/.test(uri);
}

/** Coinbase Wallet's scanner accepts this link and rejects a raw wc: code. */
export function isCoinbaseLink(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.hostname !== COINBASE_HOST) return false;
  if (url.username || url.password || url.search) return false;
  const marker = '#/link?';
  if (!url.hash.startsWith(marker)) return false;
  const params = new URLSearchParams(url.hash.slice(marker.length));
  const id = params.get('id');
  const secret = params.get('secret');
  const server = params.get('server');
  const chainId = params.get('chainId');
  const version = params.get('v');
  if (!id || !/^[a-f0-9]{32}$/.test(id)) return false;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return false;
  if (version && !/^\d+(\.\d+){0,2}$/.test(version)) return false;
  if (!chainId || !/^\d{1,10}$/.test(chainId)) return false;
  try {
    const serverUrl = new URL(server ?? '');
    if (serverUrl.protocol !== 'https:' || serverUrl.hostname !== COINBASE_HOST) return false;
  } catch {
    return false;
  }
  return true;
}

/** Coinbase Wallet's camera accepts this HTTPS wrap and rejects a raw wc: code. */
export function isCoinbaseWalletConnectLink(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'go.cb-w.com') return false;
  if (url.username || url.password || url.hash) return false;
  if (url.pathname !== '/wc') return false;
  const wc = url.searchParams.get('uri');
  return Boolean(wc && isWalletConnectUri(wc));
}

export function isScannableUri(uri: string) {
  return isWalletConnectUri(uri) || isCoinbaseLink(uri) || isCoinbaseWalletConnectLink(uri);
}

/** QR payload Coinbase Wallet can actually parse. Raw wc: shows as "QR not recognized". */
export function scannableWalletUri(choiceId: string, uri: string) {
  if (!uri) return '';
  if (isCoinbaseLink(uri) || isCoinbaseWalletConnectLink(uri)) return uri;
  if (choiceId === 'coinbase') return walletConnectLink('coinbase', uri) || uri;
  return uri;
}

export function coinbaseLinkFromStorage(chainId: number) {
  if (typeof window === 'undefined') return '';
  const id = window.localStorage.getItem(`${COINBASE_STORAGE}session:id`);
  const secret = window.localStorage.getItem(`${COINBASE_STORAGE}session:secret`);
  const version = window.localStorage.getItem(`${COINBASE_STORAGE}version`) ?? '1';
  if (!id || !secret) return '';
  const params = new URLSearchParams({
    id,
    secret,
    server: COINBASE_ORIGIN,
    v: /^\d+(\.\d+){0,2}$/.test(version) ? version : '1',
    chainId: String(chainId),
  });
  const link = `${COINBASE_ORIGIN}/#/link?${params.toString()}`;
  return isCoinbaseLink(link) ? link : '';
}

export function coinbaseSessionId() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(`${COINBASE_STORAGE}session:id`) ?? '';
}

export function isPhone() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900;
}

/** Coinbase's in-app browser only. Desktop WalletLink also sets isCoinbaseWallet. */
export function isCoinbaseDappBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /CoinbaseWallet|CBWallet/i.test(navigator.userAgent || '');
}

export function inAppWalletId(): string | null {
  if (typeof window === 'undefined') return null;
  const ethereum = (window as Window & { ethereum?: Record<string, unknown> }).ethereum;
  if (ethereum?.isCoinbaseWallet) return 'coinbase';
  if (ethereum?.isRainbow) return 'rainbow';
  if (ethereum?.isTrust || ethereum?.isTrustWallet) return 'trustWallet';
  if (ethereum?.isPhantom) return 'phantom';
  if (ethereum?.isOkxWallet) return 'okxWallet';
  if (ethereum?.isZerion) return 'zerion';
  if (ethereum?.isMetaMask && !ethereum?.isBraveWallet) return 'metaMask';
  const ua = navigator.userAgent || '';
  if (/CoinbaseWallet|CBWallet/i.test(ua)) return 'coinbase';
  if (/MetaMaskMobile/i.test(ua)) return 'metaMask';
  if (/Rainbow/i.test(ua)) return 'rainbow';
  if (/TrustWallet|Trust\//i.test(ua)) return 'trustWallet';
  if (/Phantom/i.test(ua)) return 'phantom';
  if (/OKApp|OKX/i.test(ua) && /Mobile/i.test(ua)) return 'okxWallet';
  if (/Zerion/i.test(ua)) return 'zerion';
  return null;
}

export function walletDappUrl(choiceId: string, pageUrl = typeof window === 'undefined' ? '' : window.location.href) {
  if (!pageUrl) return '';
  const encoded = encodeURIComponent(pageUrl);
  if (choiceId === 'coinbase') return `https://go.cb-w.com/dapp?cb_url=${encoded}`;
  if (choiceId === 'metaMask') {
    try {
      const url = new URL(pageUrl);
      return `https://metamask.app.link/dapp/${url.host}${url.pathname}${url.search}`;
    } catch {
      return '';
    }
  }
  if (choiceId === 'trustWallet') return `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}`;
  if (choiceId === 'rainbow') return `https://rnbwapp.com/dapp?url=${encoded}`;
  if (choiceId === 'phantom') return `https://phantom.app/ul/browse/${encoded}`;
  if (choiceId === 'okxWallet') return `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${pageUrl}`)}`;
  if (choiceId === 'zerion') return `https://link.zerion.io/browse?url=${encoded}`;
  if (choiceId === 'rabby') return `https://rabby.io/`;
  if (choiceId === 'braveWallet') return '';
  return '';
}

const WC_NATIVE: Record<string, string> = {
  coinbase: 'cbwallet://wc?uri=',
  metaMask: 'metamask://wc?uri=',
  rainbow: 'rainbow://wc?uri=',
  trustWallet: 'trust://wc?uri=',
  zerion: 'zerion://wc?uri=',
  okxWallet: 'okx://wallet/wc?uri=',
  phantom: 'phantom://wc?uri=',
  rabby: 'rabby://wc?uri=',
};

/** Coinbase Wallet iOS opens this and shows the WalletLink approval. `/wc?uri=` only launches the app. */
export function coinbaseWalletOpenUrl(
  walletLinkUrl: string,
  pageUrl = typeof window === 'undefined' ? '' : window.location.href,
) {
  if (!isCoinbaseLink(walletLinkUrl) || !pageUrl) return '';
  const url = new URL('https://go.cb-w.com/walletlink');
  url.searchParams.set('redirect_url', pageUrl);
  url.searchParams.set('wl_url', walletLinkUrl);
  return url.href;
}

export function walletConnectLink(choiceId: string, uri: string) {
  if (!isWalletConnectUri(uri)) return '';
  const encoded = encodeURIComponent(uri);
  if (choiceId === 'metaMask') return `https://metamask.app.link/wc?uri=${encoded}`;
  if (choiceId === 'rainbow') return `https://rnbwapp.com/wc?uri=${encoded}`;
  if (choiceId === 'trustWallet') return `https://link.trustwallet.com/wc?uri=${encoded}`;
  if (choiceId === 'coinbase') return `https://go.cb-w.com/wc?uri=${encoded}`;
  if (choiceId === 'zerion') return `https://wallet.zerion.io/wc?uri=${encoded}`;
  if (choiceId === 'okxWallet') return `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/wc?uri=${encoded}`)}`;
  if (choiceId === 'phantom') return `https://phantom.app/ul/wc?uri=${encoded}`;
  return uri;
}

/** iPhone handoff that carries the pairing request into the wallet app. */
export function phoneOpenHref(
  choiceId: string,
  uri: string,
  pageUrl = typeof window === 'undefined' ? '' : window.location.href,
) {
  if (isCoinbaseLink(uri)) return coinbaseWalletOpenUrl(uri, pageUrl);
  // HTTPS universal links keep the wc: pairing. Native schemes often only launch the app.
  return walletConnectLink(choiceId, uri);
}

export function phoneFallbackHref(choiceId: string, uri: string) {
  if (isCoinbaseLink(uri) || !isWalletConnectUri(uri)) return '';
  const prefix = WC_NATIVE[choiceId];
  return prefix ? `${prefix}${encodeURIComponent(uri)}` : '';
}

function isPageStealUrl(url: string) {
  return /go\.cb-w\.com\/dapp|[\w-]+\.app\.link/i.test(url);
}

export async function withoutLeavingPage<T>(run: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return run();
  const { location } = window;
  const assign = location.assign.bind(location);
  const replace = location.replace.bind(location);
  const open = window.open.bind(window);
  const hrefDesc =
    Object.getOwnPropertyDescriptor(Location.prototype, 'href') ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(location), 'href');
  const guarded = (url: string | URL) => {
    if (isPageStealUrl(String(url))) return;
    assign(url);
  };
  const onClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!anchor?.href || !isPageStealUrl(anchor.href)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.open = (url, target, features) => {
    if (url && isPageStealUrl(String(url))) return null;
    return open(url, target, features);
  };
  document.addEventListener('click', onClick, true);
  try {
    location.assign = guarded;
    location.replace = guarded;
  } catch {
    // Some browsers lock Location methods.
  }
  try {
    if (hrefDesc?.configurable && hrefDesc.get && hrefDesc.set) {
      Object.defineProperty(location, 'href', {
        configurable: true,
        get: () => hrefDesc.get?.call(location),
        set: (value: string) => {
          if (isPageStealUrl(String(value))) return;
          hrefDesc.set?.call(location, value);
        },
      });
    }
  } catch {
    // href may be non-configurable.
  }
  try {
    return await run();
  } finally {
    document.removeEventListener('click', onClick, true);
    window.open = open;
    try {
      location.assign = assign;
      location.replace = replace;
    } catch {
      // ignore
    }
    try {
      if (hrefDesc?.configurable && hrefDesc.get && hrefDesc.set) {
        Object.defineProperty(location, 'href', hrefDesc);
      }
    } catch {
      // ignore
    }
  }
}

export function openWalletUrl(url: string) {
  if (!url || typeof window === 'undefined') return false;
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(opened);
}

/** iPhone must navigate this tab. window.open is blocked and drops the dapp URL. */
export function openWalletDapp(choiceId: string) {
  const dapp = walletDappUrl(choiceId);
  if (!dapp || typeof window === 'undefined') return false;
  window.location.assign(dapp);
  return true;
}
