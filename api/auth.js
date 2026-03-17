// ================================================================
// VORNIX — api/auth.js  v5  GMAIL SMTP + HARDENED OTP + PASSWORD AUTH
// Uses nodemailer + Gmail App Password — 100% free, no domain needed
// Actions: send-otp | verify-otp | get-session | logout | debug
//          set-password | password-login | forgot-password | reset-password
// ================================================================

const crypto      = require('crypto');
const bcrypt      = require('bcryptjs');
const nodemailer  = require('nodemailer');
const { supabase, supabaseAdmin, cors, ok, err, getAuthToken } = require('../lib/db');

// ── Constants ──────────────────────────────────────────────────
const OTP_EXPIRY_MS         = 10 * 60 * 1000;  // 10 minutes
const RESEND_COOLDOWN_S     = 60;               // seconds between sends
const MAX_ATTEMPTS          = 5;               // max wrong-OTP attempts
const SESSION_DAYS          = 30;              // session lifetime (days)
const SESSION_MAX_AGE       = SESSION_DAYS * 24 * 60 * 60; // seconds
const BCRYPT_ROUNDS         = 12;              // bcrypt cost factor
const PW_LOGIN_WINDOW_MIN   = 15;             // rate-limit window (minutes)
const PW_LOGIN_MAX_ATTEMPTS = 10;             // max failed logins per window
const PW_MIN_LENGTH         = 8;              // minimum password length

const APP = process.env.APP_URL || 'https://vornix-sooty.vercel.app';

// ── Gmail transporter ─────────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

// ── Crypto helpers ────────────────────────────────────────────
function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 hex chars, cryptographically secure
}

function generateUUID() {
  return crypto.randomUUID();
}

function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.length < PW_MIN_LENGTH) return `Password must be at least ${PW_MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  return null; // valid
}

// ── IP helper ─────────────────────────────────────────────────
function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

// ── Cookie helpers ────────────────────────────────────────────
function setSessionCookies(res, token) {
  res.setHeader('Set-Cookie', [
    `vx_token=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}; Path=/`,
    `vx_session=1; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}; Path=/`,
  ]);
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    `vx_token=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`,
    `vx_session=; Secure; SameSite=Strict; Max-Age=0; Path=/`,
  ]);
}

// ── DB client (admin preferred for server-side ops) ───────────
const db = () => supabaseAdmin || supabase;

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || req.body?.action;
  const body   = req.body || {};

  try {

    // ── DEBUG ──────────────────────────────────────────────────
    if (action === 'debug') {
      return ok(res, {
        GMAIL_USER:         process.env.GMAIL_USER          ? '✓ SET' : '✗ MISSING',
        GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD  ? '✓ SET' : '✗ MISSING',
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

      // ── Duplicate account check ────────────────────────────
      const { data: existingProfile } = await db()
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (existingProfile) {
        return err(res, 'This email is already registered. Please sign in instead.', 409);
      }

      // ── Resend cooldown check ──────────────────────────────
      const { data: existing } = await db()
        .from('otp_codes')
        .select('last_sent_at')
        .eq('email', email)
        .maybeSingle();

      if (existing?.last_sent_at) {
        const elapsed = Date.now() - new Date(existing.last_sent_at).getTime();
        if (elapsed < RESEND_COOLDOWN_S * 1000) {
          const wait = Math.ceil((RESEND_COOLDOWN_S * 1000 - elapsed) / 1000);
          return err(res, `Please wait ${wait} seconds before requesting a new code.`, 429);
        }
      }

      // 6-digit OTP hashed before storage
      const otp        = Math.floor(100000 + Math.random() * 900000).toString();
      const otp_hash   = hashOTP(otp);
      const expires_at = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();
      const now        = new Date().toISOString();

      const { error: dbErr } = await db()
        .from('otp_codes')
        .upsert({
          email,
          otp_hash,
          name:         body.name    || null,
          country:      body.country || null,
          expires_at,
          attempts:     0,
          last_sent_at: now,
          created_at:   now,
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

      const email    = (body.email || '').toLowerCase().trim();
      const otp      = (body.otp   || '').trim();
      const password = body.password || null;
      if (!email || !otp) return err(res, 'Email and code required');

      // Validate password if provided (required for new accounts via signup)
      if (password !== null) {
        const pwErr = validatePasswordStrength(password);
        if (pwErr) return err(res, pwErr);
      }

      // Fetch OTP row by email only (we compare hash below)
      const { data: otpRow, error: otpErr } = await db()
        .from('otp_codes')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (otpErr || !otpRow) return err(res, 'No verification code found. Please request a new one.');

      // Max attempts check
      if ((otpRow.attempts || 0) >= MAX_ATTEMPTS) {
        await db().from('otp_codes').delete().eq('email', email);
        return err(res, 'Too many failed attempts. Please request a new code.', 429);
      }

      // Expiry check
      if (new Date(otpRow.expires_at) < new Date()) {
        await db().from('otp_codes').delete().eq('email', email);
        return err(res, 'Code expired. Please request a new one.');
      }

      // Hash comparison (constant-time via crypto.timingSafeEqual)
      const submitted    = Buffer.from(hashOTP(otp),         'hex');
      const stored       = Buffer.from(otpRow.otp_hash || '', 'hex');
      const lengthMatch  = submitted.length === stored.length;
      const hashMatch    = lengthMatch && crypto.timingSafeEqual(submitted, stored);

      if (!hashMatch) {
        const newAttempts = (otpRow.attempts || 0) + 1;
        await db().from('otp_codes').update({ attempts: newAttempts }).eq('email', email);
        const remaining = MAX_ATTEMPTS - newAttempts;
        return err(res, remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many failed attempts. Please request a new code.');
      }

      // OTP valid — delete it
      await db().from('otp_codes').delete().eq('email', email);

      // Find or create profile
      let { data: profile } = await db()
        .from('profiles')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      const name    = body.name    || otpRow.name    || email.split('@')[0];
      const country = body.country || otpRow.country || null;

      if (!profile) {
        // Hash password if provided
        const now = new Date().toISOString();
        const insertData = {
          id:         generateUUID(),
          email,
          full_name:  name,
          country,
          created_at: now,
          updated_at: now,
        };
        if (password) {
          insertData.password_hash   = await bcrypt.hash(password, BCRYPT_ROUNDS);
          insertData.password_set_at = now;
        }

        const { data: newProfile, error: createErr } = await db()
          .from('profiles')
          .insert(insertData)
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
        // Update profile only when fields actually changed
        const updates = {};
        if (body.name    && body.name    !== profile.full_name) updates.full_name = body.name;
        if (body.country && body.country !== profile.country)   updates.country   = body.country;
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          await db().from('profiles').update(updates).eq('id', profile.id);
          Object.assign(profile, updates);
        }
      }

      // Create session token
      const token      = generateToken();
      const expires_at = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const { error: sessErr } = await db().from('sessions').insert({
        token,
        user_id:    profile.id,
        email:      profile.email,
        expires_at,
        created_at: new Date().toISOString(),
      });

      if (sessErr) return err(res, 'Session error: ' + sessErr.message);

      // Set httpOnly session cookie
      setSessionCookies(res, token);

      return ok(res, {
        token,  // also returned for Bearer-based clients (e.g. mobile)
        user: {
          id:         profile.id,
          email:      profile.email,
          full_name:  profile.full_name,
          country:    profile.country,
          is_admin:   profile.is_admin || false,
          created_at: profile.created_at,
        },
        message: 'Authenticated successfully',
      });
    }


    // ── GET SESSION ────────────────────────────────────────────
    if (action === 'get-session') {
      const token = getAuthToken(req);
      if (!token) return err(res, 'No session token', 401);

      const { data: session, error: sErr } = await db()
        .from('sessions')
        .select('*, profile:profiles(id,email,full_name,country,is_admin,created_at,updated_at)')
        .eq('token', token)
        .single();

      if (sErr || !session) return err(res, 'Invalid or expired session', 401);

      if (new Date(session.expires_at) < new Date()) {
        await db().from('sessions').delete().eq('token', token);
        clearSessionCookies(res);
        return err(res, 'Session expired. Please sign in again.', 401);
      }

      return ok(res, { user: session.profile });
    }


    // ── LOGOUT ─────────────────────────────────────────────────
    if (action === 'logout') {
      const token = getAuthToken(req);
      if (token) await db().from('sessions').delete().eq('token', token);
      clearSessionCookies(res);
      return ok(res, { message: 'Signed out' });
    }

    // ── PASSWORD LOGIN ─────────────────────────────────────────
    if (action === 'password-login') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);

      const email    = (body.email    || '').toLowerCase().trim();
      const password = (body.password || '');
      if (!email || !password) return err(res, 'Email and password are required.');

      const ip = getIP(req);

      // Rate limit: count failed attempts per email in the last window
      const windowStart = new Date(Date.now() - PW_LOGIN_WINDOW_MIN * 60 * 1000).toISOString();
      const { count: recentAttempts } = await db()
        .from('login_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('email', email)
        .gte('attempted_at', windowStart);

      if ((recentAttempts || 0) >= PW_LOGIN_MAX_ATTEMPTS) {
        return err(res, `Too many login attempts. Please wait ${PW_LOGIN_WINDOW_MIN} minutes or reset your password.`, 429);
      }

      // Fetch profile (use constant-time regardless of existence to avoid timing oracle)
      const { data: profile } = await db()
        .from('profiles')
        .select('id,email,full_name,country,is_admin,created_at,password_hash')
        .eq('email', email)
        .maybeSingle();

      // Constant-time comparison even when no hash exists
      const storedHash = profile?.password_hash || '$2b$12$invalidhashpaddingtomatchlength000000000000000000000000';
      const match = await bcrypt.compare(password, storedHash);

      if (!match || !profile || !profile.password_hash) {
        // Record failed attempt
        await db().from('login_attempts').insert({ email, ip_address: ip });
        return err(res, 'Invalid email or password.', 401);
      }

      // Success — clean up old attempt records for this email (best-effort)
      await db().from('login_attempts').delete().eq('email', email);

      // Create session
      const token      = generateToken();
      const expires_at = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const { error: sessErr } = await db().from('sessions').insert({
        token,
        user_id:    profile.id,
        email:      profile.email,
        expires_at,
        created_at: new Date().toISOString(),
      });
      if (sessErr) return err(res, 'Session error: ' + sessErr.message);

      setSessionCookies(res, token);

      return ok(res, {
        token,
        user: {
          id:         profile.id,
          email:      profile.email,
          full_name:  profile.full_name,
          country:    profile.country,
          is_admin:   profile.is_admin || false,
          created_at: profile.created_at,
        },
        message: 'Signed in successfully',
      });
    }


    // ── SET PASSWORD ───────────────────────────────────────────
    if (action === 'set-password') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);

      const token = getAuthToken(req);
      if (!token) return err(res, 'Authentication required.', 401);

      const { data: session } = await db()
        .from('sessions')
        .select('user_id,expires_at')
        .eq('token', token)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return err(res, 'Invalid or expired session.', 401);
      }

      const password = body.password || '';
      const pwErr = validatePasswordStrength(password);
      if (pwErr) return err(res, pwErr);

      const password_hash    = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const password_set_at  = new Date().toISOString();

      const { error: upErr } = await db()
        .from('profiles')
        .update({ password_hash, password_set_at, updated_at: password_set_at })
        .eq('id', session.user_id);

      if (upErr) return err(res, 'Failed to save password: ' + upErr.message);

      return ok(res, { message: 'Password set successfully.' });
    }


    // ── FORGOT PASSWORD (send OTP) ─────────────────────────────
    if (action === 'forgot-password') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);

      const email = (body.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) return err(res, 'Valid email required.');

      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        return err(res, 'Email service is not configured.');
      }

      // Resend cooldown (same as send-otp)
      const { data: existing } = await db()
        .from('otp_codes')
        .select('last_sent_at,purpose')
        .eq('email', email)
        .maybeSingle();

      if (existing?.last_sent_at) {
        const elapsed = Date.now() - new Date(existing.last_sent_at).getTime();
        if (elapsed < RESEND_COOLDOWN_S * 1000) {
          const wait = Math.ceil((RESEND_COOLDOWN_S * 1000 - elapsed) / 1000);
          return err(res, `Please wait ${wait} seconds before requesting another reset code.`, 429);
        }
      }

      // Always return generic success to avoid email enumeration
      const otp        = Math.floor(100000 + Math.random() * 900000).toString();
      const otp_hash   = hashOTP(otp);
      const expires_at = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();
      const now        = new Date().toISOString();

      // Check if email has a profile (but still upsert OTP so timing is consistent)
      const { data: profile } = await db()
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      await db().from('otp_codes').upsert({
        email,
        otp_hash,
        expires_at,
        attempts:     0,
        last_sent_at: now,
        created_at:   now,
        purpose:      'password_reset',
      }, { onConflict: 'email' });

      // Only send email if profile exists (silent if not — generic message to caller)
      if (profile && process.env.GMAIL_USER) {
        try {
          await getTransporter().sendMail({
            from:    `"VORNIX" <${process.env.GMAIL_USER}>`,
            to:      email,
            subject: `${otp} — VORNIX Password Reset Code`,
            html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060911;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#0A0D1A;border:1px solid rgba(255,255,255,.1)">
    <div style="background:#E8192C;padding:3px 0"></div>
    <div style="padding:40px 40px 32px">
      <div style="font-size:28px;font-weight:900;letter-spacing:4px;color:#ffffff;margin-bottom:4px">VORN<span style="color:#E8192C">IX</span></div>
      <div style="font-size:11px;letter-spacing:3px;color:#444C6E;margin-bottom:32px;text-transform:uppercase">Password Reset</div>
      <p style="color:#9AA3C8;font-size:15px;line-height:1.7;margin-bottom:28px">
        We received a request to reset your VORNIX password.<br>
        Use the code below. It expires in <strong style="color:#E8EEFF">10 minutes</strong>.
      </p>
      <div style="background:#111528;border:1px solid rgba(232,25,44,.3);padding:32px;text-align:center;margin-bottom:28px">
        <div style="font-size:12px;letter-spacing:3px;color:#444C6E;margin-bottom:14px;text-transform:uppercase">Password Reset Code</div>
        <div style="font-size:54px;font-weight:900;letter-spacing:14px;color:#ffffff;line-height:1;font-family:monospace">${otp}</div>
      </div>
      <p style="color:#444C6E;font-size:12px;line-height:1.7;margin:0">
        If you did not request a password reset, ignore this email.<br>
        Never share this code with anyone.
      </p>
    </div>
    <div style="background:#080B16;padding:16px 40px;border-top:1px solid rgba(255,255,255,.06)">
      <p style="color:#444C6E;font-size:11px;margin:0">© 2025 VORNIX — <a href="${APP}" style="color:#E8192C">vornix-sooty.vercel.app</a></p>
    </div>
  </div>
</body>
</html>`,
            text: `Your VORNIX password reset code is: ${otp}\n\nExpires in 10 minutes. Never share this code.`,
          });
        } catch (mailErr) {
          console.error('Gmail SMTP error (forgot-password):', mailErr);
        }
      }

      return ok(res, { message: 'If that email is registered, a reset code has been sent.' });
    }


    // ── RESET PASSWORD (verify OTP + set new password) ─────────
    if (action === 'reset-password') {
      if (req.method !== 'POST') return err(res, 'POST required', 405);

      const email       = (body.email       || '').toLowerCase().trim();
      const otp         = (body.otp         || '').trim();
      const newPassword = (body.newPassword || '');

      if (!email || !otp || !newPassword) return err(res, 'Email, code, and new password are required.');

      const pwErr = validatePasswordStrength(newPassword);
      if (pwErr) return err(res, pwErr);

      const { data: otpRow, error: otpErr } = await db()
        .from('otp_codes')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (otpErr || !otpRow) return err(res, 'No reset code found. Please request a new one.');

      if (otpRow.purpose !== 'password_reset') return err(res, 'No reset code found. Please request a new one.');

      if ((otpRow.attempts || 0) >= MAX_ATTEMPTS) {
        await db().from('otp_codes').delete().eq('email', email);
        return err(res, 'Too many failed attempts. Please request a new reset code.', 429);
      }

      if (new Date(otpRow.expires_at) < new Date()) {
        await db().from('otp_codes').delete().eq('email', email);
        return err(res, 'Reset code expired. Please request a new one.');
      }

      const submitted   = Buffer.from(hashOTP(otp),          'hex');
      const stored      = Buffer.from(otpRow.otp_hash || '', 'hex');
      const lengthMatch = submitted.length === stored.length;
      const hashMatch   = lengthMatch && crypto.timingSafeEqual(submitted, stored);

      if (!hashMatch) {
        const newAttempts = (otpRow.attempts || 0) + 1;
        await db().from('otp_codes').update({ attempts: newAttempts }).eq('email', email);
        const remaining = MAX_ATTEMPTS - newAttempts;
        return err(res, remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many failed attempts. Please request a new reset code.');
      }

      // Code valid — delete it
      await db().from('otp_codes').delete().eq('email', email);

      // Fetch profile
      const { data: profile } = await db()
        .from('profiles')
        .select('id,email,full_name,country,is_admin,created_at')
        .eq('email', email)
        .maybeSingle();

      if (!profile) return err(res, 'Account not found.');

      const password_hash   = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      const password_set_at = new Date().toISOString();

      const { error: upErr } = await db()
        .from('profiles')
        .update({ password_hash, password_set_at, updated_at: password_set_at })
        .eq('id', profile.id);

      if (upErr) return err(res, 'Failed to update password: ' + upErr.message);

      // Clear any rate-limit records (best-effort)
      await db().from('login_attempts').delete().eq('email', email);

      // Create session so user is logged in immediately after reset
      const token      = generateToken();
      const expires_at = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const { error: sessErr } = await db().from('sessions').insert({
        token,
        user_id:    profile.id,
        email:      profile.email,
        expires_at,
        created_at: new Date().toISOString(),
      });
      if (sessErr) return err(res, 'Password updated but session error: ' + sessErr.message);

      setSessionCookies(res, token);

      return ok(res, {
        token,
        user: {
          id:         profile.id,
          email:      profile.email,
          full_name:  profile.full_name,
          country:    profile.country,
          is_admin:   profile.is_admin || false,
          created_at: profile.created_at,
        },
        message: 'Password reset successfully.',
      });
    }


    return err(res, `Unknown action: ${action}`, 400);

  } catch (e) {
    console.error('[auth] Unhandled error:', e);
    return err(res, 'Server error: ' + e.message, 500);
  }
};
