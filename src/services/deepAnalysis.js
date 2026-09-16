// تحليل عميق بالذكاء الاصطناعي (Claude) — يحتاج ANTHROPIC_API_KEY، وإلا يرجع "غير متاح" بأمان بدون
// أي خطأ. يغطي 3 أشياء بطلب Claude واحد فقط (توفير تكلفة):
// 1) توصيات تشغيلية محددة (وقت/يوم معين) لو النمط بالتقييمات يدعمها فعلاً — مو تخمين عشوائي
// 2) أسماء الموظفين المذكورين بالتقييمات (إشادة أو شكوى) لو مذكورين فعلاً
// 3) ملاحظات من صور مرفقة بالتقييمات (نظافة، تقديم، ازدحام) لو فيه صور — Google تعيد صور
//    التقييمات فعلاً عبر reviewMediaItems.thumbnailUrl (تأكدنا من هذا بالتوثيق الرسمي)

const { env } = require("../config/env");
const logger = require("../config/logger");

const MIN_REVIEWS_FOR_DEEP_ANALYSIS = 5;
const MAX_PHOTOS = 5;

async function generateDeepAnalysis({ businessName, reviews }) {
  if (!env.anthropicApiKey) {
    return { available: false, reason: "not_configured" };
  }

  const withComments = reviews.filter((r) => r.comment);
  if (withComments.length < MIN_REVIEWS_FOR_DEEP_ANALYSIS) {
    return { available: false, reason: "insufficient_data" };
  }

  const photoUrls = [];
  for (const r of reviews) {
    if (!r.photo_urls) continue;
    try {
      const urls = JSON.parse(r.photo_urls);
      for (const url of urls) {
        if (photoUrls.length < MAX_PHOTOS) photoUrls.push(url);
      }
    } catch {
      // تجاهل أي صف بصيغة JSON تالفة بدل ما يوقف كل التحليل
    }
  }

  const reviewsText = withComments
    .map((r) => `- (${r.star_rating}★, ${r.review_create_time ? new Date(r.review_create_time).toString() : "unknown time"}) ${r.comment}`)
    .join("\n");

  const system = `You are an operations consultant analyzing customer reviews for a business called "${businessName}".
From the reviews text (and any attached photos), produce exactly 3 labeled sections:

**Specific Recommendations**: Concrete, actionable operational suggestions (e.g. staffing on specific days/times) — but ONLY if the complaint pattern and review timestamps actually support that level of specificity. If the data doesn't clearly support a specific day/time recommendation, say "Not enough pattern yet to recommend a specific time" instead of guessing.

**Staff Mentioned**: Any employee/staff first names mentioned by reviewers, split into praised vs. complained about, with mention counts. If no names are mentioned, say "No staff members mentioned by name."

**Photo Observations**: If photos are attached, describe what they show that's operationally relevant (cleanliness, food presentation, crowding, etc). If no photos are attached, say "No photos attached to recent reviews."

Keep the whole response under 220 words. Do not invent facts not supported by the reviews or photos.`;

  const content = [{ type: "text", text: reviewsText }];
  for (const url of photoUrls) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: env.anthropicApiKey });

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system,
      messages: [{ role: "user", content }],
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.text.trim();
    if (!text) throw new Error("Claude returned an empty deep analysis");

    return { available: true, summary: text, photoCount: photoUrls.length };
  } catch (err) {
    logger.warn({ err: err.message }, "Deep analysis generation failed");
    return { available: false, reason: "generation_failed" };
  }
}

module.exports = { generateDeepAnalysis, MIN_REVIEWS_FOR_DEEP_ANALYSIS };
