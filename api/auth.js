// ================================================================
// VORNIX — api/auth.js  v2  OTP SYSTEM
// Actions: send-otp | verify-otp | get-session | logout
// No Supabase Auth SDK — pure DB + Resend OTP flow
// ================================================================

const { supabase, cors, ok, err } = require('../lib/db');
const { Resend }                   = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
/* onboarding@resend.dev works with zero domain setup — change after buying domain */
const FROM   = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const APP    = process.env.APP_URL    || 'https://vornix.com';

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || req.body?.action;
  const body   = req.body || {};

  try {

    // ── SEND OTP ───────────────────────────────────────────────
    // POST /api/auth?action=send-otp
    // Body: { email, name?, country? }
    if (action === 'send-otp') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);
      const email = (body.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) return err(res, 'Valid email required');

      // Check Resend key exists
      if (!process.env.RESEND_API_KEY) {
        return err(res, 'RESEND_API_KEY is not set in Vercel environment variables.');
      }

      // 6-digit OTP, expires in 10 minutes
      const otp        = Math.floor(100000 + Math.random() * 900000).toString();
      const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Upsert so re-sends overwrite old code
      const { error: dbErr } = await supabase
        .from('otp_codes')
        .upsert({
          email,
          otp,
          name:       body.name    || null,
          country:    body.country || null,
          expires_at,
          created_at: new Date().toISOString(),
        }, { onConflict: 'email' });

      if (dbErr) return err(res, 'Failed to generate code: ' + dbErr.message);

      // Send via Resend
      const { error: mailErr } = await resend.emails.send({
        from:    FROM,
        to:      email,
        subject: 'Your VORNIX verification code — ' + otp,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060911;font-family:'Inter',Arial,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#0A0D1A;border:1px solid rgba(255,255,255,.1)">
    <div style="background:#E8192C;padding:3px 0"></div>
    <div style="padding:40px 40px 32px">
      <div style="font-family:'Arial Black',sans-serif;font-size:28px;letter-spacing:4px;color:#ffffff;margin-bottom:6px">VORN<span style="color:#E8192C">IX</span></div>
      <div style="font-size:11px;letter-spacing:3px;color:#444C6E;margin-bottom:32px;text-transform:uppercase">Next Generation Prop Firm</div>

      <p style="color:#9AA3C8;font-size:15px;line-height:1.6;margin-bottom:28px">
        ${body.name ? 'Hi ' + body.name.split(' ')[0] + ',' : 'Hi there,'}<br><br>
        Here is your one-time verification code. It expires in <strong style="color:#E8EEFF">10 minutes</strong>.
      </p>

      <div style="background:#111528;border:1px solid rgba(232,25,44,.25);padding:28px;text-align:center;margin-bottom:28px">
        <div style="font-size:13px;letter-spacing:3px;color:#444C6E;margin-bottom:12px;text-transform:uppercase">Verification Code</div>
        <div style="font-family:'Arial Black',Impact,sans-serif;font-size:52px;letter-spacing:12px;color:#ffffff;line-height:1">${otp}</div>
      </div>

      <p style="color:#444C6E;font-size:12px;line-height:1.6">
        If you did not request this code, you can safely ignore this email.<br>
        Never share this code with anyone.
      </p>
    </div>
    <div style="background:#080B16;padding:16px 40px;border-top:1px solid rgba(255,255,255,.06)">
      <p style="color:#444C6E;font-size:11px;margin:0">© 2025 VORNIX. All rights reserved. | <a href="${APP}" style="color:#E8192C">vornix.com</a></p>
    </div>
  </div>
</body>
</html>`,
      });

      if (mailErr) {
        console.error('Resend error full:', JSON.stringify(mailErr));
        const detail = mailErr?.message || mailErr?.name || JSON.stringify(mailErr);
        return err(res, `Email send failed: ${detail}. FROM="${FROM}" — make sure EMAIL_FROM=onboarding@resend.dev in Vercel env vars.`);
      }

      return ok(res, { message: 'Code sent to ' + email });
    }


    // ── VERIFY OTP ─────────────────────────────────────────────
    // POST /api/auth?action=verify-otp
    // Body: { email, otp, name?, country? }
    if (action === 'verify-otp') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);
      const email = (body.email || '').toLowerCase().trim();
      const otp   = (body.otp   || '').trim();
      if (!email || !otp) return err(res, 'Email and code required');

      // Look up OTP
      const { data: otpRow, error: otpErr } = await supabase
        .from('otp_codes')
        .select('*')
        .eq('email', email)
        .eq('otp', otp)
        .single();

      if (otpErr || !otpRow) return err(res, 'Incorrect code. Please check and try again.');
      if (new Date(otpRow.expires_at) < new Date()) {
        await supabase.from('otp_codes').delete().eq('email', email);
        return err(res, 'Code expired. Please request a new one.');
      }

      // Delete used OTP
      await supabase.from('otp_codes').delete().eq('email', email);

      // Find or create profile
      let { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      const name    = body.name    || otpRow.name    || email.split('@')[0];
      const country = body.country || otpRow.country || null;

      if (!profile) {
        // New user — create profile
        const { data: newProfile, error: createErr } = await supabase
          .from('profiles')
          .insert({
            email,
            full_name:   name,
            country,
            created_at:  new Date().toISOString(),
            updated_at:  new Date().toISOString(),
          })
          .select()
          .single();

        if (createErr) return err(res, 'Failed to create account: ' + createErr.message);
        profile = newProfile;

        // Welcome email (non-blocking)
        resend.emails.send({
          from: FROM, to: email,
          subject: 'Welcome to VORNIX — You\'re in.',
          html: `<p style="font-family:Arial,sans-serif;color:#E8EEFF">Hi ${name.split(' ')[0]}, welcome to VORNIX. Start your challenge at <a href="${APP}" style="color:#E8192C">vornix.com</a>.</p>`,
        }).catch(() => {});

      } else {
        // Existing user — update if new data provided
        const updates = {};
        if (body.name    && body.name    !== profile.full_name) updates.full_name = body.name;
        if (body.country && body.country !== profile.country)   updates.country   = body.country;
        if (Object.keys(updates).length) {
          updates.updated_at = new Date().toISOString();
          await supabase.from('profiles').update(updates).eq('id', profile.id);
          Object.assign(profile, updates);
        }
      }

      // Generate session token (no JWT library needed — random UUID pair)
      const token      = generateToken();
      const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

      const { error: sessErr } = await supabase.from('sessions').insert({
        token,
        user_id:    profile.id,
        email:      profile.email,
        expires_at,
        created_at: new Date().toISOString(),
      });

      if (sessErr) return err(res, 'Session error: ' + sessErr.message);

      return ok(res, {
        token,
        user: {
          id:        profile.id,
          email:     profile.email,
          full_name: profile.full_name,
          country:   profile.country,
          created_at:profile.created_at,
        },
        message: 'Authenticated successfully',
      });
    }


    // ── GET SESSION ────────────────────────────────────────────
    // GET /api/auth?action=get-session
    // Header: Authorization: Bearer <token>
    if (action === 'get-session') {
      const token = extractToken(req);
      if (!token) return err(res, 'No session token', 401);

      const { data: session, error: sErr } = await supabase
        .from('sessions')
        .select('*, profile:profiles(*)')
        .eq('token', token)
        .single();

      if (sErr || !session) return err(res, 'Invalid or expired session', 401);

      if (new Date(session.expires_at) < new Date()) {
        await supabase.from('sessions').delete().eq('token', token);
        return err(res, 'Session expired. Please sign in again.', 401);
      }

      return ok(res, { user: session.profile });
    }


    // ── LOGOUT ─────────────────────────────────────────────────
    // POST /api/auth?action=logout
    if (action === 'logout') {
      const token = extractToken(req);
      if (token) await supabase.from('sessions').delete().eq('token', token);
      return ok(res, { message: 'Signed out' });
    }


    // DEBUG endpoint — remove after fixing
    if (action === "debug") {
      return ok(res, {
        RESEND_KEY:  process.env.RESEND_API_KEY ? "SET: " + process.env.RESEND_API_KEY.slice(0,8) + "..." : "MISSING",
        EMAIL_FROM:  process.env.EMAIL_FROM || "MISSING - fallback: onboarding@resend.dev",
        FROM_used:   FROM,
        SUPABASE:    process.env.SUPABASE_URL ? "SET" : "MISSING",
        APP_URL:     process.env.APP_URL || "MISSING",
      });
    }

    return err(res, `Unknown action: ${action}`, 400);

  } catch (e) {
    console.error('[auth] Unhandled error:', e);
    return err(res, 'Server error: ' + e.message, 500);
  }
};

// ── HELPERS ────────────────────────────────────────────────────
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t = '';
  for (let i = 0; i < 64; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
