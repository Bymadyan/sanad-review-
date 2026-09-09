const db = require("../db");

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.session.userId);
  if (!user) {
    req.session.destroy(() => res.redirect("/login"));
    return;
  }
  req.user = user;
  res.locals.user = user;
  next();
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

// كل نشاط تجاري له اشتراكه الخاص (مو اشتراك واحد يغطي كل حسابات المستخدم)
function isAccountActive(accountId) {
  const sub = db.prepare(`SELECT status FROM subscriptions WHERE account_id = ?`).get(accountId);
  return !!sub && ACTIVE_STATUSES.has(sub.status);
}

module.exports = { requireAuth, isAccountActive, ACTIVE_STATUSES };
