-- ================================================================
-- VORNIX — Auth Hardening Migration
-- Run this once in Supabase SQL Editor (Dashboard → SQL Editor).
--
-- Changes:
--   • otp_codes: add otp_hash, attempts, last_sent_at; drop plaintext otp
--   • otp_codes: ensure email unique constraint for upsert onConflict
--   • sessions:  add index on token for fast O(1) lookups
-- ================================================================

-- 1. otp_codes ── add new columns (skip if they already exist) ----

ALTER TABLE otp_codes
  ADD COLUMN IF NOT EXISTS otp_hash    TEXT,
  ADD COLUMN IF NOT EXISTS attempts    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

-- 2. Drop old plaintext otp column if it exists -------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'otp_codes' AND column_name = 'otp'
  ) THEN
    ALTER TABLE otp_codes DROP COLUMN otp;
  END IF;
END;
$$;

-- 3. Ensure email unique constraint for upsert onConflict ---------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'otp_codes_email_key' AND conrelid = 'otp_codes'::regclass
  ) THEN
    ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_email_key UNIQUE (email);
  END IF;
END;
$$;

-- 4. sessions ── index on token for fast lookups ------------------
CREATE INDEX IF NOT EXISTS idx_sessions_token
  ON sessions (token);

-- 5. sessions ── index on expires_at for expired-session cleanup --
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions (expires_at);

-- ================================================================
-- (Optional) If you need to create these tables from scratch,
-- uncomment and run the blocks below.
-- ================================================================

/*
CREATE TABLE IF NOT EXISTS otp_codes (
  email        TEXT NOT NULL UNIQUE,
  otp_hash     TEXT,
  name         TEXT,
  country      TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email       TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_token      ON sessions (token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT,
  country       TEXT,
  affiliate_code TEXT,
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  total_earned  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
*/
