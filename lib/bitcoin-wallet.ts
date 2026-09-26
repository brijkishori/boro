import { isBitcoinMainnetAddress, isTbtcRecoveryAddress } from '@/lib/btc';
import { isCoinbaseDappBrowser } from '@/lib/wallets';

export const BTC_ADDRESS_KEY = 'boro_btc_address';
export const BTC_ADDRESS_EVENT = 'boro_btc_address';
const GENESIS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const BITCOIN_CHAIN = 'bip122:000000000019d6689c085ae165831e93';

type RequestProvider = {
  request?: (args: { method: string; params?: unknown }) => Promise<unknown>;
  getAccounts?: () => Promise<unknown>;
  requestAccounts?: () => Promise<unknown>;
  sendBitcoin?: (to: string, satoshis: number) => Promise<string>;
  bitcoin?: unknown;
  isCoinbaseWallet?: boolean;
  isUnisat?: boolean;
};

const BITCOIN_CALLS: Array<{ method: string; params?: unknown }> = [
  { method: 'btc_requestAccounts' },
  { method: 'wallet_getAddresses', params: [{ chain: { id: BITCOIN_CHAIN } }] },
];

function usableAddress(value: string) {
  return isBitcoinMainnetAddress(value) && value !== GENESIS;
}

function collectAddresses(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 6 || value == null) return found;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const parts = trimmed.split(':');
    const candidate = parts[0] === 'bip122' && parts.length >= 3 ? parts[parts.length - 1] : trimmed;
    if (usableAddress(candidate) && !found.includes(candidate)) found.push(candidate);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAddresses(item, found, depth + 1);
    return found;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectAddresses(item, found, depth + 1);
    }
  }
  return found;
}

function preferAddress(addresses: string[]) {
  return addresses.find((item) => isTbtcRecoveryAddress(item)) ?? addresses[0] ?? '';
}

export function bitcoinAddressFrom(value: unknown) {
  return preferAddress(collectAddresses(value));
}

function withTimeout<T>(promise: Promise<T>, ms = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Wallet did not respond.')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function asProvider(value: unknown): RequestProvider | null {
  if (!value || typeof value !== 'object') return null;
  return value as RequestProvider;
}

function isBitcoinCapable(provider: RequestProvider) {
  return (
    typeof provider.requestAccounts === 'function' ||
    typeof provider.getAccounts === 'function' ||
    typeof provider.sendBitcoin === 'function' ||
    provider.isUnisat === true ||
    Boolean(asProvider(provider.bitcoin))
  );
}

function windowProviders(): RequestProvider[] {
  if (typeof window === 'undefined') return [];
  const browser = window as Window & {
    ethereum?: RequestProvider & { providers?: RequestProvider[] };
    coinbaseWalletExtension?: unknown;
    unisat?: unknown;
    okxwallet?: { bitcoin?: unknown };
    phantom?: { bitcoin?: unknown };
    LeatherProvider?: unknown;
    bitcoin?: unknown;
    btc?: unknown;
  };
  return [
    browser.unisat,
    browser.okxwallet?.bitcoin,
    browser.phantom?.bitcoin,
    browser.LeatherProvider,
    browser.bitcoin,
    browser.btc,
    browser.ethereum?.bitcoin,
    isCoinbaseDappBrowser() ? browser.ethereum : null,
  ]
    .map(asProvider)
    .filter((item): item is RequestProvider => item !== null)
    .filter((item) => isBitcoinCapable(item) || (item.isCoinbaseWallet === true && isCoinbaseDappBrowser()));
}

async function requestAddress(provider: RequestProvider, prompt: boolean) {
  if (prompt && typeof provider.requestAccounts === 'function') {
    const address = bitcoinAddressFrom(await withTimeout(provider.requestAccounts()));
    if (address) return address;
  }
  if (typeof provider.getAccounts === 'function') {
    const address = bitcoinAddressFrom(await withTimeout(provider.getAccounts()));
    if (address) return address;
  }
  if (typeof provider.request === 'function') {
    const calls = prompt ? BITCOIN_CALLS : BITCOIN_CALLS.filter((call) => !/requestAccounts/i.test(call.method));
    for (const call of calls) {
      try {
        const address = bitcoinAddressFrom(await withTimeout(provider.request(call)));
        if (address) return address;
      } catch {
        // This provider does not implement that Bitcoin method.
      }
    }
  }
  const nested = asProvider(provider.bitcoin);
  if (nested && nested !== provider) return requestAddress(nested, prompt);
  return '';
}

async function firstAddress(providers: RequestProvider[], prompt: boolean) {
  const seen = new Set<RequestProvider>();
  for (const provider of providers) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    try {
      const address = await requestAddress(provider, prompt);
      if (address) return address;
    } catch {
      // Try the next wallet if this one rejected or has no Bitcoin account.
    }
  }
  return '';
}

export function storedBitcoinAddress() {
  if (typeof window === 'undefined') return '';
  const saved = window.localStorage.getItem(BTC_ADDRESS_KEY) ?? '';
  return usableAddress(saved) ? saved : '';
}

export function rememberBitcoinAddress(address: string) {
  if (!usableAddress(address) || typeof window === 'undefined') return;
  if (window.localStorage.getItem(BTC_ADDRESS_KEY) === address) return;
  window.localStorage.setItem(BTC_ADDRESS_KEY, address);
  window.dispatchEvent(new Event(BTC_ADDRESS_EVENT));
}

export function hasBitcoinWallet() {
  return windowProviders().some(isBitcoinCapable);
}

export async function readBitcoinAddress() {
  const saved = storedBitcoinAddress();
  if (saved) return saved;
  const address = await firstAddress(windowProviders(), false);
  if (address) rememberBitcoinAddress(address);
  return address;
}

/** Fast injected Bitcoin wallets only. Does not poke Coinbase WalletLink. */
export async function connectInjectedBitcoinAddress() {
  const address = await firstAddress(windowProviders(), true);
  if (address) rememberBitcoinAddress(address);
  return address;
}

export async function sendBitcoin(to: string, satoshis: number) {
  if (!Number.isInteger(satoshis) || satoshis <= 0) throw new Error('Enter an amount to convert.');
  const account = storedBitcoinAddress();
  for (const item of windowProviders()) {
    if (typeof item.sendBitcoin === 'function') {
      try {
        return await withTimeout(item.sendBitcoin(to, satoshis), 60_000);
      } catch (error) {
        const text = error instanceof Error ? error.message : '';
        if (/user rejected|user denied|rejected the request/i.test(text)) {
          throw new Error('Bitcoin send was cancelled in the wallet.');
        }
      }
    }
    if (typeof item.request !== 'function') continue;
    const calls = [
      { method: 'sendBitcoin', params: [to, satoshis] },
      { method: 'btc_sendBitcoin', params: [to, satoshis] },
      { method: 'sendTransfer', params: { account, recipientAddress: to, amount: String(satoshis) } },
    ];
    for (const call of calls) {
      try {
        const result = await withTimeout(item.request(call), 60_000);
        if (typeof result === 'string' && result) return result;
      } catch (error) {
        const text = error instanceof Error ? error.message : '';
        if (/user rejected|user denied|rejected the request/i.test(text)) {
          throw new Error('Bitcoin send was cancelled in the wallet.');
        }
      }
    }
  }
  return null;
}
