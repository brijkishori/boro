import { formatUnits, getAddress, isAddress, type Address } from 'viem';
import { auditStoreKey, episodeKey, sanitizeDocument } from '@/lib/audit';
import { readPosition, type PositionSnapshot } from '@/lib/adapters';
import {
  loanFacts,
  monthlyAlert,
  refinanceAlert,
  renderAlertEmail,
  weeklyAlert,
  type AlertCopy,
  type AlertKind,
  type LoanFacts,
} from '@/lib/alertEmail';
import { loadSubscriber, type AlertSubscriber } from '@/lib/alerts';
import { formatApr, formatUsdExact } from '@/lib/amount';
import { loanRateHistory } from '@/lib/finance/openingApr';
import {
  digestLines,
  isOpenDebt,
  previousUtcMonth,
  summarizeEpisodePeriod,
  type DigestPosition,
} from '@/lib/finance/periodInterest';
import { buildRefinanceDeepLink, evaluateLiveRefinanceOpportunity } from '@/lib/finance/refinanceAlertQualification';
import { mailConfigured, sendMail } from '@/lib/mail';
import { chainLabel, protocolLabel, type Venue } from '@/lib/protocol';
import { fetchUsdPrices } from '@/lib/prices';
import { getRates } from '@/lib/rates';
import { storeJson } from '@/lib/store';

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

type LiveLoan = {
  venue: Venue;
  snapshot: PositionSnapshot;
  facts: LoanFacts;
  debtUsd: number;
  name: string;
};

type LiveContext = {
  venues: Venue[];
  loans: LiveLoan[];
  openLoans: LiveLoan[];
  primary: LiveLoan | null;
};

function positionLines(facts: LoanFacts) {
  return [
    `Market: ${facts.protocol} · ${facts.asset} · ${facts.chain}`,
    `Collateral: ${facts.collateral} (${facts.collateralUsd})`,
    `Debt: ${facts.debt} (${facts.debtUsd})`,
    `Health factor: ${facts.healthFactor}`,
    `LTV: ${facts.ltv} of ${facts.maxLtv} max`,
    `BTC price now: ${facts.btcPrice}`,
    `Liquidation price: ${facts.liquidationPrice}`,
    `Room to liquidation: ${facts.dropPct}`,
    `Current APR: ${facts.borrowApr}`,
    `Estimated interest at current balance and APR: ${facts.interestMonth}/mo · ${facts.interestYear}/yr`,
  ];
}

async function loadLiveContext(address: Address): Promise<LiveContext> {
  const rates = await getRates({ bypassCache: true, strict: true });
  const venues = rates.venues;
  const loans: LiveLoan[] = [];

  for (const venue of venues) {
    if (venue.action !== 'borrow') continue;
    try {
      const snapshot = await readPosition(venue, address);
      if (!snapshot || (snapshot.collateral === 0n && snapshot.debt === 0n)) continue;
      const facts = loanFacts(venue, snapshot);
      const debtUsd = Number(formatUnits(snapshot.debt, venue.loanDecimals));
      loans.push({
        venue,
        snapshot,
        facts,
        debtUsd,
        name: `${protocolLabel(venue.protocol)} · ${venue.assetSymbol} · ${chainLabel(venue.chainId)}`,
      });
    } catch {
      // A test email must never substitute fixture data when a live read fails.
    }
  }

  const openLoans = loans.filter((loan) => isOpenDebt(loan.debtUsd));
  const primary = [...openLoans].sort((a, b) => {
    const aHf = a.snapshot.healthFactor ?? Number.POSITIVE_INFINITY;
    const bHf = b.snapshot.healthFactor ?? Number.POSITIVE_INFINITY;
    if (aHf !== bHf) return aHf - bHf;
    return b.debtUsd - a.debtUsd;
  })[0] ?? null;

  return { venues, loans, openLoans, primary };
}

function thresholdStatus(current: number | null, threshold: number, comparator: 'below' | 'belowOrEqual' | 'above') {
  if (current === null || !Number.isFinite(current)) return 'Current value unavailable.';
  const breached = comparator === 'below' ? current < threshold : comparator === 'belowOrEqual' ? current <= threshold : current >= threshold;
  return breached ? 'Status: threshold is currently breached.' : 'Status: threshold is not currently breached.';
}

function livePositionTestAlert(kind: Exclude<AlertKind, 'confirm' | 'refinance' | 'weekly' | 'monthly'>, address: string, subscriber: AlertSubscriber, loan: LiveLoan): AlertCopy {
  const { facts, snapshot, venue, debtUsd } = loan;
  const liveLine = 'TEST DELIVERY using current live position and market data. No sample balances, APRs, or risk values are used.';

  if (kind === 'urgent') {
    const threshold = subscriber.rules.healthUrgent;
    return renderAlertEmail('urgent', address, [
      liveLine,
      `Current health factor is ${facts.healthFactor}. Your urgent threshold is ${threshold.toFixed(2)}.`,
      thresholdStatus(snapshot.healthFactor, threshold, 'below'),
    ], positionLines(facts));
  }

  if (kind === 'health') {
    const threshold = subscriber.rules.healthWarn;
    return renderAlertEmail('health', address, [
      liveLine,
      `Current health factor is ${facts.healthFactor}. Your warning threshold is ${threshold.toFixed(2)}.`,
      thresholdStatus(snapshot.healthFactor, threshold, 'below'),
    ], positionLines(facts));
  }

  if (kind === 'liquidation') {
    const roomPct = snapshot.liquidationPrice > 0 && venue.priceUsd > 0
      ? Math.max(0, (1 - snapshot.liquidationPrice / venue.priceUsd) * 100)
      : null;
    const threshold = subscriber.rules.liqDistancePct;
    return renderAlertEmail('liquidation', address, [
      liveLine,
      `Current room to liquidation is ${roomPct === null ? 'unavailable' : `${roomPct.toFixed(1)}%`}. Your alert distance is ${threshold.toFixed(1)}%.`,
      thresholdStatus(roomPct, threshold, 'belowOrEqual'),
    ], positionLines(facts));
  }

  if (kind === 'apr') {
    const threshold = subscriber.rules.aprAbove;
    return renderAlertEmail('apr', address, [
      liveLine,
      `Current borrow APR is ${formatApr(venue.borrowApr)}. Your APR alert threshold is ${formatApr(threshold)}.`,
      thresholdStatus(venue.borrowApr, threshold, 'above'),
    ], positionLines(facts));
  }

  const baseline = subscriber.lastThresholdUsd ?? 0;
  const growth = Math.max(0, debtUsd - baseline);
  const configured = subscriber.rules.thresholdUsd;
  const status = configured > 0
    ? (growth >= configured ? 'Status: configured threshold is currently reached.' : 'Status: configured threshold is not currently reached.')
    : 'Status: no interest/debt-growth threshold is currently configured.';
  return renderAlertEmail('threshold', address, [
    liveLine,
    `Current debt is ${formatUsdExact(debtUsd)}. Increase since the stored alert baseline is ${formatUsdExact(growth)}.`,
    `Configured threshold: ${configured > 0 ? formatUsdExact(configured) : 'not configured'}.`,
    status,
  ], positionLines(facts));
}

async function digestRows(address: string, context: LiveContext, period: 'week' | 'month') {
  const now = Date.now();
  const range = period === 'week'
    ? { periodStart: now - 7 * 86_400_000, periodEnd: now }
    : previousUtcMonth(now);
  const ledgerEvents = sanitizeDocument(await storeJson(auditStoreKey(address))).events;
  const rows: DigestPosition[] = [];
  const supplied: string[] = [];
  let totalDebtUsd = 0;

  for (const loan of context.loans) {
    if (!isOpenDebt(loan.debtUsd)) {
      if (loan.snapshot.collateral > 0n) supplied.push(loan.name);
      continue;
    }
    const key = episodeKey(address, loan.venue);
    const summary = summarizeEpisodePeriod({
      events: ledgerEvents,
      episodeKey: key,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      endingDebt: loan.snapshot.debt,
      decimals: loan.venue.loanDecimals,
    });
    const openingApr = loanRateHistory(ledgerEvents, key).opening?.normalizedBorrowApr ?? null;
    totalDebtUsd += loan.debtUsd;
    rows.push({
      name: loan.name,
      debtUsd: loan.debtUsd,
      principalRemainingUsd: summary.principalRemainingUsd,
      accruedUnpaidUsd: summary.accruedUnpaidUsd,
      apr: Number.isFinite(loan.venue.borrowApr) ? loan.venue.borrowApr : null,
      openingApr,
      ltv: loan.snapshot.ltv,
      healthFactor: loan.snapshot.healthFactor,
      liquidationPriceUsd: loan.snapshot.liquidationPrice > 0 ? loan.snapshot.liquidationPrice : null,
      actualUsd: summary.actual.usd,
      actualStatus: summary.actual.status,
      interestPaidUsd: summary.interestPaidUsd,
      principalRepaidUsd: summary.principalRepaidUsd,
      additionalBorrowingUsd: summary.additionalBorrowingUsd,
      networkFeesUsd: summary.networkFeesUsd,
    });
  }

  return [
    'TEST DELIVERY using current live positions plus your tracked loan ledger.',
    `Total debt: ${formatUsdExact(totalDebtUsd)}`,
    ...digestLines(period, rows, supplied),
  ];
}

async function buildLiveTestAlert(kind: Exclude<AlertKind, 'refinance'>, address: Address, subscriber: AlertSubscriber, context?: LiveContext): Promise<AlertCopy | null> {
  if (kind === 'confirm') {
    return renderAlertEmail('confirm', address, [
      'TEST DELIVERY using your current alert subscription details.',
      `Alerts are currently confirmed for ${subscriber.email}.`,
      `Wallet: ${address}`,
    ]);
  }

  const live = context ?? await loadLiveContext(address);
  if (kind === 'weekly') {
    if (live.openLoans.length === 0) return null;
    return weeklyAlert(address, await digestRows(address, live, 'week'));
  }
  if (kind === 'monthly') {
    if (live.openLoans.length === 0) return null;
    return monthlyAlert(address, await digestRows(address, live, 'month'));
  }
  if (!live.primary) return null;
  return livePositionTestAlert(kind, address, subscriber, live.primary);
}

async function sendTestMail(to: string, email: AlertCopy) {
  await sendMail(
    to,
    `[TEST] ${email.subject}`,
    `This is a delivery test using live account/market data where applicable. Production alerts will not include this first line.\n\n${email.text}`,
    `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666"><strong>TEST DELIVERY.</strong> Live account/market data is used where applicable. Production alerts will not include this line.</p>${email.html}`,
  );
}

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

  if (kind === 'confirm') {
    const email = await buildLiveTestAlert('confirm', address, subscriber);
    if (!email) return Response.json({ ok: true, sent: false, reason: 'NO_LIVE_DATA' });
    await sendTestMail(subscriber.email, email);
    return Response.json({ ok: true, sent: 1, to: subscriber.email, kinds: ['confirm'] });
  }

  const context = await loadLiveContext(address);

  if (kind === 'refinance') {
    const usdPrices = await fetchUsdPrices().catch(() => ({ ethUsd: 0, btcUsd: 0 }));
    const ethPriceUsd = usdPrices.ethUsd > 0 ? usdPrices.ethUsd : null;
    const liveResult = await evaluateLiveRefinanceOpportunity({
      address,
      venues: context.venues,
      rules: subscriber.rules,
      ethPriceUsd,
    });

    if (!liveResult.isQualified || !liveResult.qualification || !liveResult.sourceVenue) {
      return Response.json({ ok: true, sent: false, reason: 'NO_QUALIFIED_REFINANCE_OPPORTUNITY' });
    }

    const qualification = liveResult.qualification;
    const deepLink = buildRefinanceDeepLink(liveResult.sourceVenue.id, qualification.snapshot.destinationMarketId);
    const email = refinanceAlert(address, qualification, { deepLinkUrl: deepLink, now: Date.now() });
    await sendTestMail(subscriber.email, email);
    return Response.json({ ok: true, sent: 1, to: subscriber.email, kinds: ['refinance'] });
  }

  if (kind) {
    const email = await buildLiveTestAlert(kind, address, subscriber, context);
    if (!email) return Response.json({ ok: true, sent: false, reason: 'NO_OPEN_LOAN' });
    await sendTestMail(subscriber.email, email);
    return Response.json({ ok: true, sent: 1, to: subscriber.email, kinds: [kind] });
  }

  const requested: Exclude<AlertKind, 'refinance'>[] = ['confirm', 'urgent', 'health', 'liquidation', 'apr', 'threshold', 'weekly', 'monthly'];
  const sentKinds: AlertKind[] = [];
  const skipped: { kind: AlertKind; reason: string }[] = [];

  for (const requestedKind of requested) {
    const email = await buildLiveTestAlert(requestedKind, address, subscriber, context);
    if (!email) {
      skipped.push({ kind: requestedKind, reason: 'NO_OPEN_LOAN' });
      continue;
    }
    await sendTestMail(subscriber.email, email);
    sentKinds.push(requestedKind);
  }

  const usdPrices = await fetchUsdPrices().catch(() => ({ ethUsd: 0, btcUsd: 0 }));
  const ethPriceUsd = usdPrices.ethUsd > 0 ? usdPrices.ethUsd : null;
  const liveResult = await evaluateLiveRefinanceOpportunity({
    address,
    venues: context.venues,
    rules: subscriber.rules,
    ethPriceUsd,
  });
  if (liveResult.isQualified && liveResult.qualification && liveResult.sourceVenue) {
    const qualification = liveResult.qualification;
    const deepLink = buildRefinanceDeepLink(liveResult.sourceVenue.id, qualification.snapshot.destinationMarketId);
    await sendTestMail(subscriber.email, refinanceAlert(address, qualification, { deepLinkUrl: deepLink, now: Date.now() }));
    sentKinds.push('refinance');
  } else {
    skipped.push({ kind: 'refinance', reason: 'NO_QUALIFIED_REFINANCE_OPPORTUNITY' });
  }

  return Response.json({ ok: true, sent: sentKinds.length, to: subscriber.email, kinds: sentKinds, skipped });
}
