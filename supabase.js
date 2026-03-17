/* ================================================================
   VORNIX — supabase.js  v7  OTP EDITION
   ── Zero CDN dependency. Pure fetch() calls to /api/ endpoints ──
   ── Sessions via httpOnly cookie (server-set) + vx_session flag ─
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

// vx_session: non-httpOnly flag set by server indicating active session
const SESSION_KEY = 'vx_session';
// vx_user: JS-readable user info cache (not the session token)
const USER_KEY    = 'vx_user';

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
      const data = await r.json();
      data.status = r.status;
      return data;
    } catch(e) { return { error: 'Connection failed. Check your internet connection.' }; }
  },

  /* Step 2 — Verify OTP; server sets httpOnly vx_token + vx_session cookies */
  async verifyOTP(email, otp, name, country, password) {
    try {
      const r = await fetch(`${_API}/api/auth?action=verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, name, country, password }),
      });
      const data = await r.json();
      if (data.data?.user) {
        // Cache user info in a JS-readable cookie for fast local access.
        // The actual session token is stored httpOnly by the server.
        _setCookie(USER_KEY, JSON.stringify(data.data.user), 30);
      }
      return data;
    } catch(e) { return { error: 'Connection failed. Check your internet connection.' }; }
  },

  /* Password login — email + password (no OTP needed) */
  async passwordLogin(email, password) {
    try {
      const r = await fetch(`${_API}/api/auth?action=password-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (data.data?.user) {
        _setCookie(USER_KEY, JSON.stringify(data.data.user), 30);
      }
      return data;
    } catch(e) { return { error: 'Connection failed. Check your internet connection.' }; }
  },

  /* Set password for currently authenticated user */
  async setPassword(password) {
    try {
      const r = await fetch(`${_API}/api/auth?action=set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      return r.json();
    } catch(e) { return { error: 'Connection failed.' }; }
  },

  /* Request a password reset OTP for the given email */
  async forgotPassword(email) {
    try {
      const r = await fetch(`${_API}/api/auth?action=forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return r.json();
    } catch(e) { return { error: 'Connection failed.' }; }
  },

  /* Reset password using email + OTP + new password; server sets session cookies */
  async resetPassword(email, otp, newPassword) {
    try {
      const r = await fetch(`${_API}/api/auth?action=reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, otp, newPassword }),
      });
      const data = await r.json();
      if (data.data?.user) {
        _setCookie(USER_KEY, JSON.stringify(data.data.user), 30);
      }
      return data;
    } catch(e) { return { error: 'Connection failed.' }; }
  },

  /* Get current session from API (validates httpOnly cookie on server) */
  async getSession() {
    if (!_Auth.isLoggedIn()) return { data: { session: null } };
    try {
      const r = await fetch(`${_API}/api/auth?action=get-session`, {
        credentials: 'include',  // send httpOnly cookie
      });
      if (!r.ok) {
        _clearCookie(SESSION_KEY); _clearCookie(USER_KEY);
        return { data: { session: null } };
      }
      const data = await r.json();
      return { data: { session: { user: data.data?.user } } };
    } catch(e) { return { data: { session: null } }; }
  },

  /* Get user object from cookie cache (fast, no network) */
  getUser() {
    try {
      const raw = _getCookie(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  /* Is user logged in? Checks vx_session flag (set by server) or legacy vx_token cookie */
  isLoggedIn() {
    return _getCookie(SESSION_KEY) === '1' || !!_getCookie('vx_token');
  },

  /* Sign out — server clears httpOnly cookie; client clears JS cookies */
  async signOut() {
    try {
      await fetch(`${_API}/api/auth?action=logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {}
    _clearCookie(SESSION_KEY);
    _clearCookie(USER_KEY);
    _clearCookie('vx_token'); // clear legacy JS token if present
    return { error: null };
  },
};

/* ── PROFILES ──────────────────────────────────────────────────── */
const _Profiles = {
  async get() {
    if (!_Auth.isLoggedIn()) return { data: null };
    try {
      const r = await fetch(`${_API}/api/auth?action=get-session`, {
        credentials: 'include',
      });
      const data = await r.json();
      return { data: data.data?.user || null };
    } catch { return { data: null }; }
  },
  async update(userId, fields) {
    if (!_Auth.isLoggedIn()) return { error: { message: 'Not authenticated' } };
    try {
      const r = await fetch(`${_API}/api/auth?action=update-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(fields),
      });
      return r.json();
    } catch(e) { return { error: { message: 'Connection failed' } }; }
  },
};

/* ── CHALLENGES ────────────────────────────────────────────────── */
const _Challenges = {
  async getMyAll() {
    if (!_Auth.isLoggedIn()) return { data: [] };
    try {
      const r = await fetch(`${_API}/api/challenges`, {
        credentials: 'include',
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async startCryptoPayment(plan, size) {
    if (!_Auth.isLoggedIn()) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan, accountSize: size }),
      });
      return r.json();
    } catch(e) { return { error: e.message }; }
  },
  async getPaymentStatus(paymentId) {
    if (!_Auth.isLoggedIn()) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=status&paymentId=${encodeURIComponent(paymentId)}`, {
        credentials: 'include',
      });
      return r.json();
    } catch(e) { return { error: e.message }; }
  },
};

/* ── PAYOUTS ───────────────────────────────────────────────────── */
const _Payouts = {
  async getMy() {
    if (!_Auth.isLoggedIn()) return { data: [] };
    try {
      const r = await fetch(`${_API}/api/payouts`, {
        credentials: 'include',
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async request(challengeId, amount, method, details) {
    if (!_Auth.isLoggedIn()) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/payouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeId, amount, method, ...details }),
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
    if (!_Auth.isLoggedIn()) return { data: [] };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=pending`, {
        credentials: 'include',
      });
      return r.json();
    } catch { return { data: [] }; }
  },
  async approvePayment(paymentId, challengeData) {
    if (!_Auth.isLoggedIn()) return { error: 'Not authenticated' };
    try {
      const r = await fetch(`${_API}/api/crypto-payment?action=approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentId, ...challengeData }),
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
