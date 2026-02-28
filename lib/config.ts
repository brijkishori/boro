import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { coinbaseWallet, metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import { farcasterFrame } from '@farcaster/frame-wagmi-connector';
import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// 1. Setup RainbowKit wallets
const rainbowConnectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [coinbaseWallet, metaMaskWallet], // Coinbase Wallet prioritized
    },
  ],
  {
    appName: 'BORO',
    projectId: projectId,
  }
);

// 2. Create Wagmi config and inject Farcaster frame at the top
export const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [farcasterFrame(), ...rainbowConnectors], // Farcaster goes FIRST
  transports: {
    [base.id]: http(`https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}`),
    [baseSepolia.id]: http('https://sepolia.base.org'),
  },
  ssr: true,
});