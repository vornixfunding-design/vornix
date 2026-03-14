/* ================================================================
   VORNIX — supabase.js  v5  FIXED (no naming conflicts)
   ── CHANGE ONLY THESE TWO LINES ─────────────────────────────────
   Get values from: supabase.com → Project Settings → API
   ================================================================ */
const SUPABASE_URL      = 'https://bociajqqwpexnuoemnlx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvY2lhanFxd3BleG51b2Vtbmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDc2MDQsImV4cCI6MjA4ODkyMzYwNH0.3j13j-FWDGIyFZoSIRk7HTB7aipv_gLxaLAoPKm6FS8';
/* ============================================================== */

/* Internal client — uses _VX prefix to avoid ALL conflicts */
let _VXclient = null;

function _getClient() {
  if (_VXclient) return _VXclient;
  /* CDN sets window.supabase = { createClient, ... } */
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    _VXclient = window.supabase.createClient(VX_URL, VX_KEY);
  }
  return _VXclient;
}

/* ── AUTH ──────────────────────────────────────────────────────── */
const _Auth = {
  async signUp(email, password, fullName) {
    const c = _getClient();
    if (!c) return { error: { message: 'Supabase not initialized. Check your VX_URL and VX_KEY in supabase.js' } };
    return c.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  },
  async signIn(email, password) {
    const c = _getClient();
    if (!c) return { error: { message: 'Supabase not initialized.' } };
    return c.auth.signInWithPassword({ email, password });
  },
  async signOut() {
    const c = _getClient();
    if (!c) return;
    return c.auth.signOut();
  },
  async getSession() {
    const c = _getClient();
    if (!c) return { data: { session: null } };
    return c.auth.getSession();
  },
  async getUser() {
    const { data } = await _Auth.getSession();
    return data?.session?.user || null;
  },
  async getToken() {
    const { data } = await _Auth.getSession();
    return data?.session?.access_token || null;
  },
  async isLoggedIn() {
    const { data } = await _Auth.getSession();
    return !!data?.session;
  },
  async resetPassword(email) {
    const c = _getClient();
    if (!c) return { error: { message: 'Supabase not initialized.' } };
    return c.auth.resetPasswordForEmail(email, {
      redirectTo: (window.APP_URL || window.location.origin) + '/login.html',
    });
  },
  onStateChange(callback) {
    const c = _getClient();
    if (!c) return;
    c.auth.onAuthStateChange(callback);
  },
};

/* ── PROFILES ──────────────────────────────────────────────────── */
const _Profiles = {
  async get(userId) {
    const c = _getClient();
    if (!c) return { data: null };
    return c.from('profiles').select('*').eq('id', userId).single();
  },
  async update(userId, fields) {
    const c = _getClient();
    if (!c) return { error: { message: 'Supabase not initialized.' } };
    return c.from('profiles').upsert({ id: userId, ...fields, updated_at: new Date().toISOString() });
  },
};

/* ── CHALLENGES ────────────────────────────────────────────────── */
const _Challenges = {
  async getMyAll() {
    const token = await _Auth.getToken();
    if (!token) return { data: [] };
    try {
      const r = await fetch('/api/challenges?action=get', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async getById(id) {
    const token = await _Auth.getToken();
    if (!token) return { data: null };
    try {
      const r = await fetch('/api/challenges?action=get&id=' + id, {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: null }; }
  },
  async startCryptoPayment(plan, size, network) {
    const token = await _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch('/api/crypto-payment?action=initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ plan, account_size: size, network }),
      });
      return r.json();
    } catch (e) { return { error: e.message }; }
  },
  async submitPayment(paymentId, txHash, network) {
    const token = await _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch('/api/crypto-payment?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ payment_id: paymentId, tx_hash: txHash, network }),
      });
      return r.json();
    } catch (e) { return { error: e.message }; }
  },
};

/* ── PAYOUTS ───────────────────────────────────────────────────── */
const _Payouts = {
  async getMy() {
    const token = await _Auth.getToken();
    if (!token) return { data: [] };
    try {
      const r = await fetch('/api/payouts?action=get', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async request(challengeId, amount, method, details) {
    const token = await _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch('/api/payouts?action=request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ challenge_id: challengeId, amount_requested: amount, method, payout_details: details }),
      });
      return r.json();
    } catch (e) { return { error: e.message }; }
  },
};

/* ── LEADERBOARD ───────────────────────────────────────────────── */
const _Leaderboard = {
  async get(period = 'monthly', limit = 50) {
    try {
      const r = await fetch(`/api/leaderboard?period=${period}&limit=${limit}`);
      return r.json();
    } catch { return { data: [] }; }
  },
};

/* ── AFFILIATES ────────────────────────────────────────────────── */
const _Affiliates = {
  captureRef() {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) { try { sessionStorage.setItem('vx_ref', ref); } catch{} }
    return ref || (function(){ try { return sessionStorage.getItem('vx_ref'); } catch{ return null; } })();
  },
  async getDashboard() {
    const token = await _Auth.getToken();
    if (!token) return { data: null };
    try {
      const r = await fetch('/api/affiliate?action=dashboard', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: null }; }
  },
};

/* ── ADMIN ─────────────────────────────────────────────────────── */
const _Admin = {
  async getStats() {
    const token = await _Auth.getToken();
    if (!token) return { data: null };
    try {
      const r = await fetch('/api/admin?action=stats', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: null }; }
  },
  async getPendingPayments() {
    const token = await _Auth.getToken();
    if (!token) return { data: [] };
    try {
      const r = await fetch('/api/crypto-payment?action=pending', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async approvePayment(paymentId, challengeData) {
    const token = await _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch('/api/crypto-payment?action=approve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ payment_id: paymentId, ...challengeData }),
      });
      return r.json();
    } catch (e) { return { error: e.message }; }
  },
  async rejectPayment(paymentId, reason) {
    const token = await _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch('/api/crypto-payment?action=reject', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ payment_id: paymentId, reason }),
      });
      return r.json();
    } catch (e) { return { error: e.message }; }
  },
};

/* ── UTILS ─────────────────────────────────────────────────────── */
const _Utils = {
  formatCurrency(v) {
    return '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },
  planName(plan) {
    return { one_step:'1-Step', two_step:'2-Step', three_step:'3-Step', partial:'Partial Pay' }[plan] || plan || '—';
  },
  profitSplit(plan) {
    return { one_step:95, two_step:90, three_step:80, partial:80 }[plan] || 0;
  },
};

/* ── EXPOSE AS window.VornixDB ─────────────────────────────────── */
window.VornixDB = {
  Auth:        _Auth,
  Profiles:    _Profiles,
  Challenges:  _Challenges,
  Payouts:     _Payouts,
  Leaderboard: _Leaderboard,
  Affiliates:  _Affiliates,
  Admin:       _Admin,
  Utils:       _Utils,
};
