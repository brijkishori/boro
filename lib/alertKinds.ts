export type AlertKind =
  | 'confirm'
  | 'urgent'
  | 'health'
  | 'liquidation'
  | 'apr'
  | 'refinance'
  | 'threshold'
  | 'weekly'
  | 'monthly';

export const ALERT_SUBJECTS: Record<AlertKind, string> = {
  confirm: 'Confirm your SimpleBTC loan alerts',
  urgent: 'Urgent: loan health factor is critical',
  health: 'Warning: loan health factor dropped',
  liquidation: 'Warning: BTC is near your liquidation price',
  apr: 'Borrow APR spike on your loan',
  refinance: 'Cheaper pool available for your loan',
  threshold: 'Accrued interest reached your threshold',
  weekly: 'Weekly loan interest digest',
  monthly: 'Monthly loan statement',
};

export const TEST_ALERT_OPTIONS: { kind: AlertKind; label: string }[] = [
  { kind: 'confirm', label: 'Confirm' },
  { kind: 'urgent', label: 'Urgent health' },
  { kind: 'health', label: 'Health warning' },
  { kind: 'liquidation', label: 'Liquidation' },
  { kind: 'apr', label: 'APR spike' },
  { kind: 'refinance', label: 'Refinance' },
  { kind: 'threshold', label: 'Interest threshold' },
  { kind: 'weekly', label: 'Weekly digest' },
  { kind: 'monthly', label: 'Monthly statement' },
];
