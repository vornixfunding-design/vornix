// ================================================================
// VORNIX — api/admin.js
// All admin endpoints in one file
// Every route requires is_admin = true on the user's profile
//
// GET  /api/admin?action=stats        → dashboard stats
// GET  /api/admin?action=traders      → all traders paginated
// GET  /api/admin?action=challenges   → all active challenges
// PUT  /api/admin?action=activate     → assign MT credentials
// PUT  /api/admin?action=phase        → advance to next phase / fund
// PUT  /api/admin?action=fail         → fail a challenge
// PUT  /api/admin?action=suspend      → suspend account
// GET  /api/admin?action=payouts      → all pending payouts
// POST /api/admin?action=stats-upsert → add daily stats for a challenge
// ================================================================

const { supabase, supabaseAdmin, cors, ok, err, requireAdmin } = require('../lib/db');
const { sendEmail } = require('../lib/emails');

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req);
  if (!admin) return err(res, 'Admin access required', 403);

  const action = req.query.action;
  const body   = req.body || {};

  try {

    // ── DASHBOARD STATS ────────────────────────────────────────
    if (action === 'stats' && req.method === 'GET') {
      const [traders, allChallenges, payouts, revenue] = await Promise.all([
        supabaseAdmin.from('profiles').select('id', { count:'exact', head:true }).eq('is_admin', false),
        supabaseAdmin.from('challenges').select('status'),
        supabaseAdmin.from('payouts').select('status, trader_share'),
        supabaseAdmin.from('payments').select('amount').eq('gateway_status', 'paid'),
      ]);

      const byStatus = {};
      allChallenges.data?.forEach(c => { byStatus[c.status] = (byStatus[c.status]||0)+1; });

      const totalRevenue  = revenue.data?.reduce((s,p) => s+p.amount, 0) || 0;
      const totalPaidOut  = payouts.data?.filter(p=>p.status==='paid').reduce((s,p) => s+(p.trader_share||0), 0) || 0;
      const pendingPayouts= payouts.data?.filter(p=>p.status==='pending').length || 0;

      return ok(res, {
        totalTraders:    traders.count || 0,
        activeChallenges:(byStatus.active||0)+(byStatus.funded||0),
        fundedAccounts:  byStatus.funded||0,
        passedChallenges:byStatus.passed||0,
        failedChallenges:byStatus.failed||0,
        pendingChallenges:byStatus.pending_payment||0,
        totalRevenue,
        totalPaidOut,
        pendingPayouts,
        profit: totalRevenue - totalPaidOut,
        byStatus,
      });
    }

    // ── ALL TRADERS ─────────────────────────────────────────────
    if (action === 'traders' && req.method === 'GET') {
      const page  = Math.max(Number(req.query.page)||1, 1);
      const limit = Math.min(Number(req.query.limit)||50, 100);
      const from  = (page-1)*limit;
      const search= req.query.search || '';

      let q = supabaseAdmin
        .from('v_trader_summary')
        .select('*', { count:'exact' })
        .range(from, from+limit-1)
        .order('last_challenge_date', { ascending:false });

      if (search) q = q.ilike('email', `%${search}%`);

      const { data, error, count } = await q;
      if (error) return err(res, error.message);
      return ok(res, { traders: data, total: count, page, limit });
    }

    // ── ALL CHALLENGES ──────────────────────────────────────────
    if (action === 'challenges' && req.method === 'GET') {
      const status = req.query.status || null;
      const page   = Math.max(Number(req.query.page)||1, 1);
      const limit  = Math.min(Number(req.query.limit)||50, 100);
      const from   = (page-1)*limit;

      let q = supabaseAdmin
        .from('v_active_challenges')
        .select('*', { count:'exact' })
        .range(from, from+limit-1)
        .order('created_at', { ascending:false });

      if (status) q = q.eq('status', status);

      const { data, error, count } = await q;
      if (error) return err(res, error.message);
      return ok(res, { challenges: data, total: count, page, limit });
    }

    // ── ACTIVATE — assign MT credentials ───────────────────────
    if (action === 'activate' && req.method === 'PUT') {
      const { challengeId, mtLogin, mtPassword, mtServer, platform } = body;
      if (!challengeId || !mtLogin || !mtPassword || !mtServer)
        return err(res, 'challengeId, mtLogin, mtPassword and mtServer required');

      const { data, error } = await supabaseAdmin
        .from('challenges')
        .update({
          status:      'active',
          mt_login:    mtLogin,
          mt_password: mtPassword,
          mt_server:   mtServer,
          platform:    platform || 'MT5',
          start_date:  new Date().toISOString().split('T')[0],
        })
        .eq('id', challengeId)
        .select('*, profiles(email, full_name)')
        .single();

      if (error) return err(res, error.message);

      // Send credentials email
      if (data.profiles) {
        const planNames = {
          one_step:'1-Step', two_step:'2-Step', three_step:'3-Step', partial:'Partial Payment'
        };
        sendEmail('challengePurchased', data.profiles.email, {
          name:        data.profiles.full_name,
          plan:        planNames[data.plan],
          accountSize: data.account_size,
          fee:         data.fee_paid,
          mtLogin, mtPassword, mtServer,
        }).catch(e => console.error('Activate email failed:', e));
      }

      return ok(res, data);
    }

    // ── ADVANCE PHASE / FUND ────────────────────────────────────
    if (action === 'phase' && req.method === 'PUT') {
      const { challengeId } = body;
      if (!challengeId) return err(res, 'challengeId required');

      const { data: ch } = await supabaseAdmin
        .from('challenges').select('*, profiles(email, full_name)').eq('id', challengeId).single();
      if (!ch) return err(res, 'Challenge not found', 404);

      const totalPhases = { one_step:1, two_step:2, three_step:3, partial:3 }[ch.plan];
      const planNames   = { one_step:'1-Step', two_step:'2-Step', three_step:'3-Step', partial:'Partial Payment' };
      const profitSplit = { one_step:95, two_step:90, three_step:80, partial:80 };

      // Mark current phase passed
      await supabaseAdmin.from('phases').update({
        status:   'passed',
        end_date: new Date().toISOString().split('T')[0],
      }).eq('challenge_id', challengeId).eq('phase_number', ch.current_phase);

      let data, error;

      if (ch.current_phase >= totalPhases) {
        // Fund the account
        ({ data, error } = await supabaseAdmin
          .from('challenges')
          .update({
            status:      'funded',
            funded_date: new Date().toISOString().split('T')[0],
          })
          .eq('id', challengeId).select().single());

        if (!error && ch.profiles) {
          sendEmail('challengePassed', ch.profiles.email, {
            name: ch.profiles.full_name,
            plan: planNames[ch.plan],
            accountSize: ch.account_size,
          }).catch(e => console.error('Phase email failed:', e));
        }
      } else {
        // Advance to next phase
        const nextPhase = ch.current_phase + 1;
        ({ data, error } = await supabaseAdmin
          .from('challenges')
          .update({ current_phase: nextPhase })
          .eq('id', challengeId).select().single());

        // Get next phase target
        const { data: nextPhaseData } = await supabaseAdmin
          .from('phases')
          .select('profit_target')
          .eq('challenge_id', challengeId)
          .eq('phase_number', nextPhase)
          .single();

        // Activate next phase
        await supabaseAdmin.from('phases').update({
          status:     'active',
          start_date: new Date().toISOString().split('T')[0],
        }).eq('challenge_id', challengeId).eq('phase_number', nextPhase);

        if (!error && ch.profiles) {
          sendEmail('phasePassed', ch.profiles.email, {
            name:        ch.profiles.full_name,
            phaseNumber: ch.current_phase,
            plan:        planNames[ch.plan],
            nextTarget:  nextPhaseData?.profit_target || '—',
          }).catch(e => console.error('Phase email failed:', e));
        }
      }

      if (error) return err(res, error.message);
      return ok(res, data);
    }

    // ── FAIL CHALLENGE ──────────────────────────────────────────
    if (action === 'fail' && req.method === 'PUT') {
      const { challengeId, reason } = body;
      if (!challengeId) return err(res, 'challengeId required');

      const { data, error } = await supabaseAdmin
        .from('challenges')
        .update({ status: 'failed' })
        .eq('id', challengeId).select().single();

      if (error) return err(res, error.message);

      // Mark current phase as failed
      await supabaseAdmin.from('phases').update({
        status:       'failed',
        breach_reason: reason,
        end_date:     new Date().toISOString().split('T')[0],
      }).eq('challenge_id', challengeId).eq('phase_number', data.current_phase);

      return ok(res, data);
    }

    // ── SUSPEND ACCOUNT ────────────────────────────────────────
    if (action === 'suspend' && req.method === 'PUT') {
      const { challengeId } = body;
      if (!challengeId) return err(res, 'challengeId required');

      const { data, error } = await supabaseAdmin
        .from('challenges')
        .update({ status: 'suspended' })
        .eq('id', challengeId).select().single();

      if (error) return err(res, error.message);
      return ok(res, data);
    }

    // ── UPSERT DAILY STATS (from MT bridge or manual) ──────────
    if (action === 'stats-upsert' && req.method === 'POST') {
      const { challengeId, date, stats } = body;
      if (!challengeId || !date || !stats) return err(res, 'challengeId, date and stats required');

      const { data, error } = await supabaseAdmin
        .from('daily_stats')
        .upsert({ challenge_id: challengeId, stat_date: date, ...stats })
        .select().single();

      if (error) return err(res, error.message);
      return ok(res, data);
    }

    // ── SET ADMIN FLAG ─────────────────────────────────────────
    if (action === 'set-admin' && req.method === 'PUT') {
      const { userId, isAdmin } = body;
      if (!userId) return err(res, 'userId required');

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ is_admin: Boolean(isAdmin) })
        .eq('id', userId).select().single();

      if (error) return err(res, error.message);
      return ok(res, data);
    }

    // ── OVERVIEW METRICS ────────────────────────────────────────
    if (action === 'overview' && req.method === 'GET') {
      const period = req.query.period || 'all'; // day | week | month | all
      let since = null;
      if (period === 'day')   since = new Date(Date.now() -      86400000).toISOString();
      else if (period === 'week')  since = new Date(Date.now() -  7*86400000).toISOString();
      else if (period === 'month') since = new Date(Date.now() - 30*86400000).toISOString();

      const [traders, allChallenges, payouts, payments, newUsersRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('id', { count:'exact', head:true }).eq('is_admin', false),
        supabaseAdmin.from('challenges').select('status, created_at'),
        supabaseAdmin.from('payouts').select('status, trader_share, created_at'),
        supabaseAdmin.from('payments').select('amount, created_at').eq('gateway_status', 'paid'),
        since
          ? supabaseAdmin.from('profiles').select('id', { count:'exact', head:true }).eq('is_admin', false).gte('created_at', since)
          : Promise.resolve({ count: null }),
      ]);

      const byStatus = {};
      allChallenges.data?.forEach(c => { byStatus[c.status] = (byStatus[c.status]||0)+1; });

      const paidPayments = since
        ? (payments.data || []).filter(p => p.created_at >= since)
        : (payments.data || []);

      const totalRevenue          = payments.data?.reduce((s,p) => s + (p.amount||0), 0) || 0;
      const periodRevenue         = paidPayments.reduce((s,p) => s + (p.amount||0), 0);
      const payoutsRequested      = payouts.data?.filter(p=>p.status==='pending') || [];
      const payoutsPaid           = payouts.data?.filter(p=>p.status==='paid') || [];

      return ok(res, {
        period,
        totalSales:              payments.data?.length || 0,
        periodSales:             paidPayments.length,
        revenue:                 totalRevenue,
        periodRevenue,
        newUsers:                since ? (newUsersRes.count || 0) : (traders.count || 0),
        totalTraders:            traders.count || 0,
        activeChallenges:        byStatus.active || 0,
        fundedChallenges:        byStatus.funded || 0,
        payoutsRequestedCount:   payoutsRequested.length,
        payoutsRequestedAmount:  payoutsRequested.reduce((s,p)=>s+(p.trader_share||0),0),
        payoutsPaidCount:        payoutsPaid.length,
        payoutsPaidAmount:       payoutsPaid.reduce((s,p)=>s+(p.trader_share||0),0),
        byStatus,
      });
    }

    // ── PAYMENTS LIST ────────────────────────────────────────────
    if (action === 'payments' && req.method === 'GET') {
      const page   = Math.max(Number(req.query.page)||1, 1);
      const limit  = Math.min(Number(req.query.limit)||50, 100);
      const offset = (page-1)*limit;
      const status = req.query.status || null;
      const dateFrom = req.query.from  || null;
      const dateTo   = req.query.to    || null;
      const search   = (req.query.search || '').trim();

      let userIdFilter = null;
      if (search) {
        // Resolve matching profile IDs at the DB level before paginating
        const { data: matchProfiles } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
        userIdFilter = (matchProfiles || []).map(p => p.id);
        if (!userIdFilter.length) {
          return ok(res, { payments: [], total: 0, page, limit });
        }
      }

      let q = supabaseAdmin
        .from('payments')
        .select(`
          id, created_at, gateway_status, amount, currency, network,
          deposit_address, tx_hash, user_id,
          challenges!challenge_id ( id, plan, account_size, status,
            profiles!user_id ( id, email, full_name ) )
        `, { count: 'exact' })
        .range(offset, offset+limit-1)
        .order('created_at', { ascending: false });

      if (status)       q = q.eq('gateway_status', status);
      if (dateFrom)     q = q.gte('created_at', dateFrom);
      if (dateTo)       q = q.lte('created_at', dateTo);
      if (userIdFilter) q = q.in('user_id', userIdFilter);

      const { data, error, count } = await q;
      if (error) {
        console.error('[admin] payments query error:', error.message, error);
        return err(res, error.message);
      }

      return ok(res, { payments: data || [], total: count || 0, page, limit });
    }

    return err(res, `Unknown admin action: ${action}`, 404);

  } catch(e) {
    console.error('[admin]', e);
    return err(res, 'Server error', 500);
  }
};
