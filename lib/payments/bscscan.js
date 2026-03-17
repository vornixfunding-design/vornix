// ================================================================
// VORNIX — lib/payments/bscscan.js
// BscScan API helpers for USDT (BEP20) deposit detection.
//
// Improvements over original implementation:
//   - Only considers transfers AFTER paymentCreatedAt (time-bounded)
//   - Verifies the token contract matches BSC USDT exactly
//   - Prefers exact amount match; falls back to configurable tolerance
//   - Returns the earliest valid confirmed tx (ascending block order)
//   - Stores both confirmed and pending (confirming) results
// ================================================================

// BSC USDT (Tether) contract — checksummed; comparisons use .toLowerCase()
const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';

// Amount tolerance in USD — accept deposits within ±value of invoice amount
const AMOUNT_TOLERANCE_USD = parseFloat(process.env.PAYMENTS_AMOUNT_TOLERANCE_USD || '0.02');

function getRequiredConfirmations() {
  return parseInt(process.env.PAYMENTS_CONFIRMATIONS_BSC, 10) || 5;
}

/**
 * Low-level BscScan API call.
 * @param {object} params  Query parameters (excluding apikey)
 * @returns {Promise<object>}
 */
async function bscApiCall(params) {
  const apiKey = process.env.BSCSCAN_API_KEY || '';
  const qs     = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res    = await fetch(`https://api.bscscan.com/api?${qs}`);
  if (!res.ok) throw new Error(`BscScan HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch the latest confirmed BSC block number from BscScan.
 * Returns 0 on failure.
 */
async function getCurrentBlock() {
  const data = await bscApiCall({ module: 'proxy', action: 'eth_blockNumber' });
  return parseInt(data.result, 16) || 0;
}

/**
 * Check for a USDT (BEP20) deposit to `depositAddress`.
 *
 * @param {string}      depositAddress    BSC address to scan
 * @param {number}      expectedAmountUSD Invoice amount in USD
 * @param {string|Date} [paymentCreatedAt]  Only accept transfers after this timestamp
 *
 * @returns {Promise<
 *   | { found: true,  txHash, from, to, amount, symbol, blockNumber, confirmations, explorerUrl, isExactMatch }
 *   | { found: false, pending: true,  txHash, confirmations, required, reason }
 *   | { found: false, pending?: false, reason }
 * >}
 */
async function checkDepositByAddress(depositAddress, expectedAmountUSD, paymentCreatedAt) {
  const required  = getRequiredConfirmations();
  const lowerAddr = depositAddress.toLowerCase();
  const createdAt = paymentCreatedAt ? new Date(paymentCreatedAt) : null;

  const currentBlock = await getCurrentBlock();
  if (!currentBlock) {
    return { found: false, reason: 'Unable to fetch current block from BscScan' };
  }

  const txData = await bscApiCall({
    module:          'account',
    action:          'tokentx',
    contractaddress: USDT_CONTRACT_BSC,
    address:         depositAddress,
    page:            '1',
    offset:          '50',
    sort:            'asc',  // oldest-first so we pick the earliest valid tx
  });

  if (txData?.status === '0' && txData?.message === 'No transactions found') {
    return { found: false, reason: 'No transactions found yet' };
  }

  if (!Array.isArray(txData?.result)) {
    return { found: false, reason: 'BscScan API error: ' + (txData?.message || 'unknown') };
  }

  const confirmed = [];
  let   bestPending = null;

  for (const tx of txData.result) {
    // Must be a transfer TO the deposit address
    if ((tx.to || '').toLowerCase() !== lowerAddr) continue;

    // Verify token contract is BSC USDT
    if ((tx.contractAddress || '').toLowerCase() !== USDT_CONTRACT_BSC.toLowerCase()) continue;

    // Time-bound: ignore transfers that happened before the invoice was created
    if (createdAt) {
      const txTime = new Date(parseInt(tx.timeStamp, 10) * 1000);
      if (txTime < createdAt) continue;
    }

    const decimals = parseInt(tx.tokenDecimal, 10) || 18;
    const amount   = Number(BigInt(tx.value)) / Math.pow(10, decimals);

    // Amount check: exact match preferred, tolerance fallback
    const isExact = amount === expectedAmountUSD;
    const isInTol = Math.abs(amount - expectedAmountUSD) <= AMOUNT_TOLERANCE_USD;
    if (!isExact && !isInTol) continue;

    const txBlock = parseInt(tx.blockNumber, 10);
    const confs   = currentBlock - txBlock;

    if (confs >= required) {
      confirmed.push({
        found:         true,
        txHash:        tx.hash,
        from:          tx.from,
        to:            tx.to,
        amount,
        symbol:        tx.tokenSymbol || 'USDT',
        blockNumber:   txBlock,
        confirmations: confs,
        explorerUrl:   'https://bscscan.com/tx/' + tx.hash,
        isExactMatch:  isExact,
      });
    } else if (!bestPending) {
      // Record the earliest under-confirmed deposit
      bestPending = {
        txHash:        tx.hash,
        confirmations: confs,
        amount,
      };
    }
  }

  if (confirmed.length) {
    // Prefer exact-amount match; otherwise take earliest (first in ascending list)
    return confirmed.find(c => c.isExactMatch) || confirmed[0];
  }

  if (bestPending) {
    return {
      found:         false,
      pending:       true,
      txHash:        bestPending.txHash,
      confirmations: bestPending.confirmations,
      required,
      reason:        `Deposit detected — waiting for confirmations (${bestPending.confirmations}/${required})`,
    };
  }

  return { found: false, reason: 'No matching USDT deposit found yet' };
}

module.exports = { USDT_CONTRACT_BSC, checkDepositByAddress };
