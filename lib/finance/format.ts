export type DisplayPrecision = 'compact' | 'precise';

function finite(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function trimFraction(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Display only. Never feed the result back into calculations. */
export function formatPercent(ratio: number, decimals = 2, opts?: { exact?: boolean }): string {
  if (!finite(ratio)) return '—';
  const percent = ratio * 100;
  if (opts?.exact) {
    const text = trimFraction(percent.toString());
    return `${text}%`;
  }
  const abs = Math.abs(percent);
  if (abs > 0 && abs < 10 ** -decimals) return `<0.${'0'.repeat(Math.max(0, decimals - 1))}1%`;
  return `${percent.toFixed(decimals)}%`;
}

export const NO_DEBT_LABEL = 'N/A — no debt';
export const NO_LIQUIDATION_LABEL = 'N/A';

export function formatLtv(ltv: number): string {
  return formatPercent(ltv, 2);
}

export function formatLtvOrNone(ltv: number | undefined | null, debt: number): string {
  if (!(debt > 0)) return NO_DEBT_LABEL;
  return ltv === undefined || ltv === null ? '—' : formatLtv(ltv);
}

export function formatHealthFactorOrNone(value: number | undefined | null, debt: number): string {
  if (!(debt > 0)) return NO_DEBT_LABEL;
  return value === undefined || value === null ? '—' : formatHealthFactor(value);
}

export function formatLiquidationPrice(value: number): string {
  return formatBtcPrice(value);
}

export function formatLiquidationOrNone(value: number | undefined | null, debt: number): string {
  if (!(debt > 0) || value === undefined || value === null || !(value > 0)) return NO_LIQUIDATION_LABEL;
  return formatBtcPrice(value);
}

export function formatCushionOrNone(value: number | undefined | null, debt: number): string {
  if (!(debt > 0) || value === undefined || value === null) return NO_LIQUIDATION_LABEL;
  return formatCushion(value);
}

export function formatBtcAmount(amount: bigint, decimals = 8, compact = false): string {
  return formatTokenAmount(amount, decimals, { compact, trim: compact });
}

export function formatCushion(distance: number): string {
  return formatPercent(distance, 2);
}

export function formatHealthFactor(value: number): string {
  if (!finite(value)) return '—';
  return value.toFixed(2);
}

export function healthFactorLabel(kind?: 'native' | 'app-derived' | null): string {
  return kind === 'app-derived' ? 'App-derived Health Factor' : 'Health Factor';
}

export function formatRate(apr: number): string {
  return formatPercent(apr, 2);
}

/** Accounting display. Two decimal places and thousands separators. Does not change the stored value. */
export function formatMoneyExact(value: number, symbol?: string): string {
  if (!finite(value)) return '—';
  const text = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${text} ${symbol}` : text;
}

/** Abbreviated summary display. The K/M suffix marks that the figure is shortened. */
export function formatMoneyCompact(value: number): string {
  if (!finite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return formatUsdAdaptive(abs, 'precise').replace(/^/, sign === '-' ? '-' : '');
}

/** Magnitude only. Direction and words stay on the shared APR status. */
export function formatBps(bps: number): string {
  if (!finite(bps)) return '—';
  const abs = Math.abs(bps);
  const text = abs >= 9.95 ? abs.toFixed(0) : abs.toFixed(1).replace(/\.0$/, '');
  return `${text} bps`;
}

/** Stablecoin accounting from token units. Rounds only the displayed cents. */
export function formatAccountingAmount(amount: bigint, decimals: number, symbol: string): string {
  if (decimals < 0 || decimals > 18) return '—';
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = abs % scale;
  const centsScale = decimals >= 2 ? 10n ** BigInt(decimals - 2) : 1n;
  let cents = decimals >= 2 ? (fraction + centsScale / 2n) / centsScale : fraction * (10n ** BigInt(2 - decimals));
  let shownWhole = whole;
  if (cents >= 100n) {
    shownWhole += 1n;
    cents -= 100n;
  }
  const grouped = shownWhole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${cents.toString().padStart(2, '0')} ${symbol}`;
}

export function formatSpreadPoints(spread: number): string {
  if (!finite(spread)) return '—';
  const points = spread * 100;
  if (Math.abs(points) < 0.005) return 'in line';
  return `${Math.abs(points).toFixed(2)} pp ${spread > 0 ? 'lower' : 'higher'}`;
}

export function formatUsd(value: number, precision: DisplayPrecision = 'compact'): string {
  return formatUsdAdaptive(value, precision);
}

export function formatUsdAdaptive(value: number, precision: DisplayPrecision = 'compact'): string {
  if (!finite(value)) return '—';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) {
    const digits = abs >= 0.001 ? 4 : abs >= 0.000001 ? 6 : 8;
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: precision === 'precise' ? 2 : 2,
  });
}

export function formatBtcPrice(value: number): string {
  return formatUsdAdaptive(value, 'precise');
}

export function formatInterest(value: number): string {
  return formatUsdAdaptive(value, 'precise');
}

export function formatGasFee(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !finite(usd)) return '—';
  return formatUsdAdaptive(usd, 'precise');
}

export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  opts?: { compact?: boolean; symbol?: string; trim?: boolean; displayDecimals?: number },
): string {
  if (decimals < 0 || decimals > 18) return '—';
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = abs % scale;
  const maxShown = opts?.displayDecimals ?? (opts?.compact ? (decimals >= 8 ? decimals : Math.min(2, decimals)) : decimals);
  let frac = fraction.toString().padStart(decimals, '0').slice(0, maxShown);
  const trim = opts?.trim ?? Boolean(opts?.compact && decimals >= 8);
  if (trim) frac = frac.replace(/0+$/, '');
  const body = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  const signed = `${negative ? '-' : ''}${body}`;
  return opts?.symbol ? `${signed} ${opts.symbol}` : signed;
}

export function formatCryptoBalance(amount: bigint, decimals: number, symbol: string, compact = false): string {
  return formatTokenAmount(amount, decimals, { compact, symbol, trim: compact });
}

export function tokenNumber(amount: bigint, decimals: number): number {
  if (decimals < 0 || decimals > 18) return Number.NaN;
  const scale = 10n ** BigInt(decimals);
  return Number(amount / scale) + Number(amount % scale) / Number(scale);
}

export function formatSignedUsd(value: number): string {
  const formatted = formatUsdAdaptive(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
