'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { actionLabel } from '@/components/useSendTx';
import { explorerTx, formatEth, formatFeeUsd, weiToUsd } from '@/components/useNetworkFee';
import { formatApr, formatToken, formatUsdExact } from '@/lib/amount';
import { asBig, auditCsv, formatDuration, type AuditEvent, type LoanEpisode } from '@/lib/audit';
import { chainLabel, isChainId, protocolLabel, type ProtocolId } from '@/lib/protocol';

function proto(value: string) {
  return value === 'morpho' || value === 'aave' || value === 'compound' || value === 'spark' || value === 'moonwell'
    ? protocolLabel(value as ProtocolId)
    : value || 'Market';
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AuditLog({
  wallet,
  events,
  episodes,
  durable,
}: {
  wallet: string;
  events: AuditEvent[];
  episodes: LoanEpisode[];
  durable: boolean;
}) {
  const totals = useMemo(() => {
    const open = episodes.filter((episode) => episode.status === 'open');
    const closed = episodes.filter((episode) => episode.status === 'closed');
    const interestPaid = episodes.reduce((sum, episode) => sum + asBig(episode.interestPaid), 0n);
    const principalOwed = open.reduce((sum, episode) => sum + asBig(episode.principalRemaining), 0n);
    const feeUsd = events.reduce((sum, event) => sum + (event.ethUsd === null ? 0 : weiToUsd(asBig(event.feeWei), event.ethUsd)), 0);
    return { open, closed, interestPaid, principalOwed, feeUsd };
  }, [episodes, events]);

  if (events.length === 0 && episodes.length === 0) return null;

  return (
    <details className="rounded-xl border bg-card px-4 py-3" open>
      <summary className="cursor-pointer text-sm font-semibold">
        Loan audit · {totals.closed.length} closed · {totals.open.length} open
      </summary>
      <div className="mt-3 space-y-4">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Interest paid</p>
            <p className="font-semibold">{formatUsdExact(Number(formatToken(totals.interestPaid, 6)))}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Principal still owed</p>
            <p className="font-semibold">{formatUsdExact(Number(formatToken(totals.principalOwed, 6)))}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Network fees</p>
            <p className="font-semibold">{formatFeeUsd(totals.feeUsd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Saved</p>
            <p className="font-semibold">{durable ? 'Server + this browser' : 'This browser (server not configured)'}</p>
          </div>
        </div>

        {episodes.map((episode) => {
          const closed = episode.status === 'closed';
          return (
            <div key={`${episode.key}:${episode.openedAt}`} className="rounded-lg border px-3 py-2 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{episode.label}</p>
                  <p className="text-muted-foreground">
                    {closed ? 'Closed' : 'Open'} · {formatDuration(episode.openedAt, episode.closedAt)}
                    {episode.weightedApr > 0 ? ` · ${formatApr(episode.weightedApr)} APR` : ''}
                  </p>
                </div>
                {closed && (
                  <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Interest paid {formatToken(asBig(episode.interestPaid), 6)} USDC
                  </p>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Borrowed</p>
                  <p className="font-semibold">{formatToken(asBig(episode.principalBorrowed), 6)} USDC</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Principal remaining</p>
                  <p className="font-semibold">{formatToken(asBig(episode.principalRemaining), 6)} USDC</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Interest paid</p>
                  <p className="font-semibold">{formatToken(asBig(episode.interestPaid), 6)} USDC</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Repaid</p>
                  <p className="font-semibold">{formatToken(asBig(episode.totalRepaid), 6)} USDC</p>
                </div>
              </div>
            </div>
          );
        })}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Actions</p>
          {events.slice(0, 40).map((event) => (
            <div key={event.hash} className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0">
              <div>
                <p className="font-semibold">
                  {actionLabel(event.action)}
                  {event.protocol ? ` · ${proto(event.protocol)}` : ''}
                  {isChainId(event.chainId) ? ` · ${chainLabel(event.chainId)}` : ''}
                </p>
                {event.hash.startsWith('0x') ? (
                  <a className="text-muted-foreground underline" href={explorerTx(event.chainId, event.hash)} target="_blank" rel="noreferrer">
                    {new Date(event.at).toLocaleString()}
                  </a>
                ) : (
                  <p className="text-muted-foreground">{new Date(event.at).toLocaleString()} · started tracking</p>
                )}
                {event.action === 'repay' && event.interestPaid && event.principalPaid && (
                  <p className="text-muted-foreground">
                    This payment: {formatToken(asBig(event.interestPaid), event.decimals)} interest, {formatToken(asBig(event.principalPaid), event.decimals)} principal
                    {event.principalRemaining ? ` · principal left ${formatToken(asBig(event.principalRemaining), event.decimals)}` : ''}
                    {event.interestRemaining ? ` · interest left ${formatToken(asBig(event.interestRemaining), event.decimals)}` : ''}
                  </p>
                )}
              </div>
              <div className="text-right">
                {asBig(event.amount) > 0n && (
                  <p className="font-semibold">
                    {formatToken(asBig(event.amount), event.decimals || 6)} {event.action === 'borrow' || event.action === 'repay' || event.action === 'seed' ? 'USDC' : event.assetSymbol}
                  </p>
                )}
                {asBig(event.feeWei) > 0n && (
                  <p className="text-muted-foreground">{formatEth(asBig(event.feeWei))}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => download(`boro-audit-${wallet.slice(0, 8)}.csv`, auditCsv(events, episodes))}
          >
            Download CSV
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
            <Link href="/">Home fees</Link>
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {durable
            ? 'History is saved on the server for this wallet and cached in this browser. Phone and desktop share the same trail.'
            : 'History is saved in this browser. Add Upstash Redis to keep it after the cache is cleared.'}
        </p>
      </div>
    </details>
  );
}
