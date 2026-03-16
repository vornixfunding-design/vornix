// ================================================================
// VORNIX — api/leaderboard.js
// GET /api/leaderboard?period=monthly|weekly|alltime  → public
// POST /api/leaderboard?action=refresh                → admin only
// ================================================================

const { supabase, supabaseAdmin, cors, ok, err, requireAdmin } = require('../lib/db');

function periodKey(period) {
  const now = new Date();
  if (period === 'weekly') {
    const week = Math.ceil((now.getDate() - now.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(week).padStart(2,'0')}`;
  }
  if (period === 'monthly') {
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  return 'alltime';
}

function anonymize(n, rank) {
  if (!n) return `Trader #${rank}`;
  const parts = n.trim().split(' ');
  return parts.length > 1
    ? `${parts[0]} ${parts[parts.length-1][0]}.`
    : `${parts[0][0]}. Trader`;
}

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── PUBLIC GET ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const period = ['weekly','monthly','alltime'].includes(req.query.period)
      ? req.query.period : 'monthly';
    const key = req.query.key || periodKey(period);
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const { data, error } = await supabase
      .from('leaderboard_snapshots')
      .select('*')
      .eq('period', period)
      .eq('period_key', key)
      .order('rank', { ascending: true })
      .limit(limit);

    if (error) return err(res, error.message);
    return ok(res, { period, key, entries: data || [] });
  }

  // ── ADMIN REFRESH ──────────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'refresh') {
    const admin = await requireAdmin(req);
    if (!admin) return err(res, 'Admin required', 403);

    const period = req.body?.period || 'monthly';
    const key    = req.body?.key    || periodKey(period);

    // Pull top 100 funded challenges with aggregated stats
    const { data: challenges, error } = await supabaseAdmin
      .from('challenges')
      .select(`
        id, plan, account_size, original_size,
        profiles(id, full_name, country),
        daily_stats(daily_pnl, trades_count, win_trades, loss_trades, stat_date)
      `)
      .eq('status', 'funded')
      .limit(200);

    if (error) return err(res, error.message);

    // Build leaderboard entries
    const entries = challenges.map(c => {
      const stats   = c.daily_stats || [];
      const pnl     = stats.reduce((s,d) => s+(d.daily_pnl||0), 0);
      const trades  = stats.reduce((s,d) => s+(d.trades_count||0), 0);
      const wins    = stats.reduce((s,d) => s+(d.win_trades||0), 0);
      const pct     = c.original_size > 0 ? (pnl / c.original_size * 100) : 0;
      const winRate = trades > 0 ? (wins / trades * 100) : 0;

      return {
        challenge_id: c.id,
        user_id:      c.profiles?.id,
        period,
        period_key:   key,
        profit_pct:   parseFloat(pct.toFixed(3)),
        profit_amount: parseFloat(pnl.toFixed(2)),
        win_rate:     parseFloat(winRate.toFixed(2)),
        trades_count: trades,
        plan:         c.plan,
        account_size: c.account_size,
        country:      c.profiles?.country || null,
        rank:         0,  // set below
        display_name: null,  // set below
      };
    })
    .filter(e => e.profit_pct > 0)
    .sort((a,b) => b.profit_pct - a.profit_pct)
    .slice(0, 100)
    .map((e, i) => {
      const profile = challenges.find(c => c.id === e.challenge_id)?.profiles;
      return {
        ...e,
        rank:         i + 1,
        display_name: anonymize(profile?.full_name, i + 1),
      };
    });

    // Clear old entries for this period/key, insert new ones
    await supabaseAdmin
      .from('leaderboard_snapshots')
      .delete()
      .eq('period', period)
      .eq('period_key', key);

    if (entries.length > 0) {
      await supabaseAdmin.from('leaderboard_snapshots').insert(entries);
    }

    return ok(res, { refreshed: entries.length, period, key });
  }

  return err(res, 'Method not allowed', 405);
};
