import { clamp, round } from "../utils/helpers.js";
import { filterFreshEvidence, shouldUseEvidence } from "./freshness-policy.js";
import { buildSectorStrengthSnapshot } from "./sector-strength.js";

const BULLISH_FLOW_EVENT_TYPES = new Set([
  "insider_buy",
  "activist_stake",
  "institutional_buying",
  "abnormal_volume_buying",
  "block_trade_buying",
  "smart_money_accumulation",
  "smart_money_stacking_positive"
]);

const BEARISH_FLOW_EVENT_TYPES = new Set([
  "insider_sell",
  "institutional_selling",
  "abnormal_volume_selling",
  "block_trade_selling",
  "smart_money_distribution",
  "smart_money_stacking_negative"
]);

const MIN_MACRO_SECTOR_SIGNALS = 3;
const MIN_MACRO_TICKER_SIGNALS = 10;
const MIN_MACRO_RECENT_EVENTS = 5;
const MIN_MACRO_EVENT_SOURCES = 2;

function latestAlertTimestamp(alert) {
  return alert.created_at || alert.detected_at || null;
}

function buildDocumentLookup(store) {
  return new Map(store.normalizedDocuments.map((doc) => [doc.doc_id, doc]));
}

function buildRecentScores(store, recentHours) {
  const cutoff = Date.now() - recentHours * 3_600_000;
  const documentLookup = buildDocumentLookup(store);

  return store.documentScores
    .map((score) => {
      const normalized = documentLookup.get(score.doc_id);
      if (!normalized) {
        return null;
      }

      const publishedAt = new Date(normalized.published_at).getTime();
      if (!Number.isFinite(publishedAt) || publishedAt < cutoff || !shouldUseEvidence(normalized, store.config)) {
        return null;
      }

      return { score, normalized };
    })
    .filter(Boolean);
}

function summarizeRegime(regimeLabel, conviction) {
  if (regimeLabel === "risk_on") {
    return `Macro regime is risk on with ${Math.round(conviction * 100)}% confidence.`;
  }
  if (regimeLabel === "risk_off") {
    return `Macro regime is risk off with ${Math.round(conviction * 100)}% confidence.`;
  }
  if (regimeLabel === "high_dispersion") {
    return `Macro regime is highly dispersed, so selectivity matters more than blanket exposure.`;
  }
  return `Macro regime is balanced, with no decisive top-down edge right now.`;
}

function uniqueList(items, limit = 5) {
  return [...new Set(items.filter(Boolean))].slice(0, limit);
}

function sourceKey(row = {}) {
  return String(row.normalized?.source_name || row.score?.source_name || "").trim().toLowerCase();
}

function latestStatesForWindow(store, entityType, window) {
  const byKey = new Map();
  for (const state of store.sentimentStates) {
    if (state.entity_type !== entityType || state.window !== window) {
      continue;
    }
    if (!shouldUseEvidence({ published_at: state.as_of, source_type: "sentiment_state" }, store.config)) {
      continue;
    }
    const previous = byKey.get(state.entity_key);
    if (!previous || new Date(state.as_of || 0) >= new Date(previous.as_of || 0)) {
      byKey.set(state.entity_key, state);
    }
  }
  return [...byKey.values()];
}

export function buildMacroRegimeSnapshot(store, { window = "1h", recentHours = 24 } = {}) {
  const marketPulse = latestStatesForWindow(store, "market", window).find((state) => state.entity_key === "market") || null;
  const sectorStates = latestStatesForWindow(store, "sector", window);
  const sectorStrength = buildSectorStrengthSnapshot(store.fundamentals?.leaderboard || [], {
    sectorStates,
    etfReferences: store.sectorEtfReferences,
    asOf: store.health.lastUpdate,
    window,
    config: store.config
  });
  const sectorSignals = sectorStrength.sectors.some((sector) => sector.score_available)
    ? sectorStrength.sectors.filter((sector) => sector.score_available)
    : sectorStates;
  const tickerStates = latestStatesForWindow(store, "ticker", window);
  const fundamentals = store.fundamentals?.leaderboard || [];
  const screener = store.fundamentals?.screener || null;
  const recentRows = buildRecentScores(store, recentHours);
  const recentSourceCount = new Set(recentRows.map(sourceKey).filter(Boolean)).size;
  const bullishFlowCount = recentRows.filter((row) => BULLISH_FLOW_EVENT_TYPES.has(row.score.event_type)).length;
  const bearishFlowCount = recentRows.filter((row) => BEARISH_FLOW_EVENT_TYPES.has(row.score.event_type)).length;
  const activeAlerts = filterFreshEvidence(store.alertHistory, store.config);
  const positiveAlertCount = activeAlerts.filter((item) => item.alert_type === "high_confidence_positive").length;
  const negativeAlertCount = activeAlerts.filter((item) => item.alert_type === "high_confidence_negative").length;
  const reversalAlertCount = activeAlerts.filter((item) => item.alert_type === "polarity_reversal").length;

  const bullishSectorBreadth = sectorSignals.length
    ? sectorSignals.filter((item) => item.weighted_sentiment >= 0.15).length / sectorSignals.length
    : 0;
  const bearishSectorBreadth = sectorSignals.length
    ? sectorSignals.filter((item) => item.weighted_sentiment <= -0.15).length / sectorSignals.length
    : 0;
  const positiveFundamentalBreadth = fundamentals.length
    ? fundamentals.filter(
        (item) =>
          item.direction_label === "bullish_supportive" ||
          item.rating_label === "fundamentally_strong" ||
          item.composite_fundamental_score >= 0.62
      ).length / fundamentals.length
    : 0;
  const negativeFundamentalBreadth = fundamentals.length
    ? fundamentals.filter(
        (item) =>
          item.direction_label === "bearish_headwind" ||
          item.rating_label === "deteriorating" ||
          item.composite_fundamental_score <= 0.42
      ).length / fundamentals.length
    : 0;
  const screenerPassRate = Number(screener?.pass_rate || 0);
  const bullishTickerBreadth = tickerStates.length
    ? tickerStates.filter((item) => item.weighted_sentiment >= 0.2).length / tickerStates.length
    : 0;
  const bearishTickerBreadth = tickerStates.length
    ? tickerStates.filter((item) => item.weighted_sentiment <= -0.2).length / tickerStates.length
    : 0;

  const weightedSentiment = Number(marketPulse?.weighted_sentiment || 0);
  const momentumDelta = Number(marketPulse?.momentum_delta || 0);
  const marketConfidence = Number(marketPulse?.weighted_confidence || 0);
  const flowBalance = bullishFlowCount - bearishFlowCount;
  const minimumSectorSignals = Math.max(1, Number(store.config?.macroMinSectorSignals || MIN_MACRO_SECTOR_SIGNALS));
  const minimumTickerSignals = Math.max(1, Number(store.config?.macroMinTickerSignals || MIN_MACRO_TICKER_SIGNALS));
  const minimumRecentEvents = Math.max(1, Number(store.config?.macroMinRecentEvents || MIN_MACRO_RECENT_EVENTS));
  const minimumRecentSources = Math.max(1, Number(store.config?.macroMinRecentSources || MIN_MACRO_EVENT_SOURCES));
  const marketPulseTrusted = Boolean(marketPulse && marketConfidence >= 0.25);
  const sectorBreadthTrusted = sectorSignals.length >= minimumSectorSignals;
  const tickerBreadthTrusted = tickerStates.length >= minimumTickerSignals;
  const eventBreadthTrusted = recentRows.length >= minimumRecentEvents && recentSourceCount >= minimumRecentSources;
  const macroBreadthPass = marketPulseTrusted && (sectorBreadthTrusted || tickerBreadthTrusted || eventBreadthTrusted);
  const macroBreadthReason = macroBreadthPass
    ? null
    : `insufficient macro breadth: market pulse ${marketPulseTrusted ? "present" : "missing/low confidence"}, sectors ${sectorSignals.length}/${minimumSectorSignals}, tickers ${tickerStates.length}/${minimumTickerSignals}, recent events ${recentRows.length}/${minimumRecentEvents} from ${recentSourceCount}/${minimumRecentSources} sources`;

  let longScore = 0;
  let shortScore = 0;
  const supportingSignals = [];
  const riskFlags = [];

  longScore += clamp(weightedSentiment, 0, 1) * 0.26;
  shortScore += clamp(-weightedSentiment, 0, 1) * 0.26;
  longScore += clamp(momentumDelta, 0, 0.35) * 0.36;
  shortScore += clamp(-momentumDelta, 0, 0.35) * 0.36;
  longScore += marketConfidence * 0.12;
  shortScore += marketConfidence * 0.12;
  longScore += bullishSectorBreadth * 0.14;
  shortScore += bearishSectorBreadth * 0.14;
  longScore += bullishTickerBreadth * 0.1;
  shortScore += bearishTickerBreadth * 0.1;
  longScore += positiveFundamentalBreadth * 0.14;
  shortScore += negativeFundamentalBreadth * 0.14;
  longScore += screenerPassRate * 0.08;
  shortScore += clamp(1 - screenerPassRate, 0, 1) * 0.05;

  if (flowBalance > 0) {
    longScore += clamp(flowBalance / 8, 0, 0.12);
    supportingSignals.push(`${bullishFlowCount} recent accumulation-style flow signals`);
  } else if (flowBalance < 0) {
    shortScore += clamp(Math.abs(flowBalance) / 8, 0, 0.12);
    supportingSignals.push(`${bearishFlowCount} recent distribution-style flow signals`);
  }

  if (positiveAlertCount > negativeAlertCount) {
    longScore += clamp((positiveAlertCount - negativeAlertCount) / 10, 0, 0.08);
    supportingSignals.push("positive alerts outnumber negative alerts");
  } else if (negativeAlertCount > positiveAlertCount) {
    shortScore += clamp((negativeAlertCount - positiveAlertCount) / 10, 0, 0.08);
    supportingSignals.push("negative alerts outnumber positive alerts");
  }

  if (weightedSentiment >= 0.22) {
    supportingSignals.push("market pulse is decisively positive");
  } else if (weightedSentiment <= -0.22) {
    supportingSignals.push("market pulse is decisively negative");
  } else {
    riskFlags.push("market pulse is indecisive");
  }

  if (reversalAlertCount >= 3) {
    riskFlags.push("polarity reversals are elevated");
  }
  if (Math.abs(flowBalance) <= 1) {
    riskFlags.push("money-flow balance is not decisive");
  }

  const scoreGap = round(Math.abs(longScore - shortScore), 3);
  let regimeLabel = "balanced";
  let biasLabel = "balanced";
  let riskPosture = "neutral";
  let exposureMultiplier = 0.9;
  let maxGrossExposure = 0.85;
  let longThreshold = 0.56;
  let shortThreshold = 0.56;

  if (longScore >= 0.62 && longScore >= shortScore + 0.08) {
    regimeLabel = "risk_on";
    biasLabel = "long_bias";
    riskPosture = "constructive";
    exposureMultiplier = 1.1;
    maxGrossExposure = 1.15;
    longThreshold = 0.5;
    shortThreshold = 0.62;
  } else if (shortScore >= 0.62 && shortScore >= longScore + 0.08) {
    regimeLabel = "risk_off";
    biasLabel = "short_bias";
    riskPosture = "defensive";
    exposureMultiplier = 0.55;
    maxGrossExposure = 0.6;
    longThreshold = 0.66;
    shortThreshold = 0.5;
  } else if (Math.max(longScore, shortScore) >= 0.52 && scoreGap < 0.08) {
    regimeLabel = "high_dispersion";
    biasLabel = "selective";
    riskPosture = "selective";
    exposureMultiplier = 0.72;
    maxGrossExposure = 0.75;
    longThreshold = 0.6;
    shortThreshold = 0.6;
    riskFlags.push("leadership is mixed across the board");
  }

  if (regimeLabel !== "balanced" && !macroBreadthPass) {
    riskFlags.push(macroBreadthReason);
    regimeLabel = "balanced";
    biasLabel = "balanced";
    riskPosture = "neutral";
    exposureMultiplier = 0.9;
    maxGrossExposure = 0.85;
    longThreshold = 0.56;
    shortThreshold = 0.56;
  }

  const dominantSectors = sectorSignals
    .slice()
    .sort((a, b) => Math.abs(b.weighted_sentiment) - Math.abs(a.weighted_sentiment))
    .slice(0, 3)
    .map((item) => ({
      sector: item.entity_key,
      weighted_sentiment: round(Number(item.weighted_sentiment || 0), 3),
      confidence: round(Number(item.weighted_confidence || 0), 3),
      source: item.score_source || "sentiment_state"
    }));

  return {
    as_of: store.health.lastUpdate || new Date().toISOString(),
    window,
    regime_label: regimeLabel,
    bias_label: biasLabel,
    risk_posture: riskPosture,
    conviction: round(clamp(Math.max(longScore, shortScore), 0, 0.96), 3),
    exposure_multiplier: round(exposureMultiplier, 3),
    max_gross_exposure: round(maxGrossExposure, 3),
    long_threshold: round(longThreshold, 3),
    short_threshold: round(shortThreshold, 3),
    summary: summarizeRegime(regimeLabel, clamp(Math.max(longScore, shortScore), 0, 0.96)),
    supporting_signals: uniqueList(supportingSignals),
    risk_flags: uniqueList(riskFlags),
    score_components: {
      long: round(longScore, 3),
      short: round(shortScore, 3),
      gap: scoreGap
    },
    breadth: {
      breadth_gate_pass: macroBreadthPass,
      breadth_reason: macroBreadthReason,
      market_pulse_trusted: marketPulseTrusted,
      sector_signal_count: sectorSignals.length,
      ticker_signal_count: tickerStates.length,
      recent_event_count: recentRows.length,
      recent_source_count: recentSourceCount,
      minimum_sector_signals: minimumSectorSignals,
      minimum_ticker_signals: minimumTickerSignals,
      minimum_recent_events: minimumRecentEvents,
      minimum_recent_sources: minimumRecentSources,
      bullish_sector_breadth: round(bullishSectorBreadth, 3),
      bearish_sector_breadth: round(bearishSectorBreadth, 3),
      bullish_ticker_breadth: round(bullishTickerBreadth, 3),
      bearish_ticker_breadth: round(bearishTickerBreadth, 3),
      positive_fundamental_breadth: round(positiveFundamentalBreadth, 3),
      negative_fundamental_breadth: round(negativeFundamentalBreadth, 3),
      screener_pass_rate: round(screenerPassRate, 3)
    },
    sector_strength: sectorStrength.summary,
    event_balance: {
      bullish_flow_count: bullishFlowCount,
      bearish_flow_count: bearishFlowCount,
      positive_alert_count: positiveAlertCount,
      negative_alert_count: negativeAlertCount,
      reversal_alert_count: reversalAlertCount
    },
    dominant_sectors: dominantSectors,
    recent_alerts: activeAlerts
      .slice()
      .sort((a, b) => new Date(latestAlertTimestamp(b) || 0) - new Date(latestAlertTimestamp(a) || 0))
      .slice(0, 5)
      .map((item) => ({
        alert_type: item.alert_type,
        entity_key: item.entity_key,
        headline: item.headline,
        confidence: item.confidence,
        created_at: latestAlertTimestamp(item)
      }))
  };
}

export function createMacroRegimeAgent({ store }) {
  return {
    getMacroRegime(options = {}) {
      return buildMacroRegimeSnapshot(store, options);
    }
  };
}
