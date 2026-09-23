import { getAddress, isAddress } from 'viem';
import {
  auditStoreKey,
  isAuditEvent,
  mergeEvents,
  sanitizeDocument,
  type AuditDocument,
  type AuditEvent,
} from '@/lib/audit';
import { storeJson, storeRemoteConfigured, storeSetJson, type Json } from '@/lib/store';

export const dynamic = 'force-dynamic';

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

async function loadDoc(wallet: string): Promise<AuditDocument> {
  return sanitizeDocument(await storeJson<Json>(auditStoreKey(wallet)));
}

async function saveDoc(wallet: string, events: AuditEvent[]) {
  const doc: AuditDocument = { v: 1, events: mergeEvents(events) };
  await storeSetJson(auditStoreKey(wallet), JSON.parse(JSON.stringify(doc)) as Json);
  return doc;
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get('address') ?? '';
  if (!isAddress(address)) return Response.json({ durable: storeRemoteConfigured(), events: [] });
  const doc = await loadDoc(getAddress(address));
  return Response.json({ durable: storeRemoteConfigured(), events: doc.events });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request must come from this app.' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { address?: unknown; events?: unknown; event?: unknown };
  if (typeof body.address !== 'string' || !isAddress(body.address)) {
    return Response.json({ error: 'Invalid address.' }, { status: 400 });
  }
  const wallet = getAddress(body.address);
  const incoming = [
    ...(Array.isArray(body.events) ? body.events : []),
    ...(body.event ? [body.event] : []),
  ].filter(isAuditEvent).filter((event) => event.wallet.toLowerCase() === wallet.toLowerCase());
  if (incoming.length === 0) return Response.json({ error: 'No audit events.' }, { status: 400 });
  const current = await loadDoc(wallet);
  const doc = await saveDoc(wallet, [...current.events, ...incoming]);
  return Response.json({ ok: true, durable: storeRemoteConfigured(), events: doc.events });
}
