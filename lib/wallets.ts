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
  if (!id || !/^[a-f0-9]{32}$/.test(id)) return false;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return false;
  if (!chainId || !/^\d{1,10}$/.test(chainId)) return false;
  try {
    const serverUrl = new URL(server ?? '');
    if (serverUrl.protocol !== 'https:' || serverUrl.hostname !== COINBASE_HOST) return false;
  } catch {
    return false;
  }
  return true;
}

export function isScannableUri(uri: string) {
  return isWalletConnectUri(uri) || isCoinbaseLink(uri);
}

export function coinbaseLinkFromStorage(chainId: number) {
  if (typeof window === 'undefined') return '';
  const id = window.localStorage.getItem(`${COINBASE_STORAGE}session:id`);
  const secret = window.localStorage.getItem(`${COINBASE_STORAGE}session:secret`);
  const version = window.localStorage.getItem(`${COINBASE_STORAGE}version`);
  if (!id || !secret || !version || !/^\d+\.\d+\.\d+$/.test(version)) return '';
  const params = new URLSearchParams({
    id,
    secret,
    server: COINBASE_ORIGIN,
    v: version,
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

export function inAppWalletId(): string | null {
  if (typeof window === 'undefined') return null;
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
  if (choiceId === 'rainbow') return `https://rnbwapp.com/`;
  if (choiceId === 'phantom') return `https://phantom.app/ul/browse/${encoded}`;
  if (choiceId === 'okxWallet') return `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${pageUrl}`)}`;
  if (choiceId === 'zerion') return `https://wallet.zerion.io/`;
  if (choiceId === 'rabby') return `https://rabby.io/`;
  if (choiceId === 'braveWallet') return '';
  return '';
}

export function walletConnectLink(choiceId: string, uri: string) {
  if (!isWalletConnectUri(uri)) return '';
  const encoded = encodeURIComponent(uri);
  if (choiceId === 'metaMask') return `https://metamask.app.link/wc?uri=${encoded}`;
  if (choiceId === 'rainbow') return `https://rnbwapp.com/wc?uri=${encoded}`;
  if (choiceId === 'trustWallet') return `https://link.trustwallet.com/wc?uri=${encoded}`;
  if (choiceId === 'coinbase') return `https://go.cb-w.com/wc?uri=${encoded}`;
  if (choiceId === 'zerion') return `https://wallet.zerion.io/wc?uri=${encoded}`;
  if (choiceId === 'okxWallet') return `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${uri}`)}`;
  if (choiceId === 'phantom') return `https://phantom.app/ul/v1/connect?app_url=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.origin)}`;
  return uri;
}

export function openWalletUrl(url: string) {
  if (!url || typeof window === 'undefined') return false;
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(opened);
}
