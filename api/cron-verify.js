// ================================================================
// VORNIX — api/cron-verify.js
// Vercel Cron endpoint — batch-verifies all submitted crypto payments.
//
// Called by Vercel Cron every 5 minutes (configured in vercel.json).
// Guarded by CRON_SECRET environment variable (Vercel injects an
// Authorization: Bearer <CRON_SECRET> header on each cron request).
//
// GET /api/cron-verify
// ================================================================

const { supabaseAdmin, cors, ok, err } = require('../lib/db');
const { verifyOnChain, activatePayment, NETWORKS } = require('./crypto-payment');

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

  const { data: payments, error: fetchErr } = await supabaseAdmin
    .from('payments')
    .select('*, profiles(email, full_name)')
    .eq('gateway', 'crypto')
    .eq('gateway_status', 'submitted')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) return err(res, fetchErr.message);
  if (!payments?.length) return ok(res, { processed: 0, message: 'No submitted payments' });

  const results = [];
  for (const payment of payments) {
    const meta    = payment.metadata || {};
    const network = meta.network;
    const txHash  = meta.tx_hash;

    if (!txHash || !network || !NETWORKS[network]) {
      results.push({ id: payment.id, status: 'skipped', reason: 'Missing tx_hash or network' });
      continue;
    }

    // Already linked to a challenge — just mark paid
    if (payment.challenge_id) {
      await supabaseAdmin.from('payments').update({ gateway_status: 'paid' }).eq('id', payment.id);
      results.push({ id: payment.id, status: 'fixed' });
      continue;
    }

    try {
      const result = await verifyOnChain(network, txHash, payment);
      if (result.valid) {
        const activation = await activatePayment(payment.id, payment, result);
        results.push({ id: payment.id, status: activation.success ? 'paid' : 'error', error: activation.error });
      } else {
        results.push({ id: payment.id, status: 'pending', reason: result.reason, confirmations: result.confirmations });
      }
    } catch (e) {
      results.push({ id: payment.id, status: 'error', error: e.message });
    }
  }

  return ok(res, { processed: payments.length, results });
};
