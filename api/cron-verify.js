// ================================================================
// VORNIX — api/cron-verify.js
// Vercel Cron endpoint — batch-scans all pending crypto payments
// for incoming USDT (BEP20) deposits to their unique deposit address.
//
// Runs every 1 minute (configured in vercel.json).
// Protected by Authorization: Bearer <CRON_SECRET> header.
//
// GET /api/cron-verify
// ================================================================

const { supabaseAdmin, cors, ok, err } = require('../lib/db');
const { activatePayment, checkDepositByAddress } = require('./crypto-payment');

const BATCH_SIZE = 20;

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);

  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET || '';
  const authHeader = req.headers.authorization || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return err(res, 'Unauthorized', 401);
  }

  // Fetch pending payments that have a deposit_address (AUTO mode)
  const { data: payments, error: fetchErr } = await supabaseAdmin
    .from('payments')
    .select('*, profiles(email, full_name)')
    .eq('gateway', 'crypto')
    .eq('gateway_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) return err(res, fetchErr.message);
  if (!payments?.length) return ok(res, { processed: 0, message: 'No pending payments' });

  const results = [];

  for (const payment of payments) {
    const depositAddress = payment.metadata?.deposit_address;

    if (!depositAddress) {
      results.push({ id: payment.id, status: 'skipped', reason: 'No deposit_address — legacy payment' });
      continue;
    }

    // Already has a challenge — just mark paid (safety fix)
    if (payment.challenge_id) {
      await supabaseAdmin
        .from('payments')
        .update({ gateway_status: 'paid' })
        .eq('id', payment.id);
      results.push({ id: payment.id, status: 'fixed' });
      continue;
    }

    try {
      const result = await checkDepositByAddress(depositAddress, payment.amount);

      if (result.found) {
        const activation = await activatePayment(payment.id, payment, result);
        results.push({
          id:     payment.id,
          status: activation.success ? 'paid' : 'error',
          error:  activation.error,
        });
      } else if (result.pending) {
        // Deposit visible but not yet confirmed — record so status shows "confirming"
        await supabaseAdmin
          .from('payments')
          .update({
            metadata: {
              ...payment.metadata,
              detected_tx_hash: result.txHash,
              confirmations:    result.confirmations,
            },
          })
          .eq('id', payment.id);
        results.push({
          id:            payment.id,
          status:        'confirming',
          reason:        result.reason,
          confirmations: result.confirmations,
        });
      } else {
        results.push({ id: payment.id, status: 'pending', reason: result.reason });
      }
    } catch (e) {
      results.push({ id: payment.id, status: 'error', error: e.message });
    }
  }

  return ok(res, { processed: payments.length, results });
};
