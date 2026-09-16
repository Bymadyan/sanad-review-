// اللوحة التنفيذية: مستشار تشغيلي يحوّل التقييمات إلى قرارات — نسبة رضا، أكثر المشاكل والعناصر
// المحبوبة تكراراً، إنذار مبكر لمؤشر تراجع، ومقارنة اختيارية بالمنافسين القريبين.

const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { getSatisfactionScore, getTopIssues, getTopPraises, getEarlyWarning } = require("../services/executiveAdvisor");
const { getNearbyCompetitors } = require("../services/competitorAnalysis");

router.get("/executive", requireAuth, async (req, res, next) => {
  try {
    const accounts = db
      .prepare(
        `SELECT a.* FROM accounts a
         JOIN subscriptions s ON s.account_id = a.id
         WHERE a.user_id = ? AND s.status IN ('active','trialing')
         ORDER BY a.business_name`
      )
      .all(req.user.id);

    if (!accounts.length) {
      return res.render("dashboard/executive", {
        accounts: [],
        selectedAccountId: null,
        satisfaction: null,
        topIssues: [],
        topPraises: [],
        earlyWarning: null,
        competitors: { available: false, reason: "no_active_business" },
      });
    }

    // نشاط تجاري وحيد؟ نختاره تلقائياً بدل ما نجبر صاحب العمل يختار من قائمة ما هي موجودة أصلاً
    const requestedId = req.query.accountId ? Number(req.query.accountId) : null;
    let selectedAccount = requestedId ? accounts.find((a) => a.id === requestedId) : null;
    if (!selectedAccount && !requestedId && accounts.length === 1) {
      selectedAccount = accounts[0];
    }
    const selectedAccountId = selectedAccount ? selectedAccount.id : null;

    const satisfaction = getSatisfactionScore(req.user.id, { accountId: selectedAccountId });
    const topIssues = getTopIssues(req.user.id, { accountId: selectedAccountId });
    const topPraises = getTopPraises(req.user.id, { accountId: selectedAccountId });
    const earlyWarning = getEarlyWarning(req.user.id, { accountId: selectedAccountId });

    let competitors = { available: false, reason: "select_a_business" };
    if (selectedAccount) {
      competitors = await getNearbyCompetitors(selectedAccount);
    }

    res.render("dashboard/executive", {
      accounts,
      selectedAccountId,
      satisfaction,
      topIssues,
      topPraises,
      earlyWarning,
      competitors,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
