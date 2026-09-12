// حماية CSRF خفيفة الوزن: توكن عشوائي يُخزّن بجلسة المستخدم ويُطبع كحقل مخفي بكل نموذج،
// ونتحقق منه عند أي POST. ما نطبّقها على /billing/webhook لأنه يجيه من Stripe مباشرة بدون جلسة.

const crypto = require("crypto");

function attachCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function verifyCsrfToken(req, res, next) {
  if (req.method !== "POST") return next();

  const submitted = req.body && req.body._csrf;
  if (!submitted || submitted !== req.session.csrfToken) {
    return res.status(403).send("Your session expired or this form is invalid. Please refresh the page and try again.");
  }
  next();
}

module.exports = { attachCsrfToken, verifyCsrfToken };
