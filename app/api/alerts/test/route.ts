import { getAddress, isAddress } from 'viem';
import { type AlertKind, sampleAlertByKind, sampleAlertEmails } from '@/lib/alertEmail';
import { loadSubscriber } from '@/lib/alerts';
import { mailConfigured, sendMail } from '@/lib/mail';

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

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

const kinds = new Set<AlertKind>(['confirm', 'urgent', 'health', 'liquidation', 'apr', 'refinance', 'threshold', 'weekly', 'monthly']);
const recent = new Map<string, number>();

export async function POST(request: Request) {
  if (!mailConfigured()) return Response.json({ error: 'Gmail SMTP is not configured.' }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { address?: unknown; kind?: unknown };
  if (typeof body.address !== 'string' || !isAddress(body.address)) return Response.json({ error: 'Invalid address.' }, { status: 400 });
  if (!sameOrigin(request) && !authorized(request)) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  const kind = typeof body.kind === 'string' && kinds.has(body.kind as AlertKind) ? body.kind as AlertKind : null;

  const address = getAddress(body.address);
  const subscriber = await loadSubscriber(address);
  if (!subscriber?.confirmed) return Response.json({ error: 'Confirm email alerts first.' }, { status: 403 });
  const bucket = `${address.toLowerCase()}:${kind ?? 'all'}`;
  const wait = kind ? 5_000 : 45_000;
  const last = recent.get(bucket) ?? 0;
  if (Date.now() - last < wait) return Response.json({ error: 'Wait a few seconds before sending that test again.' }, { status: 429 });
  recent.set(bucket, Date.now());

  const samples = kind ? [sampleAlertByKind(address, kind)].filter((sample): sample is NonNullable<typeof sample> => Boolean(sample)) : sampleAlertEmails(address);
  if (samples.length === 0) return Response.json({ error: 'Unknown alert type.' }, { status: 400 });
  for (const sample of samples) {
    await sendMail(
      subscriber.email,
      `[TEST] ${sample.subject}`,
      `This is a test email. Production alerts will not include this first line.\n\n${sample.text}`,
      `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666">This is a test email. Production alerts will not include this line.</p>${sample.html}`,
    );
  }
  return Response.json({ ok: true, sent: samples.length, to: subscriber.email, kinds: samples.map((sample) => sample.kind) });
}
