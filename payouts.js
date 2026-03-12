// ================================================================
// VORNIX — api/payouts.js
// GET  /api/payouts                 → user's payout history
// POST /api/payouts                 → request a payout
// PUT  /api/payouts?action=approve  → admin: approve payout
// PUT  /api/payouts?action=paid     → admin: mark as paid
// PUT  /api/payouts?action=reject   → admin: reject payout
// ================================================================

const { supabase, supabaseAdmin, PROFIT_SPLIT, cors, ok, err } = require('../lib/db');
const { sendEmail } = require('../lib/emails');

async function getUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user;
}

async function isAdmin(userId) {
  const { data } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', userId).single();
  return data?.is_admin === true;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUser(req);
  if (!user) return err(res, 'Unauthorized', 401);

  // ── GET — user payout history ──────────────────────────────────
  if (req.method === 'GET') {
    const admin = await isAdmin(user.id);

    if (admin && req.query.all === 'true') {
      // Admin: all pending payouts
      let q = supabaseAdmin
        .from('payouts')
        .select('*, profiles(email, full_name, country), challenges(plan, account_size)')
        .order('requested_at', { ascending: false });
      if (req.query.status) q = q.eq('status', req.query.status);
      const { data, error } = await q;
      if (error) return err(res, error.message);
      return ok(res, data);
    }

    // User: their own payouts
    const { data, error } = await supabase
      .from('payouts')
      .select('*, challenges(plan, account_size)')
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false });
    if (error) return err(res, error.message);
    return ok(res, data);
  }

  // ── POST — request payout ──────────────────────────────────────
  if (req.method === 'POST') {
    const { challengeId, amount, method, walletAddress, bankDetails } = req.body || {};
    if (!challengeId || !amount || !method) return err(res, 'challengeId, amount and method required');
    if (!['crypto','wise','bank'].includes(method)) return err(res, 'method must be crypto, wise or bank');
    if (amount < 10) return err(res, 'Minimum payout is $10');

    // Verify challenge belongs to user and is funded
    const { data: challenge } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .eq('user_id', user.id)
      .single();

    if (!challenge) return err(res, 'Challenge not found', 404);
    if (challenge.status !== 'funded') return err(res, 'Account must be funded to request payout');

    const split    = PROFIT_SPLIT[challenge.plan];
    const share    = amount * (split / 100);
    const deduct   = Math.min(challenge.partial_balance || 0, share);

    const { data: payout, error } = await supabase
      .from('payouts')
      .insert({
        challenge_id:     challengeId,
        user_id:          user.id,
        amount_requested: amount,
        profit_split_pct: split,
        trader_share:     share,
        partial_deduct:   deduct,
        method,
        wallet_address:   ['crypto','wise'].includes(method) ? walletAddress : null,
        bank_details:     method === 'bank' ? bankDetails : null,
      })
      .select()
      .single();

    if (error) return err(res, error.message);

    // Send confirmation email
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('email, full_name').eq('id', user.id).single();

    if (profile) {
      sendEmail('payoutRequested', profile.email, {
        name: profile.full_name, amount, method,
        traderShare: share.toFixed(2),
        partialDeduct: deduct > 0 ? deduct.toFixed(2) : 0,
      }).catch(e => console.error('Payout email failed:', e));
    }

    return ok(res, payout, 201);
  }

  // ── PUT — admin actions ────────────────────────────────────────
  if (req.method === 'PUT') {
    if (!await isAdmin(user.id)) return err(res, 'Admin required', 403);

    const action   = req.query.action;
    const payoutId = req.body?.payoutId || req.query.payoutId;
    if (!payoutId) return err(res, 'payoutId required');

    // Get payout + profile for email
    const { data: payout } = await supabaseAdmin
      .from('payouts')
      .select('*, profiles(email, full_name)')
      .eq('id', payoutId)
      .single();
    if (!payout) return err(res, 'Payout not found', 404);

    if (action === 'approve') {
      const { data, error } = await supabaseAdmin
        .from('payouts')
        .update({ status: 'approved', admin_note: req.body?.note || '', approved_at: new Date().toISOString() })
        .eq('id', payoutId).select().single();
      if (error) return err(res, error.message);
      return ok(res, data);
    }

    if (action === 'paid') {
      const { txRef } = req.body || {};

      // Deduct partial balance if applicable
      if (payout.partial_deduct > 0) {
        await supabaseAdmin
          .from('challenges')
          .update({ partial_balance: 0 })
          .eq('id', payout.challenge_id);
      }

      // Update total_earned on profile
      await supabaseAdmin.rpc('increment_earned', {
        user_id_input: payout.user_id,
        amount_input:  payout.trader_share - payout.partial_deduct,
      });

      const { data, error } = await supabaseAdmin
        .from('payouts')
        .update({ status: 'paid', tx_reference: txRef, paid_at: new Date().toISOString() })
        .eq('id', payoutId).select().single();
      if (error) return err(res, error.message);

      // Email notification
      if (payout.profiles) {
        sendEmail('payoutPaid', payout.profiles.email, {
          name:        payout.profiles.full_name,
          amount:      payout.amount_requested,
          traderShare: (payout.trader_share - payout.partial_deduct).toFixed(2),
          method:      payout.method,
          txRef,
        }).catch(e => console.error('Payout paid email failed:', e));
      }

      return ok(res, data);
    }

    if (action === 'reject') {
      const { reason } = req.body || {};
      const { data, error } = await supabaseAdmin
        .from('payouts')
        .update({ status: 'rejected', admin_note: reason || '' })
        .eq('id', payoutId).select().single();
      if (error) return err(res, error.message);

      if (payout.profiles) {
        sendEmail('payoutRejected', payout.profiles.email, {
          name: payout.profiles.full_name, reason,
        }).catch(e => console.error('Payout reject email failed:', e));
      }

      return ok(res, data);
    }

    return err(res, 'Unknown action');
  }

  return err(res, 'Method not allowed', 405);
};
