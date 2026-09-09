// عميل Stripe اختياري: لو ما فيه STRIPE_SECRET_KEY بالإعدادات، نرجّع null بدل ما نكسر التطبيق —
// يفيد وقت التطوير المحلي قبل ما تجهز مفاتيح الدفع.

const Stripe = require("stripe");
const { env } = require("../config/env");

module.exports = env.stripe.secretKey ? new Stripe(env.stripe.secretKey) : null;
