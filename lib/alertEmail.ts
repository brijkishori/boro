import { formatUnits } from 'viem';
import type { PositionSnapshot } from '@/lib/adapters';
import { type AlertKind, ALERT_SUBJECTS } from '@/lib/alertKinds';
import { alertToken, appUrl, unsubscribeUrl } from '@/lib/alerts';
import { formatApr, formatToken, formatUsd, formatUsdExact } from '@/lib/amount';
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
    healthFactor: snapshot.healthFactor === null ? 'No debt' : snapshot.healthFactor.toFixed(2),
    ltv: `${(snapshot.ltv * 100).toFixed(1)}%`,
    maxLtv: `${(venue.maxLtv * 100).toFixed(0)}%`,
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
    `Borrow APR: ${facts.borrowApr}`,
    `Interest: ${facts.interestMonth}/mo · ${facts.interestYear}/yr`,
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

export function refinanceAlert(address: string, facts: LoanFacts, hint: { toProtocol: string; toChain: string; toApr: string; yearly: string; monthly: string }) {
  return renderAlertEmail('refinance', address, [
    `You can lower the rate on ${facts.debtUsd} of ${facts.asset} debt.`,
    `Move from ${facts.protocol} ${facts.borrowApr} on ${facts.chain} to ${hint.toProtocol} ${hint.toApr} on ${hint.toChain}.`,
    `Estimated savings: ${hint.monthly}/month, ${hint.yearly}/year. Four wallet confirmations: repay, withdraw, supply, borrow. Nothing is sent automatically.`,
  ], positionLines(facts));
}

export function thresholdAlert(address: string, facts: LoanFacts, grown: string, since: string) {
  return renderAlertEmail('threshold', address, [
    `Accrued interest on ${facts.protocol} ${facts.asset} grew by about ${grown} since ${since}.`,
    `Debt is now ${facts.debt} (${facts.debtUsd}).`,
  ], positionLines(facts));
}

export function weeklyAlert(address: string, weekly: string, rows: string[]) {
  return renderAlertEmail('weekly', address, [
    `About ${weekly} of interest accrued this week across your open loans.`,
  ], rows);
}

export function monthlyAlert(address: string, rows: string[]) {
  return renderAlertEmail('monthly', address, [
    'Monthly statement for your open SimpleBTC loans.',
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

export function sampleAlertByKind(address: string, kind: AlertKind) {
  return sampleAlertEmails(address).find((sample) => sample.kind === kind) ?? null;
}

export function sampleAlertEmails(address: string): AlertCopy[] {
  const facts = sampleFacts();
  return [
    confirmAlertEmail(address, 'sample@example.com'),
    healthAlert('urgent', address, { ...facts, healthFactor: '1.12', ltv: '65.2%', liquidationPrice: '$79,410', dropPct: '5.8%' }),
    healthAlert('health', address, { ...facts, healthFactor: '1.41', ltv: '51.8%', liquidationPrice: '$72,180', dropPct: '14.4%' }),
    liquidationAlert(address, { ...facts, healthFactor: '1.18', ltv: '62.0%', liquidationPrice: '$76,900', dropPct: '8.8%' }),
    aprAlert(address, { ...facts, borrowApr: '12.40%', interestMonth: '$1.03', interestYear: '$12.40' }),
    refinanceAlert(address, facts, {
      toProtocol: 'Spark',
      toChain: 'Ethereum',
      toApr: '4.18%',
      yearly: formatUsdExact(0.93),
      monthly: formatUsdExact(0.08),
    }),
    thresholdAlert(address, facts, '$5.10', '$94.90'),
    weeklyAlert(address, '$1.08', [...positionLines(facts), 'Interest this week: $1.08']),
    monthlyAlert(address, [...positionLines(facts), 'Interest this month: $0.43', 'Interest this year at the current rate: $5.11']),
  ];
}
