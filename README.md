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
| Payments | Manual crypto payment verification (USDT/BNB) |

---

## Required Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only, bypasses RLS) |
| `GMAIL_USER` | Your Gmail address (e.g. `you@gmail.com`) |
| `GMAIL_APP_PASSWORD` | 16-character [Google App Password](https://myaccount.google.com/apppasswords) (not your Gmail password) |
| `APP_URL` | Your production URL (e.g. `https://vornix-sooty.vercel.app`) |
| `EMAIL_FROM` | Sender name/email shown in emails (e.g. `VORNIX <noreply@vornix.com>`) |
| `ADMIN_EMAIL` | Admin notification email address |
| `WALLET_USDT_BEP20` | Your USDT BEP20 wallet address (Binance Smart Chain) |
| `WALLET_USDT_TRC20` | Your USDT TRC20 wallet address (TRON) |

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
