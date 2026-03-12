// ================================================================
// VORNIX — api/auth.js
// Handles: POST /api/auth?action=signup|signin|signout|me
// ================================================================

const { supabase, cors, ok, err } = require('../lib/db');
const { sendEmail }                = require('../lib/emails');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return err(res, 'Method not allowed', 405);

  const action = req.query.action || req.body?.action;
  const body   = req.body || {};

  try {
    // ── SIGN UP ────────────────────────────────────────────────
    if (action === 'signup') {
      const { email, password, fullName, affiliateCode } = body;
      if (!email || !password || !fullName) return err(res, 'Email, password and full name required');

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, affiliate_code: affiliateCode || null },
          emailRedirectTo: `${process.env.APP_URL}/dashboard`,
        },
      });

      if (error) return err(res, error.message);

      // Send welcome email (non-blocking)
      sendEmail('welcome', email, {
        name: fullName,
        loginUrl: `${process.env.APP_URL}/dashboard`,
      }).catch(e => console.error('Welcome email failed:', e));

      return ok(res, { user: data.user, session: data.session }, 201);
    }

    // ── SIGN IN ────────────────────────────────────────────────
    if (action === 'signin') {
      const { email, password } = body;
      if (!email || !password) return err(res, 'Email and password required');

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return err(res, error.message, 401);

      return ok(res, { user: data.user, session: data.session });
    }

    // ── FORGOT PASSWORD ────────────────────────────────────────
    if (action === 'forgot') {
      const { email } = body;
      if (!email) return err(res, 'Email required');

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.APP_URL}/reset-password`,
      });
      if (error) return err(res, error.message);

      return ok(res, { message: 'Password reset email sent' });
    }

    // ── RESET PASSWORD ─────────────────────────────────────────
    if (action === 'reset') {
      const { accessToken, password } = body;
      if (!accessToken || !password) return err(res, 'Token and password required');

      // Set session from token then update password
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return err(res, error.message);

      return ok(res, { message: 'Password updated' });
    }

    return err(res, `Unknown action: ${action}`);

  } catch (e) {
    console.error('[auth]', e);
    return err(res, 'Server error', 500);
  }
};
