// يبني تطبيق Express كامل بدون ما يشغّله (app.listen) — مفصول عن server.js عشان نقدر
// نستورده مباشرة بملفات الاختبار الآلي بدون فتح منفذ شبكة حقيقي أو تشغيل المهمة المجدولة.

const express = require("express");
const session = require("express-session");
const path = require("path");

const { env, missingRequired } = require("./config/env");
const logger = require("./config/logger");
const { helmetMiddleware } = require("./middleware/security");
const { attachCsrfToken, verifyCsrfToken } = require("./middleware/csrf");

const missing = missingRequired();
if (missing.length) {
  logger.warn({ missing }, "Missing required environment variables — some features won't work until configured");
}
if (!env.stripe.secretKey || !env.stripe.priceId) {
  logger.warn("STRIPE_SECRET_KEY or STRIPE_PRICE_ID not configured — billing pages won't work until set.");
}

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1); // خلف بروكسي Railway، عشان secure cookies وrate limiting يشتغلون صح

app.use(helmetMiddleware);

// راوت الـ webhook الخاص بـ Stripe يحتاج body خام (raw) للتحقق من التوقيع، فنسجله قبل urlencoded/session/csrf العام
app.use("/", require("./routes/billing").webhookRouter);

app.use(
  session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(attachCsrfToken);
app.use(verifyCsrfToken);

app.use("/", require("./routes/account"));
app.use("/", require("./routes/settings"));
app.use("/", require("./routes/public"));
app.use("/auth", require("./routes/auth"));
app.use("/", require("./routes/dashboard"));
app.use("/", require("./routes/billing").router);
app.use("/reviews", require("./routes/reviews"));
app.use("/templates", require("./routes/templates"));

app.use((req, res) => {
  res.status(404).render("errors/404");
});

app.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack, path: req.path }, "Unhandled request error");
  res.status(500).render("errors/500", { message: env.isProduction ? null : err.message });
});

module.exports = app;
