'use client';

import { chainLabel, type ChainId } from '@/lib/protocol';
import { shortEth } from './useGasCheck';

export default function GasNotice({ chainId, symbol, neededEth, balanceEth }: { chainId: ChainId; symbol: string; neededEth: string | null; balanceEth: string | null }) {
  return (
    <div className="space-y-1 rounded-lg border border-orange-300 bg-orange-50 p-3 text-xs leading-relaxed dark:border-orange-500/40 dark:bg-orange-500/10">
      <p className="font-semibold text-orange-700 dark:text-orange-300">Not enough ETH on {chainLabel(chainId)} for the network fee</p>
      <p className="text-muted-foreground">
        This step needs about {shortEth(neededEth)} ETH for gas. The wallet holds {shortEth(balanceEth)} ETH on {chainLabel(chainId)}. Every transaction on {chainLabel(chainId)} is paid in ETH, even when you move {symbol}.
        {chainId === 1 ? ' Add a little ETH on Ethereum, or use a Base pool, where fees are a fraction of a cent.' : ' Add a little ETH on Base to continue.'}
      </p>
    </div>
  );
}
