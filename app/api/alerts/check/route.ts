import { formatUnits, type Address } from 'viem';
import { adapterFor } from '@/lib/adapters';
import { aprAlert, healthAlert, liquidationAlert, loanFacts, monthlyAlert, refinanceAlert, thresholdAlert, weeklyAlert, type AlertCopy } from '@/lib/alertEmail';
import { allSubscribers, saveSubscriber, shouldSend, type AlertSubscriber } from '@/lib/alerts';
import { sendMail } from '@/lib/mail';
import { formatApr, formatUsdExact } from '@/lib/amount';
import { refinanceHint } from '@/lib/opportunities';
import { chainLabel, protocolLabel } from '@/lib/protocol';
import { snapshotRates } from '@/lib/rateHistory';
import { getRates } from '@/lib/rates';
import { publicClient } from '@/lib/rpc';
import type { Venue } from '@/lib/protocol';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function readPosition(venue: Venue, user: Address) {
  const adapter = adapterFor(venue);
  const reads = adapter.positionReads(venue, user);
  if (reads.length === 0) return null;
  const client = publicClient(venue.chainId);
  const results = await Promise.all(reads.map((call) => client.readContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
  })));
  return adapter.parsePosition(venue, results);
}

function localParts(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: days[weekday] ?? -1,
    day: Number(parts.find((part) => part.type === 'day')?.value),
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
  };
}

function morningWindow(hour: number) {
  return hour >= 8 && hour <= 10;
}

async function evaluate(subscriber: AlertSubscriber, venues: Venue[], record: boolean) {
  const messages: AlertCopy[] = [];
  const digestRows: string[] = [];
  let weeklyInterestUsd = 0;
  let monthlyInterestUsd = 0;
  let totalDebtUsd = 0;
  let hasPosition = false;
  const borrowVenues = venues.filter((venue) => venue.action === 'borrow');

  for (const venue of borrowVenues) {
    try {
      const snapshot = await readPosition(venue, subscriber.address as Address);
      if (!snapshot || (snapshot.collateral === 0n && snapshot.debt === 0n)) continue;
      hasPosition = true;
      const facts = loanFacts(venue, snapshot);
      const debtUsd = Number(formatUnits(snapshot.debt, venue.loanDecimals));
      const week = Math.max(0, debtUsd * venue.borrowApr / 52);
      const month = Math.max(0, debtUsd * venue.borrowApr / 12);
      weeklyInterestUsd += week;
      monthlyInterestUsd += month;
      totalDebtUsd += debtUsd;
      digestRows.push(`${facts.protocol} ${facts.asset} on ${facts.chain}: debt ${facts.debtUsd}, HF ${facts.healthFactor}, liq ${facts.liquidationPrice}, APR ${facts.borrowApr}, interest ${facts.interestMonth}/mo`);
      const drop = snapshot.liquidationPrice > 0 && venue.priceUsd > 0
        ? (1 - snapshot.liquidationPrice / venue.priceUsd) * 100
        : 100;

      if (snapshot.healthFactor !== null && snapshot.healthFactor < subscriber.rules.healthUrgent && await shouldSend(subscriber.address, 'hf-urgent', venue.id, 6, record)) {
        messages.push(healthAlert('urgent', subscriber.address, facts));
      } else if (snapshot.healthFactor !== null && snapshot.healthFactor < subscriber.rules.healthWarn && await shouldSend(subscriber.address, 'hf-warn', venue.id, 12, record)) {
        messages.push(healthAlert('health', subscriber.address, facts));
      }
      if (drop <= subscriber.rules.liqDistancePct && await shouldSend(subscriber.address, 'liq', venue.id, 12, record)) {
        messages.push(liquidationAlert(subscriber.address, facts));
      }
      if (venue.borrowApr >= subscriber.rules.aprAbove && await shouldSend(subscriber.address, 'apr', venue.id, 24, record)) {
        messages.push(aprAlert(subscriber.address, facts));
      }
      const hint = refinanceHint({ venue, snapshot }, venues);
      if (hint && hint.yearlyUsd >= subscriber.rules.refinanceUsd && await shouldSend(subscriber.address, 'refi', venue.id, 24, record)) {
        messages.push(refinanceAlert(subscriber.address, facts, {
          toProtocol: protocolLabel(hint.to.protocol),
          toChain: chainLabel(hint.to.chainId),
          toApr: formatApr(hint.to.borrowApr),
          yearly: formatUsdExact(hint.yearlyUsd),
          monthly: formatUsdExact(hint.monthlyUsd),
        }));
      }
      if (subscriber.rules.thresholdUsd > 0 && debtUsd > 0) {
        const last = subscriber.lastThresholdUsd ?? 0;
        if (debtUsd - last >= subscriber.rules.thresholdUsd) {
          messages.push(thresholdAlert(subscriber.address, facts, formatUsdExact(debtUsd - last), formatUsdExact(last)));
          subscriber.lastThresholdUsd = debtUsd;
        }
      }
    } catch {
      // Skip a venue if one RPC call fails.
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const local = localParts(subscriber.rules.timeZone);
  if (subscriber.rules.weekly && subscriber.lastWeekly !== today && local.weekday === 1 && morningWindow(local.hour) && weeklyInterestUsd >= 1) {
    messages.push(weeklyAlert(subscriber.address, formatUsdExact(weeklyInterestUsd), [
      `Open loans: ${digestRows.length}`,
      `Total debt: ${formatUsdExact(totalDebtUsd)}`,
      `Interest this week: ${formatUsdExact(weeklyInterestUsd)}`,
      ...digestRows,
    ]));
    subscriber.lastWeekly = today;
  }
  if (subscriber.rules.monthly && subscriber.lastMonthly !== today && local.day === 1 && morningWindow(local.hour) && hasPosition) {
    messages.push(monthlyAlert(subscriber.address, [
      `Open loans: ${digestRows.length}`,
      `Total debt: ${formatUsdExact(totalDebtUsd)}`,
      `Interest this month at current rates: ${formatUsdExact(monthlyInterestUsd)}`,
      ...digestRows,
    ]));
    subscriber.lastMonthly = today;
  }

  return messages;
}

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const rates = await getRates();
  await snapshotRates(rates.venues);
  const subscribers = await allSubscribers();
  const preview: { email: string; kind: string; subject: string }[] = [];

  for (const subscriber of subscribers.slice(0, 25)) {
    const messages = await evaluate(subscriber, rates.venues, !dry);
    if (messages.length === 0) continue;
    for (const message of messages) {
      preview.push({ email: subscriber.email, kind: message.kind, subject: message.subject });
      if (!dry) await sendMail(subscriber.email, message.subject, message.text, message.html);
    }
    if (!dry) await saveSubscriber(subscriber);
  }

  return Response.json({ ok: true, dry, sent: preview.length, preview: dry ? preview : undefined });
}
