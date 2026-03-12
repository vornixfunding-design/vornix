// ================================================================
// VORNIX — api/stripe.js
// POST /api/stripe?action=checkout  → create Stripe checkout
// POST /api/stripe?action=webhook   → handle Stripe webhook
//
// FREE TO USE: Stripe charges % only on live payments.
// Test with: sk_test_... and pk_test_...
// ================================================================

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { supabase, supabaseAdmin, getPrice, cors, ok, err } = require('../lib/db');
const { sendEmail } = require('../lib/emails');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── CREATE CHECKOUT SESSION ────────────────────────────────────
  if (action === 'checkout') {
    if (req.method !== 'POST') return err(res, 'POST required', 405);

    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) return err(res, 'Unauthorized', 401);

      const { plan, accountSize, affiliateCode } = req.body || {};
      if (!plan || !accountSize) return err(res, 'plan and accountSize required');

      const price = getPrice(plan, accountSize);
      if (!price) return err(res, 'Invalid plan or size');

      const planNames = {
        one_step: '1-Step Challenge', two_step: '2-Step Challenge',
        three_step: '3-Step Challenge', partial: 'Partial Payment Plan',
      };

      // For Partial: charge only 35% now
      const chargeAmount = plan === 'partial'
        ? Math.round(price * 0.35)
        : price;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `VORNIX ${planNames[plan]} — $${Number(accountSize).toLocaleString()}`,
              description: plan === 'partial'
                ? `35% upfront payment. Remaining 65% ($${price - chargeAmount}) deducted from first payout.`
                : `One-time evaluation fee. ${planNames[plan]}.`,
            },
            unit_amount: chargeAmount * 100,  // Stripe uses cents
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.APP_URL}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${process.env.APP_URL}/#challenges`,
        customer_email: user.email,
        metadata: {
          user_id:       user.id,
          plan,
          account_size:  String(accountSize),
          fee_total:     String(price),
          fee_charged:   String(chargeAmount),
          is_partial:    String(plan === 'partial'),
          affiliate_code: affiliateCode || '',
        },
      });

      return ok(res, { url: session.url, sessionId: session.id });

    } catch (e) {
      console.error('[stripe/checkout]', e);
      return err(res, e.message, 500);
    }
  }

  // ── STRIPE WEBHOOK ─────────────────────────────────────────────
  if (action === 'webhook') {
    if (req.method !== 'POST') return err(res, 'POST required', 405);

    const sig    = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      // req.body must be raw buffer for signature verification
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (e) {
      console.error('[stripe/webhook] Signature failed:', e.message);
      return res.status(400).json({ error: 'Webhook signature invalid' });
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session  = event.data.object;
        const meta     = session.metadata;
        const userId   = meta.user_id;
        const plan     = meta.plan;
        const size     = meta.account_size;
        const total    = Number(meta.fee_total);
        const charged  = Number(meta.fee_charged);
        const isPartial = meta.is_partial === 'true';

        // 1. Record payment
        const { data: payment } = await supabaseAdmin
          .from('payments')
          .insert({
            user_id:        userId,
            amount:         charged,
            currency:       'usd',
            gateway:        'stripe',
            gateway_id:     session.id,
            gateway_status: 'paid',
            is_partial:     isPartial,
            metadata:       meta,
          })
          .select()
          .single();

        // 2. Create challenge
        const affiliateCode = meta.affiliate_code || null;
        let affiliateId = null;
        if (affiliateCode) {
          const { data: aff } = await supabaseAdmin
            .from('profiles').select('id').eq('affiliate_code', affiliateCode).single();
          if (aff) affiliateId = aff.id;
        }

        await supabaseAdmin.from('challenges').insert({
          user_id:        userId,
          plan,
          account_size:   size,
          fee_total:      total,
          fee_paid:       charged,
          is_partial_pay: isPartial,
          partial_balance: isPartial ? total * 0.65 : 0,
          original_size:  Number(size),
          current_size:   Number(size),
          status:         'active',
          start_date:     new Date().toISOString().split('T')[0],
          affiliate_id:   affiliateId,
          affiliate_commission: affiliateId ? total * 0.10 : 0,
        });

        // 3. Send confirmation email
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('email, full_name').eq('id', userId).single();

        if (profile) {
          const planNames = {
            one_step:'1-Step', two_step:'2-Step', three_step:'3-Step', partial:'Partial Payment'
          };
          sendEmail('challengePurchased', profile.email, {
            name:        profile.full_name,
            plan:        planNames[plan],
            accountSize: size,
            fee:         charged,
            mtLogin:     null, mtPassword: null, mtServer: null,
          }).catch(e => console.error('Email failed:', e));
        }
      }

      // ── PAYOUT: refund/dispute handling ──
      if (event.type === 'charge.dispute.created') {
        console.warn('[stripe] Dispute created:', event.data.object.id);
        // Alert admin — add Slack/email notification here
      }

      return res.status(200).json({ received: true });

    } catch (e) {
      console.error('[stripe/webhook] Processing error:', e);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  return err(res, 'Unknown action', 400);
};
