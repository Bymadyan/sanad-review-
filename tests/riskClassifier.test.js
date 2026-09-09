const { test } = require("node:test");
const assert = require("node:assert");
const { isLowRisk, containsRiskKeyword } = require("../src/services/riskClassifier");

test("blocks auto-publish for star ratings below 4", () => {
  assert.strictEqual(isLowRisk({ starRating: 3, comment: "Great!" }), false);
  assert.strictEqual(isLowRisk({ starRating: 1, comment: "" }), false);
});

test("allows auto-publish for clean 4-5 star reviews", () => {
  assert.strictEqual(isLowRisk({ starRating: 5, comment: "Amazing service, highly recommend!" }), true);
  assert.strictEqual(isLowRisk({ starRating: 4, comment: null }), true);
});

test("blocks auto-publish when a negative keyword hides in a high star rating (English)", () => {
  assert.strictEqual(isLowRisk({ starRating: 5, comment: "Great food but the service was rude." }), false);
});

test("blocks auto-publish for negative keywords in other languages", () => {
  const cases = [
    "Superbe repas mais le service était très lent.", // French
    "Excelente comida pero el servicio fue muy lento.", // Spanish
    "Tolles Essen, aber der Service war sehr langsam.", // German
    "Отличная еда, но обслуживание было очень медленным.", // Russian
    "खाना बहुत अच्छा था लेकिन सेवा बहुत धीमी थी.", // Hindi
  ];
  for (const comment of cases) {
    assert.strictEqual(isLowRisk({ starRating: 5, comment }), false, `expected risky: ${comment}`);
  }
});

test("does not false-positive on common positive words that contain risk substrings", () => {
  const cases = [
    "Excellent service, tres professionnel!",
    "This place is truly excellent, highly recommend!",
    "Ce lieu m inspire toujours confiance.",
  ];
  for (const comment of cases) {
    assert.strictEqual(isLowRisk({ starRating: 5, comment }), true, `expected safe: ${comment}`);
  }
});

test("custom keywords extend the risk list per business", () => {
  assert.strictEqual(containsRiskKeyword("The soup was cold today", "cold, stale"), true);
  assert.strictEqual(containsRiskKeyword("Everything was fresh", "cold, stale"), false);
});
