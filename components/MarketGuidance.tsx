'use client';

import { formatApr, formatUsd } from '@/lib/amount';
import { chainLabel, protocolLabel, venueConfidence, type AssetRating, type Suggestion, type Venue, type VenueAction } from '@/lib/protocol';

function place(venue: Venue) {
  return `${venue.assetSymbol} on ${protocolLabel(venue.protocol)}, ${chainLabel(venue.chainId)}`;
}

export function suggestionText(suggestion: Suggestion, action: VenueAction): string {
  const venue = suggestion.venue;
  if (!venue) return 'No market passed the safety filters.';
  const floor = formatUsd(suggestion.thresholdUsd);
  if (action === 'lend') {
    return `${place(venue)} earns the highest supply APY among pools with at least ${floor} of liquidity.`;
  }
  const confidence = venueConfidence(venue);
  if (!suggestion.pickedForConfidence || !suggestion.anchor) {
    return `${place(venue)} has the lowest borrow APR among pools with at least ${floor} of liquidity. ${confidence.label}: ${confidence.detail}`;
  }
  const anchor = suggestion.anchor;
  return `${place(anchor)} is the lowest rate at ${formatApr(anchor.borrowApr)}. ${place(venue)} is ${formatApr(suggestion.gap)} higher, which is inside the 0.25% band, so it is suggested on reliability. ${confidence.label}: ${confidence.detail}`;
}

export default function MarketGuidance({
  action,
  ratings,
  suggestion,
  onPick,
}: {
  action: VenueAction;
  ratings: AssetRating[];
  suggestion: Suggestion;
  onPick: (venue: Venue) => void;
}) {
  const lending = action === 'lend';

  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">
          {lending ? 'Which coin earns more' : 'Which coin borrows cheaper'}
        </p>
        {ratings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Coin ratings appear once live markets load.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {ratings.map((rating) => {
              const confidence = venueConfidence(rating.venue);
              const lead = rating.rank === 1;
              return (
                <button
                  key={rating.symbol}
                  type="button"
                  onClick={() => onPick(rating.venue)}
                  className={`rounded-xl border p-3 text-left ${lead ? 'border-blue-500 bg-blue-500/5' : 'border-muted hover:border-blue-500/40'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{rating.symbol}</span>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">#{rating.rank}</span>
                  </div>
                  <p className="text-lg font-black">{formatApr(rating.rate)}</p>
                  <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                    {lead ? (lending ? 'Earns the most' : 'Cheapest to borrow') : lending ? `${formatApr(rating.gap)} less` : `${formatApr(rating.gap)} more`}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {protocolLabel(rating.venue.protocol)} · {chainLabel(rating.venue.chainId)} · {confidence.label}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="rounded-xl border bg-card p-3">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Why this pool</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{suggestionText(suggestion, action)}</p>
      </div>
    </section>
  );
}
