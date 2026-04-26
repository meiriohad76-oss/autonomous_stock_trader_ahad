import assert from "node:assert/strict";
import { generateTradeSetups } from "../src/domain/trade-setup.js";

function makeSentimentState(ticker, window, sentiment, confidence = 0.7, docCount = 5, momentumDelta = 0.05) {
  return {
    entity_type: "ticker", entity_key: ticker, window,
    weighted_sentiment: sentiment, weighted_confidence: confidence,
    doc_count: docCount, momentum_delta: momentumDelta,
    story_velocity: 2, event_concentration: 0.3, source_diversity: 0.6
  };
}

function makeDocScore(ticker, eventType, sentiment, impact, confidence, scoredAt = new Date().toISOString()) {
  const docId = `doc-${ticker}-${eventType}-${Math.random()}`;
  return {
    score: {
      score_id: `score-${docId}`,
      doc_id: docId,
      event_type: eventType,
      sentiment_score: sentiment,
      impact_score: impact,
      final_confidence: confidence,
      scored_at: scoredAt
    },
    normalized: {
      doc_id: docId,
      primary_ticker: ticker,
      source_metadata: { transaction_value_usd: 5_000_000 }
    }
  };
}

function buildStore({ tickers = [], extraScores = [], alerts = [], fundamentalsMap = new Map() } = {}) {
  const sentimentStates = [];
  const documentScores = [];
  const normalizedDocuments = [];

  for (const ticker of tickers) {
    sentimentStates.push(makeSentimentState(ticker, "1h", 0.45, 0.72, 6, 0.12));
    sentimentStates.push(makeSentimentState(ticker, "4h", 0.35, 0.68, 8, 0.08));
    sentimentStates.push(makeSentimentState(ticker, "1d", 0.28, 0.65, 12, 0.04));
    const item = makeDocScore(ticker, "institutional_buying", 0.6, 0.7, 0.75);
    documentScores.push(item.score);
    normalizedDocuments.push(item.normalized);
  }

  for (const item of extraScores) {
    documentScores.push(item.score);
    normalizedDocuments.push(item.normalized);
  }

  return {
    sentimentStates,
    documentScores,
    normalizedDocuments,
    alertHistory: alerts,
    fundamentals: { byTicker: fundamentalsMap }
  };
}

const neutralRegime = { regime: "neutral", bias: "neutral", confidence: 0.5 };
const riskOnRegime = { regime: "risk_on", bias: "bullish", confidence: 0.75 };
const riskOffRegime = { regime: "risk_off", bias: "bearish", confidence: 0.75 };

// Test 1: Strong bullish ticker produces a long setup
{
  const store = buildStore({ tickers: ["AAPL"] });
  const setups = generateTradeSetups(store, riskOnRegime);
  assert.ok(setups.length > 0, "Should produce at least one setup");
  const aapl = setups.find((s) => s.ticker === "AAPL");
  assert.ok(aapl, "AAPL setup should exist");
  assert.equal(aapl.action, "long", "Strong bullish should be long");
  assert.ok(aapl.conviction > 0 && aapl.conviction <= 1, "Conviction in [0,1]");
  assert.ok(aapl.direction_score > 0, "Direction score should be positive");
  assert.ok(typeof aapl.thesis === "string" && aapl.thesis.length > 0, "Thesis required");
}

// Test 2: Provisional cap — conviction <= 0.55 when fundamentals missing
{
  const store = buildStore({ tickers: ["NVDA"] });
  const setups = generateTradeSetups(store, riskOnRegime);
  const nvda = setups.find((s) => s.ticker === "NVDA");
  assert.ok(nvda, "NVDA setup should exist");
  assert.ok(nvda.provisional === true, "No fundamentals = provisional");
  assert.ok(nvda.conviction <= 0.55, `Provisional conviction must be <= 0.55, got ${nvda.conviction}`);
  assert.ok(nvda.risk_flags.includes("provisional_fundamentals"), "Must flag provisional");
}

// Test 3: Tape-only flow cannot produce long or short
{
  const item = makeDocScore("MSFT", "block_trade_buying", 0.8, 0.9, 0.85);
  const msftScores = [item];
  const store = {
    sentimentStates: [
      makeSentimentState("MSFT", "1h", 0.45, 0.72, 6, 0.12),
      makeSentimentState("MSFT", "4h", 0.35, 0.68, 8, 0.08),
      makeSentimentState("MSFT", "1d", 0.28, 0.65, 12, 0.04),
    ],
    documentScores: [item.score],
    normalizedDocuments: [item.normalized],
    alertHistory: [],
    fundamentals: { byTicker: new Map() }
  };
  const setups = generateTradeSetups(store, riskOnRegime);
  const msft = setups.find((s) => s.ticker === "MSFT");
  if (msft) {
    assert.notEqual(msft.action, "long", "Tape-only should not produce long");
    assert.notEqual(msft.action, "short", "Tape-only should not produce short");
  }
}

// Test 4: Output shape has all required fields
{
  const store = buildStore({ tickers: ["GOOGL"] });
  const setups = generateTradeSetups(store, neutralRegime);
  const setup = setups.find((s) => s.ticker === "GOOGL");
  assert.ok(setup, "GOOGL setup must exist");
  for (const key of [
    "setup_id", "generated_at", "ticker", "action", "conviction", "provisional",
    "timeframe", "position_size_guidance", "entry_guidance", "stop_guidance",
    "target_guidance", "thesis", "risk_flags", "evidence", "direction_score", "macro_regime"
  ]) {
    assert.ok(key in setup, `Missing field: ${key}`);
  }
  assert.ok(setup.evidence.sentiment, "evidence.sentiment required");
  assert.ok(setup.evidence.money_flow, "evidence.money_flow required");
}

// Test 5: Alert bonus shifts money flow signal
{
  const alert = { alert_type: "smart_money_accumulation", entity_key: "TSLA", created_at: new Date().toISOString() };
  const storeWithAlert = buildStore({ tickers: ["TSLA"], alerts: [alert] });
  const storeWithout = buildStore({ tickers: ["TSLA"] });
  const withAlert = generateTradeSetups(storeWithAlert, neutralRegime).find((s) => s.ticker === "TSLA");
  const without = generateTradeSetups(storeWithout, neutralRegime).find((s) => s.ticker === "TSLA");
  if (withAlert && without) {
    assert.ok(
      withAlert.evidence.money_flow.alert_bonus > 0,
      "Alert bonus should be positive"
    );
  }
}

// Test 6: No setup generated for ticker with insufficient evidence (doc_count < 2)
{
  const store = {
    sentimentStates: [{
      entity_type: "ticker", entity_key: "AMZN", window: "1h",
      weighted_sentiment: 0.5, weighted_confidence: 0.8, doc_count: 1,
      momentum_delta: 0.1, story_velocity: 1, event_concentration: 0.2, source_diversity: 0.5
    }],
    documentScores: [],
    normalizedDocuments: [],
    alertHistory: [],
    fundamentals: { byTicker: new Map() }
  };
  const setups = generateTradeSetups(store, neutralRegime);
  const amzn = setups.find((s) => s.ticker === "AMZN");
  assert.ok(!amzn, "Should not generate setup when doc_count < 2 and no recent docs");
}

console.log("trade-setup tests passed");
