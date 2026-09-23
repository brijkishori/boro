'use client';

import { formatApr, formatUsdExact } from '@/lib/amount';
import { chainLabel, protocolLabel } from '@/lib/protocol';
import { refinanceHint, type RefinanceHint } from '@/lib/opportunities';
import type { OpenPosition } from '@/components/useAllPositions';
import type { Venue } from '@/lib/protocol';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function Opportunities({ positions, venues, onRefinance }: { positions: OpenPosition[]; venues: Venue[]; onRefinance?: (hint: RefinanceHint) => void }) {
  const hints = positions.flatMap((position) => {
    const hint = refinanceHint(position, venues);
    return hint ? [hint] : [];
  });
  const idleLend = venues
    .filter((venue) => venue.action === 'lend' && venue.supplyApr >= 0.02)
    .sort((left, right) => right.supplyApr - left.supplyApr)[0];

  if (hints.length === 0 && !idleLend) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Opportunities</p>
        {hints.map((hint) => (
          <div key={`${hint.from.id}:${hint.to.id}`} className="rounded-lg border px-3 py-2 text-xs">
            <p className="font-semibold">
              Move {hint.from.assetSymbol} from {protocolLabel(hint.from.protocol)} to {protocolLabel(hint.to.protocol)} on {chainLabel(hint.to.chainId)}
            </p>
            <p className="mt-1 text-muted-foreground">
              {formatApr(hint.from.borrowApr)} → {formatApr(hint.to.borrowApr)}. About {formatUsdExact(hint.yearlyUsd)} a year, {formatUsdExact(hint.monthlyUsd)} a month.
            </p>
            <p className="mt-1 text-muted-foreground">Four wallet confirmations: repay, withdraw, supply, borrow. Nothing is sent automatically.</p>
            {onRefinance && (
              <Button type="button" size="sm" className="mt-2 h-8 bg-blue-600 text-xs text-white hover:bg-blue-700" onClick={() => onRefinance(hint)}>
                Open the cheaper pool
              </Button>
            )}
          </div>
        ))}
        {idleLend && (
          <p className="text-xs text-muted-foreground">
            Highest trusted BTC supply APY right now: {formatApr(idleLend.supplyApr)} on {protocolLabel(idleLend.protocol)} {idleLend.assetSymbol} ({chainLabel(idleLend.chainId)}).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
