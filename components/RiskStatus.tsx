import { aprMovementStatus, type StatusPresentation, type StatusTone } from '@/lib/finance/riskStatus';
import type { AprSemanticState } from '@/lib/finance/openingApr';
import type { LoanRateStatus } from '@/lib/finance/loanView';

const TONE_CLASS: Record<StatusTone, string> = {
  normal: 'text-emerald-800 dark:text-emerald-300',
  watch: 'text-blue-800 dark:text-blue-300',
  prepare: 'text-amber-800 dark:text-amber-300',
  act: 'text-orange-800 dark:text-orange-300',
  urgent: 'text-red-800 dark:text-red-300',
  data: 'text-purple-800 dark:text-purple-300',
  neutral: 'text-muted-foreground',
};

export function StatusBadge({ status }: { status: StatusPresentation }) {
  return (
    <div className={`flex items-start gap-1.5 ${TONE_CLASS[status.tone]}`}>
      <span aria-hidden="true" className="inline-block w-3 shrink-0 text-center font-semibold">{status.mark}</span>
      <span>
        <span className="font-semibold">{status.label}</span>
        {status.detail ? <span> · {status.detail}</span> : null}
      </span>
    </div>
  );
}

const SEMANTIC_CLASS: Record<AprSemanticState, string> = {
  positive: 'text-emerald-800 dark:text-emerald-300',
  warning: 'text-orange-800 dark:text-orange-300',
  neutral: 'text-neutral-700 dark:text-neutral-300',
};

export function AprChangeLine({ status }: { status: Pick<LoanRateStatus, 'icon' | 'compactText' | 'semanticState'> }) {
  if (!status.icon) return null;
  return <p className={`font-semibold ${SEMANTIC_CLASS[status.semanticState]}`}>{status.compactText}</p>;
}

export function AprMovementBadge({ movement }: { movement: Parameters<typeof aprMovementStatus>[0] }) {
  return <StatusBadge status={aprMovementStatus(movement)} />;
}
