import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import DailyLoanSnapshot, {
  sortLoansByUrgency,
  formatAprChangeText,
  formatNextAttentionPoint,
  loanActionStyle,
  PortfolioStatusCard,
  LoanCard,
  WalletReservesCard,
} from './DailyLoanSnapshot';
import { buildActiveLoanView, buildLoanRateStatus, type ActiveLoanView } from '@/lib/finance/loanView';
import { portfolioDebtSummary, type OpenDebtPosition } from '@/lib/finance/portfolio';
import type { PositionSnapshot } from '@/lib/adapters';
import type { Venue } from '@/lib/protocol';
import type { WalletHolding } from '@/components/useWalletHoldings';

function mockSnapshot(data: {
  collateral: bigint;
  debt: bigint;
  ltv: number;
  healthFactor: number | null;
  liquidationPrice: number;
  ready: boolean;
}): PositionSnapshot {
  return {
    maxBorrow: 0n,
    borrowRoom: 0n,
    withdrawMax: 0n,
    ...data,
  };
}

const mockVenueMorpho = {
  id: 'morpho-cbbtc-usdc',
  protocol: 'morpho',
  chainId: 8453,
  assetSymbol: 'cbBTC',
  loanSymbol: 'USDC',
  assetAddress: '0xcbbtc',
  loanAddress: '0xusdc',
  assetDecimals: 8,
  loanDecimals: 6,
  priceUsd: 83600,
  borrowApr: 0.048,
  maxLtv: 0.86,
  action: 'borrow',
  morpho: { marketId: '0x123' },
} as unknown as Venue;

const mockVenueAave = {
  id: 'aave-cbbtc-usdc',
  protocol: 'aave',
  chainId: 8453,
  assetSymbol: 'cbBTC',
  loanSymbol: 'USDC',
  assetAddress: '0xcbbtc',
  loanAddress: '0xusdc',
  assetDecimals: 8,
  loanDecimals: 6,
  priceUsd: 83600,
  borrowApr: 0.060,
  maxLtv: 0.75,
  action: 'borrow',
  aave: { pool: '0xpool', aToken: '0xatoken', variableDebtToken: '0xdebttoken' },
} as unknown as Venue;

function createHealthyLoanView(): ActiveLoanView {
  return buildActiveLoanView({
    id: mockVenueMorpho.id,
    lifecycleId: 'ep-1',
    protocol: 'morpho',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    loanSymbol: 'USDC',
    assetDecimals: 8,
    loanDecimals: 6,
    collateral: 100000000n, // 1 cbBTC
    debt: 21108000000n, // 21,108 USDC
    priceUsd: 83600,
    ltv: 0.2525,
    healthFactor: 3.40,
    liquidationPrice: 24544,
    currentApr: 0.048,
    openingApr: 0.0481, // 1 bp higher at opening -> current is 1 bp lower
    fetchedAt: Date.now(),
  });
}

function createStressedLoanView(): ActiveLoanView {
  return buildActiveLoanView({
    id: mockVenueAave.id,
    lifecycleId: 'ep-2',
    protocol: 'aave',
    chainId: 8453,
    assetSymbol: 'cbBTC',
    loanSymbol: 'USDC',
    assetDecimals: 8,
    loanDecimals: 6,
    collateral: 100000000n, // 1 cbBTC
    debt: 60000000000n, // 60,000 USDC
    priceUsd: 83600,
    ltv: 0.7177,
    healthFactor: 1.35, // ACT risk state (between 1.25 and 1.50)
    liquidationPrice: 70000,
    currentApr: 0.060,
    openingApr: 0.050,
    fetchedAt: Date.now(),
  });
}

const mockHoldings: { rows: WalletHolding[]; ready: boolean; isConnected: boolean } = {
  ready: true,
  isConnected: true,
  rows: [
    {
      key: '8453:USDC',
      chainId: 8453,
      symbol: 'USDC',
      decimals: 6,
      kind: 'stable',
      amount: 5000000000n,
      usd: 5000,
      amountText: '5,000.00',
      usdText: '$5,000.00',
      network: 'Base',
    },
    {
      key: '8453:cbBTC',
      chainId: 8453,
      symbol: 'cbBTC',
      decimals: 8,
      kind: 'btc',
      amount: 50000000n,
      usd: 41800,
      amountText: '0.50',
      usdText: '$41,800.00',
      network: 'Base',
    },
    {
      key: '8453:ETH',
      chainId: 8453,
      symbol: 'ETH',
      decimals: 18,
      kind: 'native',
      amount: 100000000000000000n,
      usd: 300,
      amountText: '0.10',
      usdText: '$300.00',
      network: 'Base',
    },
    {
      key: '1:USDC',
      chainId: 1,
      symbol: 'USDC',
      decimals: 6,
      kind: 'stable',
      amount: 1000000000n,
      usd: 1000,
      amountText: '1,000.00',
      usdText: '$1,000.00',
      network: 'Ethereum',
    },
  ],
};

test('A. one healthy loan renders compact loan snapshot', () => {
  const view = createHealthyLoanView();
  const activePosition: OpenDebtPosition = {
    venue: mockVenueMorpho,
    snapshot: mockSnapshot({
      collateral: 100000000n,
      debt: 21108000000n,
      ltv: 0.2525,
      healthFactor: 3.40,
      liquidationPrice: 24544,
      ready: true,
    }),
  };

  const html = renderToString(
    <DailyLoanSnapshot
      views={[view]}
      active={[activePosition]}
      isConnected={true}
      holdings={mockHoldings}
    />
  );

  // Protocol · Chain & Collateral / debt pair
  assert.ok(html.includes('Morpho') && html.includes('Base'));
  assert.ok(html.includes('cbBTC / USDC'));

  // Debt & Collateral
  assert.ok(html.includes('$21,108'));
  assert.ok(html.includes('1 cbBTC') && (html.includes('$83.6K') || html.includes('$83,600')));

  // HF & risk status & LTV
  assert.ok(html.includes('3.40'));
  assert.ok(html.includes('NORMAL'));
  assert.ok(html.includes('25.3%') || html.includes('25.25%'));

  // Liquidation BTC & Cushion
  assert.ok(html.includes('$24,544'));
  assert.ok(html.includes('70.7%') || html.includes('70.64%'));

  // APR & Interest
  assert.ok(html.includes('4.80%'));
  assert.ok(html.includes('~$84/mo'));

  // Guidance
  assert.ok(html.includes('No action required.'));

  // Actions
  assert.ok(html.includes('View loan'));
  assert.ok(html.includes('Risk monitor'));
  assert.ok(html.includes('Repay / withdraw'));
});

test('B. APR shows opening/current/change arrow', () => {
  // Case 1: Down arrow (cheaper than opening)
  const rateDown = buildLoanRateStatus({
    currentApr: 0.048,
    openingApr: 0.0481,
    debtUsd: 21108,
  });
  const textDown = formatAprChangeText(rateDown);
  assert.ok(textDown.includes('↓'));
  assert.ok(textDown.includes('1 bp'));
  assert.ok(textDown.includes('4.81%'));

  // Case 2: Up arrow (more expensive than opening)
  const rateUp = buildLoanRateStatus({
    currentApr: 0.055,
    openingApr: 0.045,
    debtUsd: 20000,
  });
  const textUp = formatAprChangeText(rateUp);
  assert.ok(textUp.includes('↑'));
  assert.ok(textUp.includes('100 bps'));
  assert.ok(textUp.includes('4.50%'));

  // Case 3: Neutral arrow (approximately unchanged)
  const rateNeutral = buildLoanRateStatus({
    currentApr: 0.04801,
    openingApr: 0.04800,
    debtUsd: 20000,
  });
  const textNeutral = formatAprChangeText(rateNeutral);
  assert.ok(textNeutral.includes('→'));
  assert.ok(textNeutral.includes('approximately unchanged'));
});

test('C. multiple loans render independently', () => {
  const healthy = createHealthyLoanView();
  const stressed = createStressedLoanView();

  const activeHealthy: OpenDebtPosition = {
    venue: mockVenueMorpho,
    snapshot: mockSnapshot({
      collateral: 100000000n,
      debt: 21108000000n,
      ltv: 0.2525,
      healthFactor: 3.40,
      liquidationPrice: 24544,
      ready: true,
    }),
  };

  const activeStressed: OpenDebtPosition = {
    venue: mockVenueAave,
    snapshot: mockSnapshot({
      collateral: 100000000n,
      debt: 60000000000n,
      ltv: 0.7177,
      healthFactor: 1.35,
      liquidationPrice: 70000,
      ready: true,
    }),
  };

  const html = renderToString(
    <DailyLoanSnapshot
      views={[healthy, stressed]}
      active={[activeHealthy, activeStressed]}
      isConnected={true}
      holdings={mockHoldings}
    />
  );

  // Both loans exist independently
  assert.ok(html.includes('Morpho'));
  assert.ok(html.includes('Aave'));
  assert.ok(html.includes('3.40'));
  assert.ok(html.includes('1.35'));
  assert.ok(html.includes('$21,108'));
  assert.ok(html.includes('$60,000'));
});

test('D. highest-risk loan appears first', () => {
  const healthy = createHealthyLoanView(); // NORMAL, HF 3.40
  const stressed = createStressedLoanView(); // ACT, HF 1.35

  // Pass in healthy first, stressed second
  const sorted = sortLoansByUrgency([healthy, stressed]);
  assert.strictEqual(sorted[0].id, stressed.id);
  assert.strictEqual(sorted[1].id, healthy.id);

  // In rendered HTML, stressed loan markup appears before healthy loan markup
  const activeHealthy: OpenDebtPosition = {
    venue: mockVenueMorpho,
    snapshot: mockSnapshot({ collateral: 100000000n, debt: 21108000000n, ltv: 0.25, healthFactor: 3.40, liquidationPrice: 24544, ready: true }),
  };
  const activeStressed: OpenDebtPosition = {
    venue: mockVenueAave,
    snapshot: mockSnapshot({ collateral: 100000000n, debt: 60000000000n, ltv: 0.71, healthFactor: 1.35, liquidationPrice: 70000, ready: true }),
  };

  const html = renderToString(
    <DailyLoanSnapshot
      views={[healthy, stressed]}
      active={[activeHealthy, activeStressed]}
      isConnected={true}
    />
  );

  const idxStressed = html.indexOf('Aave');
  const idxHealthy = html.indexOf('Morpho');
  assert.ok(idxStressed !== -1 && idxHealthy !== -1);
  assert.ok(idxStressed < idxHealthy, 'Stressed loan (ACT) must render before Healthy loan (NORMAL)');

  // Portfolio status reflects most urgent state: ACT
  assert.ok(html.includes('ACT'));
  assert.ok(html.includes('Corrective action recommended.'));
});

test('E. portfolio total debt and monthly interest aggregate correctly', () => {
  const active1: OpenDebtPosition = {
    venue: { ...mockVenueMorpho, borrowApr: 0.05 },
    snapshot: mockSnapshot({ collateral: 100000000n, debt: 10000000000n, ltv: 0.1, healthFactor: 8.0, liquidationPrice: 10000, ready: true }),
  };
  const active2: OpenDebtPosition = {
    venue: { ...mockVenueAave, borrowApr: 0.06 },
    snapshot: mockSnapshot({ collateral: 100000000n, debt: 20000000000n, ltv: 0.2, healthFactor: 4.0, liquidationPrice: 20000, ready: true }),
  };

  const summary = portfolioDebtSummary([active1, active2]);
  assert.ok(summary !== null);
  assert.strictEqual(summary.totalDebtUsd, 30000);
  // Monthly interest: 10000 * 0.05 / 12 + 20000 * 0.06 / 12 = 41.666 + 100 = 141.666
  assert.ok(summary.estimatedMonthlyInterest !== null);
  assert.ok(Math.abs(summary.estimatedMonthlyInterest - 141.666) < 0.01);
  // Weighted APR: (10000 * 0.05 + 20000 * 0.06) / 30000 = 0.05666...
  assert.ok(summary.weightedBorrowApr !== null);
  assert.ok(Math.abs(summary.weightedBorrowApr - 0.05666) < 0.001);

  const view1 = { ...createHealthyLoanView(), id: 'loan-1', totalDebtUsd: 10000 };
  const view2 = { ...createHealthyLoanView(), id: 'loan-2', totalDebtUsd: 20000 };

  const html = renderToString(
    <PortfolioStatusCard views={[view1, view2]} summary={summary} />
  );

  assert.ok(html.includes('Open loans') && html.includes('2'));
  assert.ok(html.includes('Total debt') && html.includes('$30,000'));
  assert.ok(html.includes('Estimated monthly interest') && html.includes('~$142/mo'));
  assert.ok(html.includes('Weighted current APR') && html.includes('5.67%'));
});

test('F. wallet information appears below loan data', () => {
  const view = createHealthyLoanView();
  const active: OpenDebtPosition = {
    venue: mockVenueMorpho,
    snapshot: mockSnapshot({ collateral: 100000000n, debt: 21108000000n, ltv: 0.25, healthFactor: 3.40, liquidationPrice: 24544, ready: true }),
  };

  const html = renderToString(
    <DailyLoanSnapshot
      views={[view]}
      active={[active]}
      isConnected={true}
      holdings={mockHoldings}
    />
  );

  const loanIdx = html.indexOf('cbBTC / USDC');
  const walletIdx = html.indexOf('WALLET &amp; EMERGENCY RESERVES');
  assert.ok(loanIdx !== -1, 'Loan card should be present');
  assert.ok(walletIdx !== -1, 'Wallet section should be present');
  assert.ok(loanIdx < walletIdx, 'Wallet information must appear below loan data');
});

test('G. other-network wallet data does not dominate the initial view', () => {
  const html = renderToString(<WalletReservesCard holdings={mockHoldings} />);

  // Base balances are present
  assert.ok(html.includes('Base'));
  assert.ok(html.includes('USDC') && html.includes('5,000.00'));
  assert.ok(html.includes('cbBTC') && html.includes('0.50'));
  assert.ok(html.includes('ETH gas') && html.includes('0.10'));

  // Other networks is inside a details tag that is collapsed by default (no open attribute)
  assert.ok(html.includes('<details class="pt-1">'));
  assert.ok(!html.includes('<details open') && !html.includes('<details class="pt-1" open'));
  assert.ok(html.includes('Other networks'));
});

test('H. market discovery is collapsed / secondary', () => {
  const homeCode = fs.readFileSync(path.resolve(__dirname, '../app/page.tsx'), 'utf8');

  // Verify "Explore borrowing markets" is inside details and default closed when no search params
  assert.ok(homeCode.includes('id="explore-borrowing-markets"'));
  assert.ok(homeCode.includes('<summary className="cursor-pointer text-sm font-semibold">Explore borrowing markets</summary>'));
  assert.ok(homeCode.includes('Boolean(marketParam || tabParam)'));
});

test('I. no-open-loan state works', () => {
  const html = renderToString(
    <DailyLoanSnapshot
      views={[]}
      active={[]}
      isConnected={true}
      holdings={mockHoldings}
    />
  );

  // Shows "No open loans."
  assert.ok(html.includes('No open loans.'));

  // Shows wallet summary
  assert.ok(html.includes('WALLET &amp; EMERGENCY RESERVES'));

  // Shows prominent "Compare borrowing markets"
  assert.ok(html.includes('Compare borrowing markets'));

  // Does not show loan cards
  assert.ok(!html.includes('Liquidation BTC'));
});

test('J. Home consumes existing risk calculations rather than implementing duplicate HF/liquidation formulas', () => {
  const snapshotCode = fs.readFileSync(path.resolve(__dirname, './DailyLoanSnapshot.tsx'), 'utf8');
  const homeCode = fs.readFileSync(path.resolve(__dirname, '../app/page.tsx'), 'utf8');

  // DailyLoanSnapshot imports from canonical finance modules
  assert.ok(snapshotCode.includes("from '@/lib/finance/format'"));
  assert.ok(snapshotCode.includes("from '@/lib/finance/rates'"));
  assert.ok(snapshotCode.includes("from '@/lib/finance/portfolio'"));
  assert.ok(snapshotCode.includes("from '@/lib/finance/loanView'"));
  assert.ok(snapshotCode.includes("from '@/lib/finance/riskStatus'"));

  // Verify absence of duplicate financial formulas
  assert.ok(!snapshotCode.includes('collateral / debt'));
  assert.ok(!snapshotCode.includes('debt / collateral'));
  assert.ok(!homeCode.includes('collateral / debt'));
  assert.ok(!homeCode.includes('debt / collateral'));
  assert.ok(!snapshotCode.includes('priceAtTargetHf'));
  assert.ok(!snapshotCode.includes('distanceToLiquidation'));
});

test('K. portfolio status shows authoritative freshness instead of duplicate "No action required."', () => {
  const healthy = createHealthyLoanView();
  const summary = portfolioDebtSummary([]);
  const fortyFiveSecondsAgo = Date.now() - 45_000;

  const html = renderToString(
    <PortfolioStatusCard
      views={[healthy]}
      summary={summary}
      updatedAt={fortyFiveSecondsAgo}
    />
  );

  // Authoritative freshness is displayed
  assert.ok(html.includes('Updated 45 sec ago'));

  // Duplicate "No action required." guidance detail is NOT rendered in portfolio status card
  assert.ok(!html.includes('No action required.'));
});

test('L. loan card shows next attention point: WATCH at BTC $X · Y% below current BTC using existing Risk Monitor data', () => {
  const healthy = createHealthyLoanView();
  assert.ok(healthy.decision, 'Decision should be computed on view');
  assert.strictEqual(healthy.decision.nextRiskState, 'WATCH');

  const text = formatNextAttentionPoint(healthy.decision);
  assert.match(text, /^Next attention point: WATCH at BTC \$[\d,.]+(?:\.\d{2})? · \d+% below current BTC$/);

  const html = renderToString(<LoanCard view={healthy} />);
  assert.ok(html.includes(text));
  assert.ok(html.includes('Next attention point: WATCH at BTC $61,360.00 · 27% below current BTC'));
});

test('M. NORMAL loan action buttons are all neutral', () => {
  const style = loanActionStyle('NORMAL');
  assert.strictEqual(style.variant, 'outline');
  assert.strictEqual(style.className, 'h-8 text-xs');
  assert.ok(!style.className.includes('bg-'));

  const healthy = createHealthyLoanView();
  const html = renderToString(<LoanCard view={healthy} />);

  // Should have neutral buttons (outline variant) and no colored urgency backgrounds
  assert.ok(!html.includes('bg-amber-600'));
  assert.ok(!html.includes('bg-orange-600'));
  assert.ok(!html.includes('bg-red-600'));
  assert.ok(!html.includes('bg-blue-600'));
});
