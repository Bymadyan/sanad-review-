const express = require("express");
const router = express.Router();
const db = require("../db");
const google = require("../services/googleClient");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);

// يبدأ تدفق OAuth لربط حساب Google Business Profile
router.get("/google", (req, res) => {
  res.redirect(google.getAuthUrl());
});

router.get("/google/callback", async (req, res, next) => {
  try {
    const { code, error } = req.query;
    if (error) {
      return res.status(400).send(`Google access was denied: ${error}`);
    }
    const tokens = await google.exchangeCodeForTokens(code);

    // نحفظ التوكن مؤقتاً في الجلسة عشان نكمل خطوة اختيار النشاط التجاري
    req.session.pendingTokens = tokens;
    res.redirect("/auth/select-location");
  } catch (err) {
    next(err);
  }
});

// بعد الموافقة، نخلي صاحب العمل يختار أي نشاط تجاري (لو عنده أكثر من واحد) يربطه
router.get("/select-location", async (req, res, next) => {
  try {
    const tokens = req.session.pendingTokens;
    if (!tokens) return res.redirect("/auth/google");

    const client = await google.getAuthedClientForAccount({
      id: null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: tokens.expiry_date,
    });

    const accounts = await google.listGoogleAccounts(client);
    const locationsByAccount = [];
    for (const acc of accounts) {
      const locations = await google.listLocations(client, acc.name);
      locationsByAccount.push({ account: acc, locations });
    }

    res.render("auth/select-location", { locationsByAccount });
  } catch (err) {
    next(err);
  }
});

router.post("/select-location", (req, res, next) => {
  try {
    const tokens = req.session.pendingTokens;
    if (!tokens) return res.redirect("/auth/google");

    const { locationName, businessName, reviewLink } = req.body;
    if (!locationName) return res.status(400).send("Please select a business");

    db.prepare(
      `INSERT INTO accounts (user_id, business_name, location_name, access_token, refresh_token, token_expiry, google_review_link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user.id,
      businessName || locationName,
      locationName,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date,
      reviewLink || null
    );

    delete req.session.pendingTokens;
    // كل نشاط تجاري جديد يحتاج اشتراكه الخاص قبل ما يشتغل — نوديه لصفحة الاشتراك
    res.redirect("/billing");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
