import assert from "node:assert/strict";
import { computeMacroRegime } from "../src/domain/macro-regime.js";

function makeStore(market1hSentiment, sectorSentiments) {
  const states = [];
  if (market1hSentiment !== null) {
    states.push({
      entity_type: "market", entity_key: "market", window: "1h",
      weighted_sentiment: market1hSentiment, weighted_confidence: 0.75,
      momentum_delta: 0.05, doc_count: 30
    });
    states.push({
      entity_type: "market", entity_key: "market", window: "1d",
      weighted_sentiment: market1hSentiment * 0.8, weighted_confidence: 0.7,
      momentum_delta: 0.02, doc_count: 60
    });
  }
  for (const [sector, sentiment] of Object.entries(sectorSentiments)) {
    states.push({
      entity_type: "sector", entity_key: sector, window: "1h",
      weighted_sentiment: sentiment, weighted_confidence: 0.7, doc_count: 10
    });
  }
  return { sentimentStates: states, alertHistory: [] };
}

// Test 1: risk_on when sentiment high and breadth strong
{
  const store = makeStore(0.35, {
    Technology: 0.4, Healthcare: 0.3, Financials: 0.2,
    Energy: 0.15, Materials: 0.25, Industrials: 0.3,
    Utilities: -0.05, "Consumer Discretionary": 0.35, "Communication Services": 0.28
  });
  const result = computeMacroRegime(store);
  assert.equal(result.regime, "risk_on", "Should be risk_on");
  assert.equal(result.bias, "bullish", "Bias should be bullish");
  assert.ok(result.breadth.bullish_sectors >= 7, "Should have 7+ bullish sectors");
  assert.ok(result.confidence > 0, "Confidence should be positive");
  assert.ok(typeof result.explanation === "string" && result.explanation.length > 0, "Explanation required");
}

// Test 2: risk_off when sentiment low and breadth weak
{
  const store = makeStore(-0.3, {
    Technology: -0.4, Healthcare: -0.2, Financials: -0.35,
    Energy: -0.15, Materials: -0.25, Industrials: 0.05,
    Utilities: 0.1, "Consumer Discretionary": -0.3, "Communication Services": -0.22
  });
  const result = computeMacroRegime(store);
  assert.equal(result.regime, "risk_off", "Should be risk_off");
  assert.equal(result.bias, "bearish", "Bias should be bearish");
}

// Test 3: neutral when no data
{
  const store = makeStore(null, {});
  const result = computeMacroRegime(store);
  assert.equal(result.regime, "neutral", "Should be neutral with no data");
  assert.equal(result.bias, "neutral");
}

// Test 4: output shape has all required keys
{
  const store = makeStore(0.1, { Technology: 0.1, Healthcare: -0.05 });
  const result = computeMacroRegime(store);
  for (const key of ["as_of", "regime", "confidence", "bias", "breadth", "market_sentiment_1h",
    "market_sentiment_1d", "momentum_delta", "signals_used", "explanation"]) {
    assert.ok(key in result, `Missing key: ${key}`);
  }
  assert.ok(Array.isArray(result.signals_used));
  assert.ok(typeof result.breadth.bullish_sectors === "number");
}

console.log("macro-regime tests passed");
