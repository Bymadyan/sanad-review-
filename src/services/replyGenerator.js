// يولّد رد مقترح لتقييم واحد. يحاول استخدام Claude إذا كان في ANTHROPIC_API_KEY،
// وإلا يرجع لقوالب جاهزة عربي/إنجليزي حسب لغة التقييم ونبرة الرد المختارة. النتيجة دايماً "مسودة" فقط.

const { env } = require("../config/env");
const logger = require("../config/logger");

function isArabic(text) {
  return /[؀-ۿ]/.test(text || "");
}

function ratingBucket(stars) {
  if (stars >= 4) return "positive";
  if (stars === 3) return "neutral";
  return "negative";
}

const VALID_TONES = ["friendly", "formal", "short"];

function normalizeTone(tone) {
  return VALID_TONES.includes(tone) ? tone : "friendly";
}

const TEMPLATES = {
  positive: {
    friendly: {
      ar: (name) => `شكراً جزيلاً لك على تقييمك الرائع لـ ${name}! يسعدنا جداً إنك استمتعت بتجربتك معنا، ونتطلع لخدمتك مرة ثانية قريباً. 🙏`,
      en: (name) => `Thank you so much for your kind review of ${name}! We're thrilled you had a great experience, and we look forward to welcoming you back soon.`,
    },
    formal: {
      ar: (name) => `نشكركم على تقييمكم الإيجابي لـ ${name}. يسرّنا أن التجربة كانت مرضية، ونتطلع لخدمتكم مجدداً.`,
      en: (name) => `Thank you for your positive review of ${name}. We are pleased the experience met your expectations, and we look forward to serving you again.`,
    },
    short: {
      ar: (name) => `شكراً لك! يسعدنا رضاك عن ${name}. 🙏`,
      en: (name) => `Thank you! Glad you enjoyed ${name}.`,
    },
  },
  neutral: {
    friendly: {
      ar: (name) => `شكراً لك على وقتك ومشاركة رأيك عن ${name}. نقدّر ملاحظاتك وراح نشتغل على تحسين تجربتك في زيارتك القادمة. لو عندك أي تفاصيل إضافية تحب تشاركنا فيها، يسعدنا نسمعها.`,
      en: (name) => `Thank you for taking the time to share your feedback about ${name}. We appreciate your comments and will work on improving your experience next time. Feel free to share more details with us anytime.`,
    },
    formal: {
      ar: (name) => `نشكركم على ملاحظاتكم بخصوص ${name}. نأخذ تقييمكم بعين الاعتبار وسنعمل على تحسين مستوى الخدمة.`,
      en: (name) => `Thank you for your feedback regarding ${name}. We take your comments into consideration and will work on improving our service.`,
    },
    short: {
      ar: (name) => `شكراً لملاحظاتك عن ${name}، راح نحسّن.`,
      en: (name) => `Thanks for the feedback on ${name} — we'll improve.`,
    },
  },
  negative: {
    friendly: {
      ar: (name) => `نعتذر بشدة عن التجربة اللي مرّيت فيها مع ${name}، وهذا مو المستوى اللي نطمح نقدمه لعملائنا. نأخذ ملاحظتك بكل جدية ونحب نتواصل معك لحل الموضوع. نتمنى تعطينا فرصة ثانية لتصحيح الأمر.`,
      en: (name) => `We sincerely apologize for the experience you had with ${name} — this isn't the standard we aim for. We take your feedback seriously and would love the chance to make this right. Please feel free to reach out to us directly.`,
    },
    formal: {
      ar: (name) => `نعتذر عن التجربة غير المرضية مع ${name}. نأخذ ملاحظتكم على محمل الجد، ونرجو التواصل معنا مباشرة لمعالجة الأمر.`,
      en: (name) => `We apologize for the unsatisfactory experience with ${name}. We take this matter seriously and kindly ask you to contact us directly so we can resolve it.`,
    },
    short: {
      ar: (name) => `نعتذر عن تجربتك مع ${name}. تواصل معنا لحل الموضوع.`,
      en: (name) => `Sorry about your experience with ${name}. Please reach out so we can fix this.`,
    },
  },
};

function templateReply({ businessName, starRating, comment, tone }) {
  const ar = isArabic(comment) || !comment;
  const bucket = ratingBucket(starRating || 5);
  const name = businessName || (ar ? "فريقنا" : "our team");
  const t = normalizeTone(tone);

  return TEMPLATES[bucket][t][ar ? "ar" : "en"](name);
}

const TONE_INSTRUCTIONS = {
  friendly: "بأسلوب إنساني ودود ومحترف، مو رسمي جداً.",
  formal: "بأسلوب رسمي ومهني، بدون رموز تعبيرية، جمل واضحة ومباشرة.",
  short: "برد قصير جداً (جملة أو جملتين بحد أقصى)، مباشر بدون إطالة.",
};

async function claudeReply({ businessName, starRating, comment, reviewerName, tone }) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  const toneInstruction = TONE_INSTRUCTIONS[normalizeTone(tone)];

  const system = `أنت تكتب مسودة رد على تقييم عميل على Google Business Profile نيابة عن صاحب النشاط التجاري "${businessName}".
اكتب رد قصير (2-4 جمل)، بنفس لغة التقييم (أي لغة كانت)، ${toneInstruction}
لو التقييم 4 أو 5 نجوم: اشكر العميل بحرارة واذكر تفصيل من تقييمه لو موجود.
لو التقييم 3 نجوم: اشكره واعترف بالملاحظة بدون مبالغة في الاعتذار.
لو التقييم 1 أو 2: اعتذر بصدق ومهنية، بدون تبرير مفرط، واعرض حل المشكلة خارج المنصة إذا أمكن.
لا تخترع تفاصيل غير موجودة في التقييم. لا تضع اسم صاحب الرد أو توقيع. رجّع نص الرد فقط بدون أي شرح إضافي.`;

  const userMsg = `اسم المراجع: ${reviewerName || "غير معروف"}
عدد النجوم: ${starRating}
نص التقييم: ${comment || "(بدون نص، تقييم بالنجوم فقط)"}`;

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.text.trim();
  if (!text) throw new Error("Claude returned empty reply");
  return text;
}

async function generateDraftReply(review) {
  if (env.anthropicApiKey) {
    try {
      const text = await claudeReply(review);
      return { text, generatedBy: "claude" };
    } catch (err) {
      logger.warn({ err: err.message }, "Claude reply generation failed, falling back to template");
    }
  }
  return { text: templateReply(review), generatedBy: "template" };
}

module.exports = { generateDraftReply, VALID_TONES };
