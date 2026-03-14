// ================================================================
// VORNIX — api/auth.js  v3  GMAIL SMTP
// Uses nodemailer + Gmail App Password — 100% free, no domain needed
// Actions: send-otp | verify-otp | get-session | logout | debug
// ================================================================

const { supabase, cors, ok, err } = require('../lib/db');
const nodemailer                   = require('nodemailer');

// ── Gmail transporter ─────────────────────────────────────────
// Uses GMAIL_USER and GMAIL_APP_PASSWORD env vars
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

const APP = process.env.APP_URL || 'https://vornix-sooty.vercel.app';

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || req.body?.action;
  const body   = req.body || {};

  try {

    // ── DEBUG ──────────────────────────────────────────────────
    if (action === 'debug') {
      return ok(res, {
        GMAIL_USER:         process.env.GMAIL_USER          ? '✓ SET: ' + process.env.GMAIL_USER : '✗ MISSING',
        GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD  ? '✓ SET (length: ' + process.env.GMAIL_APP_PASSWORD.length + ')' : '✗ MISSING',
        SUPABASE_URL:       process.env.SUPABASE_URL        ? '✓ SET' : '✗ MISSING',
        SUPABASE_KEY:       process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ SET' : '✗ MISSING',
        APP_URL:            APP,
      });
    }

    // ── SEND OTP ───────────────────────────────────────────────
    if (action === 'send-otp') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);

      const email = (body.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) return err(res, 'Valid email required');

      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        return err(res, 'GMAIL_USER and GMAIL_APP_PASSWORD are not set in Vercel environment variables.');
      }

      // 6-digit OTP, expires 10 minutes
      const otp        = Math.floor(100000 + Math.random() * 900000).toString();
      const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Save OTP to DB
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

      if (dbErr) return err(res, 'DB error: ' + dbErr.message);

      // Send email via Gmail SMTP
      const transporter = getTransporter();
      const firstName   = (body.name || '').split(' ')[0] || 'Trader';

      try {
        await transporter.sendMail({
          from:    `"VORNIX" <${process.env.GMAIL_USER}>`,
          to:      email,
          subject: `${otp} — Your VORNIX verification code`,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060911;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#0A0D1A;border:1px solid rgba(255,255,255,.1)">
    <div style="background:#E8192C;padding:3px 0"></div>
    <div style="padding:40px 40px 32px">
      <div style="font-size:28px;font-weight:900;letter-spacing:4px;color:#ffffff;margin-bottom:4px">VORN<span style="color:#E8192C">IX</span></div>
      <div style="font-size:11px;letter-spacing:3px;color:#444C6E;margin-bottom:32px;text-transform:uppercase">Next Generation Prop Firm</div>

      <p style="color:#9AA3C8;font-size:15px;line-height:1.7;margin-bottom:28px">
        Hi ${firstName},<br><br>
        Here is your one-time verification code.
        It expires in <strong style="color:#E8EEFF">10 minutes</strong>.
      </p>

      <div style="background:#111528;border:1px solid rgba(232,25,44,.3);padding:32px;text-align:center;margin-bottom:28px">
        <div style="font-size:12px;letter-spacing:3px;color:#444C6E;margin-bottom:14px;text-transform:uppercase">Your Verification Code</div>
        <div style="font-size:54px;font-weight:900;letter-spacing:14px;color:#ffffff;line-height:1;font-family:monospace">${otp}</div>
      </div>

      <p style="color:#444C6E;font-size:12px;line-height:1.7;margin:0">
        If you did not request this code, ignore this email.<br>
        Never share this code with anyone.
      </p>
    </div>
    <div style="background:#080B16;padding:16px 40px;border-top:1px solid rgba(255,255,255,.06)">
      <p style="color:#444C6E;font-size:11px;margin:0">© 2025 VORNIX — <a href="${APP}" style="color:#E8192C">vornix-sooty.vercel.app</a></p>
    </div>
  </div>
</body>
</html>`,
          text: `Your VORNIX verification code is: ${otp}\n\nExpires in 10 minutes. Never share this code.`,
        });
      } catch (mailErr) {
        console.error('Gmail SMTP error:', mailErr);
        return err(res, 'Gmail error: ' + mailErr.message + '. Check GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.');
      }

      return ok(res, { message: 'Code sent to ' + email });
    }


    // ── VERIFY OTP ─────────────────────────────────────────────
    if (action === 'verify-otp') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);

      const email = (body.email || '').toLowerCase().trim();
      const otp   = (body.otp   || '').trim();
      if (!email || !otp) return err(res, 'Email and code required');

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
        const { data: newProfile, error: createErr } = await supabase
          .from('profiles')
          .insert({
            id:         generateUUID(),
            email,
            full_name:  name,
            country,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (createErr) return err(res, 'Failed to create account: ' + createErr.message);
        profile = newProfile;

        // Welcome email (non-blocking, ignore errors)
        if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
          getTransporter().sendMail({
            from:    `"VORNIX" <${process.env.GMAIL_USER}>`,
            to:      email,
            subject: 'Welcome to VORNIX — You\'re in.',
            text:    `Hi ${name.split(' ')[0]}, welcome to VORNIX! Start your challenge at ${APP}`,
            html:    `<p style="font-family:Arial;color:#E8EEFF;background:#060911;padding:32px">Hi <strong>${name.split(' ')[0]}</strong>, welcome to VORNIX!<br><br>Start your challenge at <a href="${APP}" style="color:#E8192C">${APP}</a>.</p>`,
          }).catch(() => {});
        }

      } else {
        // Update profile if new data provided
        const updates = {};
        if (body.name    && body.name    !== profile.full_name) updates.full_name = body.name;
        if (body.country && body.country !== profile.country)   updates.country   = body.country;
        if (Object.keys(updates).length) {
          updates.updated_at = new Date().toISOString();
          await supabase.from('profiles').update(updates).eq('id', profile.id);
          Object.assign(profile, updates);
        }
      }

      // Create session token
      const token      = generateToken();
      const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

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
          id:         profile.id,
          email:      profile.email,
          full_name:  profile.full_name,
          country:    profile.country,
          created_at: profile.created_at,
        },
        message: 'Authenticated successfully',
      });
    }


    // ── GET SESSION ────────────────────────────────────────────
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
    if (action === 'logout') {
      const token = extractToken(req);
      if (token) await supabase.from('sessions').delete().eq('token', token);
      return ok(res, { message: 'Signed out' });
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

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
