import { formatUnits } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import { type AlertKind, ALERT_SUBJECTS } from '@/lib/alertKinds';
import { alertToken, appUrl, unsubscribeUrl } from '@/lib/alerts';
import { formatApr, formatToken, formatUsd, formatUsdExact } from '@/lib/amount';
import { formatHealthFactor, formatLtv, formatPercent } from '@/lib/finance/format';
import { digestLines, liveLikeOpenLoan, summarizeEpisodePeriod, type DigestPosition } from '@/lib/finance/periodInterest';
import {
  buildRefinanceDeepLink,
  qualifyRefinancePlan,
  type RefinanceQualification,
} from '@/lib/finance/refinanceAlertQualification';
import {
  buildMigrationPlan,
  type RefinanceCandidate,
  type RefinanceMarketBaseline,
} from '@/lib/finance/refinance';
import { projectedInterest } from '@/lib/opportunities';
import { chainLabel, protocolLabel, type Venue } from '@/lib/protocol';

export type { AlertKind };
export { ALERT_SUBJECTS, TEST_ALERT_OPTIONS } from '@/lib/alertKinds';

export type AlertCopy = {
  kind: AlertKind;
  subject: string;
  text: string;
  html: string;
};

export type LoanFacts = {
  protocol: string;
  chain: string;
  asset: string;
  collateral: string;
  collateralUsd: string;
  debt: string;
  debtUsd: string;
  healthFactor: string;
  ltv: string;
  maxLtv: string;
  btcPrice: string;
  liquidationPrice: string;
  dropPct: string;
  borrowApr: string;
  interestMonth: string;
  interestYear: string;
};

export function loanFacts(venue: Venue, snapshot: PositionSnapshot): LoanFacts {
  const collateralUsd = Number(formatUnits(snapshot.collateral, venue.assetDecimals)) * venue.priceUsd;
  const debtUsd = Number(formatUnits(snapshot.debt, venue.loanDecimals));
  const drop = snapshot.liquidationPrice > 0 && venue.priceUsd > 0
    ? Math.max(0, (1 - snapshot.liquidationPrice / venue.priceUsd) * 100)
    : 0;
  const cost = projectedInterest(debtUsd, venue.borrowApr);
  return {
    protocol: protocolLabel(venue.protocol),
    chain: chainLabel(venue.chainId),
    asset: venue.assetSymbol,
    collateral: `${formatToken(snapshot.collateral, venue.assetDecimals)} ${venue.assetSymbol}`,
    collateralUsd: formatUsdExact(collateralUsd),
    debt: `${formatToken(snapshot.debt, venue.loanDecimals)} USDC`,
    debtUsd: formatUsdExact(debtUsd),
    healthFactor: snapshot.healthFactor === null ? 'No debt' : formatHealthFactor(snapshot.healthFactor),
    ltv: formatLtv(snapshot.ltv),
    maxLtv: formatPercent(venue.maxLtv, 0, { exact: true }),
    btcPrice: formatUsd(venue.priceUsd),
    liquidationPrice: snapshot.liquidationPrice > 0 ? formatUsd(snapshot.liquidationPrice) : '—',
    dropPct: drop > 0 ? `${drop.toFixed(1)}%` : '—',
    borrowApr: formatApr(venue.borrowApr),
    interestMonth: formatUsdExact(cost.month),
    interestYear: formatUsdExact(cost.year),
  };
}

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtml(intro: string[], facts: string[], links: { href: string; label: string }[]) {
  const lead = intro.map((paragraph) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(paragraph)}</p>`).join('');
  const items = facts.length > 0
    ? `<ul style="margin:0 0 16px;padding-left:1.2rem;line-height:1.6">${facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>`
    : '';
  const linkRow = links
    .map((link) => `<a href="${link.href}" style="color:#2563eb;text-decoration:underline">${escapeHtml(link.label)}</a>`)
    .join(' &nbsp;·&nbsp; ');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">${lead}${items}<p style="margin:16px 0 0;line-height:1.5">${linkRow}</p></div>`;
}

export function renderAlertEmail(kind: AlertKind, address: string, intro: string[], facts: string[] = [], extraLink?: { href: string; label: string }): AlertCopy {
  const loans = `${appUrl()}/loans`;
  const links = [
    extraLink,
    { href: loans, label: 'Open Loans' },
    kind === 'confirm' ? undefined : { href: unsubscribeUrl(address), label: 'Unsubscribe' },
  ].filter((link): link is { href: string; label: string } => Boolean(link));
  const textFacts = facts.length > 0 ? `\n${facts.map((fact) => `• ${fact}`).join('\n')}` : '';
  const textLinks = links.map((link) => `${link.label}: ${link.href}`).join('\n');
  return {
    kind,
    subject: ALERT_SUBJECTS[kind],
    text: `${intro.join('\n')}${textFacts}\n\n${textLinks}`,
    html: wrapHtml(intro, facts, links),
  };
}

export function healthAlert(kind: 'urgent' | 'health', address: string, facts: LoanFacts) {
  const intro = kind === 'urgent'
    ? [`Urgent: health factor on ${facts.protocol} ${facts.asset} (${facts.chain}) is ${facts.healthFactor}. Add collateral or repay soon.`]
    : [`Health factor on ${facts.protocol} ${facts.asset} (${facts.chain}) dropped to ${facts.healthFactor}.`];
  return renderAlertEmail(kind, address, intro, positionLines(facts));
}

export function liquidationAlert(address: string, facts: LoanFacts) {
  return renderAlertEmail('liquidation', address, [
    `BTC is ${facts.dropPct} above your ${facts.asset} liquidation price.`,
    `BTC is ${facts.btcPrice} now. This loan liquidates if BTC falls to ${facts.liquidationPrice}.`,
  ], positionLines(facts));
}

export function aprAlert(address: string, facts: LoanFacts) {
  return renderAlertEmail('apr', address, [
    `${facts.protocol} ${facts.asset} borrow APR is ${facts.borrowApr} on ${facts.chain}.`,
    `At this rate, ${facts.debtUsd} of debt costs about ${facts.interestMonth} this month and ${facts.interestYear} this year.`,
  ], positionLines(facts));
}

function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

function wrapRefinanceEmailHtml(input: {
  sourceProtocol: string;
  sourceChain: string;
  sourceAsset: string;
  debtAsset: string;
  currentApr: string;
  destProtocol: string;
  destChain: string;
  destAsset: string;
  destDebtAsset: string;
  candidateApr: string;
  aprImprovementBps: number;
  monthlySavings: string;
  annualSavings: string;
  migrationCost: string;
  breakEven: string;
  sourceHf: string;
  projectedHf: string;
  sourceLiqBtc: string;
  projectedLiqBtc: string;
  lessMarginNotice?: string;
  timeAgo: string;
  deepLink: string;
  loansUrl: string;
  unsubUrl: string;
  isSimulated?: boolean;
}) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:600px">
  ${input.isSimulated ? `<div style="margin:0 0 16px;padding:10px 14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;color:#92400e;font-weight:700;font-size:13px;text-align:center">SIMULATED DATA — NOT LIVE MARKET DATA</div>` : ''}
  <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#111;letter-spacing:-0.01em">REFINANCE OPPORTUNITY READY TO REVIEW</p>

  <div style="margin:0 0 14px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase">Current</p>
    <p style="margin:0;font-weight:600">${escapeHtml(input.sourceProtocol)} · ${escapeHtml(input.sourceChain)}</p>
    <p style="margin:2px 0 0;font-size:13px;color:#475569">${escapeHtml(input.sourceAsset)} / ${escapeHtml(input.debtAsset)}</p>
    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0f172a">APR ${escapeHtml(input.currentApr)}</p>
  </div>

  <div style="margin:0 0 14px;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px">
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#166534;text-transform:uppercase">Candidate</p>
    <p style="margin:0;font-weight:600">${escapeHtml(input.destProtocol)} · ${escapeHtml(input.destChain)}</p>
    <p style="margin:2px 0 0;font-size:13px;color:#15803d">${escapeHtml(input.destAsset)} / ${escapeHtml(input.destDebtAsset)}</p>
    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#166534">APR ${escapeHtml(input.candidateApr)}</p>
  </div>

  <div style="margin:0 0 14px">
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase">Difference</p>
    <p style="margin:0;font-size:15px;font-weight:700;color:#16a34a">&darr; ${input.aprImprovementBps} bps</p>
  </div>

  <div style="margin:0 0 14px">
    <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase">Estimated economics</p>
    <ul style="margin:0;padding-left:1.2rem;line-height:1.6">
      <li>~${escapeHtml(input.monthlySavings)}/mo lower borrowing cost</li>
      <li>~${escapeHtml(input.annualSavings)}/yr lower borrowing cost</li>
      <li>Migration cost: ${escapeHtml(input.migrationCost)}</li>
      <li>Estimated break-even: ${escapeHtml(input.breakEven)}</li>
    </ul>
  </div>

  <div style="margin:0 0 14px">
    <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase">Execution fit</p>
    <ul style="margin:0;padding-left:1.2rem;line-height:1.6">
      <li>Same chain / same wrapper</li>
      <li>Liquidity: sufficient</li>
    </ul>
  </div>

  <div style="margin:0 0 14px">
    <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase">Safety</p>
    <ul style="margin:0;padding-left:1.2rem;line-height:1.6">
      <li>Current HF: ${escapeHtml(input.sourceHf)}</li>
      <li>Projected HF: ${escapeHtml(input.projectedHf)}</li>
      <li>Current liquidation BTC: ${escapeHtml(input.sourceLiqBtc)}</li>
      <li>Projected liquidation BTC: ${escapeHtml(input.projectedLiqBtc)}</li>
      ${input.lessMarginNotice ? `<li style="color:#d97706;font-weight:500">${escapeHtml(input.lessMarginNotice)}</li>` : ''}
    </ul>
  </div>

  <div style="margin:0 0 18px">
    ${input.isSimulated
      ? `<p style="margin:0;font-size:12px;color:#d97706;font-weight:600">SIMULATED DATA — NOT LIVE MARKET DATA</p>`
      : `<p style="margin:0;font-size:12px;color:#64748b">Data verified: ${escapeHtml(input.timeAgo)}</p>`}
  </div>

  <div style="margin:18px 0">
    <a href="${escapeHtml(input.deepLink)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">
      Review refinance
    </a>
  </div>

  <p style="margin:20px 0 0;font-size:13px;color:#64748b;line-height:1.5">
    <a href="${escapeHtml(input.loansUrl)}" style="color:#2563eb;text-decoration:underline">Open Loans</a>
    &nbsp;·&nbsp;
    <a href="${escapeHtml(input.unsubUrl)}" style="color:#2563eb;text-decoration:underline">Unsubscribe</a>
  </p>
</div>`;
}

export function refinanceAlert(
  address: string,
  qualificationOrFacts: RefinanceQualification | LoanFacts,
  optionsOrHint?:
    | { deepLinkUrl?: string; now?: number; isSimulated?: boolean }
    | { toProtocol: string; toChain: string; toApr: string; yearly: string; monthly: string },
): AlertCopy {
  if ('snapshot' in qualificationOrFacts && 'plan' in qualificationOrFacts) {
    const qualification = qualificationOrFacts as RefinanceQualification;
    const options = optionsOrHint as { deepLinkUrl?: string; now?: number; isSimulated?: boolean } | undefined;
    const snapshot = qualification.snapshot;
    const plan = qualification.plan;
    const now = options?.now ?? Date.now();
    const isSimulated = Boolean(options?.isSimulated || qualification.isSimulated || snapshot?.isSimulated);

    const sourceProtocol = protocolLabel(plan.sourceMarket.protocol);
    const sourceChain = chainLabel(plan.sourceMarket.chainId);
    const destProtocol = protocolLabel(plan.destinationMarket.protocol);
    const destChain = chainLabel(plan.destinationMarket.chainId);

    const monthlySavings = Math.round(snapshot.estimatedMonthlyDifference);
    const subject = monthlySavings > 0
      ? `Refinance opportunity ready to review — ~$${monthlySavings}/mo lower borrowing cost`
      : 'Refinance opportunity ready to review';

    const deepLink = options?.deepLinkUrl ?? buildRefinanceDeepLink(plan.sourceMarket.id, plan.destinationMarket.id);
    const breakEvenDisplay = snapshot.breakEvenDays !== null
      ? (snapshot.breakEvenDays < 1 ? '<1 day' : `~${Math.round(snapshot.breakEvenDays)} days`)
      : 'Unavailable';
    const timeAgoDisplay = formatTimeAgo(snapshot.timestamp, now);
    const lessMarginNotice = snapshot.safetyComparison.hasLessMargin
      ? `Destination has less liquidation margin (${snapshot.safetyComparison.marginCopy})`
      : '';

    const textLines = [
      ...(isSimulated ? ['SIMULATED DATA — NOT LIVE MARKET DATA', ''] : []),
      'REFINANCE OPPORTUNITY READY TO REVIEW',
      '',
      'Current:',
      `${sourceProtocol} · ${sourceChain}`,
      `${plan.sourceMarket.collateralAsset} / ${plan.sourceMarket.debtAsset}`,
      `APR ${formatApr(snapshot.currentApr)}`,
      '',
      'Candidate:',
      `${destProtocol} · ${destChain}`,
      `${plan.destinationMarket.collateral} / ${plan.destinationMarket.debtAsset}`,
      `APR ${formatApr(snapshot.candidateApr)}`,
      '',
      'Difference:',
      `↓ ${snapshot.aprImprovementBps} bps`,
      '',
      'Estimated economics:',
      `~$${snapshot.estimatedMonthlyDifference.toFixed(2)}/mo lower borrowing cost`,
      `~$${snapshot.estimatedAnnualDifference.toFixed(2)}/yr lower borrowing cost`,
      `Migration cost: ${snapshot.migrationCostUsd !== null ? formatUsdExact(snapshot.migrationCostUsd) : 'Unknown'}`,
      `Estimated break-even: ${breakEvenDisplay}`,
      '',
      'Execution fit:',
      'Same chain / same wrapper',
      'Liquidity: sufficient',
      '',
      'Safety:',
      `Current HF: ${snapshot.safetyComparison.sourceHealthFactor !== null ? formatHealthFactor(snapshot.safetyComparison.sourceHealthFactor) : '—'}`,
      `Projected HF: ${snapshot.safetyComparison.projectedHealthFactor !== null ? formatHealthFactor(snapshot.safetyComparison.projectedHealthFactor) : '—'}`,
      `Current liquidation BTC: ${snapshot.safetyComparison.sourceLiquidationBtc ? formatUsd(snapshot.safetyComparison.sourceLiquidationBtc) : '—'}`,
      `Projected liquidation BTC: ${snapshot.safetyComparison.projectedLiquidationBtc ? formatUsd(snapshot.safetyComparison.projectedLiquidationBtc) : '—'}`,
      ...(lessMarginNotice ? [lessMarginNotice] : []),
      '',
      ...(isSimulated
        ? ['Data status: SIMULATED DATA — NOT LIVE MARKET DATA']
        : ['Data verified:', timeAgoDisplay]),
      '',
      `Review refinance: ${deepLink}`,
      '',
      `Open Loans: ${appUrl()}/loans`,
      `Unsubscribe: ${unsubscribeUrl(address)}`,
    ];

    const html = wrapRefinanceEmailHtml({
      sourceProtocol,
      sourceChain,
      sourceAsset: plan.sourceMarket.collateralAsset,
      debtAsset: plan.sourceMarket.debtAsset,
      currentApr: formatApr(snapshot.currentApr),
      destProtocol,
      destChain,
      destAsset: plan.destinationMarket.collateral,
      destDebtAsset: plan.destinationMarket.debtAsset,
      candidateApr: formatApr(snapshot.candidateApr),
      aprImprovementBps: snapshot.aprImprovementBps,
      monthlySavings: formatUsdExact(snapshot.estimatedMonthlyDifference),
      annualSavings: formatUsdExact(snapshot.estimatedAnnualDifference),
      migrationCost: snapshot.migrationCostUsd !== null ? formatUsdExact(snapshot.migrationCostUsd) : 'Unknown',
      breakEven: breakEvenDisplay,
      sourceHf: snapshot.safetyComparison.sourceHealthFactor !== null ? formatHealthFactor(snapshot.safetyComparison.sourceHealthFactor) : '—',
      projectedHf: snapshot.safetyComparison.projectedHealthFactor !== null ? formatHealthFactor(snapshot.safetyComparison.projectedHealthFactor) : '—',
      sourceLiqBtc: snapshot.safetyComparison.sourceLiquidationBtc ? formatUsd(snapshot.safetyComparison.sourceLiquidationBtc) : '—',
      projectedLiqBtc: snapshot.safetyComparison.projectedLiquidationBtc ? formatUsd(snapshot.safetyComparison.projectedLiquidationBtc) : '—',
      lessMarginNotice,
      timeAgo: timeAgoDisplay,
      deepLink,
      loansUrl: `${appUrl()}/loans`,
      unsubUrl: unsubscribeUrl(address),
      isSimulated,
    });

    return {
      kind: 'refinance',
      subject,
      text: textLines.join('\n'),
      html,
    };
  }

  // Fallback for legacy / test facts call
  const facts = qualificationOrFacts as LoanFacts;
  const hint = (optionsOrHint ?? {}) as { toProtocol: string; toChain: string; toApr: string; yearly: string; monthly: string };
  return renderAlertEmail('refinance', address, [
    `You can lower the rate on ${facts.debtUsd} of ${facts.asset} debt.`,
    `Refinance opportunity ready to review: from ${facts.protocol} ${facts.borrowApr} on ${facts.chain} to ${hint.toProtocol} ${hint.toApr} on ${hint.toChain}.`,
    `Estimated savings: ${hint.monthly}/month, ${hint.yearly}/year.`,
  ], positionLines(facts));
}

export function thresholdAlert(address: string, facts: LoanFacts, grown: string, since: string) {
  return renderAlertEmail('threshold', address, [
    `Accrued interest on ${facts.protocol} ${facts.asset} grew by about ${grown} since ${since}.`,
    `Debt is now ${facts.debt} (${facts.debtUsd}).`,
  ], positionLines(facts));
}

export function weeklyAlert(address: string, rows: string[]) {
  return renderAlertEmail('weekly', address, [
    'Weekly loan digest. Interest accrued this week comes from the loan ledger. A figure at the current balance and APR is an estimate of future interest, not interest that already accrued.',
  ], rows);
}

export function monthlyAlert(address: string, rows: string[]) {
  return renderAlertEmail('monthly', address, [
    'Monthly loan statement. Interest accrued this month comes from the loan ledger. A figure at the current balance and APR is an estimate of future interest, not interest that already accrued or was paid.',
  ], rows);
}

export function confirmAlertEmail(address: string, email: string): AlertCopy {
  const href = `${appUrl()}/api/alerts/confirm?address=${address}&email=${encodeURIComponent(email)}&token=${alertToken(`${address.toLowerCase()}:${email}:confirm`)}`;
  return renderAlertEmail('confirm', address, [
    `Confirm loan alerts for ${address}.`,
    'If you did not request this, ignore the email.',
  ], [], { href, label: 'Confirm alerts' });
}

function sampleFacts(): LoanFacts {
  return {
    protocol: 'Aave V3',
    chain: 'Base',
    asset: 'cbBTC',
    collateral: '0.01032709 cbBTC',
    collateralUsd: '$869.95',
    debt: '100.00 USDC',
    debtUsd: '$100.00',
    healthFactor: '6.79',
    ltv: '11.5%',
    maxLtv: '73%',
    btcPrice: '$84,331',
    liquidationPrice: '$13,264',
    dropPct: '84.3%',
    borrowApr: '5.11%',
    interestMonth: '$0.43',
    interestYear: '$5.11',
  };
}

function accountingDigest(period: 'week' | 'month') {
  const fixture = liveLikeOpenLoan();
  const periodStart = period === 'week' ? fixture.now - 7 * 86_400_000 : fixture.openedAt;
  const summary = period === 'week'
    ? fixture.summary
    : summarizeEpisodePeriod({
      events: fixture.events,
      episodeKey: fixture.episodeKey,
      periodStart,
      periodEnd: fixture.now,
      endingDebt: fixture.endingDebt,
      decimals: 6,
    });
  const debtUsd = summary.periodEndSnapshot?.totalDebtUsd ?? 0;
  const row: DigestPosition = {
    name: 'Morpho Blue · cbBTC · Base',
    debtUsd,
    principalRemainingUsd: summary.principalRemainingUsd,
    accruedUnpaidUsd: summary.accruedUnpaidUsd,
    apr: fixture.apr,
    ltv: null,
    healthFactor: null,
    liquidationPriceUsd: null,
    actualUsd: summary.actual.usd,
    actualStatus: summary.actual.status,
    interestPaidUsd: summary.interestPaidUsd,
    principalRepaidUsd: summary.principalRepaidUsd,
    additionalBorrowingUsd: summary.additionalBorrowingUsd,
    networkFeesUsd: summary.networkFeesUsd,
  };
  return digestLines(period, [row], []);
}

export function sampleRefinanceQualification(): RefinanceQualification {
  const currentApr = 0.0483; // 4.83%
  const candidateApr = 0.0398; // 3.98%
  const debt = 20_934.12;
  const now = Date.now();

  const sourceMarket: RefinanceMarketBaseline = {
    id: 'morpho-8453-cbBTC-USDC-0x9103',
    protocol: 'morpho',
    chainId: 8453,
    marketId: 'morpho-8453-cbBTC-USDC-0x9103',
    collateralAsset: 'cbBTC',
    debtAsset: 'USDC',
    collateralAmount: 1.0,
    collateralValueUsd: 84_000,
    debt,
    currentApr,
    openingApr: 0.0483,
    safety: {
      ltv: 0.249,
      healthFactor: 3.45,
      liquidationThreshold: 0.86,
      liquidationBtc: 24_340,
      liquidationCushion: 0.71,
    },
    availableLiquidity: 10_000_000,
    utilization: 0.65,
    freshness: 'fresh',
    oraclePrice: 84_000,
    stability: { currentApr, avg7d: 0.0485, avg30d: 0.049, min7d: 0.047, max7d: 0.05, hasHistory: true },
  };

  const destinationMarket: RefinanceCandidate = {
    id: 'compound-8453-cbBTC-USDC-0x1234',
    protocol: 'compound',
    chainId: 8453,
    marketId: 'compound-8453-cbBTC-USDC-0x1234',
    collateral: 'cbBTC',
    debtAsset: 'USDC',
    currentApr: candidateApr,
    stability: { currentApr: candidateApr, avg7d: 0.04, avg30d: 0.041, min7d: 0.039, max7d: 0.042, hasHistory: true },
    liquidationThreshold: 0.86,
    availableLiquidity: 5_000_000,
    utilization: 0.60,
    freshness: 'fresh',
    wrapper: 'cbBTC',
    classification: 'SAME_CHAIN_SAME_WRAPPER',
    classificationLabel: 'Same chain · Same wrapper',
    isStale: false,
    venue: {
      id: 'compound-8453-cbBTC-USDC-0x1234',
      protocol: 'compound',
      action: 'borrow',
      chainId: 8453,
      assetSymbol: 'cbBTC',
      assetKind: 'custodial',
      assetAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      assetDecimals: 8,
      loanSymbol: 'USDC',
      loanAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      loanDecimals: 6,
      borrowApr: candidateApr,
      supplyApr: 0.03,
      maxLtv: 0.86,
      liquidityUsd: 5_000_000,
      priceUsd: 84_000,
      freshness: { source: 'rpc', fetchedAt: now - 30_000 },
    },
  };

  const plan = buildMigrationPlan({
    sourceMarket,
    destinationMarket,
    gasPriceWei: 1_000_000_000n,
    ethPriceUsd: 2500,
    now,
  });

  console.log(
    `[ALERT TEST] mode=SIMULATED_FIXTURE env=${process.env.NODE_ENV ?? 'development'} ` +
    `sourceMarket=${sourceMarket.id} candidateMarket=${destinationMarket.id} ` +
    `sourceApr=${currentApr} candidateApr=${candidateApr} fetchedAt=${now}`,
  );

  const qualification = qualifyRefinancePlan(plan, undefined, now);
  return {
    ...qualification,
    isSimulated: true,
    snapshot: {
      ...qualification.snapshot,
      isSimulated: true,
    },
  };
}

export function sampleSimulatedRefinanceAlert(address: string): AlertCopy {
  return refinanceAlert(address, sampleRefinanceQualification(), { isSimulated: true });
}

export function sampleAlertByKind(address: string, kind: AlertKind) {
  if (kind === 'refinance') return null;
  return sampleAlertEmails(address).find((sample) => sample.kind === kind) ?? null;
}

export function sampleAlertEmails(address: string, options?: { includeSimulatedRefinance?: boolean }): AlertCopy[] {
  const facts = sampleFacts();
  const alerts: AlertCopy[] = [
    confirmAlertEmail(address, 'sample@example.com'),
    healthAlert('urgent', address, { ...facts, healthFactor: '1.12', ltv: '65.2%', liquidationPrice: '$79,410', dropPct: '5.8%' }),
    healthAlert('health', address, { ...facts, healthFactor: '1.41', ltv: '51.8%', liquidationPrice: '$72,180', dropPct: '14.4%' }),
    liquidationAlert(address, { ...facts, healthFactor: '1.18', ltv: '62.0%', liquidationPrice: '$76,900', dropPct: '8.8%' }),
    aprAlert(address, { ...facts, borrowApr: '12.40%', interestMonth: '$1.03', interestYear: '$12.40' }),
    thresholdAlert(address, facts, '$5.10', '$94.90'),
    weeklyAlert(address, accountingDigest('week')),
    monthlyAlert(address, accountingDigest('month')),
  ];
  if (options?.includeSimulatedRefinance) {
    alerts.push(sampleSimulatedRefinanceAlert(address));
  }
  return alerts;
}
