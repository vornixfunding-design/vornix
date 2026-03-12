// ================================================================
// VORNIX — lib/db.js
// Shared Supabase client used by ALL /api/* serverless functions
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const URL  = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');

// Public client — respects Row Level Security
const supabase = createClient(URL, ANON);

// Admin client — bypasses RLS, for server-side only
const supabaseAdmin = SVC ? createClient(URL, SVC) : null;

// ── PLAN RULES ────────────────────────────────────────────────
const PLAN_PHASES = {
  one_step:    1,
  two_step:    2,
  three_step:  3,
  partial:     3,
};

const PROFIT_SPLIT = {
  one_step:   95,
  two_step:   90,
  three_step: 80,
  partial:    80,
};

// ── PRICING TABLE ─────────────────────────────────────────────
const PRICING = {
  one_step:   { '5000':49,  '10000':89,  '25000':189, '50000':289,  '100000':489 },
  two_step:   { '1000':15,  '2500':29,   '5000':49,   '10000':79,   '25000':169, '50000':259, '100000':429 },
  three_step: { '1000':12,  '2500':24,   '5000':39,   '10000':69,   '25000':139, '50000':229, '100000':389 },
  partial:    { '1000':20,  '2500':35,   '5000':55,   '10000':95,   '25000':195, '50000':299, '100000':489 },
};

// ── HELPERS ───────────────────────────────────────────────────
function getPrice(plan, size) {
  return PRICING[plan]?.[String(size)] || null;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function ok(res, data, status = 200) {
  cors(res);
  res.status(status).json({ success: true, data });
}

function err(res, message, status = 400) {
  cors(res);
  res.status(status).json({ success: false, error: message });
}

function getUserFromHeader(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.replace('Bearer ', '').trim();
}

module.exports = {
  supabase,
  supabaseAdmin,
  PLAN_PHASES,
  PROFIT_SPLIT,
  PRICING,
  getPrice,
  cors,
  ok,
  err,
  getUserFromHeader,
};
