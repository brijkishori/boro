const TOPICS: Array<{ title: string; body: string }> = [
  {
    title: 'How to use SimpleBTC',
    body: 'Read a Bitcoin balance or connect an EVM wallet. Compare markets using your intended borrow and optional benchmark. Select a market before reviewing supply and borrow amounts. Transactions use the on-chain oracle or Aave account data and stay capped at 90% of the protocol maximum. Repay the selected market, including interest, before withdrawing collateral.',
  },
  {
    title: 'How crypto-backed borrowing works',
    body: 'You supply wrapped or native-linked BTC as collateral and borrow a stablecoin against it. The position stays open while your loan-to-value stays below the protocol limit. Interest accrues continuously at a variable rate. Nothing here is a loan approval or a credit decision.',
  },
  {
    title: 'How liquidation works',
    body: 'If BTC falls far enough, the protocol can sell collateral to repay the debt. The relevant trigger is your actual LTV versus that market’s liquidation threshold or LLTV, not the headline Max LTV alone. A liquidation penalty or bonus may apply. SimpleBTC shows an approximate liquidation BTC price from the selected market’s published parameters.',
  },
  {
    title: 'Aave vs Morpho',
    body: 'Aave uses a shared pool, Max LTV, a separate liquidation threshold, and Health Factor. Morpho Blue uses isolated markets with a single LLTV and no Health Factor. E-Mode, if shown, applies only when the quote actually uses it. Isolated markets can be cheaper but may have less depth.',
  },
  {
    title: 'Wrapped BTC risks',
    body: 'tBTC is minted by Threshold from native Bitcoin. WBTC is backed by BTC held with BitGo. cbBTC is backed 1:1 by BTC held at Coinbase. Wrapper, custody, and redemption assumptions differ. Direct BTC markets use tBTC.',
  },
  {
    title: 'Variable-rate risk',
    body: 'Crypto borrow rates move with utilization and market demand. A lower current APR can still cost more later. Use the 7-day and 30-day averages, plus stress rates, when comparing against a fixed benchmark. History is omitted when it is not available.',
  },
];

export default function BorrowEducation() {
  return (
    <section id="how-it-works" className="mt-6 border-t border-muted pt-6">
      <h2 className="mb-3 text-center text-lg font-bold">Help</h2>
      <div className="space-y-2">
        {TOPICS.map((topic) => (
          <details key={topic.title} className="rounded-xl border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">{topic.title}</summary>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{topic.body}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
