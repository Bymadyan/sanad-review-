// يقرأ متغيرات البيئة، يتحقق من الأساسية منها، ويصدّرها بمكان واحد بدل ما تتكرر
// عمليات process.env في كل ملف. أي متغير اختياري (Claude, Resend) يبقى undefined بأمان.

require("dotenv").config();

const REQUIRED = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "SESSION_SECRET"];

function missingRequired() {
  return REQUIRED.filter((key) => !process.env[key]);
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  appBaseUrl: process.env.APP_BASE_URL || null,
  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || null,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || null,
    priceId: process.env.STRIPE_PRICE_ID || null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
  },

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,

  // اختياري: مقارنة المنافسين القريبين باللوحة التنفيذية (Google Places API). بدونه، الميزة
  // تختفي بأمان بدل ما تسبب خطأ — تحتاج مفتاح API منفصل + تفعيل Billing على Google Cloud.
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || null,

  resend: {
    apiKey: process.env.RESEND_API_KEY || null,
    fromEmail: process.env.RESEND_FROM_EMAIL || "Sanad Review <onboarding@resend.dev>",
  },

  isProduction: (process.env.NODE_ENV || "development") === "production",
};

module.exports = { env, missingRequired };
