// يحلل التقييمات السلبية/المتوسطة الأخيرة ويطلع أهم الأنماط المتكررة (شكاوى تتكرر)،
// عشان صاحب النشاط يعرف بالضبط وش يصلح بمشروعه بدل ما يقرأ كل تقييم بنفسه.
// يستخدم Claude لو مفعّل، وإلا يرجع لعدّ تكرار الكلمات (نفس قائمة كلمات الخطر) كبديل بدون تكلفة.

const { RISK_KEYWORDS, parseCustomKeywords } = require("./riskClassifier");
const { env } = require("../config/env");
const logger = require("../config/logger");

const MIN_REVIEWS_FOR_INSIGHT = 3;

function keywordFrequencyInsight(reviews, customKeywords) {
  const allKeywords = RISK_KEYWORDS.concat(parseCustomKeywords(customKeywords));

  const counts = {};
  for (const r of reviews) {
    if (!r.comment) continue;
    const lower = r.comment.toLowerCase();
    for (const kw of allKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        counts[kw] = (counts[kw] || 0) + 1;
      }
    }
  }

  const sorted = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!sorted.length) {
    return "No clear recurring pattern found in recent reviews — complaints are varied and not concentrated on one cause.";
  }

  return sorted.map(([kw, count]) => `• "${kw}" — mentioned in ${count} ${count === 1 ? "review" : "reviews"}`).join("\n");
}

async function claudeInsight(reviews, businessName) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  const reviewsText = reviews.map((r) => `- (${r.star_rating} stars) ${r.comment}`).join("\n");

  const system = `You are a business analyst helping the owner of a business called "${businessName}" understand their negative and neutral customer reviews.
Read the given reviews and extract the top 3 to 5 patterns or complaint themes that actually recur (not every individual complaint, only ones that repeat).
For each pattern write one line in English in the format: "• [description of the cause] — mentioned in about X reviews"
If there's no clear recurring pattern, say so explicitly in one sentence.
Do not write an introduction or conclusion, just the bullet points directly.`;

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: reviewsText }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.text.trim();
  if (!text) throw new Error("Claude returned empty insight");
  return text;
}

// يرجع { summary, source }
async function generateInsights({ businessName, reviews, customKeywords }) {
  const negativeOrNeutral = reviews.filter((r) => r.star_rating <= 3 && r.comment);

  if (negativeOrNeutral.length < MIN_REVIEWS_FOR_INSIGHT) {
    return {
      summary: `Not enough data to analyze yet (need at least ${MIN_REVIEWS_FOR_INSIGHT} negative/neutral reviews with a comment).`,
      source: "insufficient_data",
    };
  }

  if (env.anthropicApiKey) {
    try {
      const summary = await claudeInsight(negativeOrNeutral, businessName);
      return { summary, source: "claude" };
    } catch (err) {
      logger.warn({ err: err.message }, "Claude insight generation failed, falling back to keyword frequency");
    }
  }

  return { summary: keywordFrequencyInsight(negativeOrNeutral, customKeywords), source: "keywords" };
}

module.exports = { generateInsights };
