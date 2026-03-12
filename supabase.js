// ================================================================
// VORNIX — lib/supabase.js
// Complete Supabase client + all API helper functions
//
// HOW TO USE IN YOUR HTML PAGES:
//   Option A (CDN — easiest for your setup):
//     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
//     <script src="supabase.js"></script>
//
//   Option B (in Vercel API routes, Node.js):
//     const { supabase, Auth, Challenges } = require('./lib/supabase');
//
// SETUP:
//   Replace the two values at the top with your real keys from:
//   Supabase → Project Settings → API
// ================================================================

// ── YOUR SUPABASE KEYS ────────────────────────────────────────────
// Get these from: supabase.com → your project → Project Settings → API
const SUPABASE_URL      = 'https://bociajqqwpexnuoemnlx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvY2lhanFxd3BleG51b2Vtbmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDc2MDQsImV4cCI6MjA4ODkyMzYwNH0.3j13j-FWDGIyFZoSIRk7HTB7aipv_gLxaLAoPKm6FS8';

// ── CLIENT INIT ───────────────────────────────────────────────────
// In browser: uses the global supabase from CDN script tag above
// In Node.js: requires @supabase/supabase-js to be installed
let _supabase;

if (typeof window !== 'undefined' && window.supabase) {
  // Browser with CDN
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else if (typeof require !== 'undefined') {
  // Node.js / Vercel serverless
  const { createClient } = require('@supabase/supabase-js');
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const supabase = _supabase;

// ================================================================
// AUTH — Signup, Login, Logout, Session
// ================================================================
const Auth = {

  /**
   * Create a new account
   * @param {string} email
   * @param {string} password
   * @param {string} fullName
   * @returns {{ data, error }}
   */
  async signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    return { data, error };
  },

  /**
   * Sign in with email and password
   * @returns {{ data: { session, user }, error }}
   */
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    // Save token to localStorage for later API calls
    if (data?.session?.access_token) {
      localStorage.setItem('vornix_token', data.session.access_token);
      localStorage.setItem('vornix_user',  JSON.stringify(data.user));
    }
    return { data, error };
  },

  /**
   * Sign out and clear local storage
   */
  async signOut() {
    localStorage.removeItem('vornix_token');
    localStorage.removeItem('vornix_user');
    return supabase.auth.signOut();
  },

  /**
   * Get current logged-in session
   * @returns {Session | null}
   */
  async getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  /**
   * Get current user from Supabase
   */
  async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  /**
   * Get saved token from localStorage (for API calls)
   */
  getToken() {
    return localStorage.getItem('vornix_token');
  },

  /**
   * Send password reset email
   */
  async resetPassword(email) {
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password.html',
    });
  },

  /**
   * Update password (call after clicking reset link)
   */
  async updatePassword(newPassword) {
    return supabase.auth.updateUser({ password: newPassword });
  },

  /**
   * Check if user is logged in
   */
  async isLoggedIn() {
    const session = await this.getSession();
    return !!session;
  },

  /**
   * Listen for auth state changes (login/logout)
   * Usage: Auth.onStateChange((event, session) => { ... })
   */
  onStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  },
};

// ================================================================
// PROFILES — User profile data
// ================================================================
const Profiles = {

  /**
   * Get a user's profile
   * @param {string} userId - UUID from auth
   */
  async get(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    return { data, error };
  },

  /**
   * Update profile fields
   * @param {string} userId
   * @param {object} updates - e.g. { full_name, country, phone }
   */
  async update(userId, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    return { data, error };
  },

  /**
   * Get all traders (admin only — goes via API route)
   */
  async getAll(page = 1) {
    const token = Auth.getToken();
    const res   = await fetch(`/api/admin?action=traders&page=${page}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  },
};

// ================================================================
// CHALLENGES — Evaluation accounts
// ================================================================
const Challenges = {

  /**
   * Get all challenges for the logged-in user
   */
  async getMyAll() {
    const { data, error } = await supabase
      .from('challenges')
      .select('*, phases(*)')
      .order('created_at', { ascending: false });
    return { data, error };
  },

  /**
   * Get a single challenge by ID (with phases and payouts)
   * @param {string} id - challenge UUID
   */
  async getById(id) {
    const { data, error } = await supabase
      .from('challenges')
      .select('*, phases(*), payouts(id, amount_requested, status, requested_at)')
      .eq('id', id)
      .single();
    return { data, error };
  },

  /**
   * Get daily stats for a challenge (last N days)
   * @param {string} challengeId
   * @param {number} days
   */
  async getStats(challengeId, days = 30) {
    const { data, error } = await supabase
      .from('daily_stats')
      .select('*')
      .eq('challenge_id', challengeId)
      .order('stat_date', { ascending: false })
      .limit(days);
    return { data, error };
  },

  /**
   * Start a Stripe checkout for a new challenge
   * Redirects user to Stripe payment page
   *
   * @param {string} plan - 'one_step' | 'two_step' | 'three_step' | 'partial'
   * @param {number} accountSize - e.g. 10000
   * @param {string} affiliateCode - optional referral code
   */
  async startCheckout(plan, accountSize, affiliateCode = '') {
    const token = Auth.getToken();
    if (!token) {
      alert('Please log in first.');
      window.location.href = '/login.html';
      return;
    }

    const res = await fetch('/api/stripe?action=checkout', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ plan, accountSize, affiliateCode }),
    });

    const result = await res.json();

    if (result.success && result.data.url) {
      window.location.href = result.data.url;  // → Stripe checkout page
    } else {
      alert('Payment error: ' + (result.error || 'Unknown error'));
    }
  },

  /**
   * Aggregate stats for charts (win rate, total PnL, best/worst day)
   * @param {Array} stats - array from getStats()
   */
  aggregateStats(stats) {
    if (!stats || !stats.length) return null;
    const rev    = [...stats].reverse();  // oldest first
    const total  = rev.reduce((s, d) => s + (d.daily_pnl || 0), 0);
    const trades = rev.reduce((s, d) => s + (d.trades_count || 0), 0);
    const wins   = rev.reduce((s, d) => s + (d.win_trades || 0), 0);
    return {
      totalPnl:    total.toFixed(2),
      totalTrades: trades,
      winRate:     trades > 0 ? ((wins / trades) * 100).toFixed(1) : '0.0',
      maxDrawdown: Math.max(...rev.map(d => d.drawdown_pct || 0)).toFixed(2),
      bestDay:     Math.max(...rev.map(d => d.daily_pnl || 0)).toFixed(2),
      worstDay:    Math.min(...rev.map(d => d.daily_pnl || 0)).toFixed(2),
      profitDays:  rev.filter(d => d.daily_pnl > 0).length,
      lossDays:    rev.filter(d => d.daily_pnl < 0).length,
      chartData:   rev.map(d => ({ date: d.stat_date, balance: d.balance_end })),
    };
  },
};

// ================================================================
// PAYOUTS — Withdrawal requests
// ================================================================
const Payouts = {

  /**
   * Get all payouts for the logged-in user
   */
  async getMy() {
    const { data, error } = await supabase
      .from('payouts')
      .select('*, challenges(plan, account_size)')
      .order('requested_at', { ascending: false });
    return { data, error };
  },

  /**
   * Request a payout
   * @param {string} challengeId
   * @param {number} amount
   * @param {string} method - 'crypto' | 'wise' | 'bank'
   * @param {string} walletOrDetails - wallet address or bank info
   */
  async request(challengeId, amount, method, walletOrDetails) {
    const token = Auth.getToken();
    const res   = await fetch('/api/payouts', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        challengeId,
        amount,
        method,
        walletAddress: ['crypto','wise'].includes(method) ? walletOrDetails : undefined,
        bankDetails:   method === 'bank' ? walletOrDetails : undefined,
      }),
    });
    return res.json();
  },
};

// ================================================================
// LEADERBOARD — Public rankings
// ================================================================
const Leaderboard = {

  /**
   * Get leaderboard entries
   * @param {string} period - 'weekly' | 'monthly' | 'alltime'
   * @param {number} limit  - max entries to return
   */
  async get(period = 'monthly', limit = 50) {
    const { data, error } = await supabase
      .from('leaderboard_snapshots')
      .select('*')
      .eq('period', period)
      .order('rank', { ascending: true })
      .limit(limit);
    return { data, error };
  },
};

// ================================================================
// AFFILIATES — Referral program
// ================================================================
const Affiliates = {

  /**
   * Get current user's affiliate dashboard data
   */
  async getDashboard() {
    const token = Auth.getToken();
    const res   = await fetch('/api/affiliate', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  },

  /**
   * Join the affiliate program
   */
  async join() {
    const token = Auth.getToken();
    const res   = await fetch('/api/affiliate?action=join', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  },

  /**
   * Get affiliate code from URL (?ref=XXXXX) and save it
   * Call this on every page load
   */
  captureRef() {
    const params = new URLSearchParams(window.location.search);
    const ref    = params.get('ref');
    if (ref) {
      localStorage.setItem('vornix_ref', ref);
      // Track the click server-side
      fetch(`/api/affiliate?action=track&ref=${ref}`).catch(() => {});
    }
    return localStorage.getItem('vornix_ref');
  },
};

// ================================================================
// ADMIN — Admin panel API calls
// ================================================================
const Admin = {

  async getStats() {
    const token = Auth.getToken();
    const res   = await fetch('/api/admin?action=stats', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  },

  async getChallenges(status = null, page = 1) {
    const token = Auth.getToken();
    const q     = status ? `&status=${status}` : '';
    const res   = await fetch(`/api/admin?action=challenges&page=${page}${q}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  },

  async activateChallenge(challengeId, mtLogin, mtPassword, mtServer) {
    const token = Auth.getToken();
    const res   = await fetch('/api/admin?action=activate', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ challengeId, mtLogin, mtPassword, mtServer }),
    });
    return res.json();
  },

  async advancePhase(challengeId) {
    const token = Auth.getToken();
    const res   = await fetch('/api/admin?action=phase', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ challengeId }),
    });
    return res.json();
  },

  async failChallenge(challengeId, reason) {
    const token = Auth.getToken();
    const res   = await fetch('/api/admin?action=fail', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ challengeId, reason }),
    });
    return res.json();
  },

  async getPendingPayouts() {
    const token = Auth.getToken();
    const res   = await fetch('/api/payouts?all=true&status=pending', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.json();
  },

  async approvePayout(payoutId) {
    const token = Auth.getToken();
    const res   = await fetch('/api/payouts?action=approve', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ payoutId }),
    });
    return res.json();
  },

  async markPayoutPaid(payoutId, txRef) {
    const token = Auth.getToken();
    const res   = await fetch('/api/payouts?action=paid', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ payoutId, txRef }),
    });
    return res.json();
  },
};

// ================================================================
// UTILS — Shared helper functions
// ================================================================
const Utils = {

  /**
   * Format a number as currency
   * e.g. 10000 → "$10,000"
   */
  formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 0,
    }).format(amount);
  },

  /**
   * Format a date string to readable format
   * e.g. "2025-06-01" → "Jun 1, 2025"
   */
  formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  },

  /**
   * Get plan display name
   */
  planName(plan) {
    return {
      one_step:   '1-Step',
      two_step:   '2-Step',
      three_step: '3-Step',
      partial:    'Partial Payment',
    }[plan] || plan;
  },

  /**
   * Get profit split for a plan
   */
  profitSplit(plan) {
    return { one_step: 95, two_step: 90, three_step: 80, partial: 80 }[plan] || 80;
  },

  /**
   * Get status colour class
   */
  statusClass(status) {
    return {
      active:          'status-active',
      funded:          'status-funded',
      passed:          'status-passed',
      failed:          'status-failed',
      pending_payment: 'status-pending',
      suspended:       'status-suspended',
    }[status] || '';
  },

  /**
   * Redirect to login if not authenticated
   * Call this at the top of any protected page
   */
  async requireAuth() {
    const loggedIn = await Auth.isLoggedIn();
    if (!loggedIn) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  /**
   * Redirect to dashboard if already logged in
   * Call this on login/signup pages
   */
  async redirectIfLoggedIn() {
    const loggedIn = await Auth.isLoggedIn();
    if (loggedIn) {
      window.location.href = '/dashboard.html';
    }
  },
};

// ================================================================
// EXPORT
// In browser: these become global variables
// In Node.js: use module.exports
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { supabase, Auth, Profiles, Challenges, Payouts, Leaderboard, Affiliates, Admin, Utils };
} else {
  // Make available globally in browser
  window.VornixDB  = { supabase, Auth, Profiles, Challenges, Payouts, Leaderboard, Affiliates, Admin, Utils };
}
