import { formatUnits } from 'viem';

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

export function approvalStep(allowance: bigint, needed: bigint): 'none' | 'reset' | 'approve' {
  if (needed <= 0n || allowance >= needed) return 'none';
  if (allowance > 0n) return 'reset';
  return 'approve';
}

export function parseAmount(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;
  if (whole.length > 40) return null;
  const digits = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return BigInt(digits);
}

export function formatToken(amount: bigint, decimals: number, maxFraction = 8): string {
  const text = formatUnits(amount, decimals);
  const [whole, fraction = ''] = text.split('.');
  const sliced = fraction.slice(0, maxFraction).replace(/0+$/, '');
  return sliced ? `${whole}.${sliced}` : whole;
}

export function formatApr(apr: number): string {
  if (!Number.isFinite(apr) || apr < 0) return '—';
  const percent = apr * 100;
  if (percent > 0 && percent < 0.01) return '<0.01%';
  return `${percent.toFixed(2)}%`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  });
}

export function formatUsdExact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function tokenPriceUsd(symbol: string, priceUsd: number): number {
  if (symbol === 'USDC') return 1;
  if (priceUsd >= 1_000 && priceUsd <= 2_000_000) return priceUsd;
  return 0;
}

export function tokenAmountUsd(amount: bigint, decimals: number, priceUsd: number): number | null {
  if (priceUsd <= 0 || amount < 0n || decimals < 0 || decimals > 18) return null;
  const scale = 10n ** BigInt(decimals);
  const tokens = Number(amount / scale) + Number(amount % scale) / Number(scale);
  if (!Number.isFinite(tokens)) return null;
  return tokens * priceUsd;
}

/** Converts a dollar entry into token units. The result is rounded down so the send never exceeds the dollars typed. */
export function usdToToken(usdText: string, decimals: number, priceUsd: number): bigint | null {
  if (!(priceUsd > 0)) return null;
  const cents = parseAmount(usdText, 2);
  if (cents === null) return null;
  const price = parseAmount(priceUsd.toFixed(8), 8);
  if (price === null || price <= 0n) return null;
  return (cents * 10n ** BigInt(decimals + 6)) / price;
}

export function formatBtcFromSats(sats: number): string {
  if (!Number.isFinite(sats) || sats < 0) return '0';
  return (sats / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 });
}
