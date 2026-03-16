// ================================================================
// VORNIX — api/challenges.js
// GET  /api/challenges          → list user's challenges
// GET  /api/challenges?id=UUID  → single challenge
// POST /api/challenges          → create (after payment)
// ================================================================

const { supabase, supabaseAdmin, getPrice, PLAN_PHASES, cors, ok, err, requireUser } = require('../lib/db');

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await requireUser(req);
  if (!user) return err(res, 'Unauthorized', 401);

  // ── GET single or list ────────────────────────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;

    if (id) {
      const { data, error } = await supabase
        .from('challenges')
        .select(`*, phases(*), payouts(id,amount_requested,status,requested_at)`)
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (error) return err(res, error.message, 404);
      return ok(res, data);
    }

    const { data, error } = await supabase
      .from('challenges')
      .select(`*, phases(*)`)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) return err(res, error.message);
    return ok(res, data);
  }

  // ── POST — create challenge ───────────────────────────────────
  if (req.method === 'POST') {
    const { plan, accountSize, paymentId, affiliateCode } = req.body || {};

    if (!plan || !accountSize || !paymentId)
      return err(res, 'plan, accountSize and paymentId required');

    const validPlans = ['one_step','two_step','three_step','partial'];
    if (!validPlans.includes(plan)) return err(res, 'Invalid plan');

    const price = getPrice(plan, accountSize);
    if (!price) return err(res, 'Invalid account size for this plan');

    // Verify payment exists in our payments table
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (!payment) return err(res, 'Payment not found');
    if (payment.challenge_id) return err(res, 'Payment already used');

    // Resolve affiliate
    let affiliateId = null;
    if (affiliateCode) {
      const { data: aff } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('affiliate_code', affiliateCode.toUpperCase())
        .single();
      if (aff && aff.id !== user.id) affiliateId = aff.id;
    }

    // Create challenge (phases auto-created by DB trigger)
    const { data: challenge, error } = await supabaseAdmin
      .from('challenges')
      .insert({
        user_id:        user.id,
        plan,
        account_size:   String(accountSize),
        fee_total:      price,
        fee_paid:       payment.amount,
        is_partial_pay: plan === 'partial',
        partial_balance: plan === 'partial' ? price * 0.65 : 0,
        original_size:  Number(accountSize),
        current_size:   Number(accountSize),
        status:         'active',
        start_date:     new Date().toISOString().split('T')[0],
        affiliate_id:   affiliateId,
        affiliate_commission: affiliateId ? price * 0.10 : 0,
      })
      .select()
      .single();

    if (error) return err(res, error.message);

    // Link payment to challenge
    await supabaseAdmin
      .from('payments')
      .update({ challenge_id: challenge.id })
      .eq('id', paymentId);

    // Track affiliate referral conversion
    if (affiliateId) {
      const { data: affRec } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', affiliateId)
        .single();

      if (affRec) {
        await supabaseAdmin.from('affiliate_referrals').insert({
          affiliate_id:    affRec.id,
          referred_user_id: user.id,
          challenge_id:    challenge.id,
          commission_pct:  10,
          commission_amount: price * 0.10,
          converted_at:    new Date().toISOString(),
        });
      }
    }

    return ok(res, challenge, 201);
  }

  return err(res, 'Method not allowed', 405);
};
