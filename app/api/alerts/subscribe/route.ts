import { getAddress, isAddress } from 'viem';
import { confirmAlertEmail } from '@/lib/alertEmail';
import { DEFAULT_RULES, consumeNonce, loadSubscriber, saveSubscriber, type AlertRules } from '@/lib/alerts';
import { mailConfigured, sendMail } from '@/lib/mail';

export const dynamic = 'force-dynamic';

const recent = new Map<string, number>();

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

function rateLimit(key: string) {
  const last = recent.get(key) ?? 0;
  if (Date.now() - last < 30_000) return false;
  recent.set(key, Date.now());
  return true;
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get('address') ?? '';
  if (!isAddress(address)) return Response.json({ configured: mailConfigured(), subscriber: null });
  const subscriber = await loadSubscriber(address);
  return Response.json({
    configured: mailConfigured(),
    subscriber: subscriber ? { email: subscriber.email, confirmed: subscriber.confirmed, rules: subscriber.rules } : null,
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request must come from this app.' }, { status: 403 });
  if (!mailConfigured()) return Response.json({ error: 'Email alerts are not configured on this server.' }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    address?: unknown;
    email?: unknown;
    nonce?: unknown;
    rules?: Partial<AlertRules>;
  };
  if (typeof body.address !== 'string' || !isAddress(body.address)) return Response.json({ error: 'Invalid address.' }, { status: 400 });
  if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return Response.json({ error: 'Enter a valid email.' }, { status: 400 });
  if (typeof body.nonce !== 'string') return Response.json({ error: 'Refresh the page and try again.' }, { status: 400 });
  const address = getAddress(body.address);
  const email = body.email.trim().toLowerCase();
  if (!rateLimit(`${address.toLowerCase()}:${email}`)) {
    return Response.json({ error: 'Wait a few seconds before requesting another confirmation email.' }, { status: 429 });
  }
  if (!(await consumeNonce(address, body.nonce))) return Response.json({ error: 'The signup expired. Try again.' }, { status: 400 });

  const existing = await loadSubscriber(address);
  const rules = { ...DEFAULT_RULES, ...existing?.rules, ...body.rules };
  await saveSubscriber({ address, email, confirmed: false, rules });
  const confirm = confirmAlertEmail(address, email);
  try {
    await sendMail(email, confirm.subject, confirm.text, confirm.html);
  } catch {
    return Response.json({ error: 'Gmail could not send the confirmation email. Check the app password and try again.' }, { status: 502 });
  }
  return Response.json({ ok: true });
}
