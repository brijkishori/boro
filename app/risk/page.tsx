'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import RiskMonitor from '@/components/RiskMonitor';
import { useLoanBook } from '@/components/useLoanBook';
import { chainLabel, protocolLabel } from '@/lib/protocol';

function RiskPageInner() {
  const params = useSearchParams();
  const market = params.get('market');
  const tab = params.get('tab');
  const candidate = params.get('candidate');
  const book = useLoanBook();
  const selected = book.views.find((view) => view.id === market) ?? book.views[0] ?? null;
  const position = selected ? book.active.find((item) => item.venue.id === selected.id) : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Risk Monitor</h1>
        <p className="text-sm text-muted-foreground">Detailed safety, rate, and readiness analysis. Nothing here sends a transaction.</p>
      </div>
      {!book.isConnected && <p className="text-sm">Connect a wallet to see loan risk.</p>}
      {book.isConnected && book.views.length === 0 && <p className="text-sm text-muted-foreground">No open debt on this wallet. <Link href="/loans" className="underline">Back to Loans</Link></p>}
      {book.views.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {book.views.map((view) => {
            const item = book.active.find((entry) => entry.venue.id === view.id);
            return (
              <Link key={view.id} href={`/risk?market=${encodeURIComponent(view.id)}`} className={`shrink-0 rounded border px-2 py-1 text-xs ${view.id === selected?.id ? 'border-foreground font-semibold' : 'text-muted-foreground'}`}>
                {item ? protocolLabel(item.venue.protocol) : view.assetSymbol} · {chainLabel(view.chainId)}
              </Link>
            );
          })}
        </div>
      )}
      {position && selected && (
        <RiskMonitor
          headline={selected}
          position={position}
          principal={selected.principalUsd}
          accruedInterest={selected.accruedUnpaidUsd}
          events={book.audit.events}
          episodeKey={selected.lifecycleId}
          referenceBtcUsd={book.payload?.referenceBtcUsd}
          wrapperBtcUsd={book.payload?.wrapperBtcUsd}
          venues={book.venues}
          initialTab={tab}
          candidateId={candidate}
        />
      )}
    </div>
  );
}

export default function RiskPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading risk monitor…</p>}>
      <RiskPageInner />
    </Suspense>
  );
}
