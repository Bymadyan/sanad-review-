// مقارنة المنافسين القريبين — ميزة اختيارية بالكامل، تحتاج مفتاح Google Places API منفصل
// (GOOGLE_PLACES_API_KEY) غير مرتبط بربط Google Business Profile. بدون المفتاح، أو بدون إحداثيات
// محفوظة للنشاط التجاري، الميزة تُخفى بأمان بدل ما تسبب أي خطأ بباقي اللوحة التنفيذية.

const { env } = require("../config/env");
const logger = require("../config/logger");

const SEARCH_RADIUS_METERS = 3000;
const MAX_RESULTS = 6;

async function getNearbyCompetitors(account) {
  if (!env.googlePlacesApiKey) {
    return { available: false, reason: "not_configured" };
  }
  if (!account.latitude || !account.longitude) {
    return { available: false, reason: "missing_location" };
  }

  const textQuery = account.primary_category || account.business_name;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.googlePlacesApiKey,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        textQuery,
        locationBias: {
          circle: {
            center: { latitude: account.latitude, longitude: account.longitude },
            radius: SEARCH_RADIUS_METERS,
          },
        },
        maxResultCount: MAX_RESULTS + 1, // +1 لأن نتيجة النشاط نفسه ممكن تطلع ضمن النتائج
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, "Places API nearby search failed");
      return { available: false, reason: "api_error" };
    }

    const data = await res.json();
    const selfName = (account.business_name || "").trim().toLowerCase();

    const competitors = (data.places || [])
      .filter((p) => (p.displayName?.text || "").trim().toLowerCase() !== selfName)
      .slice(0, MAX_RESULTS)
      .map((p) => ({
        name: p.displayName?.text || "—",
        rating: typeof p.rating === "number" ? p.rating : null,
        reviewCount: p.userRatingCount || 0,
      }));

    return { available: true, competitors };
  } catch (err) {
    logger.warn({ err: err.message }, "Nearby competitor lookup failed");
    return { available: false, reason: "network_error" };
  }
}

// تحليل منافس محدد بالاسم: يبحث عنه على Google، ويجيب تقييمه العام + عيّنة من آخر مراجعاته (Google
// يرجع بحد أقصى 5 مراجعات "الأكثر صلة" لكل مكان عبر الـ API — مو كل المراجعات، هذا حد مفروض من
// Google نفسه). لو Claude مفعّل، نلخّص نقاط القوة/الضعف من العيّنة؛ وإلا نرجع نصوص المراجعات
// الخام للمالك يقرأها بنفسه.
async function analyzeNamedCompetitor(competitorName, account) {
  if (!env.googlePlacesApiKey) {
    return { available: false, reason: "not_configured" };
  }

  const trimmedName = (competitorName || "").trim();
  if (!trimmedName) return { available: false, reason: "empty_name" };

  try {
    const body = {
      textQuery: trimmedName,
      maxResultCount: 1,
    };
    if (account && account.latitude && account.longitude) {
      body.locationBias = {
        circle: { center: { latitude: account.latitude, longitude: account.longitude }, radius: 15000 },
      };
    }

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.googlePlacesApiKey,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.reviews",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const responseBody = await res.text();
      logger.warn({ status: res.status, body: responseBody }, "Named competitor search failed");
      return { available: false, reason: "api_error" };
    }

    const data = await res.json();
    const place = (data.places || [])[0];
    if (!place) return { available: false, reason: "not_found" };

    const reviewSnippets = (place.reviews || [])
      .map((r) => ({ rating: r.rating, text: (r.text && r.text.text) || "" }))
      .filter((r) => r.text);

    let aiSummary = null;
    if (env.anthropicApiKey && reviewSnippets.length) {
      try {
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: env.anthropicApiKey });
        const reviewsText = reviewSnippets.map((r) => `- (${r.rating}★) ${r.text}`).join("\n");
        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: `You are analyzing a small sample (up to 5) of a competitor business's public Google reviews. From ONLY these reviews, list their apparent strengths and weaknesses as two short bullet lists. Note this is a small sample, not their full review history. Under 120 words.`,
          messages: [{ role: "user", content: reviewsText }],
        });
        const textBlock = msg.content.find((b) => b.type === "text");
        aiSummary = textBlock && textBlock.text.trim();
      } catch (err) {
        logger.warn({ err: err.message }, "Named competitor AI summary failed");
      }
    }

    return {
      available: true,
      name: place.displayName?.text || trimmedName,
      rating: typeof place.rating === "number" ? place.rating : null,
      reviewCount: place.userRatingCount || 0,
      reviewSnippets,
      aiSummary,
    };
  } catch (err) {
    logger.warn({ err: err.message }, "Named competitor lookup failed");
    return { available: false, reason: "network_error" };
  }
}

module.exports = { getNearbyCompetitors, analyzeNamedCompetitor };
