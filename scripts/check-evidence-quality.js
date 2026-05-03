process.env.DATABASE_ENABLED = process.env.DATABASE_ENABLED || "false";
process.env.SEED_DATA_IN_DECISIONS = "true";

const { createSentimentApp } = await import("../src/app.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertScore(value, field) {
  assert(Number.isFinite(value), `${field} must be a finite number.`);
  assert(value >= 0 && value <= 1, `${field} must be between 0 and 1.`);
}

const app = createSentimentApp();
await app.initialize();
await app.replay({ reset: true, intervalMs: 0 });

const evidenceSnapshot = app.getEvidenceQuality({ limit: 100 });
const recentDocuments = app.getRecentDocuments({ limit: 20 });
const health = app.getHealth();
const tradeSetups = app.getTradeSetups({ window: "1h", limit: 10, minConviction: 0 });
const tradeSetupItems = tradeSetups.setups || [];

assert(evidenceSnapshot.summary, "Evidence quality summary is missing.");
assert(evidenceSnapshot.items.length > 0, "Evidence quality items are missing after replay.");
assert(health.evidence_quality?.total_evidence_items > 0, "Health endpoint is missing evidence quality summary.");
assert(
  recentDocuments.some((item) => item.evidence_quality),
  "Recent documents do not expose evidence quality payloads."
);
assert(
  tradeSetupItems.some((item) => item.evidence_quality),
  "Trade setup output does not expose evidence quality payloads."
);

for (const item of evidenceSnapshot.items) {
  assert(item.evidence_id, "Evidence item is missing evidence_id.");
  assert(item.doc_id, "Evidence item is missing doc_id.");
  assert(item.score_id, "Evidence item is missing score_id.");
  assert(item.ticker || item.data_quality_label === "source_limited", "Evidence item is missing ticker without being source-limited.");
  assert(
    ["high_quality", "needs_confirmation", "stale", "duplicate", "low_signal", "source_limited"].includes(
      item.data_quality_label
    ),
    `Unexpected quality label: ${item.data_quality_label}`
  );
  assert(["alert", "watch", "context", "suppress"].includes(item.display_tier), `Unexpected display tier: ${item.display_tier}`);
  assertScore(item.freshness_score, "freshness_score");
  assertScore(item.source_reliability_score, "source_reliability_score");
  assertScore(item.classification_confidence, "classification_confidence");
  assertScore(item.duplication_score, "duplication_score");
  assertScore(item.corroboration_score, "corroboration_score");
  assertScore(item.extraction_quality_score, "extraction_quality_score");
  assertScore(item.mapping_confidence, "mapping_confidence");
  assertScore(item.reliability_multiplier, "reliability_multiplier");
  assertScore(item.downstream_weight, "downstream_weight");
  assert(item.observation_level, "Evidence item is missing observation_level.");
  assert(item.verification_status, "Evidence item is missing verification_status.");
  assert(Array.isArray(item.reliability_warnings), "Evidence item reliability_warnings must be an array.");
}

const weightedScores = app.store.documentScores.filter((score) => score.evidence_quality && Number.isFinite(score.downstream_weight));
assert(weightedScores.length > 0, "Document scores are missing reusable downstream evidence weights.");

console.log(
  JSON.stringify(
    {
      status: "ok",
      evidence_items: evidenceSnapshot.items.length,
      total_evidence_items: evidenceSnapshot.summary.total_evidence_items,
      average_downstream_weight: evidenceSnapshot.summary.average_downstream_weight,
      display_tiers: evidenceSnapshot.summary.display_tiers,
      quality_labels: evidenceSnapshot.summary.quality_labels,
      recent_documents_with_quality: recentDocuments.filter((item) => item.evidence_quality).length,
      trade_setups_with_quality: tradeSetupItems.filter((item) => item.evidence_quality).length
    },
    null,
    2
  )
);
