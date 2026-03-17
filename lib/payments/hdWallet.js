// ================================================================
// VORNIX — lib/payments/hdWallet.js
// HD wallet derivation for unique BSC deposit addresses.
// Uses an atomic DB counter to prevent concurrent-request races.
// ================================================================

const { ethers }       = require('ethers');
const { supabaseAdmin } = require('../db');

/**
 * Derive a checksummed BSC/EVM address from the server-side mnemonic + index.
 * @param {number} index  BIP32 child index
 * @returns {string}      0x-prefixed checksummed address
 */
function deriveDepositAddress(index) {
  const phrase   = process.env.PAYMENTS_MNEMONIC;
  const basePath = process.env.PAYMENTS_DERIVATION_PATH || "m/44'/60'/0'/0";

  if (!phrase) throw new Error('PAYMENTS_MNEMONIC is not set');

  const mnemonic = ethers.Mnemonic.fromPhrase(phrase);
  const wallet   = ethers.HDNodeWallet.fromMnemonic(mnemonic, `${basePath}/${index}`);
  return wallet.address; // checksummed 0x address
}

/**
 * Atomically claim the next derivation index from the DB counter.
 * Safe under concurrent requests — no two calls will return the same index.
 *
 * Requires the `claim_derivation_index()` SQL function and `counters` table
 * (see supabase/migrations/2026-03-17_payment_improvements.sql).
 *
 * Falls back to a non-atomic MAX query if the RPC function is unavailable
 * (e.g. migration not yet applied), with a console warning.
 *
 * @returns {Promise<number>}
 */
async function atomicNextDerivationIndex() {
  // Try the atomic RPC function first
  const { data, error } = await supabaseAdmin.rpc('claim_derivation_index');

  if (!error && typeof data === 'number') {
    return data;
  }

  if (error) {
    console.warn(
      '[hdWallet] claim_derivation_index RPC failed — falling back to MAX scan ' +
      '(apply 2026-03-17_payment_improvements.sql to fix):',
      error.message,
    );
  }

  // Fallback: non-atomic MAX scan (safe for single-instance dev; risky under concurrency)
  const { data: rows } = await supabaseAdmin
    .from('payments')
    .select('metadata')
    .eq('gateway', 'crypto')
    .not('metadata->derivation_index', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (rows?.length) {
    const idx = rows[0]?.metadata?.derivation_index;
    return typeof idx === 'number' ? idx + 1 : 0;
  }
  return 0;
}

module.exports = { deriveDepositAddress, atomicNextDerivationIndex };
