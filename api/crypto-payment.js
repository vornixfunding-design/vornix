// ================================================================
// VORNIX — api/crypto-payment.js
// Auto on-chain verification via BscScan / Etherscan APIs.
// TRC20 / TRON support removed.
//
// HOW IT WORKS:
//   1. Trader picks plan → sees your wallet address + exact amount
//   2. Trader sends USDT or BNB to your wallet
//   3. Trader submits their TX hash as proof
//   4. System auto-verifies on-chain and activates challenge
//   5. Background cron re-checks any missed verifications
//
// POST /api/crypto-payment?action=initiate      → get wallet + amount
// POST /api/crypto-payment?action=submit        → trader submits TX hash
// POST /api/crypto-payment?action=verify        → auto-verify on-chain
// GET  /api/crypto-payment?action=pending       → admin: all pending
// PUT  /api/crypto-payment?action=approve       → admin: approve + activate
// PUT  /api/crypto-payment?action=reject        → admin: reject + notify
// GET  /api/crypto-payment?action=status        → trader: check status
// GET  /api/crypto-payment?action=cron-verify   → cron: batch verify (CRON_SECRET)
// ================================================================

const { supabaseAdmin, getPrice, cors, ok, err, requireUser } = require('../lib/db');
const { sendEmail } = require('../lib/emails');

// ── YOUR WALLET ADDRESSES ─────────────────────────────────────────
const WALLETS = {
  USDT_BEP20: process.env.WALLET_USDT_BEP20 || 'YOUR_BEP20_ADDRESS_HERE',
  USDT_ERC20: process.env.WALLET_USDT_ERC20 || 'YOUR_ERC20_ADDRESS_HERE',
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

// ── ON-CHAIN VERIFICATION ─────────────────────────────────────────

// Official USDT contract addresses
const USDT_CONTRACTS = {
  USDT_BEP20: '0x55d398326f99059fF775485246999027B3197955',
  USDT_ERC20: '0xdac17f958d2ee523a2206206994597c13d831ec7',
};

// Minimum confirmations before accepting a payment
const CONFIRMATION_THRESHOLD = {
  USDT_BEP20: 5,
  BNB_BEP20:  5,
  USDT_ERC20: 12,
};

const CRON_BATCH_SIZE = 20;

// ERC-20 Transfer(address,address,uint256) topic
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f20c5c323190db46b1eba38049';

async function bscApiCall(params) {
  const apiKey = process.env.BSCSCAN_API_KEY || '';
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res = await fetch(`https://api.bscscan.com/api?${qs}`);
  return res.json();
}

async function ethApiCall(params) {
  const apiKey = process.env.ETHERSCAN_API_KEY || '';
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res = await fetch(`https://api.etherscan.io/api?${qs}`);
  return res.json();
}

async function verifyBscUSDT(txHash, expectedAmountUSD) {
  const ourWallet = (WALLETS.USDT_BEP20 || '').toLowerCase();
  const usdtContract = USDT_CONTRACTS.USDT_BEP20.toLowerCase();

  const [receiptData, blockData] = await Promise.all([
    bscApiCall({ module: 'proxy', action: 'eth_getTransactionReceipt', txhash: txHash }),
    bscApiCall({ module: 'proxy', action: 'eth_blockNumber' }),
  ]);

  const receipt = receiptData.result;
  if (!receipt) return { valid: false, reason: 'Transaction not found or not yet mined' };
  if (receipt.status !== '0x1') return { valid: false, reason: 'Transaction failed on-chain' };

  const currentBlock = parseInt(blockData.result, 16);
  const txBlock = parseInt(receipt.blockNumber, 16);
  const confirmations = currentBlock - txBlock;

  if (confirmations < CONFIRMATION_THRESHOLD.USDT_BEP20) {
    return { valid: false, reason: `Waiting for confirmations: ${confirmations}/${CONFIRMATION_THRESHOLD.USDT_BEP20}`, confirmations, pending: true };
  }

  const logs = receipt.logs || [];
  const transferLog = logs.find(log =>
    log.address.toLowerCase() === usdtContract &&
    log.topics[0] === TRANSFER_TOPIC &&
    log.topics[2] &&
    ('0x' + log.topics[2].slice(26)).toLowerCase() === ourWallet
  );

  if (!transferLog) {
    return { valid: false, reason: 'No USDT transfer to our wallet found in this transaction' };
  }

  const amount = Number(BigInt(transferLog.data)) / 1e6;
  if (Math.abs(amount - expectedAmountUSD) > 0.01) {
    return { valid: false, reason: `Amount mismatch: received ${amount} USDT, expected ${expectedAmountUSD} USDT` };
  }

  const from = '0x' + (transferLog.topics[1] || '').slice(26);
  return {
    valid: true, from, to: ourWallet, amount, symbol: 'USDT',
    blockNumber: txBlock, confirmations,
    explorerUrl: NETWORKS.USDT_BEP20.explorer + txHash,
  };
}

async function verifyBscBNB(txHash, expectedBnbAmount) {
  const ourWallet = (WALLETS.BNB_BEP20 || '').toLowerCase();

  const [txData, blockData] = await Promise.all([
    bscApiCall({ module: 'proxy', action: 'eth_getTransactionByHash', txhash: txHash }),
    bscApiCall({ module: 'proxy', action: 'eth_blockNumber' }),
  ]);

  const tx = txData.result;
  if (!tx) return { valid: false, reason: 'Transaction not found or not yet mined' };
  if (!tx.blockNumber) return { valid: false, reason: 'Transaction not yet mined', pending: true };

  if ((tx.to || '').toLowerCase() !== ourWallet) {
    return { valid: false, reason: 'Transaction not sent to our wallet' };
  }

  const currentBlock = parseInt(blockData.result, 16);
  const txBlock = parseInt(tx.blockNumber, 16);
  const confirmations = currentBlock - txBlock;

  if (confirmations < CONFIRMATION_THRESHOLD.BNB_BEP20) {
    return { valid: false, reason: `Waiting for confirmations: ${confirmations}/${CONFIRMATION_THRESHOLD.BNB_BEP20}`, confirmations, pending: true };
  }

  const valueBNB = Number(BigInt(tx.value)) / 1e18;

  // Check amount with 5% tolerance (BNB price fluctuates)
  if (expectedBnbAmount && Math.abs(valueBNB - expectedBnbAmount) / expectedBnbAmount > 0.05) {
    return { valid: false, reason: `Amount mismatch: received ${valueBNB} BNB, expected ~${expectedBnbAmount} BNB` };
  }

  return {
    valid: true, from: tx.from, to: tx.to, amount: valueBNB, symbol: 'BNB',
    blockNumber: txBlock, confirmations,
    explorerUrl: NETWORKS.BNB_BEP20.explorer + txHash,
  };
}

async function verifyEthUSDT(txHash, expectedAmountUSD) {
  const ourWallet = (WALLETS.USDT_ERC20 || '').toLowerCase();
  const usdtContract = USDT_CONTRACTS.USDT_ERC20.toLowerCase();

  const [receiptData, blockData] = await Promise.all([
    ethApiCall({ module: 'proxy', action: 'eth_getTransactionReceipt', txhash: txHash }),
    ethApiCall({ module: 'proxy', action: 'eth_blockNumber' }),
  ]);

  const receipt = receiptData.result;
  if (!receipt) return { valid: false, reason: 'Transaction not found or not yet mined' };
  if (receipt.status !== '0x1') return { valid: false, reason: 'Transaction failed on-chain' };

  const currentBlock = parseInt(blockData.result, 16);
  const txBlock = parseInt(receipt.blockNumber, 16);
  const confirmations = currentBlock - txBlock;

  if (confirmations < CONFIRMATION_THRESHOLD.USDT_ERC20) {
    return { valid: false, reason: `Waiting for confirmations: ${confirmations}/${CONFIRMATION_THRESHOLD.USDT_ERC20}`, confirmations, pending: true };
  }

  const logs = receipt.logs || [];
  const transferLog = logs.find(log =>
    log.address.toLowerCase() === usdtContract &&
    log.topics[0] === TRANSFER_TOPIC &&
    log.topics[2] &&
    ('0x' + log.topics[2].slice(26)).toLowerCase() === ourWallet
  );

  if (!transferLog) {
    return { valid: false, reason: 'No USDT transfer to our wallet found in this transaction' };
  }

  const amount = Number(BigInt(transferLog.data)) / 1e6;
  if (Math.abs(amount - expectedAmountUSD) > 0.01) {
    return { valid: false, reason: `Amount mismatch: received ${amount} USDT, expected ${expectedAmountUSD} USDT` };
  }

  const from = '0x' + (transferLog.topics[1] || '').slice(26);
  return {
    valid: true, from, to: ourWallet, amount, symbol: 'USDT',
    blockNumber: txBlock, confirmations,
    explorerUrl: NETWORKS.USDT_ERC20.explorer + txHash,
  };
}

/**
 * Verify a transaction on-chain given network, txHash and the payment record.
 * For BNB, uses metadata.bnb_amount (stored at initiation) for amount check.
 */
async function verifyOnChain(network, txHash, payment) {
  const expectedUSD = payment.amount;
  const meta = payment.metadata || {};

  if (network === 'USDT_BEP20') return verifyBscUSDT(txHash, expectedUSD);
  if (network === 'USDT_ERC20') return verifyEthUSDT(txHash, expectedUSD);
  if (network === 'BNB_BEP20')  return verifyBscBNB(txHash, meta.bnb_amount || null);
  return { valid: false, reason: 'Unsupported network' };
}

// ── SHARED ACTIVATION LOGIC ────────────────────────────────────────

const PLAN_NAMES = { one_step: '1-Step', two_step: '2-Step', three_step: '3-Step', partial: 'Partial Payment' };

/**
 * Mark payment as paid, create challenge, link them.
 * Idempotent: if payment already has challenge_id, returns it.
 */
async function activatePayment(paymentId, payment, verifyDetails) {
  // Idempotency: already activated
  if (payment.challenge_id) {
    return { success: true, challenge: { id: payment.challenge_id }, alreadyActivated: true };
  }

  const meta  = payment.metadata || {};
  const plan  = meta.plan;
  const size  = meta.account_size;
  const total = meta.fee_total;

  // Mark payment as paid with on-chain proof
  const newMeta = {
    ...meta,
    ...(verifyDetails && {
      block_number:  verifyDetails.blockNumber,
      from_address:  verifyDetails.from,
      token_symbol:  verifyDetails.symbol,
      confirmed_at:  new Date().toISOString(),
      explorer_url:  verifyDetails.explorerUrl,
      confirmations: verifyDetails.confirmations,
    }),
  };

  await supabaseAdmin
    .from('payments')
    .update({ gateway_status: 'paid', metadata: newMeta })
    .eq('id', paymentId);

  // Create challenge (phases auto-created by DB trigger)
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

  // Link payment to challenge
  await supabaseAdmin
    .from('payments')
    .update({ challenge_id: challenge.id })
    .eq('id', paymentId);

  // Send challenge activation email
  const profile = payment.profiles;
  if (profile) {
    sendEmail('challengePurchased', profile.email, {
      name:        profile.full_name,
      plan:        PLAN_NAMES[plan] || plan,
      accountSize: size,
      fee:         payment.amount,
      mtLogin: null, mtPassword: null, mtServer: null,
    }).catch(e => console.error('Activation email failed:', e));
  }

  return { success: true, challenge };
}

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── INITIATE: get wallet address + amount to pay ───────────────
  if (action === 'initiate' && req.method === 'POST') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { plan, accountSize, network = 'USDT_BEP20' } = req.body || {};
    if (!plan || !accountSize) return err(res, 'plan and accountSize required');
    if (!WALLETS[network])     return err(res, 'Invalid network');

    const price = getPrice(plan, accountSize);
    if (!price) return err(res, 'Invalid plan or account size');

    // For partial plan: only charge 35% upfront
    const chargeAmount = plan === 'partial'
      ? Math.round(price * 0.35 * 100) / 100
      : price;

    const reference = 'VRX-' + Date.now().toString(36).toUpperCase();

    // For BNB payments: fetch current BNB price and calculate expected BNB amount
    let bnbAmount = null;
    if (network === 'BNB_BEP20') {
      try {
        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
        const priceData = await priceRes.json();
        const bnbPrice = priceData?.binancecoin?.usd;
        if (bnbPrice && bnbPrice > 0) {
          bnbAmount = Math.round((chargeAmount / bnbPrice) * 1e6) / 1e6;
        }
      } catch (e) {
        console.error('BNB price fetch failed:', e);
      }
      if (!bnbAmount) {
        return err(res, 'Unable to fetch current BNB price. Please try again or select a USDT network.');
      }
    }

    const isBNB = network === 'BNB_BEP20';
    const displayCurrency = isBNB ? 'BNB' : 'USDT';
    const displayAmount   = isBNB && bnbAmount ? bnbAmount : chargeAmount;

    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id:        user.id,
        amount:         chargeAmount,
        currency:       displayCurrency,
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
          ...(bnbAmount && { bnb_amount: bnbAmount }),
        },
      })
      .select().single();

    if (error) return err(res, error.message);

    const sendAmount = isBNB && bnbAmount ? `${bnbAmount} BNB` : `${chargeAmount} USDT`;

    return ok(res, {
      reference,
      payment_id:   payment.id,
      amount:       displayAmount,
      currency:     displayCurrency,
      wallet:       WALLETS[network],
      network:      NETWORKS[network],
      plan,
      plan_name:    PLAN_NAMES[plan] || plan,
      account_size: accountSize,
      fee_total:    price,
      is_partial:   plan === 'partial',
      partial_note: plan === 'partial'
        ? `This is 35% upfront. Remaining $${(price - chargeAmount).toFixed(2)} deducted from first profit withdrawal.`
        : null,
      instructions: [
        `Send exactly ${sendAmount} to the wallet address shown`,
        `Use the ${NETWORKS[network].network} network ONLY`,
        `Include your reference code ${reference} in the memo/tag if your exchange supports it`,
        'After sending, copy your Transaction Hash (TX ID) and paste it below',
        'We will automatically verify your payment on-chain — usually within a few minutes',
      ],
    });
  }

  // ── SUBMIT: trader submits TX hash after sending crypto ────────
  if (action === 'submit' && req.method === 'POST') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { paymentId, txHash, network = 'USDT_BEP20' } = req.body || {};
    if (!paymentId || !txHash) return err(res, 'paymentId and txHash required');

    if (txHash.length < 20) return err(res, 'Invalid transaction hash');

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (!payment)                          return err(res, 'Payment not found', 404);
    if (payment.gateway_status === 'paid') return ok(res, { message: 'Payment already confirmed', challenge_id: payment.challenge_id });

    const explorerUrl = NETWORKS[network]?.explorer + txHash;

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

    // Notify admin (fire-and-forget)
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      sendEmail('adminPaymentAlert', adminEmail, {
        traderName:  user.full_name || 'Unknown',
        traderEmail: user.email,
        amount:      payment.amount,
        reference:   payment.gateway_id,
        txHash,
        explorerUrl,
        network:     NETWORKS[network]?.name,
        paymentId,
      }).catch(e => console.error('Admin alert email failed:', e));
    }

    // Confirmation to trader
    sendEmail('paymentSubmitted', user.email, {
      name:        user.full_name,
      amount:      payment.amount,
      txHash,
      explorerUrl,
      reference:   payment.gateway_id,
    }).catch(e => console.error('Submission email failed:', e));

    return ok(res, {
      message: 'Payment submitted! Verifying on-chain — this usually takes just a few minutes.',
      explorer_url:  explorerUrl,
      reference:     payment.gateway_id,
      auto_verify:   true,
    });
  }

  // ── VERIFY: auto on-chain verification ────────────────────────
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

    // Already paid — idempotent success
    if (payment.gateway_status === 'paid') {
      return ok(res, { status: 'paid', challenge_id: payment.challenge_id, message: 'Payment already confirmed' });
    }

    if (!['submitted', 'pending'].includes(payment.gateway_status)) {
      return err(res, 'Payment cannot be verified in its current state');
    }

    const meta    = payment.metadata || {};
    const network = meta.network;
    const txHash  = meta.tx_hash;

    if (!txHash)  return err(res, 'No transaction hash on record. Please submit your TX hash first.');
    if (!network || !NETWORKS[network]) return err(res, 'Network not set or unsupported on payment');

    let result;
    try {
      result = await verifyOnChain(network, txHash, payment);
    } catch (e) {
      console.error('On-chain verification error:', e);
      return err(res, 'Verification failed: ' + e.message);
    }

    if (!result.valid) {
      return ok(res, {
        status:        'pending',
        verified:      false,
        reason:        result.reason,
        confirmations: result.confirmations,
        pending:       result.pending || false,
      });
    }

    const activation = await activatePayment(paymentId, payment, result);
    if (!activation.success) return err(res, activation.error);

    return ok(res, {
      status:      'paid',
      verified:    true,
      challenge_id: activation.challenge.id,
      message:     activation.alreadyActivated
        ? 'Payment already confirmed'
        : 'Payment verified on-chain! Challenge is now active.',
      details: {
        amount:        result.amount,
        symbol:        result.symbol,
        confirmations: result.confirmations,
        explorer_url:  result.explorerUrl,
      },
    });
  }

  // ── PENDING: admin gets all submitted payments waiting review ──
  if (action === 'pending' && req.method === 'GET') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);
    if (!user?.is_admin) return err(res, 'Admin required', 403);

    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('*, profiles(email, full_name, country)')
      .eq('gateway', 'crypto')
      .in('gateway_status', ['submitted', 'pending'])
      .order('created_at', { ascending: false });

    if (error) return err(res, error.message);
    return ok(res, data);
  }

  // ── APPROVE: admin manually approves a payment ─────────────────
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
      message: activation.alreadyActivated
        ? 'Payment was already activated'
        : 'Payment approved and challenge created!',
    });
  }

  // ── REJECT: admin rejects invalid/fake payment ─────────────────
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

  // ── STATUS: trader checks their payment status ─────────────────
  if (action === 'status' && req.method === 'GET') {
    const user = await requireUser(req);
    if (!user) return err(res, 'Unauthorized', 401);

    const { paymentId } = req.query;
    if (!paymentId) return err(res, 'paymentId required');

    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('gateway_status, gateway_id, amount, currency, metadata, challenge_id, created_at')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (error) return err(res, 'Payment not found', 404);

    const statusMsg = {
      pending:   'Waiting for your payment',
      submitted: 'Payment submitted — verifying on-chain',
      paid:      'Payment confirmed! Challenge is active.',
      failed:    'Payment rejected. Please contact support.',
    };

    return ok(res, {
      ...data,
      status_message: statusMsg[data.gateway_status] || data.gateway_status,
    });
  }

  // ── CRON-VERIFY: batch verify submitted payments ───────────────
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
      .eq('gateway_status', 'submitted')
      .order('created_at', { ascending: true })
      .limit(CRON_BATCH_SIZE);

    if (fetchErr) return err(res, fetchErr.message);
    if (!payments?.length) return ok(res, { processed: 0, message: 'No submitted payments' });

    const results = [];
    for (const payment of payments) {
      const meta    = payment.metadata || {};
      const network = meta.network;
      const txHash  = meta.tx_hash;

      if (!txHash || !network || !NETWORKS[network]) {
        results.push({ id: payment.id, status: 'skipped', reason: 'Missing tx_hash or network' });
        continue;
      }

      // Already linked to a challenge — just mark paid
      if (payment.challenge_id) {
        await supabaseAdmin.from('payments').update({ gateway_status: 'paid' }).eq('id', payment.id);
        results.push({ id: payment.id, status: 'fixed' });
        continue;
      }

      try {
        const result = await verifyOnChain(network, txHash, payment);
        if (result.valid) {
          const activation = await activatePayment(payment.id, payment, result);
          results.push({ id: payment.id, status: activation.success ? 'paid' : 'error', error: activation.error });
        } else {
          results.push({ id: payment.id, status: 'pending', reason: result.reason, confirmations: result.confirmations });
        }
      } catch (e) {
        results.push({ id: payment.id, status: 'error', error: e.message });
      }
    }

    return ok(res, { processed: payments.length, results });
  }

  return err(res, 'Unknown action', 400);
};

// Export shared helpers for use by the cron handler
module.exports.verifyOnChain    = verifyOnChain;
module.exports.activatePayment  = activatePayment;
module.exports.WALLETS          = WALLETS;
module.exports.NETWORKS         = NETWORKS;
