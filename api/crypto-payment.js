// ================================================================
// VORNIX — api/crypto-payment.js
// AUTO on-chain verification — BSC (BEP20) USDT only.
// Unique deposit address per invoice derived from HD wallet.
// No TX hash required from the user.
//
// POST /api/crypto-payment?action=initiate      → get unique deposit address + amount
// GET  /api/crypto-payment?action=status        → trader: check payment status
// POST /api/crypto-payment?action=verify        → on-demand address scan (polling helper)
// GET  /api/crypto-payment?action=pending       → admin: all pending payments
// PUT  /api/crypto-payment?action=approve       → admin: approve + activate
// PUT  /api/crypto-payment?action=reject        → admin: reject + notify
// ================================================================

const { supabaseAdmin, getPrice, cors, ok, err, requireUser } = require('../lib/db');
const { sendEmail }                                            = require('../lib/emails');
const { deriveDepositAddress, atomicNextDerivationIndex }      = require('../lib/payments/hdWallet');
const { checkDepositByAddress }                                = require('../lib/payments/bscscan');
const { activatePayment, markConfirming }                      = require('../lib/payments/autoUsdtBsc');

const PLAN_NAMES = {
  one_step:   '1-Step',
  two_step:   '2-Step',
  three_step: '3-Step',
  partial:    'Partial Payment',
};

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── INITIATE ────────────────────────────────────────────────────
  if (action === 'initiate' && req.method === 'POST') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { plan, accountSize } = req.body || {};
    if (!plan || !accountSize) return err(res, 'plan and accountSize required');

    if (!process.env.PAYMENTS_MNEMONIC) {
      return err(res, 'Payment system not configured. Please contact support.');
    }

    const price = getPrice(plan, accountSize);
    if (!price) return err(res, 'Invalid plan or account size');

    const chargeAmount = plan === 'partial'
      ? Math.round(price * 0.35 * 100) / 100
      : price;

    const reference = 'VRX-' + Date.now().toString(36).toUpperCase();

    let depositAddress, derivationIndex;
    try {
      derivationIndex = await atomicNextDerivationIndex();
      depositAddress  = deriveDepositAddress(derivationIndex);
    } catch (e) {
      console.error('[crypto-payment] Address derivation failed:', e);
      return err(res, 'Failed to generate deposit address. Please contact support.');
    }

    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id:        user.id,
        amount:         chargeAmount,
        currency:       'USDT',
        gateway:        'crypto',
        gateway_id:     reference,
        gateway_status: 'pending',
        is_partial:     plan === 'partial',
        metadata: {
          plan,
          account_size:     String(accountSize),
          fee_total:        price,
          network:          'USDT_BEP20',
          reference,
          deposit_address:  depositAddress,
          derivation_index: derivationIndex,
        },
      })
      .select()
      .single();

    if (error) return err(res, error.message);

    return ok(res, {
      reference,
      payment_id:      payment.id,
      deposit_address: depositAddress,
      amount:          chargeAmount,
      currency:        'USDT',
      network:         'BSC (BEP20)',
      network_note:    'BNB Smart Chain — send USDT (BEP20) only',
      plan,
      plan_name:       PLAN_NAMES[plan] || plan,
      account_size:    accountSize,
      fee_total:       price,
      is_partial:      plan === 'partial',
      partial_note:    plan === 'partial'
        ? `35% upfront. Remaining $${(price - chargeAmount).toFixed(2)} deducted from first profit withdrawal.`
        : null,
    });
  }

  // ── SUBMIT: disabled in AUTO mode ───────────────────────────────
  if (action === 'submit') {
    return err(res,
      'TX hash submission is no longer required. Your payment is detected automatically once confirmed on-chain.',
      410,
    );
  }

  // ── VERIFY: on-demand address scan ─────────────────────────────
  if (action === 'verify' && req.method === 'POST') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { paymentId } = req.body || {};
    if (!paymentId) return err(res, 'paymentId required');

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name)')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (!payment) return err(res, 'Payment not found', 404);

    if (payment.gateway_status === 'paid') {
      return ok(res, {
        status:       'paid',
        challenge_id: payment.challenge_id,
        message:      'Payment already confirmed',
      });
    }

    const depositAddress = payment.metadata?.deposit_address;
    if (!depositAddress) return err(res, 'No deposit address on record for this payment');

    let result;
    try {
      result = await checkDepositByAddress(depositAddress, payment.amount, payment.created_at);
    } catch (e) {
      console.error('[crypto-payment] Address scan error:', e);
      return err(res, 'Scan failed: ' + e.message);
    }

    if (!result.found) {
      if (result.pending) {
        await markConfirming(paymentId, payment, result);
      }
      return ok(res, {
        status:        result.pending ? 'confirming' : 'pending',
        verified:      false,
        reason:        result.reason,
        confirmations: result.confirmations || null,
        required:      result.required      || null,
        tx_hash:       result.txHash        || null,
        explorer_url:  result.txHash ? 'https://bscscan.com/tx/' + result.txHash : null,
        pending:       result.pending || false,
      });
    }

    const activation = await activatePayment(paymentId, payment, result);
    if (!activation.success) return err(res, activation.error);

    return ok(res, {
      status:       'paid',
      verified:     true,
      challenge_id: activation.challenge.id,
      message:      activation.alreadyActivated
        ? 'Payment already confirmed'
        : 'Payment detected on-chain! Challenge is now active.',
    });
  }

  // ── STATUS: trader polls payment status ─────────────────────────
  if (action === 'status' && req.method === 'GET') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { paymentId } = req.query;
    if (!paymentId) return err(res, 'paymentId required');

    const { data, error: fetchErr } = await supabaseAdmin
      .from('payments')
      .select([
        'gateway_status', 'gateway_id', 'amount', 'currency', 'metadata',
        'challenge_id', 'created_at',
        'detected_tx_hash', 'detected_at', 'confirmed_at', 'explorer_url', 'confirmations',
      ].join(', '))
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (fetchErr) return err(res, 'Payment not found', 404);

    const meta = data.metadata || {};

    // Normalize status: if gateway_status is 'pending' but we have a detected tx,
    // display it as 'confirming' (handles rows created before the explicit status was added)
    let displayStatus = data.gateway_status;
    if (displayStatus === 'pending' && (data.detected_tx_hash || meta.detected_tx_hash)) {
      displayStatus = 'confirming';
    }

    const txHash      = data.detected_tx_hash || meta.detected_tx_hash || null;
    const explorerUrl = data.explorer_url      || (txHash ? `https://bscscan.com/tx/${txHash}` : null);
    const confs       = data.confirmations     ?? meta.confirmations    ?? null;
    const required    = parseInt(process.env.PAYMENTS_CONFIRMATIONS_BSC, 10) || 5;

    const statusMsg = {
      pending:    'Waiting for your USDT deposit on BSC (BEP20)',
      confirming: confs != null
        ? `Deposit detected — waiting for confirmations (${confs}/${required})`
        : 'Deposit detected — waiting for confirmations',
      paid:       'Payment confirmed! Your challenge is now active.',
      failed:     'Payment rejected. Please contact support.',
    };

    return ok(res, {
      status:                 displayStatus,
      gateway_status:         data.gateway_status,
      amount:                 data.amount,
      currency:               data.currency,
      deposit_address:        meta.deposit_address,
      challenge_id:           data.challenge_id,
      created_at:             data.created_at,
      confirmations:          confs,
      required_confirmations: required,
      tx_hash:                txHash,
      explorer_url:           explorerUrl,
      detected_at:            data.detected_at  || null,
      confirmed_at:           data.confirmed_at || null,
      status_message:         statusMsg[displayStatus] || displayStatus,
    });
  }

  // ── PENDING: admin lists unresolved payments ────────────────────
  if (action === 'pending' && req.method === 'GET') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);
    if (!user?.is_admin) return err(res, 'Admin required', 403);

    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name, country)')
      .eq('gateway', 'crypto')
      .in('gateway_status', ['pending', 'confirming', 'submitted'])
      .order('created_at', { ascending: false });

    if (error) return err(res, error.message);
    return ok(res, data);
  }

  // ── APPROVE: admin manually approves ───────────────────────────
  if (action === 'approve' && req.method === 'PUT') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);
    if (!user?.is_admin) return err(res, 'Admin required', 403);

    const { paymentId } = req.body || {};
    if (!paymentId) return err(res, 'paymentId required');

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name)')
      .eq('id', paymentId)
      .single();

    if (!payment) return err(res, 'Payment not found', 404);

    const activation = await activatePayment(paymentId, payment, null);
    if (!activation.success) return err(res, activation.error);

    return ok(res, {
      challenge: activation.challenge,
      message:   activation.alreadyActivated
        ? 'Payment was already activated'
        : 'Payment approved and challenge created!',
    });
  }

  // ── REJECT: admin rejects invalid payment ───────────────────────
  if (action === 'reject' && req.method === 'PUT') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);
    if (!user?.is_admin) return err(res, 'Admin required', 403);

    const { paymentId, reason } = req.body || {};
    if (!paymentId) return err(res, 'paymentId required');

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name)')
      .eq('id', paymentId)
      .single();

    if (!payment) return err(res, 'Payment not found', 404);

    await supabaseAdmin
      .from('payments')
      .update({
        gateway_status: 'failed',
        metadata: { ...payment.metadata, reject_reason: reason },
      })
      .eq('id', paymentId);

    if (payment.profiles) {
      sendEmail('payoutRejected', payment.profiles.email, {
        name:   payment.profiles.full_name,
        reason: reason || 'Transaction could not be verified. Please contact support.',
      }).catch(e => console.error('[crypto-payment] Reject email failed:', e));
    }

    return ok(res, { message: 'Payment rejected' });
  }

  return err(res, 'Unknown action', 400);
};

// Re-export lib helpers so existing code that imports from this file
// (e.g. older cron-verify.js versions) continues to work.
module.exports.activatePayment       = activatePayment;
module.exports.checkDepositByAddress = checkDepositByAddress;
module.exports.markConfirming        = markConfirming;
