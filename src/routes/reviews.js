const express = require("express");
const router = express.Router();
const db = require("../db");
const google = require("../services/googleClient");
const { generateDraftReply } = require("../services/replyGenerator");
const { isLowRisk } = require("../services/riskClassifier");
const { requireAuth, ACTIVE_STATUSES } = require("../middleware/auth");
const { notifyNewReviews, sendUrgentReviewAlert } = require("../services/emailer");
const logger = require("../config/logger");

router.use(requireAuth);

// يجيب التقييمات الجديدة فقط من Google لكل الأنشطة التجارية اللي عندها اشتراك فعّال
router.post("/sync", async (req, res, next) => {
  try {
    const accounts = db
      .prepare(`SELECT a.* FROM accounts a JOIN subscriptions s ON s.account_id = a.id WHERE a.user_id = ? AND s.status IN ('active','trialing')`)
      .all(req.user.id);

    let newCount = 0;
    let needsReviewCount = 0;

    for (const account of accounts) {
      const client = await google.getAuthedClientForAccount(account);

      let pageToken;
      do {
        const { reviews, nextPageToken } = await google.listReviews(client, account.location_name, pageToken);
        pageToken = nextPageToken;

        for (const gr of reviews) {
          const exists = db.prepare(`SELECT id FROM reviews WHERE account_id = ? AND google_review_id = ?`).get(account.id, gr.reviewId);
          if (exists) continue;

          const starRatingMap = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
          const starRating = starRatingMap[gr.starRating] || 0;
          const comment = gr.comment || "";
          const hasOwnerReply = gr.reviewReply ? 1 : 0;
          const reviewerName = (gr.reviewer && gr.reviewer.displayName) || "";
          const photoUrls = (gr.reviewMediaItems || []).map((m) => m.thumbnailUrl).filter(Boolean);

          const info = db
            .prepare(
              `INSERT INTO reviews (account_id, google_review_id, reviewer_name, star_rating, comment, review_create_time, has_owner_reply, photo_urls)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              account.id,
              gr.reviewId,
              reviewerName,
              starRating,
              comment,
              gr.createTime || null,
              hasOwnerReply,
              photoUrls.length ? JSON.stringify(photoUrls) : null
            );

          newCount++;

          // تنبيه فوري (بدون انتظار) لأي تقييم نجمة أو نجمتين — أسرع من الملخص المجمّع بآخر المزامنة
          if (starRating > 0 && starRating <= 2) {
            sendUrgentReviewAlert({
              toEmail: req.user.email,
              businessName: account.business_name,
              starRating,
              comment,
              reviewerName,
            }).catch((err) => logger.warn({ err: err.message }, "Failed to send urgent low-rating alert email"));
          }

          // ما نسوي مسودة رد لتقييم عنده رد من صاحب النشاط أصلاً
          if (!hasOwnerReply) {
            const { text, generatedBy } = await generateDraftReply({
              businessName: account.business_name,
              starRating,
              comment,
              reviewerName: (gr.reviewer && gr.reviewer.displayName) || "",
              tone: account.reply_tone,
            });

            const eligibleForAutoPublish =
              account.auto_publish_positive && isLowRisk({ starRating, comment, customKeywords: account.custom_risk_keywords });

            if (eligibleForAutoPublish) {
              // نشر تلقائي فوري — فقط لتقييمات آمنة (4-5 نجوم بدون أي إشارة سلبية بالتعليق)
              // وفقط إذا فعّل صاحب النشاط هذا الإعداد بنفسه. أي شك يرجّح كفة المراجعة اليدوية.
              const reviewResourceName = `${account.location_name}/reviews/${gr.reviewId}`;
              await google.publishReply(client, reviewResourceName, text);

              db.prepare(
                `INSERT INTO drafts (review_id, draft_text, status, generated_by, auto_published, published_at)
                 VALUES (?, ?, 'published', ?, 1, strftime('%s','now'))`
              ).run(info.lastInsertRowid, text, generatedBy);
              db.prepare(`UPDATE reviews SET has_owner_reply = 1 WHERE id = ?`).run(info.lastInsertRowid);
            } else {
              db.prepare(`INSERT INTO drafts (review_id, draft_text, status, generated_by) VALUES (?, ?, 'draft', ?)`).run(
                info.lastInsertRowid,
                text,
                generatedBy
              );
              needsReviewCount++;
            }
          }
        }
      } while (pageToken);

      db.prepare(`UPDATE accounts SET last_synced_at = strftime('%s','now') WHERE id = ?`).run(account.id);
    }

    if (needsReviewCount > 0) {
      notifyNewReviews({ toEmail: req.user.email, businessName: req.user.business_name, count: needsReviewCount }).catch((err) =>
        logger.warn({ err: err.message }, "Failed to send new-review notification email")
      );
    }

    res.redirect(`/dashboard?synced=${newCount}`);
  } catch (err) {
    next(err);
  }
});

// يتأكد إن التقييم يخص نشاط تجاري تابع للعميل المسجل دخوله حالياً (يمنع أي تسريب بيانات بين العملاء)
function getOwnedReview(reviewId, userId) {
  return db
    .prepare(
      `SELECT r.*, a.user_id, a.business_name, a.reply_tone, a.id AS account_id, s.status AS sub_status
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       LEFT JOIN subscriptions s ON s.account_id = a.id
       WHERE r.id = ? AND a.user_id = ?`
    )
    .get(reviewId, userId);
}

function requireActiveReviewAccount(review, res) {
  if (!review.sub_status || !ACTIVE_STATUSES.has(review.sub_status)) {
    res.status(402).send("This business's subscription isn't active. Complete payment from the Subscription page to manage its reviews.");
    return false;
  }
  return true;
}

// حفظ تعديل المستخدم على نص المسودة (بدون نشر)
router.post("/:id/draft", (req, res, next) => {
  try {
    const reviewId = Number(req.params.id);
    const review = getOwnedReview(reviewId, req.user.id);
    if (!review) return res.status(404).send("Review not found");
    if (!requireActiveReviewAccount(review, res)) return;

    const { draftText } = req.body;

    const existing = db.prepare(`SELECT id FROM drafts WHERE review_id = ?`).get(reviewId);
    if (existing) {
      db.prepare(`UPDATE drafts SET draft_text = ?, status = 'edited', updated_at = strftime('%s','now') WHERE review_id = ?`).run(
        draftText,
        reviewId
      );
    } else {
      db.prepare(`INSERT INTO drafts (review_id, draft_text, status, generated_by) VALUES (?, ?, 'edited', 'manual')`).run(reviewId, draftText);
    }

    res.redirect("/dashboard#review-" + reviewId);
  } catch (err) {
    next(err);
  }
});

// يعيد توليد مسودة جديدة لتقييم معين
router.post("/:id/regenerate", async (req, res, next) => {
  try {
    const reviewId = Number(req.params.id);
    const review = getOwnedReview(reviewId, req.user.id);
    if (!review) return res.status(404).send("Review not found");
    if (!requireActiveReviewAccount(review, res)) return;

    const { text, generatedBy } = await generateDraftReply({
      businessName: review.business_name,
      starRating: review.star_rating,
      comment: review.comment,
      reviewerName: review.reviewer_name,
      tone: review.reply_tone,
    });

    const existing = db.prepare(`SELECT id FROM drafts WHERE review_id = ?`).get(reviewId);
    if (existing) {
      db.prepare(`UPDATE drafts SET draft_text = ?, status = 'draft', generated_by = ?, updated_at = strftime('%s','now') WHERE review_id = ?`).run(
        text,
        generatedBy,
        reviewId
      );
    } else {
      db.prepare(`INSERT INTO drafts (review_id, draft_text, status, generated_by) VALUES (?, ?, 'draft', ?)`).run(reviewId, text, generatedBy);
    }

    res.redirect("/dashboard#review-" + reviewId);
  } catch (err) {
    next(err);
  }
});

// النشر الفعلي على Google — يحدث فقط هنا، وفقط لما المستخدم يضغط الزر بنفسه
router.post("/:id/publish", async (req, res, next) => {
  try {
    const reviewId = Number(req.params.id);
    const review = getOwnedReview(reviewId, req.user.id);
    if (!review) return res.status(404).send("Review not found");
    if (!requireActiveReviewAccount(review, res)) return;

    // لو المستخدم عدّل النص في الصندوق ولحقّ الضغط على نشر مباشرة بدون حفظ منفصل، نحفظ آخر نص كتبه أولاً
    if (typeof req.body.draftText === "string" && req.body.draftText.trim()) {
      db.prepare(`UPDATE drafts SET draft_text = ?, updated_at = strftime('%s','now') WHERE review_id = ?`).run(req.body.draftText, reviewId);
    }

    const draft = db.prepare(`SELECT draft_text FROM drafts WHERE review_id = ?`).get(reviewId);
    if (!draft || !draft.draft_text || !draft.draft_text.trim()) {
      return res.status(400).send("Draft text is empty — edit the reply before publishing");
    }

    const account = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(review.account_id);
    const client = await google.getAuthedClientForAccount(account);
    const reviewResourceName = `${account.location_name}/reviews/${review.google_review_id}`;

    await google.publishReply(client, reviewResourceName, draft.draft_text);

    db.prepare(`UPDATE drafts SET status = 'published', published_at = strftime('%s','now') WHERE review_id = ?`).run(reviewId);
    db.prepare(`UPDATE reviews SET has_owner_reply = 1 WHERE id = ?`).run(reviewId);

    res.redirect("/dashboard#review-" + reviewId);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
