-- ================================================================
-- VORNIX — supabase/migrations/2026-03-17_payment_improvements.sql
--
-- Apply via: Supabase Dashboard → SQL Editor → Paste & Run
--
-- What this migration does:
--   1. Creates a `counters` table for atomic derivation-index allocation
--      (fixes the race condition where two concurrent payment initiations
--       could claim the same HD wallet index / deposit address).
--   2. Creates `claim_derivation_index()` — an atomic stored procedure that
--      increments the counter and returns the previous value.
--   3. Adds dedicated detection-tracking columns to `payments`:
--      detected_tx_hash, detected_at, confirmed_at, explorer_url, confirmations
--   4. Adds a partial index for faster cron scanning of active payments.
-- ================================================================

-- ── 1. Atomic derivation-index counter ──────────────────────────
-- Prevents concurrent payment initiations from allocating the same
-- HD wallet derivation index (and therefore the same deposit address).

CREATE TABLE IF NOT EXISTS counters (
  key   TEXT    PRIMARY KEY,
  value BIGINT  NOT NULL DEFAULT 0
);

-- Seed with 0 if not already present.
-- NOTE: After applying this migration, run the following to sync the
-- counter with any payments that were created before this migration:
--
--   UPDATE counters
--   SET    value = (
--     SELECT COALESCE(MAX((metadata->>'derivation_index')::BIGINT), -1) + 1
--     FROM   payments
--     WHERE  gateway = 'crypto'
--       AND  metadata->>'derivation_index' IS NOT NULL
--   )
--   WHERE  key = 'next_derivation_index';
--
INSERT INTO counters (key, value)
VALUES ('next_derivation_index', 0)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Atomic increment stored procedure ────────────────────────
-- Returns the index to USE (value BEFORE increment), then atomically
-- advances the counter.  Concurrent calls are serialised by the row
-- lock on the counters table — each caller gets a unique index.

CREATE OR REPLACE FUNCTION claim_derivation_index()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  idx BIGINT;
BEGIN
  UPDATE counters
  SET    value = value + 1
  WHERE  key   = 'next_derivation_index'
  RETURNING value - 1 INTO idx;

  RETURN idx;
END;
$$;

-- ── 3. Dedicated detection-tracking columns on payments ─────────
-- These replace the ad-hoc metadata JSONB fields that were previously
-- used for deposit tracking, enabling proper indexing and type safety.
-- Code writes to both the columns AND metadata for backward compatibility.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS detected_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS detected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS explorer_url     TEXT,
  ADD COLUMN IF NOT EXISTS confirmations    INTEGER;

-- ── 4. Partial index for faster cron scanning ───────────────────
-- Only indexes the rows that the cron job actively polls.

CREATE INDEX IF NOT EXISTS idx_payments_cron_scan
  ON payments (gateway, created_at)
  WHERE gateway = 'crypto' AND gateway_status IN ('pending', 'confirming');
