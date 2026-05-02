import { buildEntityRows, normalizeRawDocument } from "./normalize.js";
import { assignDedupeCluster } from "./dedupe.js";
import { classifyWithRules } from "./rules.js";
import { buildDocumentScore, simulateLlmScore } from "./score.js";
import { recomputeStates } from "./aggregate.js";
import { createEvidenceQualityAgent } from "./evidence-quality.js";
import { freshnessStatus } from "./freshness-policy.js";
import { makeId, round } from "../utils/helpers.js";

function updateSourceStats(store, normalized, score) {
  const existing = store.sourceStats.get(normalized.source_name) || {
    source_name: normalized.source_name,
    source_type: normalized.source_type,
    rolling_volume_1d: 0,
    rolling_avg_confidence: 0,
    rolling_precision_1d: null,
    avg_lag_seconds: 0,
    failure_count_1d: 0,
    trust_score: normalized.source_trust,
    updated_at: new Date().toISOString()
  };

  const nextVolume = existing.rolling_volume_1d + 1;
  existing.rolling_avg_confidence = round(
    (existing.rolling_avg_confidence * existing.rolling_volume_1d + score.final_confidence) / nextVolume,
    3
  );
  existing.rolling_volume_1d = nextVolume;
  existing.avg_lag_seconds = round(
    ((existing.avg_lag_seconds || 0) * (nextVolume - 1) +
      (new Date().getTime() - new Date(normalized.published_at).getTime()) / 1000) /
      nextVolume,
    2
  );
  existing.updated_at = new Date().toISOString();
  store.sourceStats.set(normalized.source_name, existing);
}

function buildAlerts(store, normalized, score, latestStates) {
  const alerts = [];
  const evidenceQuality = score.evidence_quality || null;
  const sourceContext = {
    source_name: normalized.source_name || evidenceQuality?.source_name || null,
    source_type: normalized.source_type || null,
    published_at: normalized.published_at || evidenceQuality?.published_at || null,
    event_type: score.event_type || null,
    url: normalized.url || normalized.canonical_url || null,
    evidence_quality: evidenceQuality
  };

  if (evidenceQuality?.display_tier === "suppress") {
    return alerts;
  }

  if (score.final_confidence >= store.config.alertConfidenceThreshold && score.sentiment_score <= -0.6) {
    alerts.push({
      alert_id: makeId(),
      alert_type: "high_confidence_negative",
      entity_type: "ticker",
      entity_key: normalized.primary_ticker || "market",
      headline: normalized.headline,
      severity: "high",
      confidence: score.final_confidence,
      source_name: sourceContext.source_name,
      source_type: sourceContext.source_type,
      published_at: sourceContext.published_at,
      event_type: sourceContext.event_type,
      url: sourceContext.url,
      payload: { score_id: score.score_id, sentiment_score: score.sentiment_score, ...sourceContext },
      created_at: new Date().toISOString()
    });
  }

  if (score.final_confidence >= store.config.alertConfidenceThreshold && score.sentiment_score >= 0.6) {
    alerts.push({
      alert_id: makeId(),
      alert_type: "high_confidence_positive",
      entity_type: "ticker",
      entity_key: normalized.primary_ticker || "market",
      headline: normalized.headline,
      severity: "high",
      confidence: score.final_confidence,
      source_name: sourceContext.source_name,
      source_type: sourceContext.source_type,
      published_at: sourceContext.published_at,
      event_type: sourceContext.event_type,
      url: sourceContext.url,
      payload: { score_id: score.score_id, sentiment_score: score.sentiment_score, ...sourceContext },
      created_at: new Date().toISOString()
    });
  }

  const tickerState = normalized.primary_ticker ? latestStates.get(`ticker:${normalized.primary_ticker}:1h`) : null;
  if (tickerState && Math.abs(tickerState.momentum_delta) >= 0.2) {
    alerts.push({
      alert_id: makeId(),
      alert_type: "polarity_reversal",
      entity_type: "ticker",
      entity_key: normalized.primary_ticker,
      headline: normalized.headline,
      severity: "medium",
      confidence: tickerState.weighted_confidence,
      source_name: sourceContext.source_name,
      source_type: sourceContext.source_type,
      published_at: sourceContext.published_at,
      event_type: sourceContext.event_type,
      url: sourceContext.url,
      payload: {
        weighted_sentiment: tickerState.weighted_sentiment,
        momentum_delta: tickerState.momentum_delta,
        ...sourceContext
      },
      created_at: new Date().toISOString()
    });
  }

  if (alerts.length) {
    store.alertHistory = [...alerts, ...store.alertHistory].slice(0, 50);
  }

  return alerts;
}

export function createPipeline(store) {
  const evidenceQualityAgent = createEvidenceQualityAgent({ store });

  async function processRawDocument(rawDocument) {
    const raw = {
      raw_id: rawDocument.raw_id || makeId(),
      canonical_url: rawDocument.canonical_url || rawDocument.url,
      published_at: rawDocument.published_at || new Date().toISOString(),
      fetched_at: rawDocument.fetched_at || new Date().toISOString(),
      ...rawDocument
    };

    store.health.queueDepth += 1;
    store.rawDocuments.push(raw);

    const universeEntries = store.fundamentals?.leaderboard || [];
    const normalized = normalizeRawDocument(raw, { universeEntries });
    const freshness = freshnessStatus(normalized, store.config);
    if (!freshness.fresh) {
      store.health.queueDepth = Math.max(0, store.health.queueDepth - 1);
      store.health.lastUpdate = new Date().toISOString();
      return {
        raw,
        normalized,
        skipped: true,
        skipped_reason: freshness.reason,
        freshness
      };
    }

    const cluster = assignDedupeCluster(store, normalized);
    normalized.dedupe_cluster_id = cluster.dedupe_cluster_id;
    normalized.novelty_score = cluster.novelty_score;
    store.normalizedDocuments.push(normalized);

    const entities = buildEntityRows(normalized, store.config.universeName, { universeEntries });
    store.documentEntities.push(...entities);

    const ruleResult = classifyWithRules(normalized);
    const llmResult = simulateLlmScore(normalized, ruleResult);
    const score = buildDocumentScore(normalized, ruleResult, llmResult);
    const evidenceQuality = evidenceQualityAgent.evaluate({ normalized, score, cluster });
    score.evidence_quality = evidenceQuality;
    score.downstream_weight = evidenceQuality.downstream_weight;
    score.display_tier = evidenceQuality.display_tier;
    store.documentScores.push(score);

    updateSourceStats(store, normalized, score);
    const latestStates = recomputeStates(store);
    const alerts = buildAlerts(store, normalized, score, latestStates);

    store.health.queueDepth = Math.max(0, store.health.queueDepth - 1);
    store.health.documentsProcessedToday += 1;
    store.health.lastUpdate = new Date().toISOString();
    store.health.llmLatencyMs = round(14 + Math.random() * 18, 1);

    const liveEvent = {
      type: "document_scored",
      timestamp: score.scored_at,
      published_at: normalized.published_at,
      ticker: normalized.primary_ticker,
      headline: normalized.headline,
      source_name: normalized.source_name,
      source_type: normalized.source_type,
      url: normalized.url || normalized.canonical_url || null,
      source_metadata: normalized.source_metadata || null,
      event_type: score.event_type,
      label: score.bullish_bearish_label,
      sentiment_score: score.sentiment_score,
      impact_score: score.impact_score,
      confidence: score.final_confidence,
      explanation_short: score.explanation_short,
      evidence_quality: evidenceQuality
    };

    const tickerUpdate = normalized.primary_ticker
      ? latestStates.get(`ticker:${normalized.primary_ticker}:1h`)
      : latestStates.get("market:market:1h");

    store.bus.emit("event", liveEvent);
    if (tickerUpdate) {
      store.bus.emit("event", {
        type: "ticker_update",
        ticker: tickerUpdate.entity_key,
        as_of: tickerUpdate.as_of,
        window: tickerUpdate.window,
        weighted_sentiment: tickerUpdate.weighted_sentiment,
        confidence: tickerUpdate.weighted_confidence,
        momentum_delta: tickerUpdate.momentum_delta,
        top_event_type: tickerUpdate.top_event_types[0] || null
      });
    }

    for (const alert of alerts) {
      store.bus.emit("event", {
        type: "alert",
        timestamp: alert.created_at,
        alert_type: alert.alert_type,
        entity_key: alert.entity_key,
        headline: alert.headline,
        confidence: alert.confidence,
        source_name: alert.source_name,
        published_at: alert.published_at,
        event_type: alert.event_type,
        url: alert.url || null
      });
    }

    store.persistence?.saveStoreSnapshot(store);

    return { raw, normalized, score, evidence_quality: evidenceQuality };
  }

  return { processRawDocument, evidenceQualityAgent };
}
