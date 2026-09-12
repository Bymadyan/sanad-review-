const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authRateLimiter } = require("../middleware/security");
const { sendPasswordResetEmail } = require("../services/emailer");
const { env } = require("../config/env");
const logger = require("../config/logger");

function baseUrl(req) {
  return env.appBaseUrl || `${req.protocol}://${req.get("host")}`;
}

router.get("/signup", (req, res) => {
  res.render("account/signup", { error: null, values: {} });
});

router.post("/signup", authRateLimiter, async (req, res) => {
  const { businessName, email, password } = req.body;

  if (!businessName || !email || !password || password.length < 8) {
    return res.render("account/signup", {
      error: "Please fill in all fields, and make sure your password is at least 8 characters",
      values: { businessName, email },
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
  if (existing) {
    return res.render("account/signup", {
      error: "An account with this email already exists — try logging in instead",
      values: { businessName, email },
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const info = db
    .prepare(`INSERT INTO users (business_name, email, password_hash) VALUES (?, ?, ?)`)
    .run(businessName.trim(), normalizedEmail, passwordHash);

  // ما فيه اشتراك يُنشأ هنا — كل نشاط تجاري يُفعّل اشتراكه الخاص لما يُربط لاحقاً
  req.session.userId = info.lastInsertRowid;
  res.redirect("/dashboard");
});

router.get("/login", (req, res) => {
  res.render("account/login", { error: null });
});

router.post("/login", authRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get((email || "").toLowerCase().trim());

  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.render("account/login", { error: "Incorrect email or password" });
  }

  req.session.userId = user.id;
  res.redirect("/dashboard");
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

router.get("/forgot-password", (req, res) => {
  res.render("account/forgot-password", { sent: false, error: null });
});

router.post("/forgot-password", authRateLimiter, async (req, res, next) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

    // نعرض نفس الرسالة سواء الإيميل موجود أو لا، عشان ما نسرّب أي حساب مسجل من عدمه
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60; // ساعة وحدة

      db.prepare(`UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ? WHERE id = ?`).run(tokenHash, expiresAt, user.id);

      const resetUrl = `${baseUrl(req)}/reset-password?token=${token}&uid=${user.id}`;
      try {
        await sendPasswordResetEmail({ toEmail: user.email, resetUrl });
      } catch (err) {
        logger.warn({ err: err.message }, "Failed to send password reset email");
      }
    }

    res.render("account/forgot-password", { sent: true, error: null });
  } catch (err) {
    next(err);
  }
});

router.get("/reset-password", (req, res) => {
  const { token, uid } = req.query;
  if (!token || !uid) return res.redirect("/forgot-password");
  res.render("account/reset-password", { token, uid, error: null });
});

router.post("/reset-password", authRateLimiter, async (req, res) => {
  const { token, uid, password } = req.body;
  const render = (error) => res.render("account/reset-password", { token, uid, error });

  if (!password || password.length < 8) {
    return render("Password must be at least 8 characters");
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(uid));
  const tokenHash = crypto.createHash("sha256").update(token || "").digest("hex");

  const valid =
    user &&
    user.reset_token_hash &&
    user.reset_token_hash === tokenHash &&
    user.reset_token_expires_at &&
    user.reset_token_expires_at > Math.floor(Date.now() / 1000);

  if (!valid) {
    return render("This reset link is invalid or has expired. Please request a new one.");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(`UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = ?`).run(
    passwordHash,
    user.id
  );

  res.redirect("/login");
});

module.exports = router;
