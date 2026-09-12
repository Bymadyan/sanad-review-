const express = require("express");
const router = express.Router();
const webhookRouter = express.Router();
const db = require("../db");
const stripe = require("../services/stripeClient");
const { requireAuth, ACTIVE_STATUSES } = require("../middleware/auth");
const { env } = require("../config/env");
const logger = require("../config/logger");

function baseUrl(req) {
  return env.appBaseUrl || `${req.protocol}://${req.get("host")}`;
}

// يجيب Stripe customer id لأي اشتراك سابق لهذا المستخدم (نعيد استخدام نفس العميل لكل أنشطته التجارية)
function findExistingCustomerId(userId) {
  const row = db.prepare(`SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? AND stripe_customer_id IS NOT NULL LIMIT 1`).get(userId);
  return row && row.stripe_customer_id;
}

router.get("/billing", requireAuth, (req, res) => {
  const accounts = db
    .prepare(
      `SELECT a.*, s.status AS sub_status, s.current_period_end AS sub_period_end
       FROM accounts a
       LEFT JOIN subscriptions s ON s.account_id = a.id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(req.user.id);

  const hasStripeCustomer = !!findExistingCustomerId(req.user.id);

  res.render("billing/index", { accounts, stripeConfigured: !!stripe, hasStripeCustomer, activeStatuses: ACTIVE_STATUSES });
});

// ينشئ جلسة دفع اشتراك شهري 35$ لنشاط تجاري معين (كل نشاط تجاري له اشتراكه الخاص)
router.post("/billing/:accountId/checkout", requireAuth, async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    const account = db.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id);
    if (!account) return res.status(404).send("Business not found");

    if (!stripe || !env.stripe.priceId) {
      return res.status(500).send("Payments aren't enabled yet (STRIPE_SECRET_KEY / STRIPE_PRICE_ID not configured)");
    }

    let customerId = findExistingCustomerId(req.user.id);
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.business_name,
        metadata: { sanad_review_user_id: String(req.user.id) },
      });
      customerId = customer.id;
    }

    const metadata = { sanad_review_user_id: String(req.user.id), sanad_review_account_id: String(accountId) };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: env.stripe.priceId, quantity: 1 }],
      success_url: `${baseUrl(req)}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl(req)}/billing`,
      metadata,
      subscription_data: { metadata },
    });

    res.redirect(session.url);
  } catch (err) {
    next(err);
  }
});

// نجيب حالة الاشتراك فوراً بعد رجوع العميل من Stripe (بدون الاعتماد فقط على الـ webhook اللي قد يتأخر ثوانٍ)
router.get("/billing/success", requireAuth, async (req, res, next) => {
  try {
    if (!stripe || !req.query.session_id) return res.redirect("/billing");

    const session = await stripe.checkout.sessions.retrieve(req.query.session_id, { expand: ["subscription"] });

    const accountId = Number(session.metadata && session.metadata.sanad_review_account_id);
    if (session.subscription && accountId) {
      upsertSubscriptionForAccount({ userId: req.user.id, accountId, customerId: session.customer, subscription: session.subscription });
    }

    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// بوابة إدارة الاشتراكات المستضافة من Stripe — بوابة واحدة تدير كل الأنشطة التجارية لهذا العميل
router.post("/billing/portal", requireAuth, async (req, res, next) => {
  try {
    const customerId = findExistingCustomerId(req.user.id);
    if (!stripe || !customerId) return res.redirect("/billing");

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl(req)}/billing`,
    });
    res.redirect(portalSession.url);
  } catch (err) {
    next(err);
  }
});

function upsertSubscriptionForAccount({ userId, accountId, customerId, subscription }) {
  const existing = db.prepare(`SELECT id FROM subscriptions WHERE account_id = ?`).get(accountId);
  if (existing) {
    db.prepare(
      `UPDATE subscriptions
       SET stripe_customer_id = ?, stripe_subscription_id = ?, status = ?, current_period_end = ?, updated_at = strftime('%s','now')
       WHERE account_id = ?`
    ).run(customerId, subscription.id, subscription.status, subscription.current_period_end || null, accountId);
  } else {
    db.prepare(
      `INSERT INTO subscriptions (user_id, account_id, stripe_customer_id, stripe_subscription_id, status, current_period_end)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, accountId, customerId, subscription.id, subscription.status, subscription.current_period_end || null);
  }
}

// Stripe يستدعي هذا الرابط مباشرة (لا يمر عبر جلسة تسجيل الدخول أو CSRF) — يحتاج body خام للتحقق من التوقيع
webhookRouter.post("/billing/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !env.stripe.webhookSecret) {
    return res.status(500).send("Webhook not configured");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], env.stripe.webhookSecret);
  } catch (err) {
    logger.warn({ err: err.message }, "Stripe webhook signature verification failed");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const obj = event.data.object;

  try {
    if (event.type === "checkout.session.completed" && obj.subscription) {
      const userId = Number(obj.metadata && obj.metadata.sanad_review_user_id);
      const accountId = Number(obj.metadata && obj.metadata.sanad_review_account_id);
      if (userId && accountId) {
        stripe.subscriptions.retrieve(obj.subscription).then((sub) => {
          upsertSubscriptionForAccount({ userId, accountId, customerId: obj.customer, subscription: sub });
        });
      }
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.deleted"
    ) {
      const userId = Number(obj.metadata && obj.metadata.sanad_review_user_id);
      const accountId = Number(obj.metadata && obj.metadata.sanad_review_account_id);
      if (userId && accountId) {
        upsertSubscriptionForAccount({ userId, accountId, customerId: obj.customer, subscription: obj });
      } else {
        // احتياطي لو ماكو metadata على الاشتراك نفسه، نطابق عن طريق stripe_subscription_id
        db.prepare(
          `UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = strftime('%s','now') WHERE stripe_subscription_id = ?`
        ).run(obj.status, obj.current_period_end || null, obj.id);
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, "Error handling Stripe webhook");
  }

  res.json({ received: true });
});

module.exports = { router, webhookRouter };
