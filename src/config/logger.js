// تسجيل أحداث منظّم (structured logging) بدل console.log/console.error المبعثرة —
// يسهّل تتبع الأخطاء الحقيقية بالإنتاج ويميزها عن أخطاء العملاء المتوقعة (404، إلخ).

const pino = require("pino");
const { env } = require("./env");

const logger = pino({
  level: env.isProduction ? "info" : "debug",
});

module.exports = logger;
