const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const db = require("../db");
const { requireAuth, isAccountActive } = require("../middleware/auth");
const { VALID_TONES } = require("../services/replyGenerator");
const { generateInsights } = require("../services/insightsGenerator");
const { buildWeeklyDigest } = require("../services/digestGenerator");
const { sendWeeklyDigest } = require("../services/emailer");
const { getWeeklyRatingTrend, renderTrendSvg } = require("../services/analytics");
const { env } = require("../config/env");
const logger = require("../config/logger");

router.get("/dashboard", requireAuth, (req, res) => {
  const accounts = db
    .prepare(
      `SELECT a.*, s.status AS sub_status, s.current_period_end AS sub_period_end
       FROM accounts a
       LEFT JOIN subscriptions s ON s.account_id = a.id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(req.user.id);

  for (const a of accounts) {
    a.isActive = a.sub_status === "active" || a.sub_status === "trialing";
    a.templates = db.prepare(`SELECT * FROM reply_templates WHERE account_id = ? ORDER BY created_at DESC`).all(a.id);
  }

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         ROUND(AVG(r.star_rating), 1) AS avg_rating,
         SUM(CASE WHEN d.status IS NULL OR d.status IN ('draft','edited') THEN 1 ELSE 0 END) AS needs_reply,
         SUM(CASE WHEN d.status = 'published' THEN 1 ELSE 0 END) AS published
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       JOIN subscriptions s ON s.account_id = a.id AND s.status IN ('active','trialing')
       LEFT JOIN drafts d ON d.review_id = r.id
       WHERE a.user_id = ?`
    )
    .get(req.user.id);

  const filterStatus = ["needs_reply", "published", "all"].includes(req.query.status) ? req.query.status : "all";
  const filterStars = ["1", "2", "3", "4", "5"].includes(req.query.stars) ? Number(req.query.stars) : null;

  let where = "WHERE a.user_id = ?";
  const params = [req.user.id];

  if (filterStatus === "needs_reply") {
    where += ` AND (d.status IS NULL OR d.status IN ('draft','edited'))`;
  } else if (filterStatus === "published") {
    where += ` AND d.status = 'published'`;
  }
  if (filterStars) {
    where += ` AND r.star_rating = ?`;
    params.push(filterStars);
  }

  const reviews = db
    .prepare(
      `SELECT r.*, d.draft_text, d.status AS draft_status, d.generated_by, d.auto_published, a.business_name
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       JOIN subscriptions s ON s.account_id = a.id AND s.status IN ('active','trialing')
       LEFT JOIN drafts d ON d.review_id = r.id
       ${where}
       ORDER BY r.review_create_time DESC`
    )
    .all(...params);

  const trend = getWeeklyRatingTrend(req.user.id);
  const trendSvg = renderTrendSvg(trend);

  const appBaseUrl = env.appBaseUrl || `${req.protocol}://${req.get("host")}`;

  res.render("dashboard/index", {
    accounts,
    reviews,
    user: req.user,
    stats,
    filterStatus,
    filterStars,
    tones: VALID_TONES,
    digestSent: req.query.digestSent,
    appBaseUrl,
    trendSvg,
  });
});

// كود QR لصفحة كتابة تقييم Google الخاصة بنشاط تجاري معين — يُستخدم لطباعته أو مشاركته مع العملاء
router.get("/accounts/:id/qr.png", requireAuth, async (req, res, next) => {
  try {
    const accountId = Number(req.params.id);
    const account = db.prepare(`SELECT google_review_link FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id);
    if (!account || !account.google_review_link) return res.status(404).send("Not available yet");

    const buffer = await QRCode.toBuffer(account.google_review_link, { width: 320, margin: 1 });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// تفعيل/تعطيل النشر التلقائي للتقييمات الإيجابية الآمنة، لكل نشاط تجاري على حدة
router.post("/accounts/:id/auto-publish", requireAuth, (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare(`SELECT id FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id);
  if (!account) return res.status(404).send("Business not found");
  if (!isAccountActive(accountId)) return res.redirect("/billing");

  const enabled = req.body.enabled === "1" ? 1 : 0;
  db.prepare(`UPDATE accounts SET auto_publish_positive = ? WHERE id = ?`).run(enabled, accountId);

  res.redirect("/dashboard");
});

// تحديث إعدادات الرد لنشاط تجاري: نبرة الرد + كلمات الخطر المخصصة + متوسط قيمة الزبون
router.post("/accounts/:id/settings", requireAuth, (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare(`SELECT id FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id);
  if (!account) return res.status(404).send("Business not found");
  if (!isAccountActive(accountId)) return res.redirect("/billing");

  const tone = VALID_TONES.includes(req.body.replyTone) ? req.body.replyTone : "friendly";
  const customKeywords = (req.body.customKeywords || "").slice(0, 1000);
  const avgCustomerValueRaw = Number(req.body.avgCustomerValue);
  const avgCustomerValue = avgCustomerValueRaw > 0 ? avgCustomerValueRaw : null;

  db.prepare(`UPDATE accounts SET reply_tone = ?, custom_risk_keywords = ?, avg_customer_value = ? WHERE id = ?`).run(
    tone,
    customKeywords || null,
    avgCustomerValue,
    accountId
  );

  res.redirect("/dashboard");
});

// يحلل التقييمات السلبية/المتوسطة الأخيرة لنشاط تجاري ويطلع أهم الأسباب المتكررة
router.post("/accounts/:id/insights", requireAuth, async (req, res, next) => {
  try {
    const accountId = Number(req.params.id);
    const account = db.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id);
    if (!account) return res.status(404).send("Business not found");
    if (!isAccountActive(accountId)) return res.redirect("/billing");

    const reviews = db
      .prepare(`SELECT star_rating, comment FROM reviews WHERE account_id = ? AND review_create_time >= datetime('now', '-90 days')`)
      .all(accountId);

    const { summary, source } = await generateInsights({
      businessName: account.business_name,
      reviews,
      customKeywords: account.custom_risk_keywords,
    });

    db.prepare(`UPDATE accounts SET insight_summary = ?, insight_generated_at = strftime('%s','now'), insight_source = ? WHERE id = ?`).run(
      summary,
      source,
      accountId
    );

    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// يولّد التقرير الأسبوعي الآن (بدل ما ينتظر جدولة الاثنين) ويرسله بريدياً لو الإيميل مفعّل
router.post("/digest/send-now", requireAuth, async (req, res, next) => {
  try {
    const digest = await buildWeeklyDigest(req.user);
    if (!digest) return res.redirect("/dashboard");

    db.prepare(`UPDATE users SET last_digest_summary = ?, last_digest_sent_at = strftime('%s','now') WHERE id = ?`).run(
      digest.narrative,
      req.user.id
    );

    let sent = false;
    try {
      sent = await sendWeeklyDigest({ toEmail: req.user.email, subject: digest.subject, narrative: digest.narrative });
    } catch (err) {
      logger.warn({ err: err.message }, "Failed to send weekly digest email");
    }
    res.redirect(`/dashboard?digestSent=${sent ? "1" : "0"}`);
  } catch (err) {
    next(err);
  }
});

// تصدير تقييمات الأنشطة التجارية المفعّلة (المدفوعة) كملف CSV
router.get("/reviews/export.csv", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.review_create_time, a.business_name, r.reviewer_name, r.star_rating, r.comment,
              COALESCE(d.status, 'draft') AS status, d.draft_text
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       JOIN subscriptions s ON s.account_id = a.id AND s.status IN ('active','trialing')
       LEFT JOIN drafts d ON d.review_id = r.id
       WHERE a.user_id = ?
       ORDER BY r.review_create_time DESC`
    )
    .all(req.user.id);

  const escapeCsv = (val) => {
    const s = String(val ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ["Date", "Business", "Reviewer", "Stars", "Comment", "Status", "Reply"];
  const lines = [header.map(escapeCsv).join(",")];
  for (const r of rows) {
    lines.push([r.review_create_time, r.business_name, r.reviewer_name, r.star_rating, r.comment, r.status, r.draft_text].map(escapeCsv).join(","));
  }

  const csv = "﻿" + lines.join("\n"); // BOM so Excel reads UTF-8 correctly
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sanad-review-reviews-${Date.now()}.csv"`);
  res.send(csv);
});

module.exports = router;
