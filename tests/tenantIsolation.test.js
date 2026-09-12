// اختبار تكاملي: يشغّل التطبيق الحقيقي على منفذ مؤقت مع قاعدة بيانات معزولة، ويتأكد إن:
// 1) التسجيل وتسجيل الدخول يشتغلون
// 2) لوحة التحكم ما تجبر على دفع قبل ربط أي نشاط تجاري
// 3) عميل ما يقدر يوصل لبيانات عميل ثاني (فحص أساسي لعزل البيانات بين المستأجرين)

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB_PATH = path.join(os.tmpdir(), `sanad-review-test-${Date.now()}.sqlite`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.SESSION_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/auth/google/callback";

const app = require("../src/app");

let server;
let baseUrl;

before(() => {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(TEST_DB_PATH + suffix, { force: true });
  }
});

// مساعد بسيط: يمسك أي كوكي جديد من الرد ويرجعه للطلبات التالية، ويستخرج CSRF token من الصفحة
function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

async function getCookieAndCsrf(path, cookie = "") {
  const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  const html = await res.text();
  const setCookie = res.headers.get("set-cookie");
  const newCookie = setCookie ? setCookie.split(";")[0] : cookie;
  return { cookie: newCookie, csrf: extractCsrf(html) };
}

test("signup succeeds and redirects to dashboard without forcing payment first", async () => {
  const { cookie, csrf } = await getCookieAndCsrf("/signup");
  assert.ok(csrf, "signup page should carry a CSRF token");

  const res = await fetch(`${baseUrl}/signup`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({
      _csrf: csrf,
      businessName: "Test Biz A",
      email: "tenant-a@example.com",
      password: "testpass123",
    }),
  });

  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get("location"), "/dashboard");
});

test("a request without a valid CSRF token is rejected", async () => {
  const res = await fetch(`${baseUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ businessName: "No CSRF", email: "nocsrf@example.com", password: "testpass123" }),
  });
  assert.strictEqual(res.status, 403);
});

test("a logged-in user cannot access another tenant's business settings", async () => {
  // ننشئ عميلين منفصلين بجلستين منفصلتين
  const signup = async (email) => {
    const { cookie, csrf } = await getCookieAndCsrf("/signup");
    await fetch(`${baseUrl}/signup`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ _csrf: csrf, businessName: `Biz ${email}`, email, password: "testpass123" }),
    });
    return cookie;
  };

  const cookieOwner = await signup("owner@example.com");
  const cookieIntruder = await signup("intruder@example.com");

  // نتأكد إن العميلين فعلاً بجلستين مستقلتين (كوكي مختلف)
  assert.notStrictEqual(cookieOwner, cookieIntruder);

  // نجيب توكن CSRF صحيح لجلسة الدخيل عشان الطلب يوصل فعلياً لفحص الملكية (مو يترفض من فحص CSRF بس)
  const { csrf: intruderCsrf } = await getCookieAndCsrf("/dashboard", cookieIntruder);

  // العميل الدخيل يحاول يوصل لصفحة إعدادات نشاط تجاري برقم اختياري (لا يملكه) — يتوقع 404، مو بيانات فعلية
  const res = await fetch(`${baseUrl}/accounts/1/insights`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieIntruder },
    body: new URLSearchParams({ _csrf: intruderCsrf }),
  });
  assert.strictEqual(res.status, 404, `expected 404 for cross-tenant access, got ${res.status}`);
});
