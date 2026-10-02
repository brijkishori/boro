import { getAddress, isAddress } from 'viem';
import { type AlertKind, refinanceAlert, sampleAlertByKind, sampleAlertEmails } from '@/lib/alertEmail';
import { loadSubscriber } from '@/lib/alerts';
import { buildRefinanceDeepLink, evaluateLiveRefinanceOpportunity } from '@/lib/finance/refinanceAlertQualification';
import { mailConfigured, sendMail } from '@/lib/mail';
import { fetchUsdPrices } from '@/lib/prices';
import { getRates } from '@/lib/rates';

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

  if (kind === 'refinance') {
    const rates = await getRates({
      bypassCache: true,
      strict: true,
    });
    const usdPrices = await fetchUsdPrices().catch(() => ({ ethUsd: 0, btcUsd: 0 }));
    const ethPriceUsd = usdPrices.ethUsd > 0 ? usdPrices.ethUsd : null;

    const liveResult = await evaluateLiveRefinanceOpportunity({
      address,
      venues: rates.venues,
      rules: subscriber.rules,
      ethPriceUsd,
    });

    if (!liveResult.isQualified || !liveResult.qualification || !liveResult.sourceVenue) {
      return Response.json({
        ok: true,
        sent: false,
        reason: 'NO_QUALIFIED_REFINANCE_OPPORTUNITY',
      });
    }

    const qualification = liveResult.qualification;
    const deepLink = buildRefinanceDeepLink(liveResult.sourceVenue.id, qualification.snapshot.destinationMarketId);
    const email = refinanceAlert(address, qualification, { deepLinkUrl: deepLink, now: Date.now() });

    await sendMail(
      subscriber.email,
      `[TEST] ${email.subject}`,
      `This is a test email. Production alerts will not include this first line.\n\n${email.text}`,
      `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666">This is a test email. Production alerts will not include this line.</p>${email.html}`,
    );

    return Response.json({
      ok: true,
      sent: true,
      to: subscriber.email,
      kinds: ['refinance'],
    });
  }

  if (kind) {
    const sample = sampleAlertByKind(address, kind);
    if (!sample) return Response.json({ error: 'Unknown alert type.' }, { status: 400 });
    await sendMail(
      subscriber.email,
      `[TEST] ${sample.subject}`,
      `This is a test email. Production alerts will not include this first line.\n\n${sample.text}`,
      `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666">This is a test email. Production alerts will not include this line.</p>${sample.html}`,
    );
    return Response.json({ ok: true, sent: 1, to: subscriber.email, kinds: [kind] });
  }

  // All samples requested
  const samples = sampleAlertEmails(address);
  for (const sample of samples) {
    await sendMail(
      subscriber.email,
      `[TEST] ${sample.subject}`,
      `This is a test email. Production alerts will not include this first line.\n\n${sample.text}`,
      `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666">This is a test email. Production alerts will not include this line.</p>${sample.html}`,
    );
  }
  const sentKinds = samples.map((sample) => sample.kind);

  // Evaluate live refinance test for "all" mode
  const rates = await getRates({
    bypassCache: true,
    strict: true,
  });
  const usdPrices = await fetchUsdPrices().catch(() => ({ ethUsd: 0, btcUsd: 0 }));
  const ethPriceUsd = usdPrices.ethUsd > 0 ? usdPrices.ethUsd : null;

  const liveResult = await evaluateLiveRefinanceOpportunity({
    address,
    venues: rates.venues,
    rules: subscriber.rules,
    ethPriceUsd,
  });

  if (liveResult.isQualified && liveResult.qualification && liveResult.sourceVenue) {
    const qualification = liveResult.qualification;
    const deepLink = buildRefinanceDeepLink(liveResult.sourceVenue.id, qualification.snapshot.destinationMarketId);
    const email = refinanceAlert(address, qualification, { deepLinkUrl: deepLink, now: Date.now() });

    await sendMail(
      subscriber.email,
      `[TEST] ${email.subject}`,
      `This is a test email. Production alerts will not include this first line.\n\n${email.text}`,
      `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666">This is a test email. Production alerts will not include this line.</p>${email.html}`,
    );
    sentKinds.push('refinance');
  }

  return Response.json({ ok: true, sent: sentKinds.length, to: subscriber.email, kinds: sentKinds });
}
