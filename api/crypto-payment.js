// ================================================================
// VORNIX — api/crypto-payment.js
// AUTO on-chain verification — BSC (BEP20) USDT only.
// Unique deposit address per invoice derived from HD wallet.
// No TX hash required from the user.
//
// HOW IT WORKS:
//   1. Trader picks plan → server derives a unique BSC deposit address
//   2. Trader sends USDT (BEP20) to that address
//   3. Cron auto-detects the deposit on-chain and activates challenge
//   4. Trader polls action=status to watch pending → paid
//
// POST /api/crypto-payment?action=initiate      → get unique deposit address + amount
// GET  /api/crypto-payment?action=status        → trader: check payment status
// POST /api/crypto-payment?action=verify        → on-demand address scan (polling helper)
// GET  /api/crypto-payment?action=pending       → admin: all pending payments
// PUT  /api/crypto-payment?action=approve       → admin: approve + activate
// PUT  /api/crypto-payment?action=reject        → admin: reject + notify
// GET  /api/crypto-payment?action=cron-verify   → cron: batch scan pending (CRON_SECRET)
// ================================================================

const { ethers }                                                    = require('ethers');
const { supabaseAdmin, getPrice, cors, ok, err, requireUser }       = require('../lib/db');
const { sendEmail }                                                  = require('../lib/emails');

// ── BSC / USDT CONSTANTS ─────────────────────────────────────────

// BSC USDT (Tether) contract
const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';

// Minimum confirmations before accepting (from env or default 5)
function getConfirmations() {
  return parseInt(process.env.PAYMENTS_CONFIRMATIONS_BSC, 10) || 5;
}

const CRON_BATCH_SIZE = 20;

// Maximum tolerated USDT amount difference (handles rounding/fee dust)
const AMOUNT_TOLERANCE_USD = 0.02;

const PLAN_NAMES = {
  one_step:   '1-Step',
  two_step:   '2-Step',
  three_step: '3-Step',
  partial:    'Partial Payment',
};

// ── HD WALLET DERIVATION ─────────────────────────────────────────

/**
 * Derive a BSC/EVM deposit address from the server-side mnemonic + index.
 */
function deriveDepositAddress(index) {
  const phrase   = process.env.PAYMENTS_MNEMONIC;
  const basePath = process.env.PAYMENTS_DERIVATION_PATH || "m/44'/60'/0'/0";

  if (!phrase) {
    console.error('[crypto-payment] PAYMENTS_MNEMONIC is not configured');
    throw new Error('Payment system not configured');
  }

  const mnemonic = ethers.Mnemonic.fromPhrase(phrase);
  const wallet   = ethers.HDNodeWallet.fromMnemonic(mnemonic, `${basePath}/${index}`);
  return wallet.address; // Checksummed 0x address
}

/**
 * Determine the next derivation index by querying the max existing index in payments.
 */
async function nextDerivationIndex() {
  const { data: rows } = await supabaseAdmin
    .from('payments')
    .select('metadata')
    .eq('gateway', 'crypto')
    .not('metadata->derivation_index', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (rows?.length) {
    const idx = rows[0]?.metadata?.derivation_index;
    return typeof idx === 'number' ? idx + 1 : 0;
  }
  return 0;
}

// ── BSCSCAN API HELPERS ────────────────────────────────────────

async function bscApiCall(params) {
  const apiKey = process.env.BSCSCAN_API_KEY || '';
  const qs     = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res    = await fetch(`https://api.bscscan.com/api?${qs}`);
  return res.json();
}

/**
 * Query BscScan tokentx for USDT transfers to a deposit address.
 * Returns the first matching confirmed transfer, or a pending/not-found result.
 */
async function checkDepositByAddress(depositAddress, expectedAmountUSD) {
  const required  = getConfirmations();
  const lowerAddr = depositAddress.toLowerCase();

  const blockData = await bscApiCall({
    module: 'proxy',
    action: 'eth_blockNumber',
  });
  const currentBlock = parseInt(blockData.result, 16);
  if (!currentBlock) return { found: false, reason: 'Blockchain API temporarily unavailable. Please try again in a few moments.' };

  const txData = await bscApiCall({
    module:          'account',
    action:          'tokentx',
    contractaddress: USDT_CONTRACT_BSC,
    address:         depositAddress,
    page:            '1',
    offset:          '50',
    sort:            'desc',
  });

  if (txData?.status === '0' && txData?.message === 'No transactions found') {
    return { found: false, reason: 'No transactions found yet' };
  }

  if (!Array.isArray(txData?.result)) {
    return { found: false, reason: 'BscScan API error: ' + (txData?.message || 'unknown') };
  }

  let bestPending = null;

  for (const tx of txData.result) {
    if ((tx.to || '').toLowerCase() !== lowerAddr) continue;

    const decimals = parseInt(tx.tokenDecimal, 10) || 6;
    const amount   = Number(ethers.formatUnits(tx.value, decimals));

    if (Math.abs(amount - expectedAmountUSD) > AMOUNT_TOLERANCE_USD) continue;

    const txBlock = parseInt(tx.blockNumber, 10);
    const confs   = currentBlock - txBlock;

    if (confs < required) {
      if (!bestPending) bestPending = { txHash: tx.hash, confs, amount };
      continue;
    }

    return {
      found:         true,
      txHash:        tx.hash,
      from:          tx.from,
      to:            tx.to,
      amount,
      symbol:        'USDT',
      blockNumber:   txBlock,
      confirmations: confs,
      explorerUrl:   'https://bscscan.com/tx/' + tx.hash,
    };
  }

  if (bestPending) {
    return {
      found:         false,
      reason:        `Deposit detected — waiting for confirmations: ${bestPending.confs}/${required}`,
      confirmations: bestPending.confs,
      required,
      txHash:        bestPending.txHash,
      pending:       true,
    };
  }

  return { found: false, reason: 'No matching USDT deposit found yet' };
}

// ── SHARED ACTIVATION LOGIC ──────────────────────────────────────

/**
 * Mark payment paid, create challenge, link them. Idempotent.
 */
async function activatePayment(paymentId, payment, depositDetails) {
  if (payment.challenge_id) {
    return { success: true, challenge: { id: payment.challenge_id }, alreadyActivated: true };
  }

  const meta  = payment.metadata || {};
  const plan  = meta.plan;
  const size  = meta.account_size;
  const total = meta.fee_total;

  const newMeta = {
    ...meta,
    ...(depositDetails && {
      tx_hash:       depositDetails.txHash,
      block_number:  depositDetails.blockNumber,
      from_address:  depositDetails.from,
      token_symbol:  depositDetails.symbol,
      confirmed_at:  new Date().toISOString(),
      explorer_url:  depositDetails.explorerUrl,
      confirmations: depositDetails.confirmations,
    }),
  };

  await supabaseAdmin
    .from('payments')
    .update({ gateway_status: 'paid', metadata: newMeta })
    .eq('id', paymentId);

  const { data: challenge, error } = await supabaseAdmin
    .from('challenges')
    .insert({
      user_id:         payment.user_id,
      plan,
      account_size:    size,
      fee_total:       total,
      fee_paid:        payment.amount,
      is_partial_pay:  payment.is_partial,
      partial_balance: payment.is_partial ? total * 0.65 : 0,
      original_size:   Number(size),
      current_size:    Number(size),
      status:          'active',
      start_date:      new Date().toISOString().split('T')[0],
    })
    .select().single();

  if (error) return { success: false, error: error.message };

  await supabaseAdmin
    .from('payments')
    .update({ challenge_id: challenge.id })
    .eq('id', paymentId);

  const profile = payment.profiles;
  if (profile) {
    sendEmail('challengePurchased', profile.email, {
      name:        profile.full_name,
      plan:        PLAN_NAMES[plan] || plan,
      accountSize: size,
      fee:         payment.amount,
      mtLogin:     null,
      mtPassword:  null,
      mtServer:    null,
    }).catch(e => console.error('Activation email failed:', e));
  }

  return { success: true, challenge };
}

// ── ROUTE HANDLER ─────────────────────────────────────────────────

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
      derivationIndex = await nextDerivationIndex();
      depositAddress  = deriveDepositAddress(derivationIndex);
    } catch (e) {
      console.error('Address derivation failed:', e);
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
      .select().single();

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
      result = await checkDepositByAddress(depositAddress, payment.amount);
    } catch (e) {
      console.error('Address scan error:', e);
      return err(res, 'Scan failed: ' + e.message);
    }

    if (!result.found) {
      return ok(res, {
        status:        result.pending ? 'confirming' : 'pending',
        verified:      false,
        reason:        result.reason,
        confirmations: result.confirmations,
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
      .select('gateway_status, gateway_id, amount, currency, metadata, challenge_id, created_at')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (fetchErr) return err(res, 'Payment not found', 404);

    const meta          = data.metadata || {};
    const isConfirming  = data.gateway_status === 'pending' && !!meta.detected_tx_hash;
    const displayStatus = isConfirming ? 'confirming' : data.gateway_status;

    const statusMsg = {
      pending:    'Waiting for your USDT deposit on BSC (BEP20)',
      confirming: 'Deposit detected — waiting for confirmations',
      paid:       'Payment confirmed! Challenge is now active.',
      failed:     'Payment rejected. Please contact support.',
    };

    return ok(res, {
      status:          displayStatus,
      gateway_status:  data.gateway_status,
      amount:          data.amount,
      currency:        data.currency,
      deposit_address: meta.deposit_address,
      challenge_id:    data.challenge_id,
      created_at:      data.created_at,
      confirmations:   meta.confirmations,
      status_message:  statusMsg[displayStatus] || displayStatus,
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
      .in('gateway_status', ['pending', 'submitted'])
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
      .eq('id', paymentId).single();

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

  // ── CRON-VERIFY: batch scan all pending payments ─────────────────
  if (action === 'cron-verify' && req.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET || '';
    const authHeader = req.headers.authorization || '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return err(res, 'Unauthorized', 401);
    }

    const { data: payments, error: fetchErr } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name)')
      .eq('gateway', 'crypto')
      .eq('gateway_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(CRON_BATCH_SIZE);

    if (fetchErr) return err(res, fetchErr.message);
    if (!payments?.length) return ok(res, { processed: 0, message: 'No pending payments' });

    const results = [];
    for (const payment of payments) {
      const depositAddress = payment.metadata?.deposit_address;

      if (!depositAddress) {
        results.push({ id: payment.id, status: 'skipped', reason: 'No deposit_address in metadata' });
        continue;
      }

      if (payment.challenge_id) {
        await supabaseAdmin
          .from('payments')
          .update({ gateway_status: 'paid' })
          .eq('id', payment.id);
        results.push({ id: payment.id, status: 'fixed' });
        continue;
      }

      try {
        const result = await checkDepositByAddress(depositAddress, payment.amount);

        if (result.found) {
          const activation = await activatePayment(payment.id, payment, result);
          results.push({
            id:     payment.id,
            status: activation.success ? 'paid' : 'error',
            error:  activation.error,
          });
        } else if (result.pending) {
          // Store detected tx so status shows "confirming"
          await supabaseAdmin
            .from('payments')
            .update({
              metadata: {
                ...payment.metadata,
                detected_tx_hash: result.txHash,
                confirmations:    result.confirmations,
              },
            })
            .eq('id', payment.id);
          results.push({
            id:            payment.id,
            status:        'confirming',
            reason:        result.reason,
            confirmations: result.confirmations,
          });
        } else {
          results.push({ id: payment.id, status: 'pending', reason: result.reason });
        }
      } catch (e) {
        results.push({ id: payment.id, status: 'error', error: e.message });
      }
    }

    return ok(res, { processed: payments.length, results });
  }

  return err(res, 'Unknown action', 400);
};

// Export shared helpers for cron handler
module.exports.activatePayment       = activatePayment;
module.exports.checkDepositByAddress = checkDepositByAddress;
