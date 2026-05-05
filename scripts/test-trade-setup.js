import assert from "node:assert/strict";
import { buildTradeSetupsSnapshot } from "../src/domain/trade-setup.js";

const now = new Date().toISOString();
const config = { defaultWindow: "1h", signalFreshnessMaxHours: 72, seedDataInDecisions: true };
const riskOnMacro = {
  regime_label: "risk_on",
  bias_label: "long_bias",
  exposure_multiplier: 1.1,
  long_threshold: 0.5,
  short_threshold: 0.62,
  summary: "Macro regime is risk on with strong confirmation."
};
const healthyRuntime = { status: "optimal", sources: [], pressure: { isConstrained: false } };

function sentimentState(ticker, sentiment, confidence = 0.9, momentumDelta = 0.32) {
  return {
    entity_type: "ticker",
    entity_key: ticker,
    entity_name: ticker,
    window: "1h",
    as_of: now,
    weighted_sentiment: sentiment,
    weighted_confidence: confidence,
    momentum_delta: momentumDelta,
    story_velocity: 8,
    top_event_types: ["institutional_buying"],
    top_reasons: ["institutional_buying"]
  };
}

function scoredDocument(ticker, eventType = "institutional_buying", sentiment = 0.72, sourceName = "sec_13f", sourceType = "institutional") {
  const docId = `${ticker}-${eventType}`;
  return {
    score: {
      score_id: `score-${docId}`,
      doc_id: docId,
      event_type: eventType,
      bullish_bearish_label: sentiment >= 0 ? "bullish" : "bearish",
      sentiment_score: sentiment,
      impact_score: 0.8,
      final_confidence: 0.86,
      downstream_weight: 0.9,
      display_tier: "alert",
      evidence_quality: { downstream_weight: 0.9, display_tier: "alert" },
      explanation_short: "High-quality flow evidence."
    },
    normalized: {
      doc_id: docId,
      primary_ticker: ticker,
      headline: `${ticker} institutional buying signal`,
      source_name: sourceName,
      source_type: sourceType,
      published_at: now,
      canonical_url: `https://example.com/${ticker}`,
      source_metadata: { transaction_value_usd: 5_000_000 }
    }
  };
}

function fundamental(ticker, overrides = {}) {
  return {
    ticker,
    company_name: ticker,
    sector: "Technology",
    market_reference: { current_price: 100, beta: 1, live: true },
    initial_screen: { stage: "eligible", summary: "Passes the first-pass screen." },
    direction_label: "bullish_supportive",
    rating_label: "fundamentally_strong",
    final_confidence: 0.9,
    composite_fundamental_score: 0.78,
    anomaly_penalty: 0,
    reason_codes: ["high_roic", "solid_fcf"],
    ...overrides
  };
}

function makeStore({ tickers = ["AAPL"], fundamentals = null, runtimeConfig = config, earningsCalendar = new Map() } = {}) {
  const documents = tickers.flatMap((ticker) => [
    scoredDocument(ticker, "institutional_buying", 0.72, "sec_13f", "institutional"),
    scoredDocument(ticker, "block_trade_buying", 0.68, "polygon_trades", "api")
  ]);
  return {
    config: runtimeConfig,
    health: { lastUpdate: now },
    sentimentStates: tickers.map((ticker) => sentimentState(ticker, 0.72)),
    documentScores: documents.map((item) => item.score),
    normalizedDocuments: documents.map((item) => item.normalized),
    alertHistory: [{ alert_type: "high_confidence_positive", entity_key: tickers[0], created_at: now, headline: "Positive alert", confidence: 0.9 }],
    fundamentals: { leaderboard: fundamentals || tickers.map((ticker) => fundamental(ticker)) },
    earningsCalendar
  };
}

{
  const thinDocuments = [scoredDocument("THIN", "institutional_buying", 0.72, "sec_13f", "institutional")];
  const result = snapshot({
    config,
    health: { lastUpdate: now },
    sentimentStates: [sentimentState("THIN", 0.72)],
    documentScores: thinDocuments.map((item) => item.score),
    normalizedDocuments: thinDocuments.map((item) => item.normalized),
    alertHistory: [{ alert_type: "high_confidence_positive", entity_key: "THIN", created_at: now, headline: "Thin alert", confidence: 0.9 }],
    fundamentals: { leaderboard: [fundamental("THIN")] },
    earningsCalendar: new Map()
  });
  const setup = result.setups.find((item) => item.ticker === "THIN");
  assert.equal(setup.action, "watch", "One fresh source must not become a tradable setup.");
  assert.equal(setup.evidence_breadth.breadth_gate_pass, false, "Thin signal breadth should be explicit.");
  assert.ok(setup.decision_blockers.some((item) => item.key === "insufficient_signal_breadth"));
}

function snapshot(store, options = {}) {
  return buildTradeSetupsSnapshot(store, {
    minConviction: 0,
    limit: 25,
    macroRegimeSnapshot: riskOnMacro,
    runtimeReliabilitySnapshot: healthyRuntime,
    ...options
  });
}

{
  const result = snapshot(makeStore({ tickers: ["AAPL"] }));
  const setup = result.setups.find((item) => item.ticker === "AAPL");
  assert.ok(setup, "AAPL setup should exist");
  assert.equal(setup.action, "long");
  assert.ok(setup.conviction > 0.5 && setup.conviction <= 0.95);
  assert.ok(setup.position_size_pct > 0);
  assert.ok(setup.entry_zone);
  assert.ok(setup.stop_loss);
  assert.ok(setup.take_profit);
}

{
  const earningsCalendar = new Map([
    ["MSFT", { next_earnings_date: now, days_until: 3, confirmed: true, last_checked_at: now }]
  ]);
  const result = snapshot(makeStore({ tickers: ["MSFT"], earningsCalendar }));
  const setup = result.setups.find((item) => item.ticker === "MSFT");
  assert.ok(setup.risk_flags.includes("earnings_in_window"), "Upcoming earnings should be flagged");
}

{
  const degradedRuntime = {
    status: "degraded",
    pressure: { isConstrained: true },
    sources: [{ key: "live_news", label: "Live News", status: "error", criticality: "high", category: "market", action: "investigate" }]
  };
  const result = snapshot(makeStore({ tickers: ["NVDA"] }), { runtimeReliabilitySnapshot: degradedRuntime });
  const setup = result.setups.find((item) => item.ticker === "NVDA");
  assert.ok(setup.runtime_reliability.adjustment_multiplier < 1);
  assert.ok(setup.risk_flags.some((flag) => flag.includes("runtime reliability reduces conviction")));
}

{
  const plannedRuntime = {
    status: "optimal",
    pressure: { isConstrained: false },
    sources: [
      { key: "stocktwits_stream", label: "StockTwits Social Pulse", status: "disabled", enabled: false, criticality: "low", category: "social", action: "leave_disabled" },
      { key: "trade_prints", label: "Delayed Trade Prints", status: "disabled", enabled: false, criticality: "medium", category: "money_flow", action: "leave_disabled" },
      { key: "live_news", label: "Live News", status: "polling", enabled: true, criticality: "medium", category: "news", action: "monitor" }
    ]
  };
  const result = snapshot(makeStore({ tickers: ["META"] }), { runtimeReliabilitySnapshot: plannedRuntime });
  const setup = result.setups.find((item) => item.ticker === "META");
  assert.equal(setup.runtime_reliability.adjustment_multiplier, 1);
  assert.ok(!setup.risk_flags.some((flag) => /runtime reliability|StockTwits|Trade Prints/i.test(flag)));
  assert.ok(setup.decision_thresholds, "Decision thresholds should explain the trade gate");
  assert.ok(Array.isArray(setup.decision_blockers), "Decision blockers should be present");
}

{
  const result = snapshot(makeStore({ tickers: ["GOOGL"] }));
  const setup = result.setups.find((item) => item.ticker === "GOOGL");
  for (const key of [
    "ticker",
    "company_name",
    "action",
    "setup_label",
    "conviction",
    "position_size_pct",
    "timeframe",
    "entry_zone",
    "stop_loss",
    "take_profit",
    "risk_flags",
    "evidence",
    "score_components",
    "decision_thresholds",
    "decision_blockers",
    "runtime_reliability",
    "macro_regime",
    "sentiment",
    "fundamentals",
    "recent_documents"
  ]) {
    assert.ok(key in setup, `Missing field: ${key}`);
  }
}

console.log("trade-setup tests passed");
