const express = require("express");
const router = express.Router();
const db = require("../db");
const { getLandingCopy } = require("../i18n/landing");

function readLangCookie(req) {
  const header = req.headers.cookie || "";
  const match = header.match(/(?:^|;\s*)sanad_review_lang=(en|ar)/);
  return match ? match[1] : null;
}

router.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");

  const queryLang = req.query.lang === "ar" || req.query.lang === "en" ? req.query.lang : null;
  const lang = queryLang || readLangCookie(req) || "en"; // الإنجليزي هو الافتراضي

  if (queryLang) {
    res.cookie("sanad_review_lang", queryLang, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: false });
  }

  res.render("landing", { t: getLandingCopy(lang) });
});

router.get("/privacy", (req, res) => res.render("legal/privacy"));
router.get("/terms", (req, res) => res.render("legal/terms"));

// رابط عام (بدون تسجيل دخول) يفتحه أي عميل يمسح كود QR أو يضغط رابط طلب التقييم،
// ويوجهه مباشرة لصفحة كتابة تقييم جديد على Google لنفس النشاط التجاري
router.get("/r/:id", (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare(`SELECT google_review_link FROM accounts WHERE id = ?`).get(accountId);

  if (!account || !account.google_review_link) {
    return res.status(404).send("This review link isn't available yet.");
  }

  res.redirect(account.google_review_link);
});

module.exports = router;
