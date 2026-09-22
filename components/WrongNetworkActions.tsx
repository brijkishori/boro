'use client';

import { Button } from '@/components/ui/button';
import { useNetworkSwitch } from '@/components/useNetworkSwitch';
import { chainLabel, type ChainId, type Venue } from '@/lib/protocol';

export default function WrongNetworkActions({
  walletName,
  marketChainId,
  alternate,
  onUseAlternate,
}: {
  walletName: string;
  marketChainId: ChainId;
  alternate: Venue | null;
  onUseAlternate?: (id: string) => void;
}) {
  const { switchTo, cancel, pendingChainId, viaPhone, walletName: appName } = useNetworkSwitch();
  const waiting = pendingChainId === marketChainId;

  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Your wallet is on {walletName}. This pool is on {chainLabel(marketChainId)}, so its transactions have to be signed on {chainLabel(marketChainId)}.
      </p>
      {alternate && onUseAlternate && (
        <Button type="button" className="h-12 w-full bg-blue-600 text-white hover:bg-blue-700" onClick={() => onUseAlternate(alternate.id)}>
          Use the {chainLabel(alternate.chainId)} pool instead
        </Button>
      )}
      {waiting ? (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
          <p className="text-xs font-medium">
            {viaPhone
              ? `Open ${appName} on your phone and approve the switch to ${chainLabel(marketChainId)}.`
              : `Approve the switch to ${chainLabel(marketChainId)} in ${appName}.`}
          </p>
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={cancel}>Stop waiting</Button>
        </div>
      ) : (
        <Button
          type="button"
          variant={alternate ? 'outline' : 'default'}
          className={alternate ? 'h-12 w-full' : 'h-12 w-full bg-blue-600 text-white hover:bg-blue-700'}
          onClick={() => void switchTo(marketChainId)}
        >
          Switch wallet to {chainLabel(marketChainId)}
        </Button>
      )}
    </div>
  );
}
