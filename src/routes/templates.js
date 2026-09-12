// إدارة "الردود الجاهزة المحفوظة" لكل نشاط تجاري — مقاطع نص يحفظها صاحب النشاط ليستخدمها
// كنقطة بداية سريعة عند كتابة رد يدوي (بدل ما يكتب من الصفر كل مرة لنفس الحالات المتكررة).

const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAuth, isAccountActive } = require("../middleware/auth");

function getOwnedAccount(accountId, userId) {
  return db.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).get(accountId, userId);
}

router.post("/accounts/:accountId", requireAuth, (req, res) => {
  const accountId = Number(req.params.accountId);
  const account = getOwnedAccount(accountId, req.user.id);
  if (!account) return res.status(404).send("Business not found");
  if (!isAccountActive(accountId)) return res.redirect("/billing");

  const label = (req.body.label || "").trim().slice(0, 80);
  const body = (req.body.body || "").trim().slice(0, 2000);
  if (!label || !body) return res.redirect("/dashboard");

  db.prepare(`INSERT INTO reply_templates (account_id, label, body) VALUES (?, ?, ?)`).run(accountId, label, body);
  res.redirect("/dashboard");
});

router.post("/:id/delete", requireAuth, (req, res) => {
  const templateId = Number(req.params.id);
  const template = db
    .prepare(`SELECT rt.*, a.user_id FROM reply_templates rt JOIN accounts a ON a.id = rt.account_id WHERE rt.id = ?`)
    .get(templateId);

  if (!template || template.user_id !== req.user.id) return res.status(404).send("Template not found");

  db.prepare(`DELETE FROM reply_templates WHERE id = ?`).run(templateId);
  res.redirect("/dashboard");
});

module.exports = router;
