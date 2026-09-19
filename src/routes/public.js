const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("landing");
});

router.get("/privacy", (req, res) => res.render("legal/privacy"));
router.get("/terms", (req, res) => res.render("legal/terms"));

// Public link (no login needed) that a customer reaches by scanning a QR code or
// clicking a review-request link — sends them straight to a new Google review form
// for that business.
router.get("/r/:id", (req, res) => {
  const accountId = Number(req.params.id);
  const account = db.prepare(`SELECT google_review_link FROM accounts WHERE id = ?`).get(accountId);

  if (!account || !account.google_review_link) {
    return res.status(404).send("This review link isn't available yet.");
  }

  res.redirect(account.google_review_link);
});

module.exports = router;
