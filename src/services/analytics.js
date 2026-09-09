// يبني بيانات ورسم بياني بسيط (SVG) لمتوسط التقييم أسبوعياً آخر 8 أسابيع — يعطي صاحب النشاط
// نظرة سريعة هل سمعته تتحسن أو تتراجع، بدل ما يقرأ أرقام مجردة بس.

const db = require("../db");

const WEEKS = 8;

// يرجّع مصفوفة بطول WEEKS، كل عنصر { weekStart, avgRating, count } (avgRating = null لو ما فيه تقييمات)
function getWeeklyRatingTrend(userId) {
  const rows = db
    .prepare(
      `SELECT
         CAST((julianday('now') - julianday(r.review_create_time)) / 7 AS INTEGER) AS weeks_ago,
         AVG(r.star_rating) AS avg_rating,
         COUNT(*) AS count
       FROM reviews r
       JOIN accounts a ON a.id = r.account_id
       JOIN subscriptions s ON s.account_id = a.id AND s.status IN ('active','trialing')
       WHERE a.user_id = ? AND r.review_create_time >= datetime('now', '-${WEEKS * 7} days')
       GROUP BY weeks_ago`
    )
    .all(userId);

  const byWeeksAgo = new Map(rows.map((r) => [r.weeks_ago, r]));

  const trend = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const row = byWeeksAgo.get(i);
    trend.push({
      weeksAgo: i,
      avgRating: row ? Math.round(row.avg_rating * 10) / 10 : null,
      count: row ? row.count : 0,
    });
  }
  return trend;
}

// يرسم خط بياني بسيط بدون أي مكتبة خارجية — نفس أسلوب الرسم بالصفحة التسويقية
function renderTrendSvg(trend, { width = 320, height = 90 } = {}) {
  const withData = trend.filter((p) => p.avgRating != null);
  if (withData.length < 2) return null;

  const padding = 10;
  const minRating = 1;
  const maxRating = 5;
  const stepX = (width - padding * 2) / (trend.length - 1);

  const yFor = (rating) => height - padding - ((rating - minRating) / (maxRating - minRating)) * (height - padding * 2);

  const points = trend.map((p, i) => {
    const x = padding + i * stepX;
    const y = p.avgRating != null ? yFor(p.avgRating) : null;
    return { x, y, avgRating: p.avgRating };
  });

  // نربط بس النقاط اللي فيها بيانات فعلية، عشان ما نرسم خط لأسابيع فاضية
  const segments = [];
  let current = [];
  for (const p of points) {
    if (p.y == null) {
      if (current.length > 1) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length > 1) segments.push(current);

  const polylines = segments
    .map((seg) => `<polyline points="${seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`)
    .join("");

  const dots = points
    .filter((p) => p.y != null)
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#0a0a0a" />`)
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weekly average rating trend">${polylines}${dots}</svg>`;
}

module.exports = { getWeeklyRatingTrend, renderTrendSvg, WEEKS };
