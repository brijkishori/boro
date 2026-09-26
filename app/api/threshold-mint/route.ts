import { getAddress, isAddress } from 'viem';
import { isBitcoinMainnetAddress, isTbtcRecoveryAddress } from '@/lib/btc';
import { createTbtcMint, readDepositUtxos, revealedAt } from '@/lib/threshold-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, number[]>();

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

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request must come from this app.' }, { status: 403 });
  const ip = clientIp(request);
  if (!ip) return Response.json({ error: 'Could not verify the request origin.' }, { status: 400 });
  if (limited(ip)) return Response.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });

  let body: { address?: unknown; recoveryAddress?: unknown };
  try {
    body = (await request.json()) as { address?: unknown; recoveryAddress?: unknown };
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (typeof body.address !== 'string' || !isAddress(body.address)) {
    return Response.json({ error: 'Connect the Ethereum wallet that should receive tBTC.' }, { status: 400 });
  }
  if (typeof body.recoveryAddress !== 'string' || !isTbtcRecoveryAddress(body.recoveryAddress)) {
    return Response.json({
      error: 'Enter a Bitcoin 1… or bc1q… address from a wallet you control. Do not use an exchange or taproot address.',
    }, { status: 400 });
  }

  try {
    const mint = await createTbtcMint(getAddress(body.address), body.recoveryAddress.trim());
    return Response.json({ mint }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create a Bitcoin deposit address.';
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const btc = url.searchParams.get('btc')?.trim() ?? '';
  if (!isBitcoinMainnetAddress(btc)) {
    return Response.json({ error: 'Enter the Bitcoin deposit address from this mint.' }, { status: 400 });
  }
  try {
    const utxos = await readDepositUtxos(btc);
    const confirmedSats = utxos.filter((item) => item.confirmed).reduce((sum, item) => sum + item.value, 0);
    const unconfirmedSats = utxos.filter((item) => !item.confirmed).reduce((sum, item) => sum + item.value, 0);
    const revealed = utxos.length === 0 ? 0 : await revealedAt(utxos[0]).catch(() => 0);
    return Response.json({
      btcAddress: btc,
      confirmedSats,
      unconfirmedSats,
      utxos,
      revealedAt: revealed,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that Bitcoin address.';
    return Response.json({ error: message }, { status: 502 });
  }
}
