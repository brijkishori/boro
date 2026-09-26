import { bitcoinAddressFrom, rememberBitcoinAddress } from '@/lib/bitcoin-wallet';

export const BITCOIN_CHAIN = 'bip122:000000000019d6689c085ae165831e93';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()
  || '21fef48091f12692cad574a6f7753643';

type SignClient = {
  connect: (params: {
    optionalNamespaces: Record<string, { methods: string[]; chains: string[]; events: string[] }>;
  }) => Promise<{ uri?: string; approval: () => Promise<Session> }>;
  request: (params: { topic: string; chainId: string; request: { method: string; params?: unknown } }) => Promise<unknown>;
  session: { getAll: () => Session[] };
};

type Session = {
  topic: string;
  namespaces?: { bip122?: { accounts?: string[] } };
};

type SignClientCtor = {
  init: (opts: Record<string, unknown>) => Promise<SignClient>;
};

let clientPromise: Promise<SignClient> | null = null;
let pairing: { cancel: () => void } | null = null;

function memoryStorage() {
  const map = new Map<string, unknown>();
  return {
    getKeys: async () => [...map.keys()],
    getEntries: async <T = unknown>() => [...map.entries()] as [string, T][],
    getItem: async <T = unknown>(key: string) => map.get(key) as T | undefined,
    setItem: async <T = unknown>(key: string, value: T) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
  };
}

function signClientCtor(mod: Record<string, unknown>): SignClientCtor {
  const nested = mod.default && typeof mod.default === 'object'
    ? (mod.default as { default?: unknown }).default
    : undefined;
  const candidates = [mod.SignClient, mod.default, nested];
  for (const item of candidates) {
    if (item && typeof (item as SignClientCtor).init === 'function') return item as SignClientCtor;
  }
  throw new Error('Bitcoin wallet pairing is unavailable in this browser.');
}

async function quiet<T>(work: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (first && typeof first === 'object' && !(first instanceof Error) && Object.keys(first as object).length === 0) {
      return;
    }
    original.apply(console, args as []);
  };
  try {
    return await work();
  } finally {
    console.error = original;
  }
}

async function startClient() {
  const mod = await import('@walletconnect/sign-client') as Record<string, unknown>;
  const SignClient = signClientCtor(mod);
  return quiet(() => SignClient.init({
    projectId,
    name: 'simplebtc-bip122',
    logger: 'fatal',
    customStoragePrefix: 'simplebtc-bip122',
    storage: memoryStorage(),
    metadata: {
      name: 'Simple BTC Borrow',
      description: 'Borrow and lend BTC on Morpho and Aave',
      url: 'https://boro-ruddy.vercel.app',
      icons: ['https://boro-ruddy.vercel.app/icon.png'],
    },
  }));
}

async function client() {
  if (clientPromise) {
    try {
      return await clientPromise;
    } catch {
      clientPromise = null;
    }
  }
  clientPromise = startClient();
  try {
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    throw error instanceof Error ? error : new Error('Could not start a Bitcoin wallet session.');
  }
}

async function addressFromSession(sign: SignClient, session: Session) {
  let address = bitcoinAddressFrom(session.namespaces?.bip122?.accounts);
  if (address) return address;
  try {
    address = bitcoinAddressFrom(
      await sign.request({
        topic: session.topic,
        chainId: BITCOIN_CHAIN,
        request: { method: 'getAccountAddresses', params: {} },
      }),
    );
  } catch {
    // Wallet approved a session but has not implemented getAccountAddresses.
  }
  return address;
}

export async function readBitcoinWalletConnect() {
  try {
    const sign = await client();
    for (const session of sign.session.getAll()) {
      const address = await addressFromSession(sign, session);
      if (address) {
        rememberBitcoinAddress(address);
        return address;
      }
    }
  } catch {
    // WalletConnect is unavailable in this browser session.
  }
  return '';
}

export async function pairBitcoinWallet(onUri: (uri: string) => void) {
  cancelBitcoinPairing();
  const sign = await client();
  for (const session of sign.session.getAll()) {
    const existing = await addressFromSession(sign, session);
    if (existing) {
      rememberBitcoinAddress(existing);
      return existing;
    }
  }
  const { uri, approval } = await sign.connect({
    optionalNamespaces: {
      bip122: {
        methods: ['sendTransfer', 'getAccountAddresses', 'signMessage', 'signPsbt'],
        chains: [BITCOIN_CHAIN],
        events: ['bip122_addressesChanged'],
      },
    },
  });
  if (!uri) throw new Error('Could not start a Bitcoin wallet session.');
  onUri(uri);
  let cancelled = false;
  pairing = {
    cancel() {
      cancelled = true;
    },
  };
  try {
    const session = await approval();
    if (cancelled) throw new Error('Bitcoin connection cancelled.');
    const address = await addressFromSession(sign, session);
    if (!address) throw new Error('Wallet connected but did not share a Bitcoin address.');
    rememberBitcoinAddress(address);
    return address;
  } finally {
    pairing = null;
  }
}

export function cancelBitcoinPairing() {
  pairing?.cancel();
  pairing = null;
}

export async function sendBitcoinWalletConnect(to: string, satoshis: number) {
  const account = await readBitcoinWalletConnect();
  if (!account) return null;
  const sign = await client();
  const session = sign.session.getAll().find((item) => Boolean(item.namespaces?.bip122?.accounts?.length));
  if (!session) return null;
  const result = await sign.request({
    topic: session.topic,
    chainId: BITCOIN_CHAIN,
    request: {
      method: 'sendTransfer',
      params: { account, recipientAddress: to, amount: String(satoshis) },
    },
  });
  return typeof result === 'string' && result ? result : typeof result === 'object' && result && 'txid' in result
    ? String((result as { txid: unknown }).txid)
    : null;
}
