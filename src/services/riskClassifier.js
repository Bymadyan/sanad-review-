// يقرر هل تقييم معين "آمن" بما يكفي للنشر التلقائي، أو لازم يتحول لمراجعة بشرية.
// نتعمد التحفظ: أي شك يرجّح كفة المراجعة اليدوية، لأن رد منشور بالخطأ ضرر دائم وعلني.
// قائمة الكلمات تغطي عربي/إنجليزي/فرنسي/إسباني/ألماني/برتغالي/تركي/روسي/هندي — عشان تشتغل الحماية
// بأي دولة يستخدم فيها العميل Google Business Profile، مو بس السوق الناطق بالعربي أو الإنجليزي.

const RISK_KEYWORDS = [
  // عربي
  "سيء", "سيئ", "سيئة", "أسوأ", "مشكلة", "مشاكل", "خدمة سيئة", "لن أعود",
  "لا أنصح", "ما أنصح", "بطيء", "وسخ", "قذر", "غالي", "استرجاع", "شكوى",
  "احتيال", "خطأ", "لكن", "للأسف", "خيبة", "مقرف", "تجنبوا", "زعلان",
  "غاضب", "رديء", "مخيب", "فاشل", "كذب", "خدعوني",
  // English
  "bad", "worst", "problem", "issue", "disappointed", "disappointing",
  "never again", "don't recommend", "not recommend", "slow", "dirty",
  "rude", "refund", "complaint", "scam", "mistake", "but ", "however",
  "unfortunately", "poor", "terrible", "awful", "horrible",
  // French (مسافة قبل "lent"/"pire" عشان ما تطابق كلمات إيجابية زي "excellent"/"inspire")
  "mauvais", "mauvaise", " pire", "problème", "déçu", "déçue", "plus jamais",
  "ne recommande pas", " lent", "sale", "impoli", "remboursement", "plainte",
  "arnaque", "erreur", "malheureusement", "horrible", "dommage",
  // Spanish (نستخدم جذر الكلمة عشان يطابق المذكر والمؤنث معاً، مثل sucio/sucia)
  "malo", "mala", "peor", "problema", "decepcionado", "decepcionada",
  "nunca más", "no recomiendo", "lento", "suci", "groser", "reembolso",
  "queja", "estafa", "error", "desafortunadamente", "terrible",
  // German
  "schlecht", "schlechteste", "problem", "enttäuscht", "nie wieder",
  "nicht empfehlenswert", "langsam", "schmutzig", "unhöflich",
  "rückerstattung", "beschwerde", "betrug", "fehler", "leider", "schrecklich",
  // Portuguese
  "ruim", "péssimo", "pior", "decepcionado", "decepcionada", "nunca mais",
  "não recomendo", "lento", "suj", "grosseir", "reembolso", "reclamação",
  "golpe", "erro", "infelizmente", "horrível",
  // Turkish
  "kötü", "en kötü", "sorun", "hayal kırıklığı", "bir daha asla",
  "tavsiye etmiyorum", "yavaş", "kirli", "kaba", "iade", "şikayet",
  "dolandırıcılık", "hata", "maalesef", "berbat",
  // Russian (جذر الكلمة عشان يطابق كل تصريفاتها النحوية، مثل медленно/медленный/медленным)
  "плох", "худш", "проблема", "разочарован", "никогда больше",
  "не рекомендую", "медленн", "грязн", "груб", "возврат", "жалоб",
  "мошенничеств", "ошибк", "к сожалению", "ужасн",
  // Hindi (جذر الكلمة عشان يطابق كل تصريفاتها، مثل धीमा/धीमी)
  "बुर", "सबसे खराब", "समस्या", "निराश", "कभी नहीं", "सिफारिश नहीं",
  "धीम", "गंद", "असभ्य", "वापसी", "शिकायत", "धोखा", "गलती", "भयानक",
];

// customKeywords: نص خام من إعدادات النشاط التجاري، كلمات مفصولة بفواصل
function parseCustomKeywords(customKeywords) {
  if (!customKeywords) return [];
  return customKeywords.split(",").map((w) => w.trim()).filter(Boolean);
}

function containsRiskKeyword(text, customKeywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const allKeywords = RISK_KEYWORDS.concat(parseCustomKeywords(customKeywords));
  return allKeywords.some((word) => lower.includes(word.toLowerCase()));
}

// آمن للنشر التلقائي فقط لو: 4 نجوم فأعلى، وما فيه أي إشارة سلبية بالتعليق (بما فيها كلمات المستخدم الخاصة)
function isLowRisk({ starRating, comment, customKeywords }) {
  if (starRating < 4) return false;
  if (containsRiskKeyword(comment, customKeywords)) return false;
  return true;
}

module.exports = { isLowRisk, containsRiskKeyword, parseCustomKeywords, RISK_KEYWORDS };
