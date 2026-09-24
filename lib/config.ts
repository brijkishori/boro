import { farcasterFrame } from '@farcaster/frame-wagmi-connector';
import { createConfig, type CreateConnectorFn } from 'wagmi';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { base, mainnet } from 'wagmi/chains';
import type { EIP1193Provider } from 'viem';
import { chainTransport } from '@/lib/rpc';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()
  || '21fef48091f12692cad574a6f7753643';

type FlaggedProvider = EIP1193Provider & {
  providers?: FlaggedProvider[];
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
  _events?: unknown;
  _state?: unknown;
} & Record<string, unknown>;

type EthereumWindow = Window & {
  ethereum?: FlaggedProvider;
  phantom?: { ethereum?: FlaggedProvider };
};

function ethereumProviders(target?: Window): FlaggedProvider[] {
  const ethereum = (target as EthereumWindow | undefined)?.ethereum;
  if (!ethereum) return [];
  return ethereum.providers?.length ? ethereum.providers : [ethereum];
}

function flagged(flag: string) {
  return (target?: Window) => ethereumProviders(target).find((provider) => provider[flag] === true);
}

function metaMaskProvider(target?: Window) {
  const masks = ['isRabby', 'isPhantom', 'isOkxWallet', 'isCoinbaseWallet', 'isTrust', 'isTrustWallet', 'isRainbow', 'isZerion'];
  return ethereumProviders(target).find((provider) => {
    if (provider.isMetaMask !== true) return false;
    if (provider.isBraveWallet === true && !provider._events && !provider._state) return false;
    return !masks.some((flag) => provider[flag] === true);
  });
}

function phantomProvider(target?: Window) {
  return (target as EthereumWindow | undefined)?.phantom?.ethereum ?? flagged('isPhantom')(target);
}

function trustProvider(target?: Window) {
  return flagged('isTrust')(target) ?? flagged('isTrustWallet')(target);
}

function attemptConnector(label: string, factory: () => CreateConnectorFn, connectors: CreateConnectorFn[]) {
  try {
    connectors.push(factory());
  } catch (error) {
    console.error(`Skipped ${label} wallet connector`, error);
  }
}

function namedWallet(id: string, name: string, provider: (target?: Window) => FlaggedProvider | undefined) {
  return injected({
    shimDisconnect: true,
    target: {
      id,
      name,
      provider: ((target?: Window) => provider(target)) as never,
    },
  });
}

function buildConnectors(): CreateConnectorFn[] {
  const connectors: CreateConnectorFn[] = [];
  attemptConnector('Farcaster', () => farcasterFrame(), connectors);
  attemptConnector('MetaMask', () => namedWallet('metaMask', 'MetaMask', metaMaskProvider), connectors);
  attemptConnector('Coinbase Wallet', () => namedWallet('coinbaseExtension', 'Coinbase Wallet', flagged('isCoinbaseWallet')), connectors);
  attemptConnector('Coinbase mobile', () => coinbaseWallet({
    appName: 'Simple BTC Borrow',
    appLogoUrl: 'https://boro-ruddy.vercel.app/icon.png',
    headlessMode: true,
    // WalletLink pairing on iPhone. Without this, Coinbase SDK sets
    // location.href to go.cb-w.com/dapp and the wallet opens with nothing to approve.
    enableMobileWalletLink: true,
  } as Parameters<typeof coinbaseWallet>[0]), connectors);
  attemptConnector('Rainbow', () => namedWallet('rainbow', 'Rainbow', flagged('isRainbow')), connectors);
  attemptConnector('Rabby', () => namedWallet('rabby', 'Rabby', flagged('isRabby')), connectors);
  attemptConnector('Trust Wallet', () => namedWallet('trustWallet', 'Trust Wallet', trustProvider), connectors);
  attemptConnector('Phantom', () => namedWallet('phantom', 'Phantom', phantomProvider), connectors);
  attemptConnector('OKX Wallet', () => namedWallet('okxWallet', 'OKX Wallet', flagged('isOkxWallet')), connectors);
  attemptConnector('Brave Wallet', () => namedWallet('braveWallet', 'Brave Wallet', flagged('isBraveWallet')), connectors);
  attemptConnector('Zerion', () => namedWallet('zerion', 'Zerion', flagged('isZerion')), connectors);
  attemptConnector('WalletConnect', () => walletConnect({
    projectId,
    showQrModal: false,
    metadata: {
      name: 'Simple BTC Borrow',
      description: 'Borrow and lend BTC on Morpho and Aave',
      url: 'https://boro-ruddy.vercel.app',
      icons: ['https://boro-ruddy.vercel.app/icon.png'],
    },
  }), connectors);
  return connectors;
}

const connectors = buildConnectors();

export const config = createConfig({
  chains: [base, mainnet],
  connectors,
  transports: {
    [base.id]: chainTransport(8453),
    [mainnet.id]: chainTransport(1),
  },
  multiInjectedProviderDiscovery: false,
  ssr: true,
});
