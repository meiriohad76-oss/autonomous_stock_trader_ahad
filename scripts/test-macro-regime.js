import assert from "node:assert/strict";
import { buildMacroRegimeSnapshot } from "../src/domain/macro-regime.js";

const now = new Date().toISOString();
const config = { signalFreshnessMaxHours: 72, seedDataInDecisions: true };

function state(entityType, entityKey, window, sentiment, confidence = 0.75, momentumDelta = 0.05) {
  return {
    entity_type: entityType,
    entity_key: entityKey,
    window,
    as_of: now,
    weighted_sentiment: sentiment,
    weighted_confidence: confidence,
    momentum_delta: momentumDelta,
    doc_count: 12
  };
}

function makeFundamental(ticker, direction = "bullish_supportive", score = 0.72) {
  return {
    ticker,
    direction_label: direction,
    rating_label: direction === "bearish_headwind" ? "deteriorating" : "fundamentally_strong",
    composite_fundamental_score: score
  };
}

function makeStore({ marketSentiment = 0, marketMomentum = 0, sectors = {}, tickers = {}, fundamentals = [], passRate = 0.5, alerts = [] } = {}) {
  return {
    config,
    health: { lastUpdate: now },
    sentimentStates: [
      state("market", "market", "1h", marketSentiment, 0.82, marketMomentum),
      ...Object.entries(sectors).map(([sector, sentiment]) => state("sector", sector, "1h", sentiment)),
      ...Object.entries(tickers).map(([ticker, sentiment]) => state("ticker", ticker, "1h", sentiment))
    ],
    documentScores: [],
    normalizedDocuments: [],
    alertHistory: alerts,
    fundamentals: {
      leaderboard: fundamentals,
      screener: { pass_rate: passRate }
    }
  };
}

{
  const store = makeStore({
    marketSentiment: 0.42,
    marketMomentum: 0.32,
    sectors: {
      Technology: 0.5,
      Healthcare: 0.35,
      Financials: 0.28,
      Energy: 0.22,
      Materials: 0.2,
      Industrials: 0.31,
      Utilities: 0.12,
      "Consumer Discretionary": 0.38
    },
    tickers: { AAPL: 0.5, MSFT: 0.44, NVDA: 0.6, AMZN: 0.35 },
    fundamentals: ["AAPL", "MSFT", "NVDA", "AMZN"].map((ticker) => makeFundamental(ticker)),
    passRate: 0.88,
    alerts: [{ alert_type: "high_confidence_positive", created_at: now }]
  });

  const result = buildMacroRegimeSnapshot(store);
  assert.equal(result.regime_label, "risk_on");
  assert.equal(result.bias_label, "long_bias");
  assert.ok(result.conviction > 0.6);
  assert.ok(result.breadth.bullish_sector_breadth > 0.6);
}

{
  const store = makeStore({
    marketSentiment: -0.44,
    marketMomentum: -0.34,
    sectors: {
      Technology: -0.5,
      Healthcare: -0.35,
      Financials: -0.28,
      Energy: -0.22,
      Materials: -0.2,
      Industrials: -0.31,
      Utilities: -0.12,
      "Consumer Discretionary": -0.38
    },
    tickers: { AAPL: -0.5, MSFT: -0.44, NVDA: -0.6, AMZN: -0.35 },
    fundamentals: ["AAPL", "MSFT", "NVDA", "AMZN"].map((ticker) => makeFundamental(ticker, "bearish_headwind", 0.35)),
    passRate: 0.12,
    alerts: [{ alert_type: "high_confidence_negative", created_at: now }]
  });

  const result = buildMacroRegimeSnapshot(store);
  assert.equal(result.regime_label, "risk_off");
  assert.equal(result.bias_label, "short_bias");
  assert.ok(result.conviction > 0.6);
  assert.ok(result.breadth.bearish_sector_breadth > 0.6);
}

{
  const store = makeStore();
  const result = buildMacroRegimeSnapshot(store);
  for (const key of [
    "as_of",
    "window",
    "regime_label",
    "bias_label",
    "risk_posture",
    "conviction",
    "exposure_multiplier",
    "long_threshold",
    "short_threshold",
    "breadth",
    "event_balance",
    "dominant_sectors"
  ]) {
    assert.ok(key in result, `Missing key: ${key}`);
  }
}

console.log("macro-regime tests passed");
