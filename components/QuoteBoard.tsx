'use client';

import { Button } from '@/components/ui/button';
import { formatApr, formatUsd } from '@/lib/amount';
import {
  RECOMMENDED_LIQUIDITY_USD,
  assetRouteLabel,
  chainLabel,
  protocolLabel,
  venueConfidence,
  type AssetFilter,
  type Venue,
  type VenueAction,
} from '@/lib/protocol';

const FILTERS: { id: AssetFilter; label: string }[] = [
  { id: 'all', label: 'All BTC' },
  { id: 'direct', label: 'Direct BTC' },
  { id: 'tBTC', label: 'tBTC' },
  { id: 'WBTC', label: 'WBTC' },
  { id: 'cbBTC', label: 'cbBTC' },
];

export default function QuoteBoard({
  action,
  venues,
  selectedId,
  recommendedId,
  filter,
  onFilter,
  onSelect,
}: {
  action: VenueAction;
  venues: Venue[];
  selectedId: string | null;
  recommendedId: string | null;
  filter: AssetFilter;
  onFilter: (filter: AssetFilter) => void;
  onSelect: (id: string) => void;
}) {
  const lending = action === 'lend';

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={filter === item.id ? 'default' : 'outline'}
            className={filter === item.id ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}
            onClick={() => onFilter(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {lending
          ? 'The highlighted market has the highest supply APY among pools with at least $100,000 of liquidity. Smaller pools stay visible.'
          : 'The highlighted market is the cheapest pool with at least $10 million of liquidity, unless a stronger pool is within 0.25% APR. Coinbase uses the main Morpho cbBTC market on Base. Smaller pools stay visible.'}
      </p>
      {venues.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No market passed the safety filters for this view.</p>
      ) : (
        <div className="grid gap-2">
          {venues.map((venue) => {
            const selected = venue.id === selectedId;
            const recommended = venue.id === recommendedId;
            const confidence = venueConfidence(venue);
            const rate = lending ? venue.supplyApr : venue.borrowApr;
            return (
              <button
                key={venue.id}
                type="button"
                onClick={() => onSelect(venue.id)}
                className={`rounded-xl border p-3 text-left transition-colors ${selected ? 'border-blue-500 bg-blue-500/5' : 'border-muted hover:border-blue-500/40'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">{protocolLabel(venue.protocol)}</span>
                      <span className="text-xs text-muted-foreground">{chainLabel(venue.chainId)} · {venue.assetSymbol}</span>
                      {recommended && (
                        <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                          {lending ? 'Best supply APY' : 'Suggested'}
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${confidence.level === 'high' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : confidence.level === 'cautious' ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400' : 'bg-muted text-muted-foreground'}`}>
                        {confidence.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{assetRouteLabel(venue.assetKind)}. {confidence.detail}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black">{formatApr(rate)}</p>
                    <p className="text-[10px] uppercase text-muted-foreground">{lending ? 'Supply APY' : 'Borrow APR'}</p>
                  </div>
                </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  {!lending && <span>Max LTV {Math.round(venue.maxLtv * 100)}%</span>}
                  <span>Liquidity {formatUsd(venue.liquidityUsd)}</span>
                  {venue.liquidityUsd < RECOMMENDED_LIQUIDITY_USD && <span>Limited depth</span>}
                  {lending && <span>Borrow cost {formatApr(venue.borrowApr)}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
