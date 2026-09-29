import { formatApr } from '@/lib/amount';
import type { LoanRateStatus as LoanRateModel } from '@/lib/finance/loanView';
import { AprChangeLine } from '@/components/RiskStatus';

export function LoanRateStatus({ status }: { status: LoanRateModel }) {
  return (
    <div className="space-y-0.5 text-xs">
      <p className="text-muted-foreground">Current APR</p>
      <p className="text-sm font-semibold">{status.currentApr === null ? '—' : formatApr(status.currentApr)}</p>
      <AprChangeLine status={status} />
      {status.openingApr !== null && (
        <p className="text-muted-foreground">Opened at {formatApr(status.openingApr)}</p>
      )}
    </div>
  );
}
