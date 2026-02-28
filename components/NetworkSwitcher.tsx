'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { Button } from '@/components/ui/button';

export function NetworkSwitcher() {
  const { chain, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  if (!isConnected) return null;

  const isTestnet = chain?.id === baseSepolia.id;

  return (
    <div className="flex items-center space-x-3 bg-muted/50 px-4 py-1.5 rounded-full border shadow-sm">
      <div className="flex items-center space-x-2">
        {/* Dynamic status dot: Blue for Mainnet, Orange for Testnet, Red for unsupported */}
        <div className={`w-2.5 h-2.5 rounded-full ${chain?.id === base.id ? 'bg-blue-500' : chain?.id === baseSepolia.id ? 'bg-orange-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-sm font-bold text-foreground">
          {chain?.name || 'Unsupported Network'}
        </span>
      </div>
      <div className="w-px h-5 bg-border" />
      <Button 
        variant="ghost" 
        size="sm" 
        className="h-7 text-xs px-3 rounded-full font-semibold hover:bg-background"
        onClick={() => switchChain({ chainId: isTestnet ? base.id : baseSepolia.id })}
      >
        Switch to {isTestnet ? 'Mainnet' : 'Testnet'}
      </Button>
    </div>
  );
}