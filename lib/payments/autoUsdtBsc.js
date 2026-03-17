// ================================================================
// VORNIX — lib/payments/autoUsdtBsc.js
// Payment activation + status helpers for AUTO BSC USDT payments.
//
// activatePayment  — marks payment paid, creates challenge, sends email
// markConfirming   — marks deposit detected but not yet confirmed
//
// Both functions are idempotent and safe to call multiple times for
// the same payment.
// ================================================================

const { supabaseAdmin } = require('../db');
const { sendEmail }     = require('../emails');

const PLAN_NAMES = {
  one_step:   '1-Step',
  two_step:   '2-Step',
  three_step: '3-Step',
  partial:    'Partial Payment',
};

/**
 * Mark a payment as paid, create the corresponding challenge, and send
 * the activation email.  Idempotent: if challenge_id is already set the
 * function returns immediately without creating a duplicate.
 *
 * @param {string}      paymentId       Payment row ID
 * @param {object}      payment         Full payment row (with .profiles join)
 * @param {object|null} depositDetails  Result from checkDepositByAddress (found=true), or null
 *
 * @returns {Promise<{success, challenge, alreadyActivated, error}>}
 */
async function activatePayment(paymentId, payment, depositDetails) {
  // Idempotency guard
  if (payment.challenge_id) {
    return { success: true, challenge: { id: payment.challenge_id }, alreadyActivated: true };
  }

  const meta = payment.metadata || {};
  const plan  = meta.plan;
  const size  = meta.account_size;
  const total = meta.fee_total;
  const now   = new Date().toISOString();

  // Build the payments update — write to both metadata (for legacy reads) and
  // dedicated columns added in 2026-03-17_payment_improvements.sql.
  const paymentUpdate = {
    gateway_status: 'paid',
    confirmed_at:   now,
    metadata: {
      ...meta,
      ...(depositDetails && {
        tx_hash:      depositDetails.txHash,
        block_number: depositDetails.blockNumber,
        from_address: depositDetails.from,
        token_symbol: depositDetails.symbol,
        confirmed_at: now,
        explorer_url: depositDetails.explorerUrl,
        confirmations: depositDetails.confirmations,
      }),
    },
  };

  if (depositDetails) {
    paymentUpdate.detected_tx_hash = depositDetails.txHash || payment.detected_tx_hash || null;
    paymentUpdate.explorer_url     = depositDetails.explorerUrl || null;
    paymentUpdate.confirmations    = depositDetails.confirmations || null;
    // Preserve detected_at if it was set during the confirming stage
    if (!payment.detected_at) {
      paymentUpdate.detected_at = now;
    }
  }

  await supabaseAdmin
    .from('payments')
    .update(paymentUpdate)
    .eq('id', paymentId);

  const { data: challenge, error } = await supabaseAdmin
    .from('challenges')
    .insert({
      user_id:         payment.user_id,
      plan,
      account_size:    size,
      fee_total:       total,
      fee_paid:        payment.amount,
      is_partial_pay:  payment.is_partial,
      partial_balance: payment.is_partial ? total * 0.65 : 0,
      original_size:   Number(size),
      current_size:    Number(size),
      status:          'active',
      start_date:      new Date().toISOString().split('T')[0],
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await supabaseAdmin
    .from('payments')
    .update({ challenge_id: challenge.id })
    .eq('id', paymentId);

  const profile = payment.profiles;
  if (profile) {
    sendEmail('challengePurchased', profile.email, {
      name:        profile.full_name,
      plan:        PLAN_NAMES[plan] || plan,
      accountSize: size,
      fee:         payment.amount,
      mtLogin:     null,
      mtPassword:  null,
      mtServer:    null,
    }).catch(e => console.error('[autoUsdtBsc] Activation email failed:', e));
  }

  return { success: true, challenge };
}

/**
 * Mark a payment as "confirming" — deposit detected on-chain but not yet
 * at the required confirmation threshold.
 *
 * Writes to both dedicated columns and metadata for compatibility.
 *
 * @param {string} paymentId
 * @param {object} payment    Full payment row
 * @param {object} result     checkDepositByAddress result (pending=true)
 */
async function markConfirming(paymentId, payment, result) {
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('payments')
    .update({
      gateway_status:  'confirming',
      detected_tx_hash: result.txHash,
      // Preserve the original detected_at timestamp if already set
      detected_at:     payment.detected_at || now,
      confirmations:   result.confirmations,
      explorer_url:    'https://bscscan.com/tx/' + result.txHash,
      metadata: {
        ...payment.metadata,
        detected_tx_hash: result.txHash,
        confirmations:    result.confirmations,
      },
    })
    .eq('id', paymentId);
}

module.exports = { activatePayment, markConfirming };
