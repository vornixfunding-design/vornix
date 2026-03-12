// ================================================================
// VORNIX — api/crypto-payment.js
// Replaces Stripe entirely. Works 100% in India via Binance.
//
// HOW IT WORKS:
//   1. Trader picks plan → sees your wallet address + exact amount
//   2. Trader sends USDT (or BNB/ETH) to your wallet
//   3. Trader submits their TX hash as proof
//   4. Admin verifies on blockchain explorer → approves
//   5. Challenge is activated automatically
//
// POST /api/crypto-payment?action=initiate   → get wallet + amount
// POST /api/crypto-payment?action=submit     → trader submits TX hash
// GET  /api/crypto-payment?action=pending    → admin: all pending
// PUT  /api/crypto-payment?action=approve    → admin: approve + activate
// PUT  /api/crypto-payment?action=reject     → admin: reject + notify
// GET  /api/crypto-payment?action=status     → trader: check status
// ================================================================

const { supabase, supabaseAdmin, getPrice, cors, ok, err } = require('../lib/db');
const { sendEmail } = require('../lib/emails');

// ── YOUR WALLET ADDRESSES ─────────────────────────────────────────
// PUT YOUR REAL BINANCE WALLET ADDRESSES HERE
// Get them from: Binance App → Wallet → Receive → copy address
const WALLETS = {
  USDT_BEP20: process.env.WALLET_USDT_BEP20 || 'YOUR_BEP20_ADDRESS_HERE',  // Cheapest fees (~$0.10)
  USDT_TRC20: process.env.WALLET_USDT_TRC20 || 'YOUR_TRC20_ADDRESS_HERE',  // Also cheap
  USDT_ERC20: process.env.WALLET_USDT_ERC20 || 'YOUR_ERC20_ADDRESS_HERE',  // Higher fees
  BNB_BEP20:  process.env.WALLET_BNB_BEP20  || 'YOUR_BNB_ADDRESS_HERE',
};

// Network display names and explorer URLs
const NETWORKS = {
  USDT_BEP20: {
    name:     'USDT (BNB Smart Chain / BEP20)',
    symbol:   'USDT',
    network:  'BNB Smart Chain',
    explorer: 'https://bscscan.com/tx/',
    note:     'Recommended — lowest fees (~$0.10)',
  },
  USDT_TRC20: {
    name:     'USDT (TRON / TRC20)',
    symbol:   'USDT',
    network:  'TRON',
    explorer: 'https://tronscan.org/#/transaction/',
    note:     'Low fees, fast',
  },
  USDT_ERC20: {
    name:     'USDT (Ethereum / ERC20)',
    symbol:   'USDT',
    network:  'Ethereum',
    explorer: 'https://etherscan.io/tx/',
    note:     'Higher gas fees',
  },
  BNB_BEP20: {
    name:     'BNB (BNB Smart Chain)',
    symbol:   'BNB',
    network:  'BNB Smart Chain',
    explorer: 'https://bscscan.com/tx/',
    note:     'Pay in BNB',
  },
};

async function getUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user;
}

async function isAdmin(userId) {
  const { data } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', userId).single();
  return data?.is_admin === true;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── INITIATE: get wallet address + amount to pay ───────────────
  if (action === 'initiate' && req.method === 'POST') {
    const user = await getUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { plan, accountSize, network = 'USDT_BEP20' } = req.body || {};
    if (!plan || !accountSize) return err(res, 'plan and accountSize required');
    if (!WALLETS[network])     return err(res, 'Invalid network');

    const price = getPrice(plan, accountSize);
    if (!price) return err(res, 'Invalid plan or account size');

    const planNames = {
      one_step: '1-Step', two_step: '2-Step',
      three_step: '3-Step', partial: 'Partial Payment',
    };

    // For partial plan: only charge 35% upfront
    const chargeAmount = plan === 'partial'
      ? Math.round(price * 0.35 * 100) / 100
      : price;

    // Create a pending payment record with a unique reference
    const reference = 'VRX-' + Date.now().toString(36).toUpperCase();

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
          account_size: String(accountSize),
          fee_total:    price,
          network,
          reference,
        },
      })
      .select().single();

    if (error) return err(res, error.message);

    return ok(res, {
      reference,
      payment_id:   payment.id,
      amount:       chargeAmount,
      currency:     'USDT',
      wallet:       WALLETS[network],
      network:      NETWORKS[network],
      plan,
      plan_name:    planNames[plan],
      account_size: accountSize,
      fee_total:    price,
      is_partial:   plan === 'partial',
      partial_note: plan === 'partial'
        ? `This is 35% upfront. Remaining $${(price - chargeAmount).toFixed(2)} deducted from first profit withdrawal.`
        : null,
      instructions: [
        `Send exactly ${chargeAmount} USDT to the wallet address shown`,
        `Use the ${NETWORKS[network].network} network ONLY`,
        `Include your reference code ${reference} in the memo/tag if your exchange supports it`,
        'After sending, copy your Transaction Hash (TX ID) and paste it below',
        'Admin will verify on blockchain explorer and activate your account within 1-4 hours',
      ],
    });
  }

  // ── SUBMIT: trader submits TX hash after sending crypto ────────
  if (action === 'submit' && req.method === 'POST') {
    const user = await getUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { paymentId, txHash, network = 'USDT_BEP20' } = req.body || {};
    if (!paymentId || !txHash) return err(res, 'paymentId and txHash required');

    // Validate TX hash format (basic check)
    if (txHash.length < 20) return err(res, 'Invalid transaction hash');

    // Get payment record
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (!payment)                         return err(res, 'Payment not found', 404);
    if (payment.gateway_status === 'paid') return err(res, 'Payment already confirmed');

    const explorerUrl = NETWORKS[network]?.explorer + txHash;

    // Update payment with TX hash
    await supabaseAdmin
      .from('payments')
      .update({
        gateway_status: 'submitted',
        metadata: {
          ...payment.metadata,
          tx_hash:      txHash,
          network,
          explorer_url: explorerUrl,
          submitted_at: new Date().toISOString(),
        },
      })
      .eq('id', paymentId);

    // Get user profile for notification
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('email, full_name').eq('id', user.id).single();

    // Email admin alert
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      sendEmail('adminPaymentAlert', adminEmail, {
        traderName:  profile?.full_name || 'Unknown',
        traderEmail: profile?.email,
        amount:      payment.amount,
        reference:   payment.gateway_id,
        txHash,
        explorerUrl,
        network:     NETWORKS[network]?.name,
        paymentId,
      }).catch(e => console.error('Admin alert email failed:', e));
    }

    // Confirmation to trader
    if (profile) {
      sendEmail('paymentSubmitted', profile.email, {
        name:        profile.full_name,
        amount:      payment.amount,
        txHash,
        explorerUrl,
        reference:   payment.gateway_id,
      }).catch(e => console.error('Submission email failed:', e));
    }

    return ok(res, {
      message: 'Payment submitted! Admin will verify within 1-4 hours and activate your account.',
      explorer_url: explorerUrl,
      reference: payment.gateway_id,
    });
  }

  // ── PENDING: admin gets all submitted payments waiting review ──
  if (action === 'pending' && req.method === 'GET') {
    const user = await getUser(req);
    if (!user) return err(res, 'Unauthorized', 401);
    if (!await isAdmin(user.id)) return err(res, 'Admin required', 403);

    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name, country)')
      .eq('gateway', 'crypto')
      .in('gateway_status', ['submitted', 'pending'])
      .order('created_at', { ascending: false });

    if (error) return err(res, error.message);
    return ok(res, data);
  }

  // ── APPROVE: admin verifies TX and activates challenge ─────────
  if (action === 'approve' && req.method === 'PUT') {
    const user = await getUser(req);
    if (!user) return err(res, 'Unauthorized', 401);
    if (!await isAdmin(user.id)) return err(res, 'Admin required', 403);

    const { paymentId } = req.body || {};
    if (!paymentId) return err(res, 'paymentId required');

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name)')
      .eq('id', paymentId).single();

    if (!payment) return err(res, 'Payment not found', 404);

    const meta = payment.metadata || {};
    const plan  = meta.plan;
    const size  = meta.account_size;
    const total = meta.fee_total;

    // Mark payment as paid
    await supabaseAdmin
      .from('payments')
      .update({ gateway_status: 'paid' })
      .eq('id', paymentId);

    // Create challenge (phases auto-created by DB trigger)
    const { data: challenge, error } = await supabaseAdmin
      .from('challenges')
      .insert({
        user_id:        payment.user_id,
        plan,
        account_size:   size,
        fee_total:      total,
        fee_paid:       payment.amount,
        is_partial_pay: payment.is_partial,
        partial_balance: payment.is_partial ? total * 0.65 : 0,
        original_size:  Number(size),
        current_size:   Number(size),
        status:         'active',
        start_date:     new Date().toISOString().split('T')[0],
      })
      .select().single();

    if (error) return err(res, error.message);

    // Link payment to challenge
    await supabaseAdmin
      .from('payments')
      .update({ challenge_id: challenge.id })
      .eq('id', paymentId);

    // Send challenge activation email to trader
    if (payment.profiles) {
      const planNames = { one_step:'1-Step', two_step:'2-Step', three_step:'3-Step', partial:'Partial Payment' };
      sendEmail('challengePurchased', payment.profiles.email, {
        name:        payment.profiles.full_name,
        plan:        planNames[plan],
        accountSize: size,
        fee:         payment.amount,
        mtLogin:     null, mtPassword: null, mtServer: null,
      }).catch(e => console.error('Activation email failed:', e));
    }

    return ok(res, { challenge, message: 'Payment approved and challenge created!' });
  }

  // ── REJECT: admin rejects invalid/fake payment ─────────────────
  if (action === 'reject' && req.method === 'PUT') {
    const user = await getUser(req);
    if (!user) return err(res, 'Unauthorized', 401);
    if (!await isAdmin(user.id)) return err(res, 'Admin required', 403);

    const { paymentId, reason } = req.body || {};
    if (!paymentId) return err(res, 'paymentId required');

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name)')
      .eq('id', paymentId).single();

    if (!payment) return err(res, 'Payment not found', 404);

    await supabaseAdmin
      .from('payments')
      .update({ gateway_status: 'failed', metadata: { ...payment.metadata, reject_reason: reason } })
      .eq('id', paymentId);

    if (payment.profiles) {
      sendEmail('payoutRejected', payment.profiles.email, {
        name:   payment.profiles.full_name,
        reason: reason || 'Transaction could not be verified. Please contact support.',
      }).catch(e => console.error('Reject email failed:', e));
    }

    return ok(res, { message: 'Payment rejected' });
  }

  // ── STATUS: trader checks their payment status ─────────────────
  if (action === 'status' && req.method === 'GET') {
    const user = await getUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { paymentId } = req.query;
    if (!paymentId) return err(res, 'paymentId required');

    const { data, error } = await supabase
      .from('payments')
      .select('gateway_status, gateway_id, amount, currency, metadata, challenge_id, created_at')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (error) return err(res, 'Payment not found', 404);

    const statusMsg = {
      pending:   'Waiting for your payment',
      submitted: 'Payment submitted — admin verifying (1-4 hours)',
      paid:      'Payment confirmed! Challenge is active.',
      failed:    'Payment rejected. Please contact support.',
    };

    return ok(res, {
      ...data,
      status_message: statusMsg[data.gateway_status] || data.gateway_status,
    });
  }

  return err(res, 'Unknown action', 400);
};
