'use client';

import { chainLabel, isChainId } from '@/lib/protocol';
import { Button } from '@/components/ui/button';
import { clearFees, explorerTx, formatEth, formatFeeUsd, useFeeHistory, weiToUsd } from '@/components/useNetworkFee';
import { actionLabel } from '@/components/useSendTx';

export default function FeeHistory() {
  const rows = useFeeHistory();
  if (rows.length === 0) return null;
  const totalWei = rows.reduce((sum, row) => sum + BigInt(row.feeWei), 0n);
  const totalUsd = rows.reduce((sum, row) => sum + (row.ethUsd === null ? 0 : weiToUsd(BigInt(row.feeWei), row.ethUsd)), 0);

  return (
    <details className="rounded-xl border bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Network fees paid · {formatFeeUsd(totalUsd)} · {formatEth(totalWei)}
      </summary>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.hash} className="flex items-center justify-between gap-3 border-b pb-2 text-xs last:border-b-0">
            <div>
              <p className="font-semibold">{actionLabel(row.action)} · {isChainId(row.chainId) ? chainLabel(row.chainId) : 'Unknown network'}</p>
              <a className="text-muted-foreground underline" href={explorerTx(row.chainId, row.hash)} target="_blank" rel="noreferrer">
                {new Date(row.at).toLocaleString()}
              </a>
            </div>
            <div className="text-right">
              <p className="font-semibold">{formatFeeUsd(row.ethUsd === null ? null : weiToUsd(BigInt(row.feeWei), row.ethUsd))}</p>
              <p className="text-muted-foreground">{formatEth(BigInt(row.feeWei))}</p>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          Dollar values use the ETH price when each transaction confirmed. Open <a className="underline" href="/loans">Loans</a> for principal, interest, and the full audit (saved on the server when Redis is configured).
        </p>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={clearFees}>Clear list</Button>
      </div>
    </details>
  );
}
