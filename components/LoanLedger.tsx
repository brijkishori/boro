'use client';

import { formatToken, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import { liveSplit, type LiveSplit, type LoanEpisode } from '@/lib/audit';

export function LoanLedger({
  episode,
  debt,
  decimals = 6,
  compact = false,
}: {
  episode: LoanEpisode | null;
  debt: bigint;
  decimals?: number;
  compact?: boolean;
}) {
  const split = liveSplit(episode, debt);
  return <LedgerSplit split={split} decimals={decimals} compact={compact} seeded={episode !== null} />;
}

export function LedgerSplit({
  split,
  decimals = 6,
  compact = false,
  seeded = true,
}: {
  split: LiveSplit;
  decimals?: number;
  compact?: boolean;
  seeded?: boolean;
}) {
  const cells = [
    ['Debt', split.debt],
    ['Principal remaining', split.principalRemaining],
    ['Interest remaining', split.interestRemaining],
    ['Interest so far', split.interestSoFar],
  ] as const;
  return (
    <div className={compact ? 'grid grid-cols-2 gap-2 text-xs' : 'grid grid-cols-2 gap-2 text-xs sm:grid-cols-4'}>
      {cells.map(([label, value]) => (
        <div key={label}>
          <p className="text-muted-foreground">{label}</p>
          <p className="font-semibold">{formatToken(value, decimals)} USDC</p>
          <p className="text-muted-foreground">{formatUsdExact(tokenAmountUsd(value, decimals, 1) ?? 0)}</p>
        </div>
      ))}
      {!seeded && split.debt > 0n && (
        <p className="col-span-full text-[11px] text-muted-foreground">Interest tracking starts from the current debt. Past interest is not backfilled.</p>
      )}
    </div>
  );
}
