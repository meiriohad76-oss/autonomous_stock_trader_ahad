import { HALF_LIFE_HOURS, WINDOWS } from "./taxonomy.js";
import { clamp, differenceInHours, makeId, round, scoreToLabel } from "../utils/helpers.js";

function decayFactor(score, normalized, asOf) {
  const ageHours = differenceInHours(normalized.published_at, asOf);
  const halfLifeHours = HALF_LIFE_HOURS[score.event_type] || HALF_LIFE_HOURS.default;
  const lambda = Math.log(2) / halfLifeHours;
  return Math.exp(-lambda * ageHours);
}

function buildState(entityType, entityKey, entityName, window, rows, previousState, asOf) {
  const uniqueStories = new Set(rows.map((row) => row.normalized.dedupe_cluster_id)).size;
  const sourceNames = new Set(rows.map((row) => row.normalized.source_name));
  const weightSum = rows.reduce((sum, row) => {
    const decay = row.decay;
    const weight = Math.max(0.05, row.score.impact_score * row.score.relevance_score * row.score.final_confidence * decay);
    return sum + weight;
  }, 0);
  const alphaSum = rows.reduce((sum, row) => sum + row.score.document_alpha * row.decay, 0);
  const weightedSentiment = weightSum ? alphaSum / weightSum : 0;
  const weightedImpact = rows.length ? rows.reduce((sum, row) => sum + row.score.impact_score, 0) / rows.length : 0;
  const weightedConfidence = rows.length ? rows.reduce((sum, row) => sum + row.score.final_confidence, 0) / rows.length : 0;
  const eventCounts = Object.create(null);
  const reasonCounts = Object.create(null);
  const clusterCounts = Object.create(null);

  for (const row of rows) {
    eventCounts[row.score.event_type] = (eventCounts[row.score.event_type] || 0) + 1;
    clusterCounts[row.normalized.dedupe_cluster_id] = (clusterCounts[row.normalized.dedupe_cluster_id] || 0) + 1;

    for (const reason of row.score.reason_codes) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }

  const topEventTypes = Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key);
  const topReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key);
  const highestClusterShare = uniqueStories ? Math.max(...Object.values(clusterCounts)) / rows.length : 0;

  return {
    state_id: makeId(),
    entity_type: entityType,
    entity_key: entityKey,
    entity_name: entityName,
    window,
    as_of: new Date(asOf).toISOString(),
    doc_count: rows.length,
    unique_story_count: uniqueStories,
    weighted_sentiment: round(weightedSentiment, 4),
    weighted_impact: round(weightedImpact, 3),
    weighted_confidence: round(weightedConfidence, 3),
    story_velocity: round(rows.length / Math.max(0.25, WINDOWS.find((item) => item.key === window)?.hours || 1), 3),
    momentum_delta: round(weightedSentiment - (previousState?.weighted_sentiment || 0), 4),
    event_concentration: round(clamp(highestClusterShare, 0, 1), 3),
    source_diversity: round(rows.length ? sourceNames.size / rows.length : 0, 3),
    sentiment_regime: scoreToLabel(weightedSentiment),
    top_event_types: topEventTypes,
    top_reasons: topReasons,
    state_metadata: {}
  };
}

export function recomputeStates(store, asOf = Date.now()) {
  const rows = store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      return normalized ? { score, normalized, decay: decayFactor(score, normalized, asOf) } : null;
    })
    .filter(Boolean);

  const nextStates = [];
  const latestByKey = new Map();

  for (const window of WINDOWS) {
    const eligibleRows = rows.filter((row) => differenceInHours(row.normalized.published_at, asOf) <= window.hours);
    const grouped = new Map();

    for (const row of eligibleRows) {
      const entities = store.documentEntities.filter((entity) => entity.doc_id === row.normalized.doc_id);

      for (const entity of entities) {
        const key = `${entity.entity_type}:${entity.entity_key}:${window.key}`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key).push(row);
      }
    }

    for (const [key, groupedRows] of grouped) {
      const [entityType, entityKey] = key.split(":");
      const entity = store.documentEntities.find(
        (item) => item.entity_type === entityType && item.entity_key === entityKey && groupedRows.some((row) => row.normalized.doc_id === item.doc_id)
      );
      const previousState = store.sentimentStates
        .filter((state) => state.entity_type === entityType && state.entity_key === entityKey && state.window === window.key)
        .sort((a, b) => new Date(b.as_of) - new Date(a.as_of))[0];
      const nextState = buildState(entityType, entityKey, entity?.entity_name || entityKey, window.key, groupedRows, previousState, asOf);
      nextStates.push(nextState);
      latestByKey.set(`${entityType}:${entityKey}:${window.key}`, nextState);
    }
  }

  store.sentimentStates = [...store.sentimentStates.filter(() => false), ...nextStates];
  return latestByKey;
}
