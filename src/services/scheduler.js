// مهمة مجدولة تولّد وترسل التقرير الأسبوعي لكل عميل عنده اشتراك فعّال، كل يوم اثنين 8 صباحاً UTC.

const cron = require("node-cron");
const db = require("../db");
const { buildWeeklyDigest } = require("./digestGenerator");
const { sendWeeklyDigest } = require("./emailer");
const logger = require("../config/logger");

async function runWeeklyDigestForAllUsers() {
  const users = db
    .prepare(
      `SELECT DISTINCT u.* FROM users u
       JOIN accounts a ON a.user_id = u.id
       JOIN subscriptions s ON s.account_id = a.id
       WHERE s.status IN ('active','trialing')`
    )
    .all();

  for (const user of users) {
    try {
      const digest = await buildWeeklyDigest(user);
      if (!digest) continue;

      db.prepare(`UPDATE users SET last_digest_summary = ?, last_digest_sent_at = strftime('%s','now') WHERE id = ?`).run(
        digest.narrative,
        user.id
      );

      if (digest.thisWeekCount > 0) {
        await sendWeeklyDigest({ toEmail: user.email, subject: digest.subject, narrative: digest.narrative });
      }
    } catch (err) {
      logger.error({ err: err.message, userId: user.id }, "Weekly digest failed for user");
    }
  }
}

function startScheduler() {
  cron.schedule("0 8 * * 1", () => {
    runWeeklyDigestForAllUsers().catch((err) => logger.error({ err: err.message }, "Weekly digest job crashed"));
  });
}

module.exports = { startScheduler, runWeeklyDigestForAllUsers };
