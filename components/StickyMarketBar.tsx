'use client';

import { Button } from '@/components/ui/button';
import { formatApr } from '@/lib/amount';
import { formatLtv } from '@/lib/finance/format';
import { scenarioForVenue } from '@/lib/finance/scenario';
import type { BorrowScenario } from '@/lib/finance/persist';
import { chainLabel, protocolLabel, type Venue } from '@/lib/protocol';

export default function StickyMarketBar({
  venue,
  scenario,
  btcPrice,
  onReview,
}: {
  venue: Venue;
  scenario: BorrowScenario | null;
  btcPrice: number;
  onReview: () => void;
}) {
  const view = scenario ? scenarioForVenue(venue, scenario, venue.priceUsd || btcPrice) : null;
  const ltv = view?.startingLtv !== null && view?.startingLtv !== undefined
    ? `LTV ${formatLtv(view.startingLtv)}`
    : null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur md:hidden pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {protocolLabel(venue.protocol)} {chainLabel(venue.chainId)}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {formatApr(venue.borrowApr)}
            {ltv ? ` · ${ltv}` : ''}
          </p>
        </div>
        <Button type="button" className="h-11 shrink-0 bg-blue-600 px-4 text-white hover:bg-blue-700" onClick={onReview}>
          Review
        </Button>
      </div>
    </div>
  );
}
