// ================================================================
// VORNIX — api/cron-verify.js
// Vercel Cron endpoint — batch-scans pending + confirming crypto
// payments for incoming USDT (BEP20) deposits.
//
// Runs every 1 minute (configured in vercel.json).
//
// Auth:
//   Authorization: Bearer <CRON_SECRET>   (Vercel injects automatically)
//   ?secret=<CRON_SECRET>                 (for manual debug invocation)
//
// GET /api/cron-verify
// ================================================================

const { supabaseAdmin, cors, ok, err }   = require('../lib/db');
const { checkDepositByAddress }          = require('../lib/payments/bscscan');
const { activatePayment, markConfirming } = require('../lib/payments/autoUsdtBsc');

const BATCH_SIZE = 20;

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);

  // Verify cron secret — accept Bearer header OR ?secret= query param
  const cronSecret  = process.env.CRON_SECRET || '';
  const authHeader  = req.headers.authorization || '';
  const querySecret = req.query.secret || '';

  const isAuthorized =
    cronSecret &&
    (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret);

  if (!isAuthorized) {
    return err(res, 'Unauthorized', 401);
  }

  // Fetch pending AND confirming payments that have a deposit_address (AUTO mode)
  const { data: payments, error: fetchErr } = await supabaseAdmin
    .from('payments')
    .select('*, profiles(email, full_name)')
    .eq('gateway', 'crypto')
    .in('gateway_status', ['pending', 'confirming'])
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

    // Already has a challenge — just mark paid (safety fix for orphaned records)
    if (payment.challenge_id) {
      await supabaseAdmin
        .from('payments')
        .update({ gateway_status: 'paid' })
        .eq('id', payment.id);
      results.push({ id: payment.id, status: 'fixed' });
      continue;
    }

    try {
      const result = await checkDepositByAddress(
        depositAddress,
        payment.amount,
        payment.created_at,
      );

      if (result.found) {
        const activation = await activatePayment(payment.id, payment, result);
        results.push({
          id:     payment.id,
          status: activation.success ? 'paid' : 'error',
          error:  activation.error,
        });
      } else if (result.pending) {
        await markConfirming(payment.id, payment, result);
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
