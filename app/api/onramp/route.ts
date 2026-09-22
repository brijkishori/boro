import { getAddress, isAddress } from 'viem';
import { cdpJwt } from '@/lib/cdpJwt';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN_HOST = 'api.developer.coinbase.com';
const TOKEN_PATH = '/onramp/v1/token';
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const MAX_USD = 1_000_000;
const hits = new Map<string, number[]>();

function configured() {
  return Boolean(process.env.CDP_API_KEY_ID?.trim() && process.env.CDP_API_KEY_SECRET?.trim());
}

function clientIp(request: Request): string | null {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  if (process.env.VERCEL) {
    const forwarded = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return process.env.NODE_ENV === 'production' ? null : '192.0.2.1';
}

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) {
    const oldest = hits.keys().next().value;
    if (oldest) hits.delete(oldest);
  }
  return recent.length > MAX_PER_WINDOW;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function GET() {
  return Response.json({ configured: configured() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!configured()) {
    return Response.json({ error: 'Coinbase transfer is not set up on this server.' }, { status: 503 });
  }
  if (!sameOrigin(request)) {
    return Response.json({ error: 'Request must come from this app.' }, { status: 403 });
  }
  const ip = clientIp(request);
  if (!ip) return Response.json({ error: 'Could not verify the request origin.' }, { status: 400 });
  if (limited(ip)) return Response.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });

  let body: { address?: unknown; usd?: unknown };
  try {
    body = (await request.json()) as { address?: unknown; usd?: unknown };
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (typeof body.address !== 'string' || !isAddress(body.address)) {
    return Response.json({ error: 'Invalid wallet address.' }, { status: 400 });
  }
  const address = getAddress(body.address);
  const usd = typeof body.usd === 'number' && Number.isFinite(body.usd) && body.usd > 0 && body.usd <= MAX_USD ? Math.round(body.usd * 100) / 100 : null;

  let jwt: string;
  try {
    jwt = cdpJwt({
      keyId: process.env.CDP_API_KEY_ID!,
      secret: process.env.CDP_API_KEY_SECRET!,
      method: 'POST',
      host: TOKEN_HOST,
      path: TOKEN_PATH,
    });
  } catch (error) {
    console.error('onramp: could not sign the CDP request', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Coinbase transfer is misconfigured on this server.', code: 'key_format' }, { status: 500 });
  }

  try {
    const response = await fetch(`https://${TOKEN_HOST}${TOKEN_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: [{ address, blockchains: ['base'] }], clientIp: ip }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const text = await response.text();
    let data: { token?: unknown } | null = null;
    try {
      data = JSON.parse(text) as { token?: unknown };
    } catch {
      data = null;
    }
    if (!response.ok || typeof data?.token !== 'string') {
      console.error('onramp: Coinbase token request failed', response.status, text.slice(0, 300));
      return Response.json({ error: 'Coinbase did not start the transfer. Try again shortly.', code: `coinbase_${response.status}` }, { status: 502 });
    }
    const url = new URL('https://pay.coinbase.com/buy/select-asset');
    url.searchParams.set('sessionToken', data.token);
    url.searchParams.set('defaultExperience', 'send');
    url.searchParams.set('defaultNetwork', 'base');
    url.searchParams.set('defaultAsset', 'BTC');
    if (usd !== null) url.searchParams.set('presetFiatAmount', String(usd));
    return Response.json({ url: url.toString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('onramp: Coinbase unreachable', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Coinbase did not start the transfer. Try again shortly.', code: 'coinbase_unreachable' }, { status: 502 });
  }
}
