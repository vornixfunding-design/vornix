/* ================================================================
   VORNIX — supabase.js  v6  OTP EDITION
   ── Zero CDN dependency. Pure fetch() calls to /api/ endpoints ──
   ── Sessions stored in cookies, not localStorage ────────────────
   ================================================================ */

const _API = '';  // Empty = same origin (your Vercel domain)

/* ── COOKIE HELPERS ────────────────────────────────────────────── */
function _setCookie(name, value, days) {
  const d = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d}; path=/; SameSite=Strict`;
}
function _getCookie(name) {
  const match = document.cookie.split('; ').find(r => r.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}
function _clearCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict`;
}

const TOKEN_KEY = 'vx_token';
const USER_KEY  = 'vx_user';

/* ── AUTH ──────────────────────────────────────────────────────── */
const _Auth = {

  /* Step 1 — Send OTP to email */
  async sendOTP(email, name, country) {
    try {
      const r = await fetch(`${_API}/api/auth?action=send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, country }),
      });
      return r.json();
    } catch(e) { return { error: 'Connection failed. Check your internet connection.' }; }
  },

  /* Step 2 — Verify OTP and get session token */
  async verifyOTP(email, otp, name, country) {
    try {
      const r = await fetch(`${_API}/api/auth?action=verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, name, country }),
      });
      const data = await r.json();
      if (data.token) {
        _setCookie(TOKEN_KEY, data.token, 30);
        if (data.user) _setCookie(USER_KEY, JSON.stringify(data.user), 30);
      }
      return data;
    } catch(e) { return { error: 'Connection failed. Check your internet connection.' }; }
  },

  /* Get current session from API */
  async getSession() {
    const token = _getCookie(TOKEN_KEY);
    if (!token) return { data: { session: null } };
    try {
      const r = await fetch(`${_API}/api/auth?action=get-session`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) {
        _clearCookie(TOKEN_KEY); _clearCookie(USER_KEY);
        return { data: { session: null } };
      }
      const data = await r.json();
      return { data: { session: { user: data.user } } };
    } catch(e) { return { data: { session: null } }; }
  },

  /* Get user object from cookie (fast, no network) */
  getUser() {
    try {
      const raw = _getCookie(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  /* Get token for API calls */
  getToken() {
    return _getCookie(TOKEN_KEY);
  },

  /* Is user logged in? (cookie check only — instant) */
  isLoggedIn() {
    return !!_getCookie(TOKEN_KEY);
  },

  /* Sign out */
  async signOut() {
    const token = _getCookie(TOKEN_KEY);
    _clearCookie(TOKEN_KEY);
    _clearCookie(USER_KEY);
    if (token) {
      try {
        await fetch(`${_API}/api/auth?action=logout`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
        });
      } catch {}
    }
    return { error: null };
  },
};

/* ── PROFILES ──────────────────────────────────────────────────── */
const _Profiles = {
  async get(userId) {
    const token = _Auth.getToken();
    if (!token) return { data: null };
    try {
      const r = await fetch(`${_API}/api/auth?action=get-session`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await r.json();
      return { data: data.user || null };
    } catch { return { data: null }; }
  },
  async update(userId, fields) {
    const token = _Auth.getToken();
    if (!token) return { error: { message: 'Not authenticated' } };
    try {
      const r = await fetch(`${_API}/api/auth?action=update-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(fields),
      });
      return r.json();
    } catch(e) { return { error: { message: 'Connection failed' } }; }
  },
};

/* ── CHALLENGES ────────────────────────────────────────────────── */
const _Challenges = {
  async getMyAll() {
    const token = _Auth.getToken();
    if (!token) return { data: [] };
    try {
      const r = await fetch(`${_API}/api/challenges?action=get`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async startCryptoPayment(plan, size, network) {
    const token = _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ plan, account_size: size, network }),
      });
      return r.json();
    } catch(e) { return { error: e.message }; }
  },
  async submitPayment(paymentId, txHash, network) {
    const token = _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ payment_id: paymentId, tx_hash: txHash, network }),
      });
      return r.json();
    } catch(e) { return { error: e.message }; }
  },
};

/* ── PAYOUTS ───────────────────────────────────────────────────── */
const _Payouts = {
  async getMy() {
    const token = _Auth.getToken();
    if (!token) return { data: [] };
    try {
      const r = await fetch(`${_API}/api/payouts?action=get`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async request(challengeId, amount, method, details) {
    const token = _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/payouts?action=request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ challenge_id: challengeId, amount_requested: amount, method, payout_details: details }),
      });
      return r.json();
    } catch(e) { return { error: e.message }; }
  },
};

/* ── LEADERBOARD ───────────────────────────────────────────────── */
const _Leaderboard = {
  async get(period = 'monthly', limit = 50) {
    try {
      const r = await fetch(`${_API}/api/leaderboard?period=${period}&limit=${limit}`);
      return r.json();
    } catch { return { data: [] }; }
  },
};

/* ── AFFILIATES ────────────────────────────────────────────────── */
const _Affiliates = {
  captureRef() {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) { try { sessionStorage.setItem('vx_ref', ref); } catch {} }
    return ref || (function(){ try { return sessionStorage.getItem('vx_ref'); } catch { return null; } })();
  },
};

/* ── ADMIN ─────────────────────────────────────────────────────── */
const _Admin = {
  async getPendingPayments() {
    const token = _Auth.getToken();
    if (!token) return { data: [] };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=pending`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async approvePayment(paymentId, challengeData) {
    const token = _Auth.getToken();
    if (!token) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ payment_id: paymentId, ...challengeData }),
      });
      return r.json();
    } catch(e) { return { error: e.message }; }
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
