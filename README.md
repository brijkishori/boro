This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Move BTC from a Coinbase account (Coinbase Onramp)

The "Move BTC from Coinbase" button opens Coinbase's hosted transfer page. You sign in to Coinbase there and send BTC to the connected wallet on Base, where Coinbase delivers it as cbBTC, 1:1. This app never sees your Coinbase login or balances.

1. Create a project at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com), then create a **Secret API Key** (not a Client API Key).
2. Add the key to `.env.local` (gitignored). Paste the secret as one line; escaped `\n` in PEM keys is fine.

   ```bash
   CDP_API_KEY_ID=your-key-id
   CDP_API_KEY_SECRET=your-key-secret
   ```

3. Restart `npm run dev`. Without the key, the button links to Coinbase's manual send guide instead.
4. Before production, add your domain to the Onramp domain allowlist in the CDP portal. The server sends Coinbase the visitor's IP from `x-real-ip`, so deploy behind a proxy that sets that header (Vercel does).

Full production steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Borrow cost is the interest other people pay to borrow that BTC. You do not pay it when you lend.**

It only appears on the Lend tab. The large number there is the **supply APY**, which is what you earn. Borrow cost is the rate a borrower of that same BTC pays the pool. On the Borrow tab the large number is **borrow APR**, which is the interest you pay to borrow USDC. Morpho Blue uses that same interest rate. This app does not add a second Morpho fee on top of it.

**Aave does not turn native Bitcoin into tBTC.** The Bitcoin panel only reads a mainnet balance. To lend that BTC you mint tBTC yourself on [Threshold](https://dashboard.threshold.network/tBTC/mint): send BTC from your own Bitcoin wallet, wait for confirmations, and receive tBTC in your Ethereum wallet. After that tBTC is in the wallet, Aave or Morpho can take it as a normal token. cbBTC is a separate Coinbase-wrapped token and is only used if you pick a cbBTC market.

**Check the position on the protocol’s own site and on a block explorer.**

- Borrowing USDC on Aave: open [app.aave.com](https://app.aave.com) with the same wallet and the same network (Base or Ethereum). Your tBTC or cbBTC collateral and your USDC debt should match this app. The transaction hash on [Basescan](https://basescan.org) or [Etherscan](https://etherscan.org) shows the Pool `supply` and `borrow` calls.
- Borrowing on Morpho: open [app.morpho.org](https://app.morpho.org) on the same wallet and network. The market position should show the same collateral and debt. The explorer transaction is a Morpho Blue `supplyCollateral` or `borrow`.
- Lending: your wallet’s tBTC balance drops by the amount you supplied, and Aave shows an aToken balance for that deposit. That aToken balance is what should creep up with the supply APY.
- Whether the rate is real: note the USDC debt today, then check it tomorrow on Aave or Morpho. It should be higher by about `borrow APR / 365`. A lend deposit should be higher by about `supply APY / 365`.
- Native Bitcoin: [mempool.space](https://mempool.space) for your BTC address. That balance changes only after you actually send BTC to mint tBTC. This app’s Bitcoin panel does not move those coins.

