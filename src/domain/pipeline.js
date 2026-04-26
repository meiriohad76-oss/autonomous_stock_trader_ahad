import { buildEntityRows, normalizeRawDocument } from "./normalize.js";
import { assignDedupeCluster } from "./dedupe.js";
import { classifyWithRules } from "./rules.js";
import { buildDocumentScore, simulateLlmScore } from "./score.js";
import { recomputeStates } from "./aggregate.js";
import { makeId, round } from "../utils/helpers.js";

const POSITIVE_MONEY_FLOW_EVENT_TYPES = new Set([
  "insider_buy",
  "activist_stake",
  "institutional_buying",
  "abnormal_volume_buying",
  "block_trade_buying"
]);
const NEGATIVE_MONEY_FLOW_EVENT_TYPES = new Set([
  "insider_sell",
  "institutional_selling",
  "abnormal_volume_selling",
  "block_trade_selling"
]);
const MONEY_FLOW_EVENT_TYPES = new Set([...POSITIVE_MONEY_FLOW_EVENT_TYPES, ...NEGATIVE_MONEY_FLOW_EVENT_TYPES]);

function recentAlertExists(store, alertType, ticker, cooldownHours = 6) {
  const cutoff = Date.now() - cooldownHours * 3_600_000;
  return store.alertHistory.some((alert) => {
    if (alert.alert_type !== alertType || alert.entity_key !== ticker) {
      return false;
    }
    return new Date(alert.created_at || 0).getTime() >= cutoff;
  });
}

function collectRecentMoneyFlowSignals(store, ticker, lookbackHours = 72) {
  const cutoff = Date.now() - lookbackHours * 3_600_000;

  return store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      if (!normalized || normalized.primary_ticker !== ticker || !MONEY_FLOW_EVENT_TYPES.has(score.event_type)) {
        return null;
      }

      const publishedAt = new Date(normalized.published_at || score.scored_at || 0).getTime();
      if (!Number.isFinite(publishedAt) || publishedAt < cutoff) {
        return null;
      }

      return { score, normalized };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.normalized.published_at) - new Date(a.normalized.published_at));
}

function buildSmartMoneyAlerts(store, normalized, score) {
  const ticker = normalized.primary_ticker;
  if (!ticker || !MONEY_FLOW_EVENT_TYPES.has(score.event_type)) {
    return [];
  }

  const alerts = [];
  const isPositiveFlow = POSITIVE_MONEY_FLOW_EVENT_TYPES.has(score.event_type);
  const baseAlertType = isPositiveFlow ? "smart_money_accumulation" : "smart_money_distribution";
  const cooldownHours = score.event_type.startsWith("block_trade") ? 2 : 4;

  if (!recentAlertExists(store, baseAlertType, ticker, cooldownHours)) {
    alerts.push({
      alert_id: makeId(),
      alert_type: baseAlertType,
      entity_type: "ticker",
      entity_key: ticker,
      headline: normalized.headline,
      severity: score.event_type.startsWith("block_trade") ? "high" : "medium",
      confidence: score.final_confidence,
      payload: {
        score_id: score.score_id,
        event_type: score.event_type,
        sentiment_score: score.sentiment_score,
        source_name: normalized.source_name
      },
      created_at: new Date().toISOString()
    });
  }

  const recentSignals = collectRecentMoneyFlowSignals(store, ticker);
  const sameDirectionSignals = recentSignals.filter((item) =>
    isPositiveFlow ? POSITIVE_MONEY_FLOW_EVENT_TYPES.has(item.score.event_type) : NEGATIVE_MONEY_FLOW_EVENT_TYPES.has(item.score.event_type)
  );
  const uniqueBuckets = new Set(
    sameDirectionSignals.map((item) => {
      if (item.score.event_type.startsWith("block_trade") || item.score.event_type.startsWith("abnormal_volume")) {
        return "tape";
      }
      if (item.score.event_type.startsWith("institutional_")) {
        return "institutional";
      }
      return "insider";
    })
  );
  const weightedFlow = sameDirectionSignals.reduce(
    (sum, item) => sum + Math.abs(item.score.sentiment_score) * Math.max(0.1, item.score.final_confidence),
    0
  );
  const stackingAlertType = isPositiveFlow ? "smart_money_stacking_positive" : "smart_money_stacking_negative";

  if (
    sameDirectionSignals.length >= 2 &&
    uniqueBuckets.size >= 2 &&
    weightedFlow >= 0.9 &&
    !recentAlertExists(store, stackingAlertType, ticker, 12)
  ) {
    alerts.push({
      alert_id: makeId(),
      alert_type: stackingAlertType,
      entity_type: "ticker",
      entity_key: ticker,
      headline: `${ticker} is showing stacked smart-money ${isPositiveFlow ? "accumulation" : "distribution"} across ${[...uniqueBuckets].join(", ")} flow.`,
      severity: "high",
      confidence: round(
        Math.min(
          0.97,
          sameDirectionSignals.reduce((sum, item) => sum + item.score.final_confidence, 0) / sameDirectionSignals.length
        ),
        3
      ),
      payload: {
        trigger_score_id: score.score_id,
        direction: isPositiveFlow ? "positive" : "negative",
        event_count: sameDirectionSignals.length,
        buckets: [...uniqueBuckets],
        weighted_flow: round(weightedFlow, 3)
      },
      created_at: new Date().toISOString()
    });
  }

  return alerts;
}

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

  if (score.final_confidence >= store.config.alertConfidenceThreshold && score.sentiment_score <= -0.6) {
    alerts.push({
      alert_id: makeId(),
      alert_type: "high_confidence_negative",
      entity_type: "ticker",
      entity_key: normalized.primary_ticker || "market",
      headline: normalized.headline,
      severity: "high",
      confidence: score.final_confidence,
      payload: { score_id: score.score_id, sentiment_score: score.sentiment_score },
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
      payload: { score_id: score.score_id, sentiment_score: score.sentiment_score },
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
      payload: {
        weighted_sentiment: tickerState.weighted_sentiment,
        momentum_delta: tickerState.momentum_delta
      },
      created_at: new Date().toISOString()
    });
  }

  alerts.push(...buildSmartMoneyAlerts(store, normalized, score));

  if (alerts.length) {
    store.alertHistory = [...alerts, ...store.alertHistory].slice(0, 50);
  }

  return alerts;
}

export function createPipeline(store) {
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

    const normalized = normalizeRawDocument(raw);
    const cluster = assignDedupeCluster(store, normalized);
    normalized.dedupe_cluster_id = cluster.dedupe_cluster_id;
    normalized.novelty_score = cluster.novelty_score;
    store.normalizedDocuments.push(normalized);

    const entities = buildEntityRows(normalized, store.config.universeName);
    store.documentEntities.push(...entities);

    const ruleResult = classifyWithRules(normalized);
    const llmResult = simulateLlmScore(normalized, ruleResult);
    const score = buildDocumentScore(normalized, ruleResult, llmResult);
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
      ticker: normalized.primary_ticker,
      headline: normalized.headline,
      source_name: normalized.source_name,
      event_type: score.event_type,
      label: score.bullish_bearish_label,
      sentiment_score: score.sentiment_score,
      impact_score: score.impact_score,
      confidence: score.final_confidence,
      explanation_short: score.explanation_short
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
        confidence: alert.confidence
      });
    }

    store.persistence?.saveStoreSnapshot(store);

    return { raw, normalized, score };
  }

  return { processRawDocument };
}
