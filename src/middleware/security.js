const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// حماية أساسية عبر HTTP headers (XSS, clickjacking, sniffing، إلخ).
// نعطّل CSP الافتراضي الصارم مؤقتاً لأن الصفحات تستخدم style/script داخلي (inline)
// بدون nonce حالياً؛ باقي الحمايات (frameguard، noSniff، إلخ) تبقى فعّالة.
const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
});

// يمنع محاولات تخمين كلمة المرور أو إغراق نظام تسجيل الحسابات بطلبات متكررة
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many attempts. Please try again in a few minutes.",
});

module.exports = { helmetMiddleware, authRateLimiter };
