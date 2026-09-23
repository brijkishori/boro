'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { chainLabel, isChainId, type ChainId } from '@/lib/protocol';

export type NetworkView = ChainId | 'all';

const OPTIONS: { id: NetworkView; label: string }[] = [
  { id: 8453, label: 'Base' },
  { id: 1, label: 'Ethereum' },
  { id: 'all', label: 'All networks' },
];

const NetworkFilterContext = createContext<{
  network: NetworkView;
  setNetwork: (network: NetworkView) => void;
} | null>(null);

export function NetworkFilterProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkView>('all');
  const value = useMemo(() => ({ network, setNetwork }), [network]);
  return <NetworkFilterContext.Provider value={value}>{children}</NetworkFilterContext.Provider>;
}

export function useNetworkFilter() {
  const context = useContext(NetworkFilterContext);
  if (!context) throw new Error('useNetworkFilter needs NetworkFilterProvider');
  return context;
}

export function matchesNetwork(chainId: number, network: NetworkView) {
  return network === 'all' || chainId === network;
}

export function networkTitle(network: NetworkView) {
  return network === 'all' ? 'Base and Ethereum' : chainLabel(network);
}

export function NetworkPicker({ onChange }: { onChange?: (network: NetworkView) => void } = {}) {
  const { network, setNetwork } = useNetworkFilter();
  const { isConnected, chain } = useAccount();
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isConnected && isChainId(connectedChainId) ? connectedChainId : null;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">Show</p>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {OPTIONS.map((option) => (
          <button
            key={String(option.id)}
            type="button"
            aria-pressed={network === option.id}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${network === option.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => {
              setNetwork(option.id);
              onChange?.(option.id);
            }}
          >
            {option.label}{option.id === walletChainId ? ' · wallet' : ''}
          </button>
        ))}
      </div>
      {walletChainId && network !== 'all' && network !== walletChainId && (
        <p className="text-[11px] text-muted-foreground">
          Your wallet is on {chainLabel(walletChainId)}. These pools need a network switch before you can sign.
        </p>
      )}
    </div>
  );
}
