// قائمة كلمات إيجابية (مدح) تُستخدم فقط لتحليل "أكثر العناصر المحبوبة" باللوحة التنفيذية —
// عكس riskClassifier.js، هذي القائمة ما تتحكم بأي قرار نشر تلقائي، فمخاطر الخطأ فيها أقل بكثير.
// نغطي عربي وإنجليزي (أكبر سوقين للأداة حالياً)، بنفس أسلوب المطابقة الجزئية البسيطة.

const PRAISE_KEYWORDS = [
  // عربي
  "ممتاز", "ممتازة", "رائع", "رائعة", "جميل", "جميلة", "لذيذ", "لذيذة",
  "نظيف", "نظيفة", "احترافي", "احترافية", "سريع", "سريعة", "ودود", "ودودة",
  "لطيف", "لطيفة", "أنصح به", "أنصح بها", "تجربة رائعة", "خدمة ممتازة",
  "أفضل", "مريح", "مريحة", "هادئ", "هادئة", "منظم", "منظمة", "أسعار ممتازة",
  "جودة عالية", "بجد يستاهل", "يستحق", "احترافيه عاليه", "أجواء حلوة",
  // English
  "excellent", "amazing", "great", "delicious", "clean", "professional",
  "fast service", "friendly", "kind staff", "highly recommend", "great experience",
  "great service", "the best", "comfortable", "quiet", "well organized",
  "good prices", "high quality", "love this place", "wonderful", "outstanding",
  "fantastic", "polite staff", "fresh food", "cozy",
];

function countPraiseMentions(reviews, limit = 10) {
  const counts = {};
  for (const r of reviews) {
    if (!r.comment) continue;
    const lower = r.comment.toLowerCase();
    for (const kw of PRAISE_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) {
        counts[kw] = (counts[kw] || 0) + 1;
      }
    }
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}

module.exports = { PRAISE_KEYWORDS, countPraiseMentions };
