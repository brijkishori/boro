import { formatUnits, type Address } from 'viem';
import { alertMarketKey, deliveryKind, evaluateEnabledPlan, monthlyStatementLines, type AlertEvent, type AlertRecommendationInput } from '@/lib/finance/recommendedAlerts';
import { historyCoverage } from '@/lib/finance/history';
import { availableToBorrowUsd, chainLabel, protocolLabel, protocolMarketId, type Venue } from '@/lib/protocol';
import { type RatePoint } from '@/lib/rateHistory';
import { storeJson } from '@/lib/store';
import { adapterFor } from '@/lib/adapters';
import { aprAlert, healthAlert, liquidationAlert, loanFacts, monthlyAlert, refinanceAlert, renderAlertEmail, thresholdAlert, weeklyAlert, type AlertCopy } from '@/lib/alertEmail';
import { allSubscribers, saveSubscriber, shouldSend, type AlertSubscriber } from '@/lib/alerts';
import { sendMail } from '@/lib/mail';
import { formatApr, formatUsdExact } from '@/lib/amount';
import { refinanceHint } from '@/lib/opportunities';
import { snapshotRates } from '@/lib/rateHistory';
import { getRates } from '@/lib/rates';
import { publicClient } from '@/lib/rpc';

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

type VenueRateContext = {
  aprChange6hBps: number | null;
  aprChange24hBps: number | null;
  recentUtilization: number | null;
  recentBorrowApr: number | null;
  recentLiquidityUsd: number | null;
};

function earlierPoint(points: RatePoint[], secondsAgo: number) {
  const target = Date.now() / 1000 - secondsAgo;
  const eligible = points.filter((point) => point.t <= target);
  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

async function loadVenueRateContext(venue: Venue): Promise<VenueRateContext> {
  const points = (await storeJson<RatePoint[]>(`rates:hist:${venue.id}`)) ?? [];
  const six = earlierPoint(points, 6 * 3_600);
  const day = earlierPoint(points, 24 * 3_600);
  const adequate = historyCoverage(venue.rateHistory) === 'adequate';
  const dayApr = day?.borrow ?? (adequate ? venue.rateHistory?.avg24h : undefined);
  return {
    aprChange6hBps: six ? (venue.borrowApr - six.borrow) * 10_000 : null,
    aprChange24hBps: dayApr === undefined ? null : (venue.borrowApr - dayApr) * 10_000,
    recentUtilization: six?.utilization ?? day?.utilization ?? null,
    recentBorrowApr: six?.borrow ?? dayApr ?? null,
    recentLiquidityUsd: day?.liquidity ?? null,
  };
}

function recommendationInput(
  venue: Venue,
  snapshot: { collateral: bigint; debt: bigint; healthFactor: number | null; ltv: number; liquidationPrice: number },
  wallet: string,
  failed = false,
  context?: VenueRateContext,
  benchmarkApr?: number | null,
): AlertRecommendationInput {
  const collateralAmount = Number(formatUnits(snapshot.collateral, venue.assetDecimals));
  const debtUsd = Number(formatUnits(snapshot.debt, venue.loanDecimals));
  const cushion = venue.priceUsd > 0 && snapshot.liquidationPrice > 0
    ? (venue.priceUsd - snapshot.liquidationPrice) / venue.priceUsd
    : null;
  const coverage = historyCoverage(venue.rateHistory);
  const day = coverage === 'adequate' && venue.rateHistory?.avg24h !== undefined
    ? (venue.borrowApr - venue.rateHistory.avg24h) * 10_000
    : null;
  return {
    wallet,
    chainId: venue.chainId,
    protocol: venue.protocol,
    marketId: protocolMarketId(venue),
    collateralAmount,
    debtUsd,
    oraclePriceUsd: venue.priceUsd,
    healthFactor: snapshot.healthFactor,
    ltv: snapshot.ltv,
    liquidationThreshold: venue.maxLtv,
    liquidationPriceUsd: snapshot.liquidationPrice > 0 ? snapshot.liquidationPrice : null,
    cushion,
    borrowApr: venue.borrowApr,
    utilization: venue.utilization,
    liquidityUsd: availableToBorrowUsd(venue),
    recentLiquidityUsd: context?.recentLiquidityUsd,
    historyAdequate: coverage === 'adequate',
    aprChange6hBps: context?.aprChange6hBps ?? null,
    aprChange24hBps: context?.aprChange24hBps ?? day,
    recentUtilization: context?.recentUtilization,
    recentBorrowApr: context?.recentBorrowApr,
    benchmarkApr,
    freshnessAgeMs: venue.freshness?.fetchedAt ? Date.now() - venue.freshness.fetchedAt : null,
    positionReadFailed: failed,
    oracleStale: venue.priceUsd <= 0,
  };
}

function recommendedCopy(address: string, event: AlertEvent): AlertCopy {
  const kind = deliveryKind(event);
  const subject = event.category === 'data-health'
    ? 'Data warning: SimpleBTC could not verify fresh market data'
    : event.message.slice(0, 120);
  const copy = renderAlertEmail(kind, address, [event.message], [
    `${event.protocol} · chain ${event.chainId}`,
    `Market ${event.marketId}`,
    event.currentHf === null ? 'Health factor unavailable' : `Health factor ${event.currentHf}`,
    event.currentOraclePrice === null ? 'Oracle price unavailable' : `Oracle price ${event.currentOraclePrice}`,
  ]);
  return { ...copy, subject };
}

async function evaluate(subscriber: AlertSubscriber, venues: Venue[], record: boolean, contexts: Map<string, VenueRateContext>) {
  const messages: AlertCopy[] = [];
  const digestRows: string[] = [];
  const statementRows: string[] = [];
  let weeklyInterestUsd = 0;
  let monthlyInterestUsd = 0;
  let totalDebtUsd = 0;
  let hasPosition = false;
  const borrowVenues = venues.filter((venue) => venue.action === 'borrow');

  for (const venue of borrowVenues) {
    try {
      const snapshot = await readPosition(venue, subscriber.address as Address);
      const closedPlan = subscriber.positionPlans?.find((item) => item.approved && item.marketKey === alertMarketKey({
        wallet: subscriber.address,
        chainId: venue.chainId,
        protocol: venue.protocol,
        marketId: protocolMarketId(venue),
      }));
      if (snapshot && snapshot.collateral === 0n && snapshot.debt === 0n && closedPlan) {
        const paused = evaluateEnabledPlan({
          rules: closedPlan.rules,
          position: recommendationInput(venue, snapshot, subscriber.address, false, contexts.get(venue.id), closedPlan.benchmarkApr),
          states: closedPlan.states,
          at: Date.now(),
          emailResolutions: closedPlan.emailResolutions,
        });
        closedPlan.states = paused.states;
      }
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
      const plan = subscriber.positionPlans?.find((item) => item.approved && item.marketKey === alertMarketKey({
        wallet: subscriber.address,
        chainId: venue.chainId,
        protocol: venue.protocol,
        marketId: protocolMarketId(venue),
      }));
      const coversSafety = Boolean(plan?.rules.some((rule) => rule.enabled && rule.category === 'position-safety'));
      const coversRate = Boolean(plan?.rules.some((rule) => rule.enabled && rule.category === 'borrowing-cost'));
      if (plan) {
        const evaluated = evaluateEnabledPlan({
          rules: plan.rules,
          position: recommendationInput(venue, snapshot, subscriber.address, false, contexts.get(venue.id), plan.benchmarkApr),
          states: plan.states,
          at: Date.now(),
          emailResolutions: plan.emailResolutions,
        });
        plan.states = evaluated.states;
        for (const event of evaluated.notifications) {
          if (event.alertType === 'monthly-statement') continue;
          messages.push(recommendedCopy(subscriber.address, event));
        }
        if (plan.rules.some((rule) => rule.enabled && rule.id === 'monthly-statement')) {
          statementRows.push(...monthlyStatementLines(recommendationInput(venue, snapshot, subscriber.address, false, contexts.get(venue.id), plan.benchmarkApr)));
        }
      }

      if (!coversSafety && snapshot.healthFactor !== null && snapshot.healthFactor < subscriber.rules.healthUrgent && await shouldSend(subscriber.address, 'hf-urgent', venue.id, 6, record)) {
        messages.push(healthAlert('urgent', subscriber.address, facts));
      } else if (!coversSafety && snapshot.healthFactor !== null && snapshot.healthFactor < subscriber.rules.healthWarn && await shouldSend(subscriber.address, 'hf-warn', venue.id, 12, record)) {
        messages.push(healthAlert('health', subscriber.address, facts));
      }
      if (!coversSafety && drop <= subscriber.rules.liqDistancePct && await shouldSend(subscriber.address, 'liq', venue.id, 12, record)) {
        messages.push(liquidationAlert(subscriber.address, facts));
      }
      if (!coversRate && venue.borrowApr >= subscriber.rules.aprAbove && await shouldSend(subscriber.address, 'apr', venue.id, 24, record)) {
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
      const plan = subscriber.positionPlans?.find((item) => item.approved && item.marketKey === alertMarketKey({
        wallet: subscriber.address,
        chainId: venue.chainId,
        protocol: venue.protocol,
        marketId: protocolMarketId(venue),
      }));
      if (plan) {
        const evaluated = evaluateEnabledPlan({
          rules: plan.rules,
          position: recommendationInput(venue, { collateral: 0n, debt: 0n, healthFactor: null, ltv: 0, liquidationPrice: 0 }, subscriber.address, true, contexts.get(venue.id), plan.benchmarkApr),
          states: plan.states,
          at: Date.now(),
        });
        plan.states = evaluated.states;
        for (const event of evaluated.notifications) messages.push(recommendedCopy(subscriber.address, event));
      }
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
      ...statementRows,
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

  const contexts = new Map<string, VenueRateContext>();
  if (subscribers.some((subscriber) => subscriber.positionPlans?.some((plan) => plan.approved))) {
    for (const venue of rates.venues) {
      if (venue.action !== 'borrow') continue;
      contexts.set(venue.id, await loadVenueRateContext(venue));
    }
  }

  for (const subscriber of subscribers.slice(0, 25)) {
    const messages = await evaluate(subscriber, rates.venues, !dry, contexts);
    if (messages.length === 0) continue;
    for (const message of messages) {
      preview.push({ email: subscriber.email, kind: message.kind, subject: message.subject });
      if (!dry) await sendMail(subscriber.email, message.subject, message.text, message.html);
    }
    if (!dry) await saveSubscriber(subscriber);
  }

  return Response.json({ ok: true, dry, sent: preview.length, preview: dry ? preview : undefined });
}
