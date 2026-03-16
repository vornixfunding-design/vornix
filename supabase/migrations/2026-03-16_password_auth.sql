-- ================================================================
-- VORNIX — Password Authentication Migration
-- Run this once in Supabase SQL Editor (Dashboard → SQL Editor).
--
-- Changes:
--   • profiles: add password_hash, password_set_at
--   • login_attempts: new table for brute-force protection
-- ================================================================

-- 1. profiles ── add password columns --------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash    TEXT,
  ADD COLUMN IF NOT EXISTS password_set_at  TIMESTAMPTZ;

-- 2. login_attempts ── track failed password login attempts ----
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,
  ip_address   TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email
  ON public.login_attempts (email, attempted_at);

-- 3. otp_codes ── add purpose column for password_reset OTPs ---
--    Nullable so existing rows and send-otp upserts that don't set it work fine
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS purpose TEXT;
