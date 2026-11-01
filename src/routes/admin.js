const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

// لوحة قراءة فقط: كم مستخدم سجّل، كم نشاط تجاري مربوط، وحالة اشتراكاتهم — محمية بـ requireAdmin.
router.get("/admin/stats", requireAuth, requireAdmin, (req, res) => {
  const totalUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const totalAccounts = db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get().n;

  const byStatus = db
    .prepare(`SELECT COALESCE(status, 'no subscription row') AS status, COUNT(*) AS n FROM subscriptions GROUP BY status`)
    .all();

  const accountsWithoutSub = totalAccounts - byStatus.reduce((sum, row) => sum + row.n, 0);
  if (accountsWithoutSub > 0) byStatus.push({ status: "no subscription row", n: accountsWithoutSub });

  const activeCount = byStatus.filter((r) => r.status === "active" || r.status === "trialing").reduce((sum, r) => sum + r.n, 0);

  const recentSignups = db
    .prepare(`SELECT business_name, email, created_at FROM users ORDER BY created_at DESC LIMIT 20`)
    .all();

  const recentAccounts = db
    .prepare(
      `SELECT a.business_name, a.created_at, u.email AS owner_email, s.status AS sub_status
       FROM accounts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN subscriptions s ON s.account_id = a.id
       ORDER BY a.created_at DESC LIMIT 20`
    )
    .all();

  res.render("admin/stats", { totalUsers, totalAccounts, activeCount, byStatus, recentSignups, recentAccounts });
});

module.exports = router;
