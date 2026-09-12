// نصوص صفحة التسويق بلغتين. الإنجليزي هو اللغة الافتراضية (واجهة أولى احترافية)،
// والعربي متاح بزر تبديل يحفظ اختيار الزائر بكوكي.

const en = {
  htmlLang: "en",
  dir: "ltr",
  metaTitle: "Sanad Review — AI Review Management for Google Business Profile",
  metaDescription: "Sanad Review drafts the perfect reply to every new Google review in seconds. You stay in control — review, edit, or let safe reviews publish themselves.",
  nav: { login: "Log in", start: "Get Started" },
  hero: {
    eyebrow: "AI-Powered Review Management",
    title: "Reply to every Google review in seconds — without losing control.",
    subtitle:
      "Sanad Review drafts the perfect reply the moment a new Google review lands, in your brand's voice. Approve every word before it goes public — or let safe, positive reviews publish themselves.",
    cta: "Get Started — $35/mo",
    note: "No long-term contract. Cancel anytime from your dashboard.",
  },
  mockup: {
    reviewerName: "Sarah M.",
    reviewText: "Amazing service, the staff were incredibly helpful and the food was perfect!",
    replyLabel: "AI-drafted reply",
    replyText: "Thank you so much, Sarah! We're thrilled you had a great experience and can't wait to welcome you back. 🙏",
  },
  stats: { rating: "4.9 avg rating", reviews: "New review synced", growth: "Reputation trending up" },
  features: {
    title: "Everything you need to manage your reputation",
    subtitle: "Built for business owners who don't have time to babysit every review.",
    items: [
      { icon: "🤖", title: "AI-Drafted Replies", desc: "Every new review gets a ready-to-send, on-brand reply in seconds — in the reviewer's own language." },
      { icon: "🛡️", title: "You're Always in Control", desc: "Nothing publishes without your approval by default. Review, edit, or approve with one click." },
      { icon: "⚡", title: "Smart Auto-Publish", desc: "Let low-risk 5-star reviews publish themselves instantly, while anything uncertain waits for you." },
      { icon: "📊", title: "Root-Cause Insights", desc: "Sanad Review analyzes your negative reviews and tells you exactly what's driving complaints." },
      { icon: "📈", title: "Rating Trend Chart", desc: "See your average rating move week over week, right on your dashboard." },
      { icon: "📩", title: "Weekly Business Digest", desc: "A short, human-written summary of your week, delivered straight to your inbox." },
      { icon: "📣", title: "QR Review Requests", desc: "A ready-made QR code and link that send happy customers straight to your review page." },
      { icon: "📝", title: "Saved Reply Templates", desc: "Keep a library of go-to responses for common situations, ready to reuse in one click." },
      { icon: "🏢", title: "Built for Multi-Location Brands", desc: "Manage every branch from a single dashboard, each with its own tone, settings, and billing." },
    ],
  },
  pricing: {
    title: "Simple, transparent pricing",
    subtitle: "One plan per business. Everything included.",
    price: "$35",
    period: "/ month / business",
    items: [
      "Unlimited reviews",
      "AI-drafted replies in any language",
      "Smart auto-publish & insights",
      "Weekly email digest",
      "QR review-request tools",
      "Cancel anytime",
    ],
    cta: "Get Started",
  },
  footer: { tagline: "AI review management, built on trust.", privacy: "Privacy Policy", terms: "Terms of Service" },
  langToggle: { label: "العربية", href: "/?lang=ar" },
};

const ar = {
  htmlLang: "ar",
  dir: "rtl",
  metaTitle: "Sanad Review — إدارة تقييمات Google بالذكاء الاصطناعي",
  metaDescription: "تُعدّ Sanad Review رداً احترافياً على كل تقييم جديد على Google خلال ثوانٍ. راجع كل رد أو دع التقييمات الآمنة تُنشر تلقائياً.",
  nav: { login: "تسجيل الدخول", start: "ابدأ الآن" },
  hero: {
    eyebrow: "إدارة تقييمات ذكية مدعومة بالذكاء الاصطناعي",
    title: "رد على كل تقييم Google خلال ثوانٍ — دون أن تفقد السيطرة",
    subtitle:
      "تُعدّ Sanad Review رداً احترافياً بصوت علامتك التجارية فور وصول أي تقييم جديد على Google. راجع كل كلمة قبل نشرها، أو دع التقييمات الإيجابية الآمنة تُنشر تلقائياً.",
    cta: "ابدأ الآن — 35$ شهرياً",
    note: "بدون التزام طويل الأمد. يمكنك الإلغاء في أي وقت من لوحة التحكم.",
  },
  mockup: {
    reviewerName: "سارة م.",
    reviewText: "تجربة رائعة، الموظفون متعاونون جداً والطعام كان ممتازاً!",
    replyLabel: "رد مُعد بالذكاء الاصطناعي",
    replyText: "شكراً جزيلاً لك سارة! يسعدنا جداً أنك استمتعتِ بتجربتك، ونتطلع لاستقبالك مجدداً. 🙏",
  },
  stats: { rating: "4.9 متوسط التقييم", reviews: "تقييم جديد تمت مزامنته", growth: "سمعتك في تحسّن مستمر" },
  features: {
    title: "كل ما تحتاجه لإدارة سمعتك الرقمية",
    subtitle: "مصممة لأصحاب الأعمال الذين لا وقت لديهم لمتابعة كل تقييم بأنفسهم.",
    items: [
      { icon: "🤖", title: "ردود مُعدّة بالذكاء الاصطناعي", desc: "كل تقييم جديد يحصل على رد جاهز للنشر خلال ثوانٍ، بنفس لغة العميل." },
      { icon: "🛡️", title: "السيطرة الكاملة بين يديك", desc: "لا يُنشر شيء دون موافقتك افتراضياً. راجع أو عدّل أو وافق بضغطة واحدة." },
      { icon: "⚡", title: "نشر تلقائي ذكي", desc: "دع التقييمات الإيجابية الآمنة تُنشر تلقائياً، بينما تنتظر أي حالة فيها شك مراجعتك." },
      { icon: "📊", title: "تحليل الأسباب الجذرية", desc: "تحلل Sanad Review تقييماتك السلبية وتخبرك بالضبط بما يزعج عملاءك." },
      { icon: "📈", title: "رسم بياني لتطور التقييم", desc: "شاهد متوسط تقييمك يتحسن أسبوعاً بعد أسبوع مباشرة من لوحة التحكم." },
      { icon: "📩", title: "تقرير أسبوعي ذكي", desc: "ملخص أسبوعي مختصر ومكتوب بأسلوب إنساني يصلك بريدياً مباشرة." },
      { icon: "📣", title: "طلب تقييمات بكود QR", desc: "كود QR ورابط جاهزين يوجهون عملاءك الراضين مباشرة لصفحة كتابة تقييم." },
      { icon: "📝", title: "ردود جاهزة محفوظة", desc: "احتفظ بمكتبة ردود جاهزة للحالات المتكررة، واستخدمها بضغطة واحدة." },
      { icon: "🏢", title: "مصممة للعلامات متعددة الفروع", desc: "أدر كل فرع من لوحة تحكم واحدة، ولكل فرع نبرته وإعداداته واشتراكه الخاص." },
    ],
  },
  pricing: {
    title: "تسعير بسيط وشفاف",
    subtitle: "خطة واحدة لكل نشاط تجاري. كل شيء متضمّن.",
    price: "35$",
    period: "/ شهرياً لكل نشاط",
    items: [
      "تقييمات غير محدودة",
      "ردود ذكية بأي لغة",
      "نشر تلقائي ذكي وتحليلات",
      "تقرير أسبوعي بالبريد",
      "أدوات طلب تقييمات بـ QR",
      "إلغاء في أي وقت",
    ],
    cta: "ابدأ الآن",
  },
  footer: { tagline: "إدارة تقييمات ذكية مبنية على الثقة.", privacy: "سياسة الخصوصية", terms: "شروط الاستخدام" },
  langToggle: { label: "English", href: "/?lang=en" },
};

function getLandingCopy(lang) {
  return lang === "ar" ? ar : en;
}

module.exports = { getLandingCopy };
