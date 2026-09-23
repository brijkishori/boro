'use client';

import { HOLDING_CHAINS, HOLDING_SPECS } from '@/lib/holdings';
import { chainLabel } from '@/lib/protocol';
import { useNetworkFilter } from '@/components/NetworkFilter';
import { useWalletHoldings } from '@/components/useWalletHoldings';

export default function WalletBalances() {
  const { isConnected, rows } = useWalletHoldings();
  const { network } = useNetworkFilter();
  if (!isConnected) return null;
  const chains = network === 'all' ? HOLDING_CHAINS : [network];

  return (
    <div className="border-t bg-background/95">
      <div className="mx-auto flex max-w-3xl gap-3 overflow-x-auto px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chains.map((chainId) => {
          const group = HOLDING_SPECS.filter((spec) => spec.chainId === chainId).map((spec) => (
            rows.find((row) => row.key === spec.key) ?? { ...spec, amount: 0n, amountText: '—', usdText: '—', usd: null, network: chainLabel(chainId) }
          ));
          return (
            <div key={chainId} className="flex shrink-0 items-center gap-2 text-[11px] leading-tight">
              <span className="font-semibold text-muted-foreground">{chainLabel(chainId)}</span>
              {group.map((row) => (
                <span key={row.key} className="whitespace-nowrap" title={`${row.amountText} ${row.symbol} · ${row.usdText}`}>
                  <span className="text-muted-foreground">{row.symbol}</span>{' '}
                  <span className="font-semibold tabular-nums">{row.amountText}</span>
                  {row.amount > 0n && (
                    <span className="ml-0.5 text-muted-foreground">{row.usdText}</span>
                  )}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
