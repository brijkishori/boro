# Deploying SimpleBTC Borrow to Vercel

This guide covers a production deployment on Vercel, including the Coinbase Developer Platform (CDP) key that powers **Move BTC from Coinbase**.

- Live URL today: `https://boro-ruddy.vercel.app`
- Repository: `github.com/brijkishori/boro`, branch `main`
- Framework: Next.js 16 (App Router), Node 22

---

## 1. What gets deployed

| Part | Where it runs | Secrets it needs |
|---|---|---|
| Pages (`/`, `/loans`, `/faq`, `/terms`, `/contact`) | Static files on Vercel's CDN | None |
| `/api/rates` | Vercel serverless function | None (reads Morpho, Aave, Compound, Spark, Moonwell) |
| `/api/rates/history` | Vercel serverless function | Optional Upstash Redis for snapshots |
| `/api/btc` | Vercel serverless function | None (reads mempool.space) |
| `/api/onramp` | Vercel serverless function | `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` |
| `/api/alerts/*` | Vercel serverless functions | Gmail SMTP, signing secret, optional Redis |
| `/.well-known/farcaster.json` | Vercel serverless function | None |
| Wallet reads and transactions | The user's browser and wallet | Public RPC and WalletConnect IDs only |

The app has no database and never holds user funds. The fee history and wallet session live in the user's browser.

The only real secret is the CDP key. It stays on the server: `/api/onramp` uses it to sign a 2-minute JWT, and that JWT requests a single-use Coinbase session token (valid 5 minutes) bound to the user's wallet address. The browser only ever receives the resulting `pay.coinbase.com` URL.

---

## 2. Environment variables

| Name | Required | Secret? | Used by | Notes |
|---|---|---|---|---|
| `CDP_API_KEY_ID` | For the Coinbase transfer | Yes | `/api/onramp` | The key's `id` (or `name` in older key files) |
| `CDP_API_KEY_SECRET` | For the Coinbase transfer | **Yes, sensitive** | `/api/onramp` | The key's `privateKey`, on one line |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Recommended | No (public) | Wallet connect QR | Falls back to a built-in shared ID. Use your own for production. |
| `NEXT_PUBLIC_ALCHEMY_KEY` | Optional | No (public) | RPC reads | Without it the app uses the public Base and Ethereum RPCs, which rate-limit under load. |
| `GMAIL_USER` | For loan email alerts | Yes | `/api/alerts/*` | Full Gmail address that owns the app password |
| `GMAIL_APP_PASSWORD` | For loan email alerts | **Yes, sensitive** | `/api/alerts/*` | 16-character Google app password (spaces optional) |
| `ALERT_FROM_EMAIL` | Optional | No | `/api/alerts/*` | From address. Defaults to `GMAIL_USER` |
| `ALERT_SIGNING_SECRET` | Recommended | **Yes, sensitive** | `/api/alerts/*` | HMAC secret for confirm/unsubscribe links. Falls back to the app password in development |
| `NEXT_PUBLIC_APP_URL` | Recommended | No (public) | Confirm/unsubscribe links | Production origin, for example `https://boro-ruddy.vercel.app` |
| `CRON_SECRET` | Production alerts | **Yes, sensitive** | `/api/alerts/check` | Vercel sends this as `Authorization: Bearer …` on the daily cron |
| `UPSTASH_REDIS_REST_URL` | Production alerts | Yes | Alerts + rate history | Without Redis, subscribers and snapshots live only in one function instance |
| `UPSTASH_REDIS_REST_TOKEN` | Production alerts | **Yes, sensitive** | Alerts + rate history | REST token from the same Upstash database |

Rules:

- **Never** prefix the CDP values with `NEXT_PUBLIC_`. Anything with that prefix is copied into the browser bundle.
- `NEXT_PUBLIC_*` values are baked in at build time. After changing one, redeploy.
- Without the two CDP variables, the app still works. The Coinbase button falls back to "How to send BTC from Coinbase" and links to Coinbase's manual guide.

---

## 3. Create the CDP Secret API key

1. Open [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com), choose your project, then **API Keys → Secret API keys → Create secret API key**.
2. Name it `boro-onramp-production`.
3. Under **Advanced settings**:

   | Setting | Value |
   |---|---|
   | Portfolio | Primary (not used) |
   | View (read-only) | Leave as is (always on) |
   | Trade | **Off** |
   | Transfer | **Off** |
   | Receive | **Off** |
   | Export / Manage (Non-custodial) | Off |
   | IP allowlist | Leave empty (Vercel functions do not have fixed IPs) |
   | Signature algorithm | **Ed25519** |

   Onramp session tokens need none of the Trade, Transfer, or Receive permissions. Leaving them off means a leaked key cannot move or trade anything in your Coinbase account.

4. Click **Create**. Download the JSON file or copy the values right away, because Coinbase shows the secret only once.

   ```json
   {
     "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
     "privateKey": "base64-string-of-about-88-characters=="
   }
   ```

   - `id` goes into `CDP_API_KEY_ID`
   - `privateKey` goes into `CDP_API_KEY_SECRET`

5. Keep that JSON file out of the repo. Store it in a password manager, then delete the downloaded copy.

Use a separate key for local development (`boro-onramp-dev`) so you can revoke either one without touching the other.

---

## 4. Allow your domain for Onramp

Coinbase refuses to open Onramp from domains that aren't on your project's allowlist.

1. In the CDP portal, open **Onramp** (Payments → Onramp) and find **Domain allowlist**.
2. Add each domain that will host the app, including the scheme and no trailing slash:
   - `https://boro-ruddy.vercel.app`
   - your custom domain, if you add one (for example `https://simplebtc.app`)
   - `http://localhost:3000`, only for local testing
3. Save.

If Coinbase asks you to finish Onramp onboarding for the project (business details or use case), complete it. Sending from an existing Coinbase account works once the project is enabled.

---

## 5. Add the variables in Vercel

### Option A: Vercel dashboard

1. Go to [vercel.com](https://vercel.com), open the **boro** project, then **Settings → Environment Variables**.
2. Add `CDP_API_KEY_ID`:
   - Value: the key `id`
   - Environments: **Production** (add Preview only if you want the Coinbase button on preview deployments)
3. Add `CDP_API_KEY_SECRET`:
   - Value: the `privateKey`, pasted as a single line with no quotes
   - Environments: **Production**
   - Turn on **Sensitive**, so the value can never be read back from the dashboard
4. Optional: add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` and `NEXT_PUBLIC_ALCHEMY_KEY` to **Production** and **Preview**.
5. Click **Save**. Existing deployments do **not** pick up new variables until you redeploy (step 6).

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel link                                  # run in C:\CryptoApps\boro, pick the boro project
vercel env add CDP_API_KEY_ID production     # paste the id when prompted
vercel env add CDP_API_KEY_SECRET production --sensitive   # paste the privateKey when prompted
vercel env ls                                # confirm both names are listed
```

Avoid pasting the secret as a command-line argument, because it would end up in your shell history. Let the prompt read it.

### Preview deployments

Every pull request gets a preview URL such as `boro-git-feature-xyz.vercel.app`. Those URLs change each time and are not on the Onramp allowlist, so leave the CDP variables out of Preview. The button falls back to the manual guide there, which is the safe default.

---

## 6. Deploy

### Commit and push

The working tree currently has uncommitted changes: the fee display, the "Your BTC" portfolio card, the Onramp route, and the repay and withdraw fixes. Vercel deploys whatever is on `main`.

```bash
cd C:\CryptoApps\boro
npm run build          # must finish with no errors (deprecation warnings from @farcaster are expected)
git status             # make sure no .env files are listed
git add -A
git commit -m "Fee display, portfolio card, Coinbase Onramp transfer, repay fixes"
git push origin main
```

Vercel builds and deploys automatically on the push. Watch progress under **Deployments** in the dashboard.

### Redeploy after changing environment variables only

- **Dashboard:** Deployments → latest Production deployment → **⋯ → Redeploy**. Leave "Use existing build cache" unchecked if you changed a `NEXT_PUBLIC_*` value.
- **CLI:** `vercel --prod`

---

## 7. Verify the production deployment

Replace the URL if you use a custom domain.

1. **Config check.** It should return `{"configured":true}`:

   ```bash
   curl https://boro-ruddy.vercel.app/api/onramp
   ```

   `{"configured":false}` means the variables are missing from Production, or you haven't redeployed since adding them.

2. **The route rejects other origins.** Expect HTTP `403`:

   ```bash
   curl -i -X POST https://boro-ruddy.vercel.app/api/onramp \
     -H "Origin: https://evil.example" -H "Content-Type: application/json" \
     -d "{\"address\":\"0x0000000000000000000000000000000000000001\"}"
   ```

3. **In the app:**
   - Connect your wallet. The **Your BTC** card shows balances across Base and Ethereum.
   - The Coinbase button reads **Move BTC from Coinbase**, not "How to send BTC from Coinbase".
   - Click it. A Coinbase window opens on `pay.coinbase.com` with sending BTC on Base preselected.

4. **Small live test.** Send about $5 of BTC from your Coinbase account.
   - Coinbase delivers it as cbBTC on Base, usually within a few minutes.
   - The **Your BTC** card updates on its own (it refreshes every 20 seconds).
   - Confirm the incoming transfer on [basescan.org](https://basescan.org) under your wallet address.

5. **Rates and fees.** `https://boro-ruddy.vercel.app/api/rates` returns JSON with a `venues` array, and a Borrow or Repay screen shows a **Costs** box with network fees in USD and ETH.

6. **Logs.** In Vercel, open **Deployments → the deployment → Functions (Logs)**. `/api/onramp` never logs the key or the token.

---

## 8. Security notes

- **Least privilege.** The CDP key has no Trade, Transfer, or Receive permission. It can only create Onramp sessions, and the user still approves every transfer inside Coinbase.
- **Server-only secret.** `CDP_API_KEY_SECRET` is read only in `app/api/onramp/route.ts` and `lib/cdpJwt.ts`. It is not sent to the browser and not logged.
- **Short-lived credentials.** Each request signs a fresh JWT (valid 120 seconds) scoped to `POST api.developer.coinbase.com/onramp/v1/token`. Coinbase's session token is single-use and expires in 5 minutes.
- **Request checks in `/api/onramp`:**
  - the `Origin` header must match the host
  - the wallet address is validated and checksummed
  - any preset amount is capped
  - each IP gets at most 6 requests a minute
- **Client IP.** Coinbase requires the real user IP. On Vercel the route reads `x-real-ip`, which Vercel sets itself and clients cannot override. If you ever move off Vercel, put the app behind a proxy that overwrites `x-real-ip`.
- **Rate limit scope.** The limit is kept in memory per function instance, so it slows abuse but is not a global quota. For a strict global limit, use Vercel KV or Upstash Redis.
- **Rotation.** To rotate the key:
  1. Create a new key in CDP.
  2. Update both variables in Vercel.
  3. Redeploy.
  4. Delete the old key in CDP.

  If a key ever leaks, delete it in CDP first. That takes effect immediately.
- **Public keys.** `NEXT_PUBLIC_ALCHEMY_KEY` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` are visible to anyone. Protect them with allowlists: restrict the Alchemy key to your domains in Alchemy's dashboard, and add your domains to the WalletConnect (Reown) project's allowlist at [cloud.reown.com](https://cloud.reown.com).

---

## 9. Using a custom domain

1. Vercel: **Settings → Domains → Add** your domain, and set the DNS records Vercel shows.
2. Update the hardcoded app URL in these files, then commit and push:
   - `lib/config.ts`: `appLogoUrl` and the WalletConnect `metadata.url` and `icons`
   - `app/layout.tsx`: `appUrl`
   - `app/.well-known/farcaster.json/route.ts`: `appUrl`
3. Add the new domain to the CDP Onramp allowlist (section 4) and the Reown allowlist (section 8).
4. Keep `boro-ruddy.vercel.app` on the allowlists until traffic has moved over.

---

## 10. Rollback

- **App:** Vercel → Deployments → pick the last good Production deployment → **⋯ → Promote to Production** (instant, no rebuild).
- **Coinbase transfer only:** delete `CDP_API_KEY_SECRET` in Vercel and redeploy. The button falls back to the manual guide, and everything else keeps working.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Button says "How to send BTC from Coinbase" | CDP variables missing in Production, or no redeploy since adding them | Add both variables (section 5) and redeploy |
| Toast: "Coinbase did not start the transfer" (HTTP 502) | Wrong key ID or secret, secret pasted with quotes or extra spaces, or key deleted | Re-paste the values from the key JSON exactly, then redeploy. Check the function logs for the status code Coinbase returned. |
| HTTP 401 or 403 from Coinbase in the logs | Key lacks Onramp access, or the project isn't enabled for Onramp | Finish Onramp onboarding in CDP (section 4) |
| Coinbase page says the domain isn't allowed | Domain missing from the Onramp allowlist | Add the exact origin, for example `https://boro-ruddy.vercel.app` |
| Toast: "Request must come from this app" (403) | Called from another site or a script without a matching `Origin` | Expected. Only the app's own pages can start a session. |
| Toast: "Too many requests" (429) | More than 6 attempts a minute from one IP | Wait a minute |
| Nothing opens after clicking | Browser blocked the pop-up | Allow pop-ups for the site. If the window can't open, the app navigates the same tab instead. |
| Transfer finished but cbBTC not visible | Sent on Ethereum instead of Base, or still confirming | Check Coinbase's activity page and Basescan. The Your BTC card lists Ethereum balances too. |
| Build fails on Vercel | Uncommitted files or a lockfile mismatch | Run `npm run build` locally, commit `package-lock.json`, and push again |

---

## 12. Gmail SMTP loan alerts

The Loans page lets a connected wallet subscribe to email alerts. The wallet signs an EIP-191 message, then the owner confirms the address by opening a link in their inbox. Nothing is sent until that second step.

Cadence:

- Immediate, with a cooldown: health factor, liquidation distance, borrow-APR spike, refinance savings
- Weekly digest (Monday morning in the subscriber's timezone), skipped when estimated weekly interest is under $1
- Monthly statement on the 1st
- Optional dollar-threshold interest notice

1. Turn on 2-Step Verification on the Google account.
2. Open [Google Account → App passwords](https://myaccount.google.com/apppasswords) and create a Mail app password.
3. Add these Production (and local) variables:

   ```bash
   GMAIL_USER=you@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ALERT_FROM_EMAIL=you@gmail.com
   ALERT_SIGNING_SECRET=long-random-string
   NEXT_PUBLIC_APP_URL=https://boro-ruddy.vercel.app
   CRON_SECRET=long-random-string
   UPSTASH_REDIS_REST_URL=https://….upstash.io
   UPSTASH_REDIS_REST_TOKEN=…
   ```

4. Get the Redis REST URL and token from Upstash (free tier is enough):
   1. Open [console.upstash.com](https://console.upstash.com) and sign in with GitHub or email.
   2. Click **Create Database** → **Redis**.
   3. Name it `boro-alerts`. Region: **Washington, D.C. (iad)** or another US East region close to Vercel.
   4. Keep the free/pay-as-you-go plan. TLS stays on. Create.
   5. On the database page, open the **REST API** / **Details** card.
   6. Copy **UPSTASH_REDIS_REST_URL** (`https://….upstash.io`) and **UPSTASH_REDIS_REST_TOKEN**.
   7. Paste those into `.env.local` and into Vercel → Settings → Environment Variables (Production).
   Without Redis, confirmations and subscribers disappear when a serverless instance recycles. Locally, an in-memory store is used if these two variables are missing.
5. `vercel.json` already schedules `GET /api/alerts/check` daily at 13:00 UTC (about 9am Eastern). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.
6. Dry-run without sending mail:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" "https://boro-ruddy.vercel.app/api/alerts/check?dry=1"
   ```

Without `GMAIL_USER` and `GMAIL_APP_PASSWORD`, the Loans page shows that alerts are not configured and the subscribe button stays off.

---

## 13. Local development with the key

```bash
# C:\CryptoApps\boro\.env.local   (ignored by git through .env* in .gitignore)
CDP_API_KEY_ID=your-dev-key-id
CDP_API_KEY_SECRET=your-dev-key-private-key
# NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
# NEXT_PUBLIC_ALCHEMY_KEY=...
# GMAIL_USER=you@gmail.com
# GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
# ALERT_SIGNING_SECRET=dev-only-secret
# NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Restart `npm run dev` after editing. Locally the Onramp route sends Coinbase the documentation placeholder IP `192.0.2.1`, because there's no real client IP. That only happens outside production.
