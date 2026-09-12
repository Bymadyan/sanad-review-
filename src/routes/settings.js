const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

router.get("/settings", requireAuth, (req, res) => {
  res.render("account/settings", { error: null, success: null });
});

router.post("/settings/profile", requireAuth, (req, res) => {
  const businessName = (req.body.businessName || "").trim();
  if (!businessName) {
    return res.render("account/settings", { error: "Business name can't be empty", success: null });
  }

  db.prepare(`UPDATE users SET business_name = ? WHERE id = ?`).run(businessName, req.user.id);
  res.render("account/settings", { error: null, success: "Business name updated." });
});

router.post("/settings/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  const matches = await bcrypt.compare(currentPassword || "", user.password_hash);
  if (!matches) {
    return res.render("account/settings", { error: "Current password is incorrect", success: null });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.render("account/settings", { error: "New password must be at least 8 characters", success: null });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, req.user.id);
  res.render("account/settings", { error: null, success: "Password updated." });
});

module.exports = router;
