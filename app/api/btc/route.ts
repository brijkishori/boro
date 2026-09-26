import { isBitcoinMainnetAddress, normalizeBitcoinAddress } from '@/lib/btc';

export const dynamic = 'force-dynamic';

type CacheEntry = { at: number; body: BtcSnapshot };
type BtcSnapshot = {
  address: string;
  confirmedSats: number;
  unconfirmedSats: number;
  txCount: number;
  fees: { fastest: number; halfHour: number; economy: number };
};

const CACHE_MS = 15_000;
const cache = new Map<string, CacheEntry>();
let feeCache: { at: number; fees: BtcSnapshot['fees'] } | null = null;

function remember(address: string, body: BtcSnapshot) {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(address, { at: Date.now(), body });
}

function asNonNegative(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || number > 21_000_000 * 1e8) return null;
  return number;
}

const EXPLORERS = [
  'https://mempool.space/api/address/',
  'https://blockstream.info/api/address/',
];

function asCount(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? asNonNegative(parsed) : null;
  }
  return asNonNegative(value);
}

async function readFees(): Promise<BtcSnapshot['fees']> {
  if (feeCache && Date.now() - feeCache.at < 30_000) return feeCache.fees;
  try {
    const response = await fetch('https://mempool.space/api/v1/fees/recommended', {
      headers: { Accept: 'application/json', 'User-Agent': 'boro/1.0' },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('fees unavailable');
    const body = (await response.json()) as { fastestFee?: unknown; halfHourFee?: unknown; economyFee?: unknown };
    const fastest = asCount(body.fastestFee);
    const halfHour = asCount(body.halfHourFee);
    const economy = asCount(body.economyFee);
    if (fastest === null || halfHour === null || economy === null) throw new Error('bad fees');
    const fees = { fastest, halfHour, economy };
    feeCache = { at: Date.now(), fees };
    return fees;
  } catch {
    return feeCache?.fees ?? { fastest: 1, halfHour: 1, economy: 1 };
  }
}

async function readExplorer(address: string) {
  let lastError = 'Bitcoin network lookup failed.';
  for (const base of EXPLORERS) {
    try {
      const response = await fetch(`${base}${encodeURIComponent(address)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'boro/1.0' },
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
      });
      if (!response.ok) {
        lastError = 'Bitcoin network lookup failed.';
        continue;
      }
      const body = (await response.json()) as {
        chain_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown; tx_count?: unknown };
        mempool_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown };
      };
      const funded = asCount(body.chain_stats?.funded_txo_sum);
      const spent = asCount(body.chain_stats?.spent_txo_sum);
      const pendingIn = asCount(body.mempool_stats?.funded_txo_sum);
      const pendingOut = asCount(body.mempool_stats?.spent_txo_sum);
      const txCount = asCount(body.chain_stats?.tx_count);
      if (funded === null || spent === null || pendingIn === null || pendingOut === null || txCount === null) {
        lastError = 'Bitcoin network returned an unexpected balance.';
        continue;
      }
      return {
        confirmedSats: Math.max(0, funded - spent),
        unconfirmedSats: pendingIn - pendingOut,
        txCount,
      };
    } catch {
      lastError = 'Bitcoin network lookup failed.';
    }
  }
  throw new Error(lastError);
}

export async function GET(request: Request) {
  const address = normalizeBitcoinAddress(new URL(request.url).searchParams.get('address') ?? '');
  if (!isBitcoinMainnetAddress(address)) {
    return Response.json({ error: 'Enter a valid Bitcoin mainnet address.' }, { status: 400 });
  }

  const cached = cache.get(address);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return Response.json(cached.body, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const [stats, fees] = await Promise.all([readExplorer(address), readFees()]);
    const snapshot: BtcSnapshot = { address, ...stats, fees };
    remember(address, snapshot);
    return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'Bitcoin network lookup failed.',
    }, { status: 502 });
  }
}
