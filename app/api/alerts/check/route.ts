import { formatUnits, type Address } from 'viem';
import { auditStoreKey, episodeKey, sanitizeDocument } from '@/lib/audit';
import { alertMarketKey, deliveryKind, evaluateEnabledPlan, monthlyStatementLines, type AlertEvent, type AlertRecommendationInput } from '@/lib/finance/recommendedAlerts';
import { digestLines, isOpenDebt, previousUtcMonth, projectedInterestCost, summarizeEpisodePeriod, type DigestPosition } from '@/lib/finance/periodInterest';
import { historyCoverage } from '@/lib/finance/history';
import { loanRateHistory } from '@/lib/finance/openingApr';
import { availableToBorrowUsd, chainLabel, protocolLabel, protocolMarketId, type Venue } from '@/lib/protocol';
import { type RatePoint } from '@/lib/rateHistory';
import { appendTrendSample, buildEarlyWarning, earlyWarningEmailLines, type TrendSample } from '@/lib/finance/earlyWarning';
import { resolveRiskThresholds } from '@/lib/finance/riskMonitor';
import { serverTrendKey } from '@/lib/finance/trendStore';
import { storeJson, storeSetJson } from '@/lib/store';
import { adapterFor } from '@/lib/adapters';
import { aprAlert, healthAlert, liquidationAlert, loanFacts, monthlyAlert, refinanceAlert, renderAlertEmail, thresholdAlert, weeklyAlert, type AlertCopy } from '@/lib/alertEmail';
import { allSubscribers, saveSubscriber, shouldSend, type AlertSubscriber } from '@/lib/alerts';
import { sendMail } from '@/lib/mail';
import { formatApr, formatUsdExact } from '@/lib/amount';
import {
  buildRefinanceDeepLink,
  evaluateRefinanceAlertDeduplication,
  findActionableRefinanceOpportunity,
  recheckRefinanceCandidate,
  recordRefinanceDisqualified,
} from '@/lib/finance/refinanceAlertQualification';
import { snapshotRates } from '@/lib/rateHistory';
import { getRates } from '@/lib/rates';
import { publicClient } from '@/lib/rpc';
import { fetchUsdPrices } from '@/lib/prices';

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

function recommendedCopy(address: string, event: AlertEvent, extra: string[] = []): AlertCopy {
  const kind = deliveryKind(event);
  const subject = event.category === 'data-health'
    ? 'Data warning: SimpleBTC could not verify fresh market data'
    : event.message.slice(0, 120);
  const copy = renderAlertEmail(kind, address, [event.message], [
    `${event.protocol} · chain ${event.chainId}`,
    `Market ${event.marketId}`,
    event.currentHf === null ? 'Health factor unavailable' : `Health factor ${event.currentHf}`,
    event.currentOraclePrice === null ? 'Oracle price unavailable' : `Oracle price ${event.currentOraclePrice}`,
    ...extra,
  ]);
  return { ...copy, subject };
}

function digestPosition(
  name: string,
  venue: Venue,
  snapshot: { debt: bigint; healthFactor: number | null; ltv: number; liquidationPrice: number },
  debtUsd: number,
  summary: ReturnType<typeof summarizeEpisodePeriod>,
  openingApr: number | null,
): DigestPosition {
  return {
    name,
    debtUsd,
    principalRemainingUsd: summary.principalRemainingUsd,
    accruedUnpaidUsd: summary.accruedUnpaidUsd,
    apr: typeof venue.borrowApr === 'number' && Number.isFinite(venue.borrowApr) ? venue.borrowApr : null,
    openingApr,
    ltv: snapshot.ltv,
    healthFactor: snapshot.healthFactor,
    liquidationPriceUsd: snapshot.liquidationPrice > 0 ? snapshot.liquidationPrice : null,
    actualUsd: summary.actual.usd,
    actualStatus: summary.actual.status,
    interestPaidUsd: summary.interestPaidUsd,
    principalRepaidUsd: summary.principalRepaidUsd,
    additionalBorrowingUsd: summary.additionalBorrowingUsd,
    networkFeesUsd: summary.networkFeesUsd,
  };
}

async function observedTrendLines(
  wallet: string,
  venue: Venue,
  snapshot: { collateral: bigint; debt: bigint; healthFactor: number | null; ltv: number; liquidationPrice: number; ready: boolean },
  debtUsd: number,
  plan: { preferredHealthFactor?: number; rules: Array<{ id: string; threshold: number | null }> } | undefined,
  now: number,
) {
  try {
    const key = serverTrendKey(wallet, venue.id);
    const prior = (await storeJson<TrendSample[]>(key)) ?? [];
    const sample: TrendSample = {
      t: now,
      hf: snapshot.healthFactor ?? undefined,
      ltv: snapshot.ltv,
      oracle: venue.priceUsd > 0 ? venue.priceUsd : undefined,
      apr: Number.isFinite(venue.borrowApr) ? venue.borrowApr : undefined,
      utilization: venue.utilization,
      liquidity: availableToBorrowUsd(venue),
    };
    const stored = appendTrendSample(Array.isArray(prior) ? prior : [], sample, now);
    if (stored !== prior) await storeSetJson(key, JSON.parse(JSON.stringify(stored)), 8 * 24 * 3600);
    const threshold = (id: string) => plan?.rules.find((rule) => rule.id === id)?.threshold;
    const warning = buildEarlyWarning({
      now,
      healthFactor: snapshot.healthFactor,
      ltv: snapshot.ltv,
      cushion: venue.priceUsd > 0 && snapshot.liquidationPrice > 0 ? (venue.priceUsd - snapshot.liquidationPrice) / venue.priceUsd : null,
      debt: debtUsd,
      collateralAmount: Number(formatUnits(snapshot.collateral, venue.assetDecimals)),
      liquidationThreshold: venue.collateralRisk?.liquidationLtv ?? venue.maxLtv,
      oraclePrice: venue.priceUsd,
      borrowApr: venue.borrowApr,
      utilization: venue.utilization ?? null,
      availableLiquidity: availableToBorrowUsd(venue),
      samples: stored,
      safetyFresh: snapshot.ready && venue.priceUsd > 0,
      positionFreshness: snapshot.ready ? 'fresh' : 'unavailable',
      oracleFreshness: venue.priceUsd > 0 ? 'fresh' : 'unavailable',
      rateFreshness: 'fresh',
      marketFreshness: 'fresh',
      thresholds: resolveRiskThresholds({
        preferredHealthFactor: plan?.preferredHealthFactor,
        watch: threshold('hf-watch'),
        prepare: threshold('hf-prepare'),
        act: threshold('hf-act'),
        urgent: threshold('hf-urgent'),
        utilizationWatch: threshold('utilization-watch'),
        utilizationHigh: threshold('utilization-high'),
      }),
    });
    return earlyWarningEmailLines(warning);
  } catch {
    return [];
  }
}

async function evaluate(subscriber: AlertSubscriber, venues: Venue[], record: boolean, contexts: Map<string, VenueRateContext>, ethPriceUsd?: number | null) {
  const messages: AlertCopy[] = [];
  const statementRows: string[] = [];
  const weeklyPositions: DigestPosition[] = [];
  const monthlyPositions: DigestPosition[] = [];
  const suppliedNames: string[] = [];
  let projectedNext7Usd = 0;
  let measuredWeekUsd = 0;
  let totalDebtUsd = 0;
  const now = Date.now();
  const week = { periodStart: now - 7 * 86_400_000, periodEnd: now };
  const month = previousUtcMonth(now);
  const ledgerEvents = sanitizeDocument(await storeJson(auditStoreKey(subscriber.address))).events;
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
      const facts = loanFacts(venue, snapshot);
      const debtUsd = Number(formatUnits(snapshot.debt, venue.loanDecimals));
      const openDebt = isOpenDebt(debtUsd);
      const positionName = `${facts.protocol} · ${facts.asset} · ${facts.chain}`;
      let monthSummary: ReturnType<typeof summarizeEpisodePeriod> | null = null;
      let openingApr: number | null = null;
      if (openDebt) {
        const key = episodeKey(subscriber.address, venue);
        const weekSummary = summarizeEpisodePeriod({
          events: ledgerEvents,
          episodeKey: key,
          periodStart: week.periodStart,
          periodEnd: week.periodEnd,
          endingDebt: snapshot.debt,
          decimals: venue.loanDecimals,
        });
        monthSummary = summarizeEpisodePeriod({
          events: ledgerEvents,
          episodeKey: key,
          periodStart: month.periodStart,
          periodEnd: month.periodEnd,
          endingDebt: snapshot.debt,
          decimals: venue.loanDecimals,
        });
        const projected = projectedInterestCost(debtUsd, venue.borrowApr);
        projectedNext7Usd += projected.next7Days ?? 0;
        if (weekSummary.actual.usd !== null) measuredWeekUsd += weekSummary.actual.usd;
        totalDebtUsd += debtUsd;
        openingApr = loanRateHistory(ledgerEvents, key).opening?.normalizedBorrowApr ?? null;
        weeklyPositions.push(digestPosition(positionName, venue, snapshot, debtUsd, weekSummary, openingApr));
        monthlyPositions.push(digestPosition(positionName, venue, snapshot, debtUsd, monthSummary, openingApr));
      } else if (snapshot.collateral > 0n) {
        suppliedNames.push(positionName);
      }
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
        const trendLines = await observedTrendLines(subscriber.address, venue, snapshot, debtUsd, plan, now);
        for (const event of evaluated.notifications) {
          if (event.alertType === 'monthly-statement') continue;
          const contextual = event.category === 'position-safety' || event.alertType === 'rate-velocity' || event.alertType.startsWith('utilization-') || event.alertType === 'liquidity';
          messages.push(recommendedCopy(subscriber.address, event, contextual ? trendLines : []));
        }
        if (openDebt && monthSummary && plan.rules.some((rule) => rule.enabled && rule.id === 'monthly-statement')) {
          statementRows.push(...monthlyStatementLines(
            recommendationInput(venue, snapshot, subscriber.address, false, contexts.get(venue.id), plan.benchmarkApr),
            {
              startingDebtUsd: null,
              principalRepaidUsd: monthSummary.principalRepaidUsd,
              interestAccruedUsd: monthSummary.actual.usd,
              interestPaidUsd: monthSummary.interestPaidUsd,
              networkFeesUsd: monthSummary.networkFeesUsd,
            },
          ));
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
      if (debtUsd > 0 && snapshot.collateral > 0n) {
        let gasPriceWei: bigint | null = null;
        try {
          gasPriceWei = await publicClient(venue.chainId).getGasPrice();
        } catch {
          gasPriceWei = null;
        }

        const actionable = findActionableRefinanceOpportunity({
          sourceVenue: venue,
          snapshot,
          allVenues: venues,
          criteria: {
            minYearlySavingsUsd: subscriber.rules.refinanceUsd,
            minHealthFactor: subscriber.rules.healthUrgent ?? 1.2,
          },
          gasPriceWei,
          ethPriceUsd,
          openingApr,
          benchmarkApr: plan?.benchmarkApr,
          now,
        });

        if (actionable && actionable.isQualified) {
          // Pre-send revalidation: requalify from fresh position/debt, fresh gas price, and current venues immediately before sending
          let freshDebt = debtUsd;
          let freshCollateral = Number(formatUnits(snapshot.collateral, venue.assetDecimals));
          try {
            const reloaded = await readPosition(venue, subscriber.address as Address);
            if (reloaded) {
              freshDebt = Number(formatUnits(reloaded.debt, venue.loanDecimals));
              freshCollateral = Number(formatUnits(reloaded.collateral, venue.assetDecimals));
            }
          } catch {
            // retain existing snapshot if reread fails
          }

          let freshGasPrice = gasPriceWei;
          try {
            freshGasPrice = await publicClient(venue.chainId).getGasPrice();
          } catch {
            // keep gasPriceWei
          }

          const rechecked = recheckRefinanceCandidate(actionable, venues, {
            minYearlySavingsUsd: subscriber.rules.refinanceUsd,
            minHealthFactor: subscriber.rules.healthUrgent ?? 1.2,
          }, Date.now(), {
            currentDebt: freshDebt,
            currentCollateral: freshCollateral,
            gasPriceWei: freshGasPrice,
            ethPriceUsd,
          });

          if (rechecked.isQualified) {
            const dedupe = await evaluateRefinanceAlertDeduplication(subscriber.address, rechecked, record, now);
            if (dedupe.shouldSend) {
              const deepLink = buildRefinanceDeepLink(venue.id, rechecked.snapshot.destinationMarketId);
              messages.push(refinanceAlert(subscriber.address, rechecked, { deepLinkUrl: deepLink, now }));
            }
          } else if (record) {
            await recordRefinanceDisqualified(subscriber.address, venue.id, actionable.snapshot.destinationMarketId);
          }
        } else if (record) {
          await recordRefinanceDisqualified(subscriber.address, venue.id);
        }
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
  const openDebtCount = weeklyPositions.length;
  const weekWorthSending = projectedNext7Usd >= 1 || measuredWeekUsd >= 1;
  if (subscriber.rules.weekly && subscriber.lastWeekly !== today && local.weekday === 1 && morningWindow(local.hour) && openDebtCount > 0 && weekWorthSending) {
    messages.push(weeklyAlert(subscriber.address, [
      `Total debt: ${formatUsdExact(totalDebtUsd)}`,
      ...digestLines('week', weeklyPositions, suppliedNames),
    ]));
    subscriber.lastWeekly = today;
  }
  if (subscriber.rules.monthly && subscriber.lastMonthly !== today && local.day === 1 && morningWindow(local.hour) && openDebtCount > 0) {
    messages.push(monthlyAlert(subscriber.address, [
      `Total debt: ${formatUsdExact(totalDebtUsd)}`,
      ...digestLines('month', monthlyPositions, suppliedNames),
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

  const usdPrices = await fetchUsdPrices().catch(() => ({ ethUsd: 0, btcUsd: 0 }));
  const ethPriceUsd = usdPrices.ethUsd > 0 ? usdPrices.ethUsd : null;

  for (const subscriber of subscribers.slice(0, 25)) {
    const messages = await evaluate(subscriber, rates.venues, !dry, contexts, ethPriceUsd);
    if (messages.length === 0) continue;
    for (const message of messages) {
      preview.push({ email: subscriber.email, kind: message.kind, subject: message.subject });
      if (!dry) await sendMail(subscriber.email, message.subject, message.text, message.html);
    }
    if (!dry) await saveSubscriber(subscriber);
  }

  return Response.json({ ok: true, dry, sent: preview.length, preview: dry ? preview : undefined });
}
