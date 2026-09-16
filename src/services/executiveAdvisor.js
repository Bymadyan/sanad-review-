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

// إنذار مبكر: مؤشر قائم على قواعد (rule-based) مو تنبؤ ذكاء اصطناعي فعلي — يقارن آخر 14 يوم
// بالـ 14 يوم اللي قبلها: هل متوسط التقييم تراجع بشكل ملحوظ، أو هل فيه مشكلة معينة صارت تتكرر أكثر
// من المعتاد. الهدف يعطي صاحب النشاط تحذير مبكر قبل ما التقييم العام ينخفض فعلياً.
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

  const recentIssues = countRiskMentions(recent.filter((r) => r.comment), "", 5);
  const priorCounts = new Map(countRiskMentions(prior.filter((r) => r.comment), "", 10).map((i) => [i.keyword, i.count]));

  let risingIssue = null;
  for (const issue of recentIssues) {
    const priorCount = priorCounts.get(issue.keyword) || 0;
    if (issue.count >= 2 && issue.count > priorCount * 1.5) {
      risingIssue = issue.keyword;
      break;
    }
  }

  const triggered = ratingDrop >= 0.4 || Boolean(risingIssue);
  if (!triggered) return { triggered: false };

  return {
    triggered: true,
    ratingDrop: Math.round(ratingDrop * 10) / 10,
    recentAvg: Math.round(recentAvg * 10) / 10,
    priorAvg: Math.round(priorAvg * 10) / 10,
    risingIssue,
  };
}

module.exports = { getSatisfactionScore, getTopIssues, getTopPraises, getEarlyWarning };
