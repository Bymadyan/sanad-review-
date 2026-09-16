// اللوحة التنفيذية: مستشار تشغيلي يحوّل التقييمات إلى قرارات — نسبة رضا، أكثر المشاكل والعناصر
// المحبوبة تكراراً، إنذار مبكر لمؤشر تراجع، ومقارنة اختيارية بالمنافسين القريبين.

const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAuth, isAccountActive } = require("../middleware/auth");
const {
  getSatisfactionScore,
  getTopIssues,
  getTopPraises,
  getEarlyWarning,
  getBranchComparison,
  getRevenueAtRisk,
} = require("../services/executiveAdvisor");
const { getNearbyCompetitors, analyzeNamedCompetitor } = require("../services/competitorAnalysis");
const { renderBarChartSvg } = require("../services/analytics");
const { generateDeepAnalysis } = require("../services/deepAnalysis");
const { answerOperationalQuestion } = require("../services/aiAssistant");

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
        selectedAccount: null,
        selectedAccountId: null,
        satisfaction: null,
        topIssues: [],
        topPraises: [],
        issuesChartSvg: null,
        praisesChartSvg: null,
        earlyWarning: null,
        branchComparison: null,
        revenueAtRisk: { available: false, reason: "no_active_business" },
        competitors: { available: false, reason: "no_active_business" },
        aiAnswer: null,
        competitorAnalysis: null,
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
    const revenueAtRisk = getRevenueAtRisk(req.user.id, { accountId: selectedAccountId });
    const branchComparison = accounts.length > 1 ? getBranchComparison(req.user.id) : null;

    let competitors = { available: false, reason: "select_a_business" };
    if (selectedAccount) {
      competitors = await getNearbyCompetitors(selectedAccount);
    }

    // إجابة آخر سؤال سألوه المساعد الذكي، ونتيجة آخر بحث منافس بالاسم (لو فيه) — نمررهم مرة وحدة
    // بس ثم نمسحهم من الجلسة
    const aiAnswer = req.session.lastAiAnswer || null;
    delete req.session.lastAiAnswer;
    const competitorAnalysis = req.session.lastCompetitorAnalysis || null;
    delete req.session.lastCompetitorAnalysis;

    res.render("dashboard/executive", {
      accounts,
      selectedAccount,
      selectedAccountId,
      satisfaction,
      topIssues,
      topPraises,
      issuesChartSvg: renderBarChartSvg(topIssues),
      praisesChartSvg: renderBarChartSvg(topPraises, { barColor: "#16a34a" }),
      earlyWarning,
      branchComparison,
      revenueAtRisk,
      competitors,
      aiAnswer,
      competitorAnalysis,
    });
  } catch (err) {
    next(err);
  }
});

// مساعد ذكاء اصطناعي: يجاوب سؤال حر عن بيانات النطاق المختار (نشاط معين أو كل الأنشطة)، بالاعتماد
// فقط على ملخص محسوب فعلياً (بدون صلاحية SQL مباشرة للنموذج) — يحتاج ANTHROPIC_API_KEY.
router.post("/executive/ask", requireAuth, async (req, res, next) => {
  try {
    const question = (req.body.question || "").trim();
    const accountId = req.body.accountId ? Number(req.body.accountId) : null;

    if (!question) return res.redirect(`/executive${accountId ? `?accountId=${accountId}` : ""}`);

    const account = accountId ? db.prepare(`SELECT business_name FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id) : null;
    const businessName = account ? account.business_name : req.user.business_name;

    const contextSummary = {
      scope: account ? account.business_name : "all businesses combined",
      satisfaction: getSatisfactionScore(req.user.id, { accountId }),
      topIssues: getTopIssues(req.user.id, { accountId }),
      topPraises: getTopPraises(req.user.id, { accountId }),
      earlyWarning: getEarlyWarning(req.user.id, { accountId }),
      branchComparison: !accountId ? getBranchComparison(req.user.id) : undefined,
    };

    const result = await answerOperationalQuestion({ businessName, question, contextSummary });
    req.session.lastAiAnswer = result;

    res.redirect(`/executive${accountId ? `?accountId=${accountId}` : ""}`);
  } catch (err) {
    next(err);
  }
});

// تحليل منافس محدد بالاسم — يبحث عنه على Google (يحتاج GOOGLE_PLACES_API_KEY)، ويلخّص نقاط
// القوة/الضعف من عيّنة مراجعاته العامة (لو Claude مفعّل)
router.post("/executive/competitor-analysis", requireAuth, async (req, res, next) => {
  try {
    const competitorName = (req.body.competitorName || "").trim();
    const accountId = req.body.accountId ? Number(req.body.accountId) : null;

    if (!competitorName) return res.redirect(`/executive${accountId ? `?accountId=${accountId}` : ""}`);

    const account = accountId ? db.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id) : null;

    const result = await analyzeNamedCompetitor(competitorName, account || {});
    req.session.lastCompetitorAnalysis = result;

    res.redirect(`/executive${accountId ? `?accountId=${accountId}` : ""}`);
  } catch (err) {
    next(err);
  }
});

// تحليل عميق بالذكاء الاصطناعي (توصيات محددة + موظفين مذكورين + ملاحظات من الصور) لنشاط تجاري
// محدد — يحتاج ANTHROPIC_API_KEY، ونتيجته تُخزَّن (زي ميزة "التحليل الذكي" الموجودة) بدل ما تُحسب
// من جديد بكل زيارة للصفحة (توفير تكلفة استدعاء Claude).
router.post("/accounts/:id/deep-analysis", requireAuth, async (req, res, next) => {
  try {
    const accountId = Number(req.params.id);
    const account = db.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, req.user.id);
    if (!account) return res.status(404).send("Business not found");
    if (!isAccountActive(accountId)) return res.redirect("/billing");

    const reviews = db
      .prepare(
        `SELECT star_rating, comment, review_create_time, photo_urls FROM reviews
         WHERE account_id = ? AND review_create_time >= datetime('now', '-90 days')`
      )
      .all(accountId);

    const result = await generateDeepAnalysis({ businessName: account.business_name, reviews });

    if (result.available) {
      db.prepare(`UPDATE accounts SET exec_ai_summary = ?, exec_ai_generated_at = strftime('%s','now') WHERE id = ?`).run(
        result.summary,
        accountId
      );
    }

    res.redirect(`/executive?accountId=${accountId}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
