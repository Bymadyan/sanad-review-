const db = require("../db");

// عدّاد تنبيه داخل التطبيق: كم تقييم نجمة/نجمتين لسا ينتظر رد (بدون أي إشعار خارجي) — يختفي
// تلقائياً بمجرد ما صاحب النشاط ينشر الرد، بدون حاجة لتتبّع "مقروء/غير مقروء" منفصل.
function countUrgentUnrepliedReviews(userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       JOIN subscriptions s ON s.account_id = a.id AND s.status IN ('active','trialing')
       LEFT JOIN drafts d ON d.review_id = r.id
       WHERE a.user_id = ? AND r.star_rating <= 2 AND (d.status IS NULL OR d.status != 'published')`
    )
    .get(userId);
  return row.count;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.session.userId);
  if (!user) {
    req.session.destroy(() => res.redirect("/login"));
    return;
  }
  req.user = user;
  res.locals.user = user;
  res.locals.urgentReviewCount = countUrgentUnrepliedReviews(user.id);
  next();
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

// كل نشاط تجاري له اشتراكه الخاص (مو اشتراك واحد يغطي كل حسابات المستخدم)
function isAccountActive(accountId) {
  const sub = db.prepare(`SELECT status FROM subscriptions WHERE account_id = ?`).get(accountId);
  return !!sub && ACTIVE_STATUSES.has(sub.status);
}

module.exports = { requireAuth, isAccountActive, ACTIVE_STATUSES };
