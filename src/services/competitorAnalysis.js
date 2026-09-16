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

module.exports = { getNearbyCompetitors };
