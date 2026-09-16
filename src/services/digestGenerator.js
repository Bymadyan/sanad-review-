// يجمع التقرير الأسبوعي لعميل معين: إحصائيات هالأسبوع مقابل اللي قبله، أبرز تقييم إيجابي وسلبي،
// وأهم نمط شكوى متكرر (من التحليل الذكي المخزّن مسبقاً لكل نشاط). يرجّع نص جاهز للبريد وللوحة.

const db = require("../db");
const { env } = require("../config/env");
const logger = require("../config/logger");
const { getRevenueAtRisk } = require("./executiveAdvisor");

const ACTIVE_JOIN = `JOIN subscriptions s ON s.account_id = a.id AND s.status IN ('active','trialing')`;

function getStats(userId) {
  return db
    .prepare(
      `SELECT
         SUM(CASE WHEN r.review_create_time >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS this_week_count,
         ROUND(AVG(CASE WHEN r.review_create_time >= datetime('now','-7 days') THEN r.star_rating END), 1) AS this_week_avg,
         SUM(CASE WHEN r.review_create_time >= datetime('now','-14 days') AND r.review_create_time < datetime('now','-7 days') THEN 1 ELSE 0 END) AS last_week_count,
         ROUND(AVG(CASE WHEN r.review_create_time >= datetime('now','-14 days') AND r.review_create_time < datetime('now','-7 days') THEN r.star_rating END), 1) AS last_week_avg
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       ${ACTIVE_JOIN}
       WHERE a.user_id = ?`
    )
    .get(userId);
}

function getBestReview(userId) {
  return db
    .prepare(
      `SELECT r.star_rating, r.comment, r.reviewer_name, a.business_name
       FROM reviews r JOIN accounts a ON a.id = r.account_id
       ${ACTIVE_JOIN}
       WHERE a.user_id = ? AND r.review_create_time >= datetime('now','-7 days')
         AND r.comment IS NOT NULL AND r.comment != '' AND r.star_rating >= 4
       ORDER BY r.star_rating DESC, r.id DESC LIMIT 1`
    )
    .get(userId);
}

function getWorstReview(userId) {
  return db
    .prepare(
      `SELECT r.star_rating, r.comment, r.reviewer_name, a.business_name
       FROM reviews r JOIN accounts a ON a.id = r.account_id
       ${ACTIVE_JOIN}
       WHERE a.user_id = ? AND r.review_create_time >= datetime('now','-7 days')
         AND r.comment IS NOT NULL AND r.comment != '' AND r.star_rating <= 3
       ORDER BY r.star_rating ASC, r.id DESC LIMIT 1`
    )
    .get(userId);
}

function getTopInsightLines(userId) {
  const accounts = db
    .prepare(`SELECT a.business_name, a.insight_summary FROM accounts a ${ACTIVE_JOIN} WHERE a.user_id = ? AND a.insight_summary IS NOT NULL`)
    .all(userId);

  const lines = [];
  for (const acc of accounts) {
    const firstLine = (acc.insight_summary || "").split("\n")[0];
    if (firstLine && firstLine.startsWith("•")) {
      lines.push(accounts.length > 1 ? `${firstLine} (${acc.business_name})` : firstLine);
    }
  }
  return lines;
}

// إجمالي "الإيرادات المعرّضة للخطر" عبر كل الأنشطة اللي حدد صاحبها متوسط قيمة الزبون لها — تقدير
// تقريبي فقط، يظهر بالتقرير الأسبوعي لو متوفر لأي نشاط تجاري.
function getTotalRevenueAtRisk(userId) {
  const accounts = db.prepare(`SELECT a.id FROM accounts a ${ACTIVE_JOIN} WHERE a.user_id = ? AND a.avg_customer_value IS NOT NULL`).all(userId);
  let total = 0;
  let hasAny = false;
  for (const acc of accounts) {
    const result = getRevenueAtRisk(userId, { accountId: acc.id });
    if (result.available) {
      total += result.totalEstimatedRisk;
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

function trendArrow(thisAvg, lastAvg) {
  if (thisAvg == null || lastAvg == null) return "";
  if (thisAvg > lastAvg) return " ⬆️ up from last week";
  if (thisAvg < lastAvg) return " ⬇️ down from last week";
  return " (no change from last week)";
}

function templateNarrative({ businessName, stats, bestReview, worstReview, insightLines, totalRevenueAtRisk }) {
  const parts = [];

  if (!stats.this_week_count) {
    parts.push(`Hi ${businessName}, you didn't get any new reviews this week.`);
  } else {
    parts.push(
      `Hi ${businessName}, this week you got ${stats.this_week_count} ${
        stats.this_week_count === 1 ? "review" : "reviews"
      } averaging ${stats.this_week_avg} stars${trendArrow(stats.this_week_avg, stats.last_week_avg)}.`
    );
  }

  if (insightLines.length) {
    parts.push(`Worth your attention: ${insightLines[0].replace(/^•\s*/, "")}`);
  }

  if (totalRevenueAtRisk != null) {
    parts.push(`Estimated revenue at risk from recurring complaints (based on your own avg. customer value): ~${totalRevenueAtRisk.toLocaleString("en-US")}.`);
  }

  if (bestReview) {
    parts.push(`Your best review this week: "${bestReview.comment}" — ${bestReview.reviewer_name || "a customer"} (${bestReview.star_rating}★)`);
  }

  if (worstReview) {
    parts.push(`A review that needs your attention: "${worstReview.comment}" — ${worstReview.star_rating}★`);
  }

  return parts.join("\n\n");
}

// نسخة "مستشار تشغيلي" من التقرير الأسبوعي: بدل ما يكون بس سرد ودود، يبني تقرير مبني على المشكلة
// الأبرز → السبب المحتمل → الأثر المالي (لو متوفر) → الإجراء المقترح → الأولوية. يستخدم فقط الحقائق
// المعطاة له، ولا يخترع أرقام أو أسباب غير موجودة بالبيانات.
async function claudeNarrative({ businessName, stats, bestReview, worstReview, insightLines, totalRevenueAtRisk }) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  const facts = `Business name: ${businessName}
Reviews this week: ${stats.this_week_count || 0}
Average rating this week: ${stats.this_week_avg ?? "none"}
Average rating last week: ${stats.last_week_avg ?? "none"}
Top recurring complaint theme: ${insightLines[0] || "no clear pattern"}
Estimated revenue at risk (owner's own assumption applied to complaint counts): ${totalRevenueAtRisk != null ? totalRevenueAtRisk : "not available"}
Best review: ${bestReview ? `"${bestReview.comment}" (${bestReview.star_rating} stars)` : "none"}
Worst review needing attention: ${worstReview ? `"${worstReview.comment}" (${worstReview.star_rating} stars)` : "none"}`;

  const system = `You are an AI operations consultant writing a short weekly report in English for a business owner about their customer reviews on Google.
Start with one warm greeting sentence, then structure the rest as a compact consultant report with these labeled parts (skip any part with no real data instead of inventing content):
Problem: the main recurring issue, if any.
Likely Cause: a plausible, modest inference from the review text — not a wild guess.
Financial Impact: only if a revenue-at-risk figure was given.
Suggested Action: one concrete, practical next step.
Priority: High/Medium/Low, with one phrase why.
Keep the whole report under 150 words total, plain language, no markdown headers — just short labeled lines.
Do not invent numbers or details not given to you.`;

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: facts }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.text.trim();
  if (!text) throw new Error("Claude returned empty digest narrative");
  return text;
}

// يرجّع null لو ما عند العميل أي نشاط تجاري مفعّل أصلاً
async function buildWeeklyDigest(user) {
  const accounts = db.prepare(`SELECT a.id FROM accounts a ${ACTIVE_JOIN} WHERE a.user_id = ?`).all(user.id);
  if (!accounts.length) return null;

  const stats = getStats(user.id);
  const bestReview = getBestReview(user.id);
  const worstReview = getWorstReview(user.id);
  const insightLines = getTopInsightLines(user.id);
  const totalRevenueAtRisk = getTotalRevenueAtRisk(user.id);

  const context = { businessName: user.business_name, stats, bestReview, worstReview, insightLines, totalRevenueAtRisk };

  let narrative;
  if (env.anthropicApiKey) {
    try {
      narrative = await claudeNarrative(context);
    } catch (err) {
      logger.warn({ err: err.message }, "Claude digest narrative failed, falling back to template");
    }
  }
  if (!narrative) narrative = templateNarrative(context);

  return {
    narrative,
    thisWeekCount: stats.this_week_count || 0,
    subject: stats.this_week_count
      ? `Your weekly digest: ${stats.this_week_count} ${stats.this_week_count === 1 ? "new review" : "new reviews"} on Sanad Review`
      : `Your weekly digest on Sanad Review`,
  };
}

module.exports = { buildWeeklyDigest };
