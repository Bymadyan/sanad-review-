// مساعد ذكاء اصطناعي يجاوب أسئلة صاحب النشاط عن بياناته (مثلاً: "ليش تقييم فرع مارينا نزل هالشهر؟")
// اعتماداً على ملخص بيانات محسوب فعلياً (نسبة رضا، أكثر المشاكل، مقارنة فروع...) — ما نديه صلاحية
// SQL مباشرة تفادياً لأي تحليل أو استعلام خاطئ، فقط البيانات الجاهزة اللي حسبناها بأنفسنا.

const { env } = require("../config/env");
const logger = require("../config/logger");

const MAX_QUESTION_LENGTH = 300;

async function answerOperationalQuestion({ businessName, question, contextSummary }) {
  if (!env.anthropicApiKey) {
    return { available: false, reason: "not_configured" };
  }

  const trimmedQuestion = (question || "").trim().slice(0, MAX_QUESTION_LENGTH);
  if (!trimmedQuestion) {
    return { available: false, reason: "empty_question" };
  }

  const system = `You are an operations assistant for a business called "${businessName}". You will be given a JSON
data summary computed from their real Google review data, and a question from the business owner. Answer using
ONLY the information in the data summary. If the summary doesn't contain enough information to answer confidently,
say so honestly instead of guessing or inventing numbers. Keep your answer under 120 words, direct and practical.`;

  const userContent = `DATA SUMMARY:\n${JSON.stringify(contextSummary)}\n\nQUESTION: ${trimmedQuestion}`;

  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: env.anthropicApiKey });

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      system,
      messages: [{ role: "user", content: userContent }],
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    const answer = textBlock && textBlock.text.trim();
    if (!answer) throw new Error("Claude returned an empty answer");

    return { available: true, question: trimmedQuestion, answer };
  } catch (err) {
    logger.warn({ err: err.message }, "AI assistant question failed");
    return { available: false, reason: "generation_failed" };
  }
}

module.exports = { answerOperationalQuestion };
