const { OAuth2Client } = require("google-auth-library");
const db = require("../db");
const { env } = require("../config/env");

const SCOPES = ["https://www.googleapis.com/auth/business.manage"];

function newOAuthClient() {
  return new OAuth2Client(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
}

function getAuthUrl() {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // نضمن الحصول على refresh_token في كل مرة
    scope: SCOPES,
  });
}

async function exchangeCodeForTokens(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

// يرجع OAuth2Client جاهز ومحدّث التوكن لحساب معين، ويحفظ التوكن الجديد إذا تجدد
async function getAuthedClientForAccount(account) {
  const client = newOAuthClient();
  client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.token_expiry,
  });

  client.on("tokens", (tokens) => {
    db.prepare(
      `UPDATE accounts SET access_token = ?, token_expiry = ?, refresh_token = COALESCE(?, refresh_token) WHERE id = ?`
    ).run(tokens.access_token || account.access_token, tokens.expiry_date || account.token_expiry, tokens.refresh_token || null, account.id);
  });

  // يجدد التوكن تلقائياً إذا كان منتهي أو قريب من الانتهاء
  await client.getAccessToken();
  return client;
}

async function apiRequest(client, url, options = {}) {
  const accessToken = (await client.getAccessToken()).token;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Google API error ${res.status}: ${JSON.stringify(json)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// يجيب كل الحسابات (accounts/{id}) المرتبطة بالمستخدم اللي سوى تسجيل الدخول
async function listGoogleAccounts(client) {
  const data = await apiRequest(client, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
  return data.accounts || [];
}

// يجيب المواقع/النشاطات التجارية تحت حساب Google معين، بما فيها رابط كتابة تقييم جديد.
// latlng وcategories مطلوبين لميزة "مقارنة المنافسين القريبين" الاختيارية باللوحة التنفيذية.
async function listLocations(client, accountName) {
  const readMask = "name,title,storefrontAddress,phoneNumbers,metadata.newReviewUri,latlng,categories";
  const data = await apiRequest(
    client,
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`
  );
  return data.locations || [];
}

// يجيب التقييمات لموقع معين (locationName بصيغة accounts/{id}/locations/{id})
async function listReviews(client, locationName, pageToken) {
  const url = new URL(`https://mybusiness.googleapis.com/v4/${locationName}/reviews`);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const data = await apiRequest(client, url.toString());
  return { reviews: data.reviews || [], nextPageToken: data.nextPageToken || null };
}

// ينشر رد على تقييم في Google. لا تستدعِ هذه الدالة إلا عند ضغط المستخدم على زر "نشر" يدوياً
// (أو داخل مسار النشر التلقائي المُقيّد صراحة بموافقة صاحب النشاط).
async function publishReply(client, reviewResourceName, replyText) {
  return apiRequest(client, `https://mybusiness.googleapis.com/v4/${reviewResourceName}/reply`, {
    method: "PUT",
    body: JSON.stringify({ comment: replyText }),
  });
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAuthedClientForAccount,
  listGoogleAccounts,
  listLocations,
  listReviews,
  publishReply,
};
