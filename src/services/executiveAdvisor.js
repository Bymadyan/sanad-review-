// "المستشار التشغيلي": يحوّل التقييمات الخام إلى قرارات تشغيلية جاهزة لصاحب النشاط —
// نسبة رضا، أكثر المشاكل والعناصر المحبوبة تكراراً، وإنذار مبكر لو فيه مؤشر تراجع.
// كله محسوب من بيانات التقييمات الموجودة عندنا فعلاً (بدون أي خدمة خارجية جديدة).

const db = require("../db");
const { countRiskMentions } = require("./riskClassifier");
const { countPraiseMentions } = require("./praiseKeywords");

const MIN_SAMPLE_FOR_WARNING = 3;

function getReviewsInWindow(userId, { accountId, sinceDays, untilDaysAgo = 0 } = {}) {
  let where = `a.user_id = ? AND s.status IN ('active','trialing')`;
  const params = [userId];
  if (accountId) {
    where += ` AND a.id = ?`;
    params.push(accountId);
  }

  const untilClause = untilDaysAgo ? `AND r.review_create_time < datetime('now', '-${untilDaysAgo} days')` : "";

  return db
    .prepare(
      `SELECT r.star_rating, r.comment, r.review_create_time, a.custom_risk_keywords
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       JOIN subscriptions s ON s.account_id = a.id
       WHERE ${where} AND r.review_create_time >= datetime('now', '-${sinceDays} days') ${untilClause}`
    )
    .all(...params);
}

// نسبة الرضا = % التقييمات 4-5 نجوم من إجمالي التقييمات بالفترة، مع مقارنة بالفترة السابقة لنفس الطول
function getSatisfactionScore(userId, { accountId, windowDays = 90 } = {}) {
  const current = getReviewsInWindow(userId, { accountId, sinceDays: windowDays });
  const previous = getReviewsInWindow(userId, { accountId, sinceDays: windowDays * 2, untilDaysAgo: windowDays });

  const scoreOf = (rows) => (rows.length ? Math.round((rows.filter((r) => r.star_rating >= 4).length / rows.length) * 100) : null);

  const score = scoreOf(current);
  const previousScore = scoreOf(previous);

  return {
    score,
    totalReviews: current.length,
    previousScore,
    delta: score != null && previousScore != null ? score - previousScore : null,
    windowDays,
  };
}

// أكثر 10 مشاكل متكررة (من التقييمات 3 نجوم فأقل اللي فيها تعليق)
function getTopIssues(userId, { accountId, sinceDays = 90, limit = 10 } = {}) {
  const rows = getReviewsInWindow(userId, { accountId, sinceDays }).filter((r) => r.star_rating <= 3 && r.comment);
  const customKeywords = [...new Set(rows.map((r) => r.custom_risk_keywords).filter(Boolean))].join(",");
  return countRiskMentions(rows, customKeywords, limit);
}

// أكثر 10 عناصر محبوبة (من التقييمات 4-5 نجوم اللي فيها تعليق)
function getTopPraises(userId, { accountId, sinceDays = 90, limit = 10 } = {}) {
  const rows = getReviewsInWindow(userId, { accountId, sinceDays }).filter((r) => r.star_rating >= 4 && r.comment);
  return countPraiseMentions(rows, limit);
}

// تقدير "الإيرادات المعرّضة للخطر" بسبب كل مشكلة متكررة = عدد التقييمات اللي ذكرتها × متوسط قيمة
// الزبون اللي حدده صاحب النشاط بنفسه. تقدير تقريبي بسيط، مو رقم مقاس فعلياً — نوضح هذا بالواجهة.
// يحتاج نشاط تجاري محدد (مو تجميع عبر أكثر من فرع) عشان نستخدم رقم قيمة الزبون الصحيح.
function getRevenueAtRisk(userId, { accountId, sinceDays = 90 } = {}) {
  if (!accountId) return { available: false, reason: "select_a_business" };

  const account = db.prepare(`SELECT avg_customer_value FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, userId);
  if (!account || !account.avg_customer_value) return { available: false, reason: "not_configured" };

  const issues = getTopIssues(userId, { accountId, sinceDays, limit: 10 });
  const perIssue = issues.map((issue) => ({
    keyword: issue.keyword,
    count: issue.count,
    estimatedRisk: Math.round(issue.count * account.avg_customer_value),
  }));

  return {
    available: true,
    avgCustomerValue: account.avg_customer_value,
    perIssue,
    totalEstimatedRisk: perIssue.reduce((sum, i) => sum + i.estimatedRisk, 0),
  };
}

// إنذار مبكر: مؤشر قائم على قواعد (rule-based) مو تنبؤ ذكاء اصطناعي فعلي — يقارن آخر 14 يوم
// بالـ 14 يوم اللي قبلها: هل متوسط التقييم تراجع بشكل ملحوظ، أو هل فيه مشاكل معينة صارت تتكرر أكثر
// من المعتاد (نعرضهم كلهم، مو مشكلة وحدة بس). الهدف يعطي صاحب النشاط تحذير مبكر قبل ما التقييم العام
// ينخفض فعلياً.
function getEarlyWarning(userId, { accountId } = {}) {
  const recent = getReviewsInWindow(userId, { accountId, sinceDays: 14 });
  const prior = getReviewsInWindow(userId, { accountId, sinceDays: 28, untilDaysAgo: 14 });

  if (recent.length < MIN_SAMPLE_FOR_WARNING || prior.length < MIN_SAMPLE_FOR_WARNING) {
    return { triggered: false, reason: "insufficient_data" };
  }

  const avg = (rows) => rows.reduce((sum, r) => sum + r.star_rating, 0) / rows.length;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const ratingDrop = priorAvg - recentAvg;

  const recentIssues = countRiskMentions(recent.filter((r) => r.comment), "", 10);
  const priorCounts = new Map(countRiskMentions(prior.filter((r) => r.comment), "", 10).map((i) => [i.keyword, i.count]));

  const risingIssues = [];
  for (const issue of recentIssues) {
    const priorCount = priorCounts.get(issue.keyword) || 0;
    if (issue.count >= 2 && issue.count > priorCount * 1.5) {
      const percentIncrease = priorCount > 0 ? Math.round(((issue.count - priorCount) / priorCount) * 100) : null;
      risingIssues.push({ keyword: issue.keyword, recentCount: issue.count, priorCount, percentIncrease });
    }
  }

  const triggered = ratingDrop >= 0.4 || risingIssues.length > 0;
  if (!triggered) return { triggered: false };

  return {
    triggered: true,
    ratingDrop: Math.round(ratingDrop * 10) / 10,
    recentAvg: Math.round(recentAvg * 10) / 10,
    priorAvg: Math.round(priorAvg * 10) / 10,
    risingIssues,
  };
}

// مقارنة الفروع: لكل نشاط تجاري (فرع) نشط، متوسط تقييمه بالفترة الحالية مقابل الفترة السابقة —
// يحدد أفضل/أسوأ فرع، وأكثر فرع تحسّن/تراجع. مفيدة فقط لو عند العميل أكثر من فرع.
function getBranchComparison(userId, { windowDays = 90 } = {}) {
  const accounts = db
    .prepare(
      `SELECT a.id, a.business_name FROM accounts a
       JOIN subscriptions s ON s.account_id = a.id
       WHERE a.user_id = ? AND s.status IN ('active','trialing')
       ORDER BY a.business_name`
    )
    .all(userId);

  const branches = accounts.map((a) => {
    const current = getReviewsInWindow(userId, { accountId: a.id, sinceDays: windowDays });
    const previous = getReviewsInWindow(userId, { accountId: a.id, sinceDays: windowDays * 2, untilDaysAgo: windowDays });

    const avg = (rows) => (rows.length ? Math.round((rows.reduce((s, r) => s + r.star_rating, 0) / rows.length) * 10) / 10 : null);

    const avgRating = avg(current);
    const previousAvgRating = avg(previous);

    return {
      id: a.id,
      name: a.business_name,
      avgRating,
      previousAvgRating,
      delta: avgRating != null && previousAvgRating != null ? Math.round((avgRating - previousAvgRating) * 10) / 10 : null,
      reviewCount: current.length,
    };
  });

  const withRating = branches.filter((b) => b.avgRating != null);
  const withDelta = branches.filter((b) => b.delta != null);

  return {
    branches,
    best: withRating.length ? withRating.reduce((a, b) => (b.avgRating > a.avgRating ? b : a)) : null,
    worst: withRating.length ? withRating.reduce((a, b) => (b.avgRating < a.avgRating ? b : a)) : null,
    mostImproved: withDelta.length ? withDelta.reduce((a, b) => (b.delta > a.delta ? b : a)) : null,
    mostDeclined: withDelta.length ? withDelta.reduce((a, b) => (b.delta < a.delta ? b : a)) : null,
  };
}

module.exports = { getSatisfactionScore, getTopIssues, getTopPraises, getEarlyWarning, getBranchComparison, getRevenueAtRisk };
