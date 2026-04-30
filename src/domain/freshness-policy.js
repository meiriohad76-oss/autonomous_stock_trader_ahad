import { round } from "../utils/helpers.js";

const LONG_HORIZON_SOURCE_TYPES = new Set([
  "filing",
  "sec",
  "institutional",
  "fundamental",
  "quarterly"
]);

const LONG_HORIZON_SOURCE_NAMES = new Set([
  "sec_edgar",
  "sec_company_facts",
  "sec_submissions"
]);

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function evidenceTimestamp(item = {}) {
  return (
    item.published_at ||
    item.payload?.published_at ||
    item.evidence_quality?.published_at ||
    item.payload?.evidence_quality?.published_at ||
    item.timestamp ||
    item.created_at ||
    item.scored_at ||
    item.as_of ||
    null
  );
}

export function evidenceSourceType(item = {}) {
  return item.source_type || item.payload?.source_type || item.evidence_quality?.source_type || item.payload?.evidence_quality?.source_type || null;
}

export function evidenceSourceName(item = {}) {
  return item.source_name || item.payload?.source_name || item.evidence_quality?.source_name || item.payload?.evidence_quality?.source_name || null;
}

export function isLongHorizonEvidence(item = {}) {
  const sourceType = String(evidenceSourceType(item) || "").toLowerCase();
  const sourceName = String(evidenceSourceName(item) || "").toLowerCase();
  return LONG_HORIZON_SOURCE_TYPES.has(sourceType) || LONG_HORIZON_SOURCE_NAMES.has(sourceName);
}

export function freshnessStatus(item = {}, config = {}, now = Date.now()) {
  const maxAgeHours = Number(config.signalFreshnessMaxHours || 72);
  const timestamp = evidenceTimestamp(item);
  const observedMs = timestampMs(timestamp);
  const exempt = isLongHorizonEvidence(item);
  const seedData = Boolean(item.source_metadata?.seed_data || item.payload?.source_metadata?.seed_data);

  if (seedData && !config.seedDataInDecisions) {
    return {
      fresh: false,
      exempt,
      timestamp,
      age_hours: observedMs ? round(Math.max(0, (Number(now) - observedMs) / 3_600_000), 2) : null,
      max_age_hours: maxAgeHours,
      reason: "seed_data_disabled"
    };
  }

  if (!observedMs) {
    return {
      fresh: false,
      exempt,
      timestamp,
      age_hours: null,
      max_age_hours: maxAgeHours,
      reason: "missing_timestamp"
    };
  }

  const ageHours = Math.max(0, (Number(now) - observedMs) / 3_600_000);
  return {
    fresh: exempt || ageHours <= maxAgeHours,
    exempt,
    timestamp,
    age_hours: round(ageHours, 2),
    max_age_hours: maxAgeHours,
    reason: exempt ? "long_horizon_exempt" : ageHours <= maxAgeHours ? "fresh" : "stale_market_signal"
  };
}

export function shouldUseEvidence(item = {}, config = {}, now = Date.now()) {
  return freshnessStatus(item, config, now).fresh;
}

export function filterFreshEvidence(items = [], config = {}, now = Date.now()) {
  return items.filter((item) => shouldUseEvidence(item, config, now));
}
