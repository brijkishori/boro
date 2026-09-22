'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { base, mainnet } from 'wagmi/chains';
import { Button } from '@/components/ui/button';

export function NetworkSwitcher() {
  const { chain, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  if (!isConnected) return null;

  const onBase = chain?.id === base.id;

  return (
    <div className="flex items-center space-x-3 bg-muted/50 px-4 py-1.5 rounded-full border shadow-sm">
      <div className="flex items-center space-x-2">
        <div className={`w-2.5 h-2.5 rounded-full ${onBase || chain?.id === mainnet.id ? 'bg-blue-500' : 'bg-red-500'}`} />
        <span className="text-sm font-bold text-foreground">
          {chain?.name || 'Unsupported Network'}
        </span>
      </div>
      <div className="w-px h-5 bg-border" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs px-3 rounded-full font-semibold hover:bg-background"
        onClick={() => switchChain({ chainId: onBase ? mainnet.id : base.id })}
      >
        Switch to {onBase ? 'Ethereum' : 'Base'}
      </Button>
    </div>
  );
}