# VORNIX — Prop Firm Platform

A serverless prop firm web application built on **Vercel** (static + serverless functions) + **Supabase** (PostgreSQL).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Static HTML + Vanilla JS |
| API | Vercel Serverless Functions (Node 24.x) |
| Database | Supabase (PostgreSQL) |
| Auth | Custom OTP via Gmail SMTP + httpOnly cookie sessions |
| Email | Gmail SMTP via Nodemailer |
| Payments | Automatic on-chain crypto verification (BEP20 / ERC20 / BNB) |

---

## Required Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables**:

### Core

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only, bypasses RLS) |
| `GMAIL_USER` | Your Gmail address (e.g. `you@gmail.com`) |
| `GMAIL_APP_PASSWORD` | 16-character [Google App Password](https://myaccount.google.com/apppasswords) |
| `APP_URL` | Your production URL (e.g. `https://vornix-sooty.vercel.app`) |
| `EMAIL_FROM` | Sender name/email shown in emails (e.g. `VORNIX <noreply@vornix.com>`) |
| `ADMIN_EMAIL` | Admin notification email address |

### Wallet Addresses

| Variable | Description |
|----------|-------------|
| `WALLET_USDT_BEP20` | USDT wallet address on BNB Smart Chain (BEP20) |
| `WALLET_USDT_ERC20` | USDT wallet address on Ethereum (ERC20) |
| `WALLET_BNB_BEP20` | BNB wallet address on BNB Smart Chain |

All three can share the same EVM address (e.g. `0x90dfac7a3dfd03b578221be706abd1c4f2337229`).

### Blockchain Explorer API Keys (for auto-verification)

| Variable | Description | How to get |
|----------|-------------|------------|
| `BSCSCAN_API_KEY` | BscScan API key — for BEP20 / BNB verification | [bscscan.com/register](https://bscscan.com/register) → API Keys |
| `ETHERSCAN_API_KEY` | Etherscan API key — for ERC20 verification | [etherscan.io/register](https://etherscan.io/register) → API Keys |

Both offer a **free tier** (5 calls/sec, unlimited per day) — no paid plan needed.

### Background Job Secret

| Variable | Description |
|----------|-------------|
| `CRON_SECRET` | Random secret used to authenticate cron requests — set to any long random string |

Generate a suitable value: `openssl rand -hex 32`

---

## Crypto Payment Flow

### Supported Networks
| Network | Symbol | Confirmation threshold |
|---------|--------|----------------------|
| BNB Smart Chain (BEP20) | USDT | 5 blocks (~15 sec) |
| Ethereum (ERC20) | USDT | 12 blocks (~3 min) |
| BNB Smart Chain | BNB | 5 blocks (~15 sec) |

> TRC20 / TRON is **not supported**.

### How auto-verification works
1. User selects plan → account size → payment network
2. `POST /api/crypto-payment?action=initiate` — creates pending payment row, returns wallet address and exact amount
   - For BNB: fetches live BNB/USD price from CoinGecko and returns the expected BNB amount
3. User sends crypto and submits TX hash via `action=submit`
4. Frontend immediately starts polling `action=verify` every 10 seconds (up to 4 minutes)
5. `action=verify`:
   - Calls BscScan or Etherscan `eth_getTransactionReceipt` to get the receipt
   - For USDT: finds ERC-20 `Transfer` log matching the USDT contract and our wallet address; checks amount (6 decimals)
   - For BNB: verifies native transfer to our wallet; checks BNB amount with 5% tolerance
   - Checks confirmation count against the threshold (5 for BSC, 12 for ETH)
   - If valid: marks payment `paid`, creates challenge row, sends activation email
6. Background cron (`/api/cron-verify`, runs every 5 min) re-checks any payments not yet verified

### Idempotency
- Verify is safe to call multiple times — if `challenge_id` is already set, it returns success immediately
- Admin `approve` action is also idempotent

---

## Authentication Flow

### How it works
1. User enters their email → `POST /api/auth?action=send-otp`
   - 6-digit OTP generated and sent via Gmail SMTP
   - OTP stored **hashed** (SHA-256) in `otp_codes` table
   - Resend cooldown: **60 seconds**
2. User enters OTP → `POST /api/auth?action=verify-otp`
   - Max **5 wrong attempts** before OTP is invalidated
   - OTP expires in **10 minutes**
   - On success: session token created (30-day expiry), stored in `sessions` table
3. Session stored as **httpOnly cookie** (`vx_token`)
   - Also sets a JS-readable `vx_session=1` flag cookie so the frontend can check login state
   - Browser automatically sends `vx_token` with every same-origin API request
   - Bearer token (`Authorization: Bearer <token>`) also accepted as fallback (for mobile/API clients)

### Cookie behavior on Vercel
- `vx_token`: `HttpOnly; Secure; SameSite=Strict` — cannot be read by JavaScript (XSS-safe)
- `vx_session`: `Secure; SameSite=Strict` — readable by JS, used only to check "is user logged in?"
- Both cookies expire in 30 days; cleared immediately on logout

### Session validation
All protected API endpoints call `requireUser(req)` from `lib/db.js`. This:
1. Reads the token from `Authorization: Bearer` header OR `vx_token` cookie
2. Looks up the token in the `sessions` table (via service role key)
3. Checks `expires_at`; deletes and rejects expired sessions
4. Returns the full profile row on success, `null` on failure

Admin endpoints use `requireAdmin(req)` which additionally checks `profiles.is_admin = true`.

---

## CORS Policy

Allowed origins (defined in `lib/db.js`):
- `https://vornix-sooty.vercel.app` (production)
- `http://localhost:3000` (local dev)
- `http://localhost:8080` (local dev)

All authenticated endpoints require `credentials: 'include'` on the client side (handled automatically for same-origin browser requests). `Vary: Origin` is set so CDN/proxy caches respect per-origin responses.

---

## Database Schema

Run the migration in **Supabase Dashboard → SQL Editor**:

```
supabase/migrations/2026-03-16_auth_hardening.sql
```

### Key tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles; `is_admin` flag for admin access |
| `otp_codes` | OTP storage (hashed); `attempts`, `last_sent_at` for rate-limiting |
| `sessions` | Active sessions; token + user_id + expires_at |
| `payments` | Crypto payment intents and TX proofs |
| `challenges` | Trader challenges (phases auto-created by DB trigger) |
| `phases` | Individual phase records per challenge |
| `payouts` | Payout requests from traders |
| `affiliates` | Affiliate accounts |
| `affiliate_referrals` | Click/conversion tracking |
| `leaderboard_snapshots` | Cached leaderboard data |
| `daily_stats` | Per-challenge daily trading stats |

---

## Local Development

```bash
# Install dependencies
npm install

# Install Vercel CLI
npm install -g vercel

# Create .env.local with your variables, then:
vercel dev
```

The dev server runs at `http://localhost:3000`.

---

## Deployment

Push to the `main` branch — Vercel auto-deploys. No build step needed (static site + serverless functions).

---

## Security Notes

- OTP codes are **never stored in plaintext** — always SHA-256 hashed before DB insert
- Session tokens are **cryptographically random** (`crypto.randomBytes(32)`)
- The `SUPABASE_SERVICE_ROLE_KEY` is only used server-side and never exposed to the browser
- CORS is restricted to known origins — wildcard `*` is not used for authenticated routes
- `debug` endpoint (`/api/auth?action=debug`) only shows presence of env vars, never values
- Cron endpoint (`/api/cron-verify`) is protected by `CRON_SECRET` — Vercel injects this automatically for cron jobs
