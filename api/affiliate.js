// ================================================================
// VORNIX — api/affiliate.js
// GET  /api/affiliate              → user affiliate dashboard
// POST /api/affiliate?action=join  → join affiliate program
// GET  /api/affiliate?action=track&ref=CODE → track click (public)
// GET  /api/affiliate?action=all   → admin: all affiliates
// ================================================================

const { supabase, supabaseAdmin, cors, ok, err, requireUser } = require('../lib/db');

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── PUBLIC: track affiliate click ─────────────────────────────
  if (action === 'track' && req.method === 'GET') {
    const ref = req.query.ref;
    if (!ref) return err(res, 'ref required');

    // Find affiliate by code
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('id').eq('affiliate_code', ref.toUpperCase()).single();
    if (!profile) return err(res, 'Invalid affiliate code', 404);

    const { data: aff } = await supabaseAdmin
      .from('affiliates').select('id, status').eq('user_id', profile.id).single();
    if (!aff || aff.status !== 'active') return err(res, 'Affiliate inactive', 404);

    // Record click (no user_id yet — fills in on conversion)
    await supabaseAdmin.from('affiliate_referrals').insert({ affiliate_id: aff.id });

    return ok(res, { tracked: true });
  }

  const user = await requireUser(req);
  if (!user) return err(res, 'Unauthorized', 401);

  // ── GET affiliate dashboard ────────────────────────────────────
  if (req.method === 'GET' && !action) {
    // Get affiliate record
    const { data: aff } = await supabaseAdmin
      .from('affiliates')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!aff) {
      return ok(res, {
        joined: false,
        affiliate_code: user.affiliate_code,
        affiliate_link: `${process.env.APP_URL}?ref=${user.affiliate_code}`,
      });
    }

    // Get referral history
    const { data: referrals } = await supabaseAdmin
      .from('affiliate_referrals')
      .select('*, challenges(plan, account_size, fee_total)')
      .eq('affiliate_id', aff.id)
      .order('click_at', { ascending: false })
      .limit(50);

    return ok(res, {
      joined: true,
      affiliate_code: user.affiliate_code,
      affiliate_link: `${process.env.APP_URL}?ref=${user.affiliate_code}`,
      stats: {
        total_referrals:   aff.total_referrals,
        total_conversions: aff.total_conversions,
        total_commission:  aff.total_commission,
        unpaid_commission: aff.unpaid_commission,
        paid_commission:   aff.paid_commission,
        commission_pct:    aff.commission_pct,
      },
      referrals: referrals || [],
    });
  }

  // ── POST: join affiliate program ───────────────────────────────
  if (action === 'join' && req.method === 'POST') {
    const { data: existing } = await supabaseAdmin
      .from('affiliates').select('id').eq('user_id', user.id).single();
    if (existing) return err(res, 'Already in affiliate program');

    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .insert({ user_id: user.id, commission_pct: 10 })
      .select().single();

    if (error) return err(res, error.message);
    return ok(res, data, 201);
  }

  // ── GET: admin — all affiliates ────────────────────────────────
  if (action === 'all' && req.method === 'GET') {
    if (!user.is_admin) return err(res, 'Admin required', 403);

    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .select('*, profiles(email, full_name, affiliate_code, country)')
      .order('total_commission', { ascending: false });
    if (error) return err(res, error.message);
    return ok(res, data);
  }

  return err(res, 'Not found', 404);
};
