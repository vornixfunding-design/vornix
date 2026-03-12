// ================================================================
// VORNIX — lib/emails.js
// HTML email templates for every triggered email
// Uses Resend (free — 3000 emails/month at resend.com)
// ================================================================

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.EMAIL_FROM || 'VORNIX <noreply@vornix.com>';
const APP    = process.env.APP_URL    || 'https://vornix.com';

// ── SHARED STYLES ─────────────────────────────────────────────
const BASE = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#08090F;font-family:Inter,Arial,sans-serif;color:#D8DAED;}
  .wrap{max-width:600px;margin:0 auto;background:#0C0F1E;border:1px solid rgba(255,255,255,.06);}
  .hd{padding:28px 32px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:12px;}
  .logo{font-family:Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:4px;color:#fff;}
  .logo span{color:#B8000F;}
  .tag{font-size:9px;letter-spacing:2px;color:#343654;text-transform:uppercase;margin-top:2px;}
  .body{padding:36px 32px;}
  .eyebrow{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#B8000F;margin-bottom:14px;}
  h1{font-size:28px;font-weight:900;color:#fff;letter-spacing:1px;margin-bottom:16px;line-height:1.2;}
  p{font-size:15px;color:#6B7A99;line-height:1.75;margin-bottom:14px;}
  p strong{color:#D8DAED;}
  .btn{display:inline-block;background:#B8000F;color:#fff;padding:13px 36px;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;margin:18px 0;clip-path:polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%);}
  .stat-row{display:flex;gap:1px;background:rgba(255,255,255,.05);margin:22px 0;}
  .stat{background:#111428;padding:16px 20px;flex:1;}
  .stat-val{font-size:22px;font-weight:900;color:#fff;letter-spacing:1px;}
  .stat-key{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#343654;margin-top:4px;}
  .box{background:#111428;border-left:3px solid #B8000F;padding:16px 20px;margin:18px 0;}
  .box-gold{border-left-color:#C4982A;}
  .box-green{border-left-color:#17956A;}
  .box p{margin:0;font-size:14px;}
  .ft{padding:24px 32px;border-top:1px solid rgba(255,255,255,.05);font-size:11px;color:#343654;line-height:1.7;}
  .ft a{color:#6B7A99;text-decoration:none;}
  .divider{height:1px;background:rgba(255,255,255,.05);margin:18px 0;}
</style></head><body>
<div class="wrap">
  <div class="hd">
    <div>
      <div class="logo">VORN<span>IX</span></div>
      <div class="tag">Next Generation Prop Firm</div>
    </div>
  </div>
  <div class="body">${content}</div>
  <div class="ft">
    © 2025 VORNIX. All rights reserved.<br>
    <a href="${APP}">vornix.com</a> · 
    <a href="${APP}/dashboard">Dashboard</a> · 
    Trading involves significant risk of loss.
  </div>
</div>
</body></html>`;

// ── TEMPLATES ─────────────────────────────────────────────────
const templates = {

  welcome: ({ name, loginUrl }) => ({
    subject: 'Welcome to VORNIX — Your Account Is Ready',
    html: BASE(`
      <div class="eyebrow">// Account Created</div>
      <h1>Welcome, ${name}.</h1>
      <p>Your VORNIX account is live. You're one step away from accessing <strong>funded capital up to $100,000</strong> and keeping up to 95% of every dollar you generate.</p>
      <p>Choose from 4 evaluation paths — 1-Step, 2-Step, 3-Step or Partial Payment. All plans include Forex, Indices, Commodities, Crypto and Stocks.</p>
      <a href="${loginUrl || APP + '/dashboard'}" class="btn">Access Your Dashboard →</a>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">95%</div><div class="stat-key">Max Split</div></div>
        <div class="stat"><div class="stat-val">$100K</div><div class="stat-key">Max Capital</div></div>
        <div class="stat"><div class="stat-val">4</div><div class="stat-key">Challenge Types</div></div>
      </div>
      <p>If you have any questions, reply to this email or contact us on Telegram <strong>@VornixSupport</strong>.</p>
    `)
  }),

  challengePurchased: ({ name, plan, accountSize, fee, mtLogin, mtPassword, mtServer }) => ({
    subject: `VORNIX — ${plan} Challenge Activated ($${Number(accountSize).toLocaleString()})`,
    html: BASE(`
      <div class="eyebrow">// Challenge Activated</div>
      <h1>Your challenge is live.</h1>
      <p>Your <strong>${plan} — $${Number(accountSize).toLocaleString()} account</strong> has been activated. Your trading credentials are below.</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">$${Number(accountSize).toLocaleString()}</div><div class="stat-key">Account Size</div></div>
        <div class="stat"><div class="stat-val">${plan}</div><div class="stat-key">Plan</div></div>
        <div class="stat"><div class="stat-val">$${fee}</div><div class="stat-key">Fee Paid</div></div>
      </div>
      <div class="box">
        <p><strong>MT5 Login:</strong> ${mtLogin || 'Being assigned — check back in 1 hour'}</p>
        <p><strong>MT5 Password:</strong> ${mtPassword || '—'}</p>
        <p><strong>MT5 Server:</strong> ${mtServer || '—'}</p>
        <p><strong>Platform:</strong> MetaTrader 5</p>
      </div>
      <a href="${APP}/dashboard" class="btn">View Challenge Dashboard →</a>
      <p>Track your real-time progress, daily loss, drawdown and profit from your dashboard. Good luck.</p>
    `)
  }),

  phasePassed: ({ name, phaseNumber, plan, nextTarget }) => ({
    subject: `VORNIX — Phase ${phaseNumber} Passed ✓`,
    html: BASE(`
      <div class="eyebrow">// Phase ${phaseNumber} Complete</div>
      <h1>Phase ${phaseNumber} passed.</h1>
      <p>Excellent trading, <strong>${name}</strong>. You have successfully completed <strong>Phase ${phaseNumber}</strong> of your ${plan} evaluation.</p>
      <div class="box box-green">
        <p><strong>Next:</strong> Phase ${phaseNumber + 1} is now active. Target: <strong>${nextTarget}% profit</strong>.</p>
      </div>
      <a href="${APP}/dashboard" class="btn">Continue Trading →</a>
      <p>Stay disciplined. Keep your drawdown under control. You're close.</p>
    `)
  }),

  challengePassed: ({ name, plan, accountSize }) => ({
    subject: 'VORNIX — Challenge Passed ✓ — Funded Account Coming',
    html: BASE(`
      <div class="eyebrow">// Challenge Passed</div>
      <h1>You passed. Funded account incoming.</h1>
      <p>Congratulations, <strong>${name}</strong>. You have successfully completed the <strong>${plan} evaluation</strong> on your <strong>$${Number(accountSize).toLocaleString()} account</strong>.</p>
      <div class="box box-green">
        <p>Your funded account credentials will be sent within <strong>24 hours</strong>. You will be able to withdraw profits from <strong>Day 1</strong>.</p>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">Day 1</div><div class="stat-key">First Withdrawal</div></div>
        <div class="stat"><div class="stat-val">1–3 Days</div><div class="stat-key">Payout Processing</div></div>
        <div class="stat"><div class="stat-val">+25%</div><div class="stat-key">Scaling per 10%</div></div>
      </div>
      <a href="${APP}/dashboard" class="btn">View Funded Account →</a>
    `)
  }),

  fundedAccount: ({ name, plan, accountSize, mtLogin, mtPassword, mtServer, profitSplit }) => ({
    subject: `VORNIX — Funded Account Active ($${Number(accountSize).toLocaleString()})`,
    html: BASE(`
      <div class="eyebrow">// You Are Now Funded</div>
      <h1>You are funded.</h1>
      <p><strong>${name}</strong>, your live funded account is now active. Trade with <strong>real VORNIX capital</strong> and keep <strong>${profitSplit}% of every dollar you generate</strong>.</p>
      <div class="box">
        <p><strong>MT5 Login:</strong> ${mtLogin}</p>
        <p><strong>MT5 Password:</strong> ${mtPassword}</p>
        <p><strong>MT5 Server:</strong> ${mtServer}</p>
        <p><strong>Account Size:</strong> $${Number(accountSize).toLocaleString()}</p>
        <p><strong>Profit Split:</strong> ${profitSplit}%</p>
      </div>
      <div class="box box-gold">
        <p><strong>Scaling:</strong> Every 10% cumulative profit = 25% account size increase. Automatic. Up to $100,000.</p>
      </div>
      <a href="${APP}/dashboard" class="btn">Request Payout / View Stats →</a>
      <p>Withdrawals are available from Day 1. Processed via crypto, Wise or bank within 1–3 business days.</p>
    `)
  }),

  payoutRequested: ({ name, amount, method, traderShare, partialDeduct }) => ({
    subject: `VORNIX — Payout Request Received ($${amount})`,
    html: BASE(`
      <div class="eyebrow">// Payout Requested</div>
      <h1>Payout request received.</h1>
      <p>We have received your payout request, <strong>${name}</strong>. Here's your summary:</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">$${amount}</div><div class="stat-key">Requested</div></div>
        <div class="stat"><div class="stat-val">$${traderShare}</div><div class="stat-key">Your Share</div></div>
        <div class="stat"><div class="stat-val">${method}</div><div class="stat-key">Method</div></div>
      </div>
      ${partialDeduct > 0 ? `<div class="box box-gold"><p>Note: <strong>$${partialDeduct}</strong> partial payment balance will be deducted from this withdrawal.</p></div>` : ''}
      <p>Processing time: <strong>1–3 business days</strong>. You will receive a confirmation email once your payment is sent.</p>
      <a href="${APP}/dashboard" class="btn">View Payout Status →</a>
    `)
  }),

  payoutPaid: ({ name, amount, traderShare, method, txRef }) => ({
    subject: `VORNIX — Payout Sent ✓ ($${traderShare})`,
    html: BASE(`
      <div class="eyebrow">// Payout Sent</div>
      <h1>Your payout has been sent.</h1>
      <p>Payment of <strong>$${traderShare}</strong> has been sent to your ${method} account, <strong>${name}</strong>.</p>
      <div class="box box-green">
        <p><strong>Amount Sent:</strong> $${traderShare}</p>
        <p><strong>Method:</strong> ${method}</p>
        ${txRef ? `<p><strong>Transaction Reference:</strong> ${txRef}</p>` : ''}
      </div>
      <p>Allow 1–24 hours for crypto, 1–3 business days for Wise and bank transfer.</p>
      <a href="${APP}/dashboard" class="btn">View Dashboard →</a>
    `)
  }),

  payoutRejected: ({ name, reason }) => ({
    subject: 'VORNIX — Payout Request — Action Required',
    html: BASE(`
      <div class="eyebrow">// Payout Update</div>
      <h1>Action required on your payout.</h1>
      <p>There was an issue with your payout request, <strong>${name}</strong>.</p>
      <div class="box">
        <p><strong>Reason:</strong> ${reason || 'Please contact support for details.'}</p>
      </div>
      <p>Please contact our support team via Telegram <strong>@VornixSupport</strong> or email to resolve this.</p>
      <a href="${APP}/contact" class="btn">Contact Support →</a>
    `)
  }),

  affiliateCommission: ({ name, commissionAmount, referredUser, challengePlan }) => ({
    subject: `VORNIX — Commission Earned ($${commissionAmount})`,
    html: BASE(`
      <div class="eyebrow">// Commission Earned</div>
      <h1>You earned a commission.</h1>
      <p>Your referral converted, <strong>${name}</strong>. A new trader used your affiliate link and purchased a <strong>${challengePlan}</strong> challenge.</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-val">$${commissionAmount}</div><div class="stat-key">Commission</div></div>
        <div class="stat"><div class="stat-val">10%</div><div class="stat-key">Commission Rate</div></div>
      </div>
      <p>Your commission has been added to your affiliate balance. Withdraw it from your affiliate dashboard.</p>
      <a href="${APP}/dashboard" class="btn">View Affiliate Dashboard →</a>
    `)
  }),

  paymentSubmitted: ({ name, amount, txHash, explorerUrl, reference }) => ({
    subject: `VORNIX — Payment Received — Verifying Now`,
    html: BASE(`
      <div class="eyebrow">// Payment Submitted</div>
      <h1>We received your payment.</h1>
      <p>Thank you <strong>${name}</strong>. Your crypto payment has been submitted and is being verified by our team. This usually takes <strong>1–4 hours</strong>.</p>
      <div class="box">
        <p><strong>Amount:</strong> ${amount} USDT</p>
        <p><strong>Reference:</strong> ${reference}</p>
        <p><strong>TX Hash:</strong> <span style="font-family:monospace;font-size:12px;word-break:break-all">${txHash}</span></p>
        ${explorerUrl ? `<p style="margin-top:8px"><a href="${explorerUrl}" style="color:#B8000F">View on Blockchain Explorer →</a></p>` : ''}
      </div>
      <p>Once verified, your challenge credentials (MT5 login, password, server) will be sent to this email automatically.</p>
      <a href="${APP}/dashboard" class="btn">View Dashboard →</a>
    `)
  }),

  adminPaymentAlert: ({ traderName, traderEmail, amount, reference, txHash, explorerUrl, network, paymentId }) => ({
    subject: `VORNIX Admin — New Payment to Verify — ${amount} USDT`,
    html: BASE(`
      <div class="eyebrow">// Admin Alert</div>
      <h1>New crypto payment to verify.</h1>
      <div class="box">
        <p><strong>Trader:</strong> ${traderName} (${traderEmail})</p>
        <p><strong>Amount:</strong> ${amount} USDT</p>
        <p><strong>Network:</strong> ${network}</p>
        <p><strong>Reference:</strong> ${reference}</p>
        <p><strong>TX Hash:</strong> <span style="font-family:monospace;font-size:12px;word-break:break-all">${txHash}</span></p>
        ${explorerUrl ? `<p style="margin-top:8px"><a href="${explorerUrl}" style="color:#B8000F">Verify on Blockchain Explorer →</a></p>` : ''}
      </div>
      <p>Payment ID: <code>${paymentId}</code></p>
      <a href="${APP}/admin" class="btn">Go to Admin Panel →</a>
    `)
  }),

  passwordReset: ({ resetUrl }) => ({
    subject: 'VORNIX — Reset Your Password',
    html: BASE(`
      <div class="eyebrow">// Password Reset</div>
      <h1>Reset your password.</h1>
      <p>We received a request to reset the password for your VORNIX account. Click the button below to set a new password.</p>
      <a href="${resetUrl}" class="btn">Reset Password →</a>
      <p>This link expires in <strong>1 hour</strong>. If you did not request this, ignore this email — your account is safe.</p>
    `)
  }),

};

// ── SEND FUNCTION ─────────────────────────────────────────────
async function sendEmail(type, to, data) {
  const tmpl = templates[type];
  if (!tmpl) throw new Error(`Unknown email type: ${type}`);

  const { subject, html } = tmpl(data);

  const { data: result, error } = await resend.emails.send({
    from: FROM,
    to:   Array.isArray(to) ? to : [to],
    subject,
    html,
  });

  if (error) throw error;
  return result;
}

module.exports = { sendEmail, templates };
