const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// DB_PATH يسمح باستخدام ملف قاعدة بيانات منفصل أثناء الاختبارات الآلية بدون لمس بيانات التطوير الحقيقية
const dbPath = process.env.DB_PATH || path.join(dataDir, "sanad-review.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    reset_token_hash TEXT,
    reset_token_expires_at INTEGER,
    last_digest_summary TEXT,
    last_digest_sent_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- كل نشاط تجاري مربوط له اشتراكه الخاص (35$/شهر لكل فرع/بزنس)
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    account_id INTEGER UNIQUE REFERENCES accounts(id),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'incomplete', -- incomplete | active | trialing | past_due | canceled | unpaid
    current_period_end INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    business_name TEXT,
    google_account_name TEXT,
    location_name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expiry INTEGER,
    last_synced_at INTEGER,
    auto_publish_positive INTEGER NOT NULL DEFAULT 0,
    custom_risk_keywords TEXT,
    reply_tone TEXT NOT NULL DEFAULT 'friendly',
    insight_summary TEXT,
    insight_generated_at INTEGER,
    insight_source TEXT,
    google_review_link TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    google_review_id TEXT NOT NULL,
    reviewer_name TEXT,
    star_rating INTEGER NOT NULL,
    comment TEXT,
    review_create_time TEXT,
    has_owner_reply INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(account_id, google_review_id)
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL UNIQUE REFERENCES reviews(id),
    draft_text TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | edited | published
    generated_by TEXT, -- claude | template | manual
    auto_published INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- ردود جاهزة يحفظها صاحب النشاط لاستخدامها كنقطة بداية سريعة عند كتابة رد يدوي
  CREATE TABLE IF NOT EXISTS reply_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    label TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_account ON reviews(account_id);
  CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_reply_templates_account ON reply_templates(account_id);
`);

// ترقية بسيطة لقواعد بيانات أُنشئت قبل إضافة اللوحة التنفيذية: نضيف أعمدة الموقع الجغرافي/الفئة
// لو ما كانت موجودة أصلاً، بدون ما نلمس أي بيانات حالية.
const accountColumns = db.prepare(`PRAGMA table_info(accounts)`).all().map((c) => c.name);
if (!accountColumns.includes("latitude")) db.exec(`ALTER TABLE accounts ADD COLUMN latitude REAL`);
if (!accountColumns.includes("longitude")) db.exec(`ALTER TABLE accounts ADD COLUMN longitude REAL`);
if (!accountColumns.includes("primary_category")) db.exec(`ALTER TABLE accounts ADD COLUMN primary_category TEXT`);
// متوسط قيمة الزبون (بعملة صاحب النشاط، أي رقم يحدده هو) — يُستخدم لتقدير "الإيرادات المعرّضة للخطر"
// بسبب مشكلة متكررة. تقدير تقريبي مبني على افتراض صاحب النشاط نفسه، مو رقم مقاس فعلياً.
if (!accountColumns.includes("avg_customer_value")) db.exec(`ALTER TABLE accounts ADD COLUMN avg_customer_value REAL`);
// نص AI مُخزَّن من آخر تحليل عميق (توصيات تشغيلية محددة + موظفين مذكورين)، بنفس نمط insight_summary
if (!accountColumns.includes("exec_ai_summary")) db.exec(`ALTER TABLE accounts ADD COLUMN exec_ai_summary TEXT`);
if (!accountColumns.includes("exec_ai_generated_at")) db.exec(`ALTER TABLE accounts ADD COLUMN exec_ai_generated_at INTEGER`);

const reviewColumns = db.prepare(`PRAGMA table_info(reviews)`).all().map((c) => c.name);
// روابط صور مرفقة بالتقييم من Google (JSON array نصي) — تُستخدم لتحليل الصور بالذكاء الاصطناعي
if (!reviewColumns.includes("photo_urls")) db.exec(`ALTER TABLE reviews ADD COLUMN photo_urls TEXT`);

module.exports = db;
