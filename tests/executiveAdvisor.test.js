// اختبار للوحة التنفيذية: يتأكد من حساب نسبة الرضا، أكثر المشاكل والعناصر المحبوبة تكراراً،
// وتفعيل الإنذار المبكر — على قاعدة بيانات معزولة مع بيانات مصطنعة بتواريخ محسوبة بدقة.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB_PATH = path.join(os.tmpdir(), `sanad-review-exec-test-${Date.now()}.sqlite`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.SESSION_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/auth/google/callback";

const db = require("../src/db");
const { getSatisfactionScore, getTopIssues, getTopPraises, getEarlyWarning, getBranchComparison } = require("../src/services/executiveAdvisor");

let userId, accountId;

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function insertReview({ starRating, comment, daysAgo }) {
  db.prepare(
    `INSERT INTO reviews (account_id, google_review_id, star_rating, comment, review_create_time)
     VALUES (?, ?, ?, ?, ?)`
  ).run(accountId, `gr-${Math.random()}`, starRating, comment, daysAgoIso(daysAgo));
}

before(() => {
  const userInfo = db
    .prepare(`INSERT INTO users (business_name, email, password_hash) VALUES ('Test Biz', 'exec-test@example.com', 'hash')`)
    .run();
  userId = userInfo.lastInsertRowid;

  const accountInfo = db.prepare(`INSERT INTO accounts (user_id, business_name) VALUES (?, 'Test Biz')`).run(userId);
  accountId = accountInfo.lastInsertRowid;

  db.prepare(`INSERT INTO subscriptions (user_id, account_id, status) VALUES (?, ?, 'active')`).run(userId, accountId);
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(TEST_DB_PATH + suffix, { force: true });
  }
});

test("getSatisfactionScore computes % of 4-5 star reviews and the delta vs the previous period", () => {
  // آخر 90 يوم: 7 إيجابي من 10 = 70%
  for (let i = 0; i < 7; i++) insertReview({ starRating: 5, comment: null, daysAgo: 10 + i });
  for (let i = 0; i < 3; i++) insertReview({ starRating: 2, comment: null, daysAgo: 20 + i });

  // الفترة السابقة (91-180 يوم): 2 إيجابي من 5 = 40%
  for (let i = 0; i < 2; i++) insertReview({ starRating: 5, comment: null, daysAgo: 100 + i });
  for (let i = 0; i < 3; i++) insertReview({ starRating: 1, comment: null, daysAgo: 110 + i });

  const result = getSatisfactionScore(userId, { accountId });
  assert.strictEqual(result.score, 70);
  assert.strictEqual(result.totalReviews, 10);
  assert.strictEqual(result.previousScore, 40);
  assert.strictEqual(result.delta, 30);
});

test("getTopIssues ranks the most-mentioned complaint keyword first", () => {
  insertReview({ starRating: 2, comment: "The service was very slow today", daysAgo: 5 });
  insertReview({ starRating: 1, comment: "Too slow, we waited forever", daysAgo: 6 });
  insertReview({ starRating: 3, comment: "Slow service but food was ok", daysAgo: 7 });
  insertReview({ starRating: 2, comment: "The staff was rude", daysAgo: 8 });

  const issues = getTopIssues(userId, { accountId });
  assert.ok(issues.length > 0);
  assert.strictEqual(issues[0].keyword, "slow");
  assert.strictEqual(issues[0].count, 3);
});

test("getTopPraises ranks the most-mentioned praise keyword first", () => {
  insertReview({ starRating: 5, comment: "Delicious food and great service!", daysAgo: 3 });
  insertReview({ starRating: 5, comment: "The food was delicious", daysAgo: 4 });
  insertReview({ starRating: 4, comment: "Friendly staff", daysAgo: 5 });

  const praises = getTopPraises(userId, { accountId });
  assert.ok(praises.length > 0);
  assert.strictEqual(praises[0].keyword, "delicious");
  assert.strictEqual(praises[0].count, 2);
});

test("getEarlyWarning triggers when recent rating drops sharply with a rising complaint", () => {
  const freshAccount = db.prepare(`INSERT INTO accounts (user_id, business_name) VALUES (?, 'Warning Biz')`).run(userId);
  const warnAccountId = freshAccount.lastInsertRowid;
  db.prepare(`INSERT INTO subscriptions (user_id, account_id, status) VALUES (?, ?, 'active')`).run(userId, warnAccountId);

  const insertFor = (id, { starRating, comment, daysAgo }) => {
    db.prepare(
      `INSERT INTO reviews (account_id, google_review_id, star_rating, comment, review_create_time) VALUES (?, ?, ?, ?, ?)`
    ).run(id, `gr-warn-${Math.random()}`, starRating, comment, daysAgoIso(daysAgo));
  };

  // 14-28 يوم اللي فات: كله ممتاز
  for (let i = 0; i < 4; i++) insertFor(warnAccountId, { starRating: 5, comment: "Great!", daysAgo: 15 + i });

  // آخر 14 يوم: تراجع واضح + شكوى متكررة
  for (let i = 0; i < 4; i++) insertFor(warnAccountId, { starRating: 2, comment: "Very slow service lately", daysAgo: 1 + i });

  const warning = getEarlyWarning(userId, { accountId: warnAccountId });
  assert.strictEqual(warning.triggered, true);
  assert.ok(warning.risingIssues.some((i) => i.keyword === "slow"));
});

test("getBranchComparison identifies the best, worst, most-improved and most-declined branches", () => {
  const branchA = db.prepare(`INSERT INTO accounts (user_id, business_name) VALUES (?, 'Branch A')`).run(userId).lastInsertRowid;
  const branchB = db.prepare(`INSERT INTO accounts (user_id, business_name) VALUES (?, 'Branch B')`).run(userId).lastInsertRowid;
  db.prepare(`INSERT INTO subscriptions (user_id, account_id, status) VALUES (?, ?, 'active')`).run(userId, branchA);
  db.prepare(`INSERT INTO subscriptions (user_id, account_id, status) VALUES (?, ?, 'active')`).run(userId, branchB);

  const insertFor = (id, star, daysAgo) => {
    db.prepare(
      `INSERT INTO reviews (account_id, google_review_id, star_rating, review_create_time) VALUES (?, ?, ?, ?)`
    ).run(id, `gr-branch-${Math.random()}`, star, daysAgoIso(daysAgo));
  };

  // Branch A: ممتاز بالفترة الحالية، وكان متوسط بالفترة السابقة (تحسّن)
  for (let i = 0; i < 3; i++) insertFor(branchA, 5, 10 + i);
  for (let i = 0; i < 3; i++) insertFor(branchA, 3, 100 + i);

  // Branch B: ضعيف بالفترة الحالية، وكان ممتاز بالفترة السابقة (تراجع)
  for (let i = 0; i < 3; i++) insertFor(branchB, 2, 10 + i);
  for (let i = 0; i < 3; i++) insertFor(branchB, 5, 100 + i);

  const comparison = getBranchComparison(userId);
  assert.strictEqual(comparison.best.name, "Branch A");
  assert.strictEqual(comparison.worst.name, "Branch B");
  assert.strictEqual(comparison.mostImproved.name, "Branch A");
  assert.strictEqual(comparison.mostDeclined.name, "Branch B");
});

test("getEarlyWarning does not trigger with too little data", () => {
  const freshAccount = db.prepare(`INSERT INTO accounts (user_id, business_name) VALUES (?, 'Quiet Biz')`).run(userId);
  const quietAccountId = freshAccount.lastInsertRowid;
  db.prepare(`INSERT INTO subscriptions (user_id, account_id, status) VALUES (?, ?, 'active')`).run(userId, quietAccountId);

  const warning = getEarlyWarning(userId, { accountId: quietAccountId });
  assert.strictEqual(warning.triggered, false);
  assert.strictEqual(warning.reason, "insufficient_data");
});
