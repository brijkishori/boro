'use client';

import { chainLabel, protocolLabel, type ChainId, type Venue } from '@/lib/protocol';
import { formatEth, formatFeeUsd, useFeeEstimate } from '@/components/useNetworkFee';
import { actionLabel } from '@/components/useSendTx';

function FeeRow({ chainId, action }: { chainId: ChainId; action: string }) {
  const estimate = useFeeEstimate(chainId, action);
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{actionLabel(action)} network fee</span>
      <span className="font-semibold text-foreground">
        {estimate.wei === null ? 'Reading…' : `≈ ${formatFeeUsd(estimate.usd)} · ${formatEth(estimate.wei)}`}
      </span>
    </div>
  );
}

export default function FeeBreakdown({
  quote,
  actions,
  interest,
}: {
  quote: Venue;
  actions: string[];
  interest?: { apr: number; principalUsd: number; label: string } | null;
}) {
  const protocol = protocolLabel(quote.protocol);
  const yearly = interest ? interest.principalUsd * interest.apr : 0;
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <p className="text-[10px] font-semibold uppercase">Costs</p>
      {actions.map((action) => <FeeRow key={action} chainId={quote.chainId} action={action} />)}
      <div className="flex items-center justify-between gap-2">
        <span>{protocol} fee</span>
        <span className="font-semibold text-foreground">$0.00</span>
      </div>
      {interest && interest.principalUsd > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span>{interest.label} at {(interest.apr * 100).toFixed(2)}% APR</span>
          <span className="font-semibold text-foreground">≈ {formatFeeUsd(yearly / 12)}/mo · {formatFeeUsd(yearly)}/yr</span>
        </div>
      )}
      <p className="pt-1 leading-relaxed">
        Network fees go to {chainLabel(quote.chainId)} validators, are paid in ETH, and do not depend on the dollar amount. {protocol} charges no fee to supply, borrow, repay, or withdraw. Borrowing costs only interest, which grows with the amount and time borrowed. The exact fee shows after each transaction confirms.
      </p>
    </div>
  );
}
