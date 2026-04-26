# Trade Setup Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a decision-layer Trade Setup Agent that reads from the existing store (sentiment states, money flow, fundamentals, alerts) and produces explainable `long / short / watch / no_trade` setups with conviction, position sizing, entry/stop/target guidance, and a human-readable thesis.

**Architecture:** A pure `computeMacroRegime(store)` function derives market regime from existing market/sector sentiment states. An event-driven `createTradeSetupAgent(app)` subscribes to the store bus (debounced 500ms), computes regime + setups, writes `store.macroRegime` and `store.tradeSetups`, and emits SSE events. Three new API endpoints expose the outputs. A new Setups panel in the sentiment dashboard surfaces the results.

**Tech Stack:** Node.js ESM, no new npm dependencies, `node:assert/strict` for tests, existing `clamp / round / makeId` from `src/utils/helpers.js`.

**Spec:** `docs/superpowers/specs/2026-04-26-trade-setup-agent-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/domain/macro-regime.js` | **Create** | Pure function — reads store, returns regime snapshot |
| `src/domain/trade-setup.js` | **Create** | Signal assembly, scoring, action classification, agent wiring |
| `src/domain/store.js` | **Modify** | Add `macroRegime: null` and `tradeSetups: []` |
| `src/app.js` | **Modify** | Instantiate agent, add three getter methods |
| `src/http/router.js` | **Modify** | Three new endpoints; add fields to SSE snapshot |
| `src/public/index.html` | **Modify** | Macro regime bar, Setups nav item + panel skeleton |
| `src/public/app.js` | **Modify** | State fields, SSE handlers, fetch + render for setups |
| `src/public/styles.css` | **Modify** | Macro bar, setup card, conviction meter, provisional badge |
| `openapi/openapi.yaml` | **Modify** | Document three new endpoints |
| `README.md` | **Modify** | Note decision layer and new endpoints |
| `scripts/check.js` | **Modify** | Assertions for macro regime and trade setups after replay |

---

## Task 1: Extend the store

**Files:**
- Modify: `src/domain/store.js`

- [ ] **Step 1.1: Add `macroRegime` and `tradeSetups` to `createStore`**

Open `src/domain/store.js`. In the `createStore` return object, add two fields after `fundamentals`:

```js
  fundamentals: createEmptyFundamentalsState(),
  macroRegime: null,
  tradeSetups: [],
```

- [ ] **Step 1.2: Add the same fields to `resetStore`**

In the `resetStore` function body, add after the `fundamentals` reset line:

```js
  store.macroRegime = null;
  store.tradeSetups = [];
```

- [ ] **Step 1.3: Verify the server still starts**

```bash
node -e "import('./src/domain/store.js').then(m => { const s = m.createStore({}); console.log(s.macroRegime, s.tradeSetups.length); })"
```

Expected output: `null 0`

- [ ] **Step 1.4: Commit**

```bash
git add src/domain/store.js
git commit -m "feat(store): add macroRegime and tradeSetups fields"
```

---

## Task 2: Create macro-regime.js

**Files:**
- Create: `src/domain/macro-regime.js`

- [ ] **Step 2.1: Write a failing test**

Create `scripts/test-macro-regime.js`:

```js
import assert from "node:assert/strict";
import { computeMacroRegime } from "../src/domain/macro-regime.js";

// Build a minimal store with market + sector sentiment states
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
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
node scripts/test-macro-regime.js
```

Expected: Error — `Cannot find module '../src/domain/macro-regime.js'`

- [ ] **Step 2.3: Create `src/domain/macro-regime.js`**

```js
import { round } from "../utils/helpers.js";

const RISK_ON_SENTIMENT = 0.25;
const RISK_OFF_SENTIMENT = -0.25;
const RISK_ON_BREADTH = 0.6;
const RISK_OFF_BREADTH = 0.4;
const MIN_SECTORS = 5;
const MIN_DOC_COUNT = 20;

function getMarketState(store, window) {
  return store.sentimentStates.find(
    (s) => s.entity_type === "market" && s.entity_key === "market" && s.window === window
  ) || null;
}

function getSectorStates(store) {
  return store.sentimentStates.filter(
    (s) => s.entity_type === "sector" && s.window === "1h"
  );
}

function biasFromRegime(regime) {
  if (regime === "risk_on") return "bullish";
  if (regime === "risk_off") return "bearish";
  return "neutral";
}

export function computeMacroRegime(store) {
  const market1h = getMarketState(store, "1h");
  const market1d = getMarketState(store, "1d");
  const sectors = getSectorStates(store);

  const sentiment1h = market1h?.weighted_sentiment ?? 0;
  const sentiment1d = market1d?.weighted_sentiment ?? 0;
  const momentum = market1h?.momentum_delta ?? 0;

  const totalSectors = sectors.length;
  const bullishSectors = sectors.filter((s) => s.weighted_sentiment > 0.1).length;
  const bearishSectors = sectors.filter((s) => s.weighted_sentiment < -0.1).length;
  const neutralSectors = totalSectors - bullishSectors - bearishSectors;
  const breadthScore = totalSectors > 0 ? round(bullishSectors / totalSectors, 3) : 0.5;

  const totalDocs = (market1h?.doc_count ?? 0) + (market1d?.doc_count ?? 0);
  const hasEnoughData = totalSectors >= MIN_SECTORS && totalDocs >= MIN_DOC_COUNT;

  let regime;
  if (!hasEnoughData) {
    regime = "neutral";
  } else if (sentiment1h >= RISK_ON_SENTIMENT && breadthScore >= RISK_ON_BREADTH) {
    regime = "risk_on";
  } else if (sentiment1h <= RISK_OFF_SENTIMENT && breadthScore <= RISK_OFF_BREADTH) {
    regime = "risk_off";
  } else if (Math.abs(sentiment1h) < 0.1 && bullishSectors > 0 && bearishSectors > 0) {
    regime = "mixed";
  } else {
    regime = "neutral";
  }

  const marketConf = market1h?.weighted_confidence ?? 0;
  const sectorCoverage = Math.min(1, totalSectors / 9);
  const confidence = round(Math.min(1, marketConf * 0.5 + sectorCoverage * 0.3 + (hasEnoughData ? 0.2 : 0)), 3);

  const signalsUsed = [];
  if (market1h) signalsUsed.push("market_sentiment_1h");
  if (market1d) signalsUsed.push("market_sentiment_1d");
  if (sectors.length) signalsUsed.push("sector_breadth");
  if (store.alertHistory?.length) signalsUsed.push("alert_history");

  const sentimentStr = sentiment1h >= 0 ? `+${sentiment1h.toFixed(2)}` : sentiment1h.toFixed(2);
  const breadthStr = totalSectors > 0
    ? `${bullishSectors}/${totalSectors} sectors bullish`
    : "insufficient sector data";
  const explanation = `${regime.replace("_", "-")} regime; 1h market sentiment ${sentimentStr}; ${breadthStr}; confidence ${confidence.toFixed(2)}`;

  return {
    as_of: new Date().toISOString(),
    regime,
    confidence,
    bias: biasFromRegime(regime),
    breadth: {
      bullish_sectors: bullishSectors,
      bearish_sectors: bearishSectors,
      neutral_sectors: neutralSectors,
      breadth_score: breadthScore
    },
    market_sentiment_1h: round(sentiment1h, 4),
    market_sentiment_1d: round(sentiment1d, 4),
    momentum_delta: round(momentum, 4),
    signals_used: signalsUsed,
    explanation
  };
}
```

- [ ] **Step 2.4: Run test to confirm it passes**

```bash
node scripts/test-macro-regime.js
```

Expected: `macro-regime tests passed`

- [ ] **Step 2.5: Commit**

```bash
git add src/domain/macro-regime.js scripts/test-macro-regime.js
git commit -m "feat(macro-regime): add computeMacroRegime pure function with tests"
```

---

## Task 3: Create trade-setup.js — signal assembly and scoring

**Files:**
- Create: `src/domain/trade-setup.js`

- [ ] **Step 3.1: Write a failing test**

Create `scripts/test-trade-setup.js`:

```js
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

// Test 2: Provisional cap — conviction ≤ 0.55 when fundamentals missing
{
  const store = buildStore({ tickers: ["NVDA"] });
  const setups = generateTradeSetups(store, riskOnRegime);
  const nvda = setups.find((s) => s.ticker === "NVDA");
  assert.ok(nvda, "NVDA setup should exist");
  assert.ok(nvda.provisional === true, "No fundamentals = provisional");
  assert.ok(nvda.conviction <= 0.55, `Provisional conviction must be ≤ 0.55, got ${nvda.conviction}`);
  assert.ok(nvda.risk_flags.includes("provisional_fundamentals"), "Must flag provisional");
}

// Test 3: Tape-only flow cannot produce long or short
{
  const item = makeDocScore("MSFT", "block_trade_buying", 0.8, 0.9, 0.85);
  const store = buildStore({ tickers: ["MSFT"], extraScores: [item] });
  // Override the institutional buying with only tape
  store.documentScores = store.documentScores
    .filter((s) => s.event_type !== "institutional_buying");
  store.normalizedDocuments = store.normalizedDocuments
    .filter((d) => store.documentScores.some((s) => s.doc_id === d.doc_id));
  store.documentScores.push(item.score);
  store.normalizedDocuments.push(item.normalized);
  const setups = generateTradeSetups(store, riskOnRegime);
  const msft = setups.find((s) => s.ticker === "MSFT");
  if (msft) {
    assert.notEqual(msft.action, "long", "Tape-only should not produce long");
    assert.notEqual(msft.action, "short", "Tape-only should not produce short");
  }
}

// Test 4: Risk-off regime raises long threshold
{
  // Build a ticker with moderate bullish sentiment (direction ~0.28 — below 0.30 default but above 0.25)
  // Should be long in risk_on but not in risk_off (threshold 0.40)
  const store = buildStore({ tickers: ["META"] });
  // Tone down the sentiment a bit
  store.sentimentStates = store.sentimentStates.map((s) =>
    s.entity_key === "META" ? { ...s, weighted_sentiment: 0.22, weighted_confidence: 0.55 } : s
  );
  const inRiskOn = generateTradeSetups(store, riskOnRegime).find((s) => s.ticker === "META");
  const inRiskOff = generateTradeSetups(store, riskOffRegime).find((s) => s.ticker === "META");
  if (inRiskOn && inRiskOff) {
    assert.ok(
      inRiskOff.action !== "long" || inRiskOn.action === inRiskOff.action,
      "Risk-off should not produce long when risk-on would not either"
    );
  }
}

// Test 5: Output shape has all required fields
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

// Test 6: Alert bonus shifts money flow signal
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

// Test 7: No setup generated for ticker with insufficient evidence
{
  const store = buildStore();
  store.sentimentStates = [{
    entity_type: "ticker", entity_key: "AMZN", window: "1h",
    weighted_sentiment: 0.5, weighted_confidence: 0.8, doc_count: 1, // < 2 threshold
    momentum_delta: 0.1, story_velocity: 1, event_concentration: 0.2, source_diversity: 0.5
  }];
  const setups = generateTradeSetups(store, neutralRegime);
  const amzn = setups.find((s) => s.ticker === "AMZN");
  assert.ok(!amzn, "Should not generate setup when doc_count < 2 and no recent docs");
}

console.log("trade-setup tests passed");
```

- [ ] **Step 3.2: Run test to confirm it fails**

```bash
node scripts/test-trade-setup.js
```

Expected: Error — `Cannot find module '../src/domain/trade-setup.js'`

- [ ] **Step 3.3: Create `src/domain/trade-setup.js`**

```js
import { computeMacroRegime } from "./macro-regime.js";
import { clamp, makeId, round } from "../utils/helpers.js";

// --- Constants ---

const MONEY_FLOW_EVENT_TYPES = new Set([
  "insider_buy", "insider_sell", "activist_stake",
  "institutional_buying", "institutional_selling",
  "block_trade_buying", "block_trade_selling",
  "abnormal_volume_buying", "abnormal_volume_selling"
]);

const INSIDER_TYPES = new Set(["insider_buy", "insider_sell", "activist_stake"]);
const INSTITUTIONAL_TYPES = new Set(["institutional_buying", "institutional_selling"]);
const TAPE_TYPES = new Set([
  "block_trade_buying", "block_trade_selling",
  "abnormal_volume_buying", "abnormal_volume_selling"
]);

const SMART_MONEY_POSITIVE = new Set(["smart_money_accumulation", "smart_money_stacking_positive"]);
const SMART_MONEY_NEGATIVE = new Set(["smart_money_distribution", "smart_money_stacking_negative"]);

const SOURCE_WEIGHTS = { insider: 1.0, institutional: 0.9, tape: 0.6 };

const DIRECTION_LABELS = { bullish_supportive: 0.8, neutral: 0, bearish_headwind: -0.8 };

const THRESHOLDS = {
  risk_on:  { long: 0.25, short: -0.35 },
  risk_off: { long: 0.40, short: -0.25 },
  neutral:  { long: 0.30, short: -0.30 },
  mixed:    { long: 0.30, short: -0.30 }
};

// --- Helpers ---

function moneyFlowBucket(eventType) {
  if (INSIDER_TYPES.has(eventType)) return "insider";
  if (INSTITUTIONAL_TYPES.has(eventType)) return "institutional";
  if (TAPE_TYPES.has(eventType)) return "tape";
  return null;
}

function notionalFromMeta(meta = {}) {
  return Math.abs(
    Number(meta.latest_dollar_volume_usd ?? meta.transaction_value_usd ?? meta.position_delta_value_usd ?? 0) || 0
  );
}

// --- Signal assembly ---

function assembleSentimentSignal(store, ticker) {
  const WINDOW_WEIGHTS = { "1h": 0.5, "4h": 0.3, "1d": 0.2 };
  const windows = Object.keys(WINDOW_WEIGHTS);

  const states = Object.fromEntries(
    windows.map((w) => [
      w,
      store.sentimentStates.find(
        (s) => s.entity_type === "ticker" && s.entity_key === ticker && s.window === w
      ) || null
    ])
  );

  if (!windows.some((w) => states[w])) return null;

  const signal = windows.reduce((sum, w) => {
    const s = states[w];
    return sum + (s ? s.weighted_sentiment * WINDOW_WEIGHTS[w] : 0);
  }, 0);

  const confidence = windows.reduce((sum, w) => {
    const s = states[w];
    return sum + (s ? s.weighted_confidence * WINDOW_WEIGHTS[w] : 0);
  }, 0);

  const primary = states["1h"] || states["4h"] || states["1d"];

  return {
    signal: round(clamp(signal, -1, 1), 4),
    confidence: round(clamp(confidence, 0, 1), 3),
    windows: Object.fromEntries(windows.map((w) => [w, states[w]?.weighted_sentiment ?? null])),
    momentum_delta: round(primary?.momentum_delta ?? 0, 4),
    doc_count: primary?.doc_count ?? 0,
    event_concentration: primary?.event_concentration ?? 0,
    source_diversity: primary?.source_diversity ?? 0
  };
}

function assembleMoneyFlowSignal(store, ticker) {
  const cutoff = Date.now() - 48 * 3_600_000;

  const items = store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((d) => d.doc_id === score.doc_id);
      return normalized?.primary_ticker === ticker ? { score, normalized } : null;
    })
    .filter(Boolean)
    .filter((item) => MONEY_FLOW_EVENT_TYPES.has(item.score.event_type))
    .filter((item) => new Date(item.score.scored_at).getTime() >= cutoff);

  const empty = { signal: 0, confidence: 0, event_count: 0, dominant_bucket: "none", net_notional_usd: 0, alert_bonus: 0, tape_only: false };
  if (!items.length) return empty;

  let weightedSum = 0;
  let confidenceSum = 0;
  let notionalSum = 0;
  const bucketCounts = { insider: 0, institutional: 0, tape: 0 };

  for (const { score, normalized } of items) {
    const bucket = moneyFlowBucket(score.event_type);
    if (!bucket) continue;
    const w = SOURCE_WEIGHTS[bucket];
    weightedSum += score.sentiment_score * score.impact_score * score.final_confidence * w;
    confidenceSum += score.final_confidence;
    bucketCounts[bucket]++;
    notionalSum += notionalFromMeta(normalized.source_metadata);
  }

  const alerts = (store.alertHistory || []).filter((a) => a.entity_key === ticker);
  let alertBonus = 0;
  for (const alert of alerts) {
    if (SMART_MONEY_POSITIVE.has(alert.alert_type)) alertBonus += 0.15;
    if (SMART_MONEY_NEGATIVE.has(alert.alert_type)) alertBonus -= 0.15;
  }
  alertBonus = round(clamp(alertBonus, -0.3, 0.3), 3);

  const count = items.length;
  const rawSignal = clamp(weightedSum / count + alertBonus, -1, 1);
  const dominantBucket = Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0][0];
  const tapeOnly = bucketCounts.insider === 0 && bucketCounts.institutional === 0 && bucketCounts.tape > 0;

  return {
    signal: round(rawSignal, 4),
    confidence: round(confidenceSum / count, 3),
    event_count: count,
    dominant_bucket: dominantBucket,
    net_notional_usd: round(notionalSum, 2),
    alert_bonus: alertBonus,
    tape_only: tapeOnly
  };
}

function assembleFundamentalSignal(store, ticker) {
  const fund = store.fundamentals?.byTicker?.get(ticker);
  if (!fund) return null;

  const directionNumeric = DIRECTION_LABELS[fund.direction_label] ?? 0;

  return {
    signal: round(clamp(directionNumeric * fund.final_confidence, -1, 1), 4),
    confidence: round(fund.final_confidence, 3),
    direction_label: fund.direction_label,
    regime_label: fund.regime_label,
    composite_score: fund.composite_fundamental_score,
    valuation_label: fund.valuation_label,
    data_freshness_score: fund.data_freshness_score ?? 0,
    is_live: fund.market_reference?.live === true
  };
}

// --- Evidence gates ---

function hasMinimumEvidence(store, ticker) {
  const hasSentiment = store.sentimentStates.some(
    (s) => s.entity_type === "ticker" && s.entity_key === ticker && (s.doc_count ?? 0) >= 2
  );
  if (!hasSentiment) return false;

  const cutoff = Date.now() - 48 * 3_600_000;
  return store.documentScores.some((score) => {
    const normalized = store.normalizedDocuments.find((d) => d.doc_id === score.doc_id);
    return normalized?.primary_ticker === ticker && new Date(score.scored_at).getTime() >= cutoff;
  });
}

function isProvisional(fundamentalSignal) {
  if (!fundamentalSignal) return true;
  if ((fundamentalSignal.data_freshness_score ?? 0) < 0.8) return true;
  if (!fundamentalSignal.is_live) return true;
  return false;
}

// --- Scoring ---

function computeDirectionScore(sentiment, moneyFlow, fundamental) {
  const s = sentiment?.signal ?? 0;
  const m = moneyFlow?.signal ?? 0;
  const f = fundamental?.signal ?? 0;
  return round(clamp(s * 0.45 + m * 0.30 + f * 0.25, -1, 1), 4);
}

function computeConviction(sentiment, moneyFlow, fundamental, macroRegime, provisional) {
  const sc = sentiment?.confidence ?? 0;
  const mc = moneyFlow?.confidence ?? 0;
  const fc = fundamental?.confidence ?? 0;
  const rc = macroRegime?.confidence ?? 0;
  const raw = sc * 0.35 + mc * 0.25 + fc * 0.25 + rc * 0.15;
  const momentumAdj = (sentiment?.momentum_delta ?? 0) > 0 ? 0.08 : ((sentiment?.momentum_delta ?? 0) < 0 ? -0.08 : 0);
  const clamped = round(clamp(raw + momentumAdj, 0, 1), 3);
  return provisional ? Math.min(clamped, 0.55) : clamped;
}

function classifyAction(directionScore, conviction, macroRegime, tapeOnly) {
  const thresholds = THRESHOLDS[macroRegime?.regime] || THRESHOLDS.neutral;
  if (!tapeOnly) {
    if (directionScore >= thresholds.long && conviction >= 0.45) return "long";
    if (directionScore <= thresholds.short && conviction >= 0.45) return "short";
  }
  if (Math.abs(directionScore) >= 0.15 || conviction >= 0.35) return "watch";
  return "no_trade";
}

function positionSize(conviction) {
  if (conviction >= 0.70) return "full";
  if (conviction >= 0.55) return "half";
  if (conviction >= 0.40) return "quarter";
  return "starter";
}

function deriveTimeframe(sentimentSignal) {
  if (!sentimentSignal) return "1d–4d swing";
  const w = sentimentSignal.windows;
  const val1h = Math.abs(w["1h"] ?? 0);
  const val4h = Math.abs(w["4h"] ?? 0);
  if (val1h >= 0.35 && (w["4h"] === null || val4h < val1h * 0.6)) return "intraday";
  return "1d–4d swing";
}

function buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action) {
  const flags = [];
  if (provisional) flags.push("provisional_fundamentals");
  if ((macroRegime?.confidence ?? 0) < 0.4) flags.push("low_macro_confidence");
  if (action === "long" && macroRegime?.bias === "bearish") flags.push("macro_headwind");
  if (action === "short" && macroRegime?.bias === "bullish") flags.push("macro_headwind");
  if (moneyFlow?.tape_only) flags.push("tape_only_flow");
  if ((sentiment?.event_concentration ?? 0) > 0.6) flags.push("high_event_concentration");
  if ((sentiment?.source_diversity ?? 1) < 0.3) flags.push("low_story_diversity");
  if ((sentiment?.momentum_delta ?? 0) < -0.15) flags.push("deteriorating_sentiment");
  if (fundamental?.direction_label === "bearish_headwind") flags.push("weak_fundamentals");
  return flags;
}

function buildThesis(action, sentiment, moneyFlow, fundamental, macroRegime) {
  const parts = [];

  if (Math.abs(sentiment?.signal ?? 0) >= 0.2) {
    const dir = (sentiment.signal ?? 0) > 0 ? "Bullish" : "Bearish";
    const windows = ["1h", "4h"].filter((w) => (sentiment.windows?.[w] ?? null) !== null).join("/");
    parts.push(`${dir} ${windows} sentiment`);
  }

  if ((moneyFlow?.event_count ?? 0) > 0) {
    const bucket = moneyFlow.dominant_bucket;
    const dir = (moneyFlow.signal ?? 0) >= 0 ? "buying" : "selling";
    const usd = moneyFlow.net_notional_usd > 0 ? ` ($${(moneyFlow.net_notional_usd / 1e6).toFixed(1)}M)` : "";
    parts.push(`${bucket} ${dir}${usd}`);
  }

  if (fundamental) {
    const regime = fundamental.regime_label?.replace(/_/g, " ") || "";
    const val = fundamental.valuation_label || "";
    if (regime) parts.push(`${regime}${val ? ` / ${val}` : ""} fundamentals`);
  }

  if (macroRegime?.regime && macroRegime.regime !== "neutral") {
    parts.push(`${macroRegime.regime.replace("_", "-")} macro`);
  }

  if (!parts.length) return `${action.replace("_", " ")} — insufficient strong evidence`;
  const joined = parts.join("; ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

function buildGuidance(action, sentiment, fundamental) {
  const fundamentalCtx = fundamental
    ? ` (${fundamental.regime_label?.replace(/_/g, " ") || "fundamentals"})`
    : "";
  const currentSentiment4h = round(sentiment?.windows?.["4h"] ?? 0.2, 2);

  if (action === "long") {
    return {
      entry: "On pullback with volume confirmation; confirm 1h sentiment stays positive",
      stop: `Invalidated if 1h sentiment drops below −0.2 or momentum_delta turns negative${fundamentalCtx}`,
      target: `Continuation toward recent highs if 4h sentiment holds above ${currentSentiment4h}`
    };
  }
  if (action === "short") {
    return {
      entry: "On bounce into resistance with volume confirmation; confirm 1h sentiment stays negative",
      stop: `Invalidated if 1h sentiment recovers above +0.2 or momentum_delta turns positive${fundamentalCtx}`,
      target: "Continuation toward recent lows if 4h sentiment stays negative"
    };
  }
  if (action === "watch") {
    return {
      entry: "Monitor for signal convergence; no entry until direction and conviction thresholds met",
      stop: "N/A — watching only",
      target: "Reassess when sentiment momentum stabilizes"
    };
  }
  return { entry: "N/A", stop: "N/A", target: "N/A" };
}

// --- Core export ---

export function generateTradeSetups(store, macroRegime) {
  const tickers = [...new Set(
    store.sentimentStates
      .filter((s) => s.entity_type === "ticker")
      .map((s) => s.entity_key)
  )];

  const now = new Date().toISOString();
  const ACTION_ORDER = { long: 0, short: 1, watch: 2, no_trade: 3 };

  const setups = tickers
    .filter((ticker) => hasMinimumEvidence(store, ticker))
    .map((ticker) => {
      const sentiment = assembleSentimentSignal(store, ticker);
      if (!sentiment) return null;

      const moneyFlow = assembleMoneyFlowSignal(store, ticker);
      const fundamental = assembleFundamentalSignal(store, ticker);
      const provisional = isProvisional(fundamental);

      const directionScore = computeDirectionScore(sentiment, moneyFlow, fundamental);
      const conviction = computeConviction(sentiment, moneyFlow, fundamental, macroRegime, provisional);
      const action = classifyAction(directionScore, conviction, macroRegime, moneyFlow.tape_only);
      const guidance = buildGuidance(action, sentiment, fundamental);

      return {
        setup_id: makeId(),
        generated_at: now,
        ticker,
        action,
        conviction,
        provisional,
        timeframe: deriveTimeframe(sentiment),
        position_size_guidance: positionSize(conviction),
        entry_guidance: guidance.entry,
        stop_guidance: guidance.stop,
        target_guidance: guidance.target,
        thesis: buildThesis(action, sentiment, moneyFlow, fundamental, macroRegime),
        risk_flags: buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action),
        evidence: {
          sentiment: {
            signal: sentiment.signal,
            confidence: sentiment.confidence,
            windows: sentiment.windows,
            momentum_delta: sentiment.momentum_delta
          },
          money_flow: {
            signal: moneyFlow.signal,
            confidence: moneyFlow.confidence,
            event_count: moneyFlow.event_count,
            dominant_bucket: moneyFlow.dominant_bucket,
            net_notional_usd: moneyFlow.net_notional_usd,
            alert_bonus: moneyFlow.alert_bonus
          },
          fundamentals: fundamental
            ? {
                signal: fundamental.signal,
                confidence: fundamental.confidence,
                direction_label: fundamental.direction_label,
                regime_label: fundamental.regime_label,
                composite_score: fundamental.composite_score,
                valuation_label: fundamental.valuation_label
              }
            : null
        },
        direction_score: directionScore,
        macro_regime: macroRegime
          ? { regime: macroRegime.regime, bias: macroRegime.bias, confidence: macroRegime.confidence }
          : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const orderDiff = (ACTION_ORDER[a.action] ?? 4) - (ACTION_ORDER[b.action] ?? 4);
      if (orderDiff !== 0) return orderDiff;
      if (a.provisional !== b.provisional) return a.provisional ? 1 : -1;
      return b.conviction - a.conviction;
    });

  return setups;
}

// --- Agent wiring ---

export function createTradeSetupAgent(app) {
  const { store } = app;
  let debounceTimer = null;
  let lastRegime = null;

  function run() {
    const macroRegime = computeMacroRegime(store);
    store.macroRegime = macroRegime;

    if (lastRegime !== macroRegime.regime) {
      lastRegime = macroRegime.regime;
      store.bus.emit("event", { type: "macro_regime_update", ...macroRegime });
    }

    const setups = generateTradeSetups(store, macroRegime);
    store.tradeSetups = setups;

    store.bus.emit("event", {
      type: "trade_setup_refresh",
      count: setups.length,
      long_count: setups.filter((s) => s.action === "long").length,
      short_count: setups.filter((s) => s.action === "short").length,
      watch_count: setups.filter((s) => s.action === "watch").length,
      as_of: new Date().toISOString()
    });
  }

  function onBusEvent() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 500);
  }

  return {
    start() {
      store.bus.on("event", onBusEvent);
    },
    stop() {
      store.bus.off("event", onBusEvent);
      clearTimeout(debounceTimer);
    }
  };
}
```

- [ ] **Step 3.4: Run tests**

```bash
node scripts/test-trade-setup.js
```

Expected: `trade-setup tests passed`

- [ ] **Step 3.5: Commit**

```bash
git add src/domain/trade-setup.js scripts/test-trade-setup.js
git commit -m "feat(trade-setup): add generateTradeSetups, signal assembly, and agent wiring"
```

---

## Task 4: Wire the agent into app.js

**Files:**
- Modify: `src/app.js`

- [ ] **Step 4.1: Add import at the top of `src/app.js`**

After the existing import block, add:

```js
import { createTradeSetupAgent } from "./domain/trade-setup.js";
```

- [ ] **Step 4.2: Instantiate the agent and add getter methods**

After the line `const secFundamentalsCollector = createSecFundamentalsCollector(app);` (near line 709), add:

```js
  const tradeSetupAgent = createTradeSetupAgent(app);
```

In the `app` object, after the `getMoneyFlowTickerDetail` method, add three new methods:

```js
    getMacroRegime() {
      return store.macroRegime;
    },
    getTradeSetups({ action = null, minConviction = null, provisional = null } = {}) {
      return store.tradeSetups
        .filter((s) => (action ? s.action === action : true))
        .filter((s) => (minConviction !== null ? s.conviction >= minConviction : true))
        .filter((s) => (provisional !== null ? s.provisional === provisional : true));
    },
    getTradeSetupDetail(ticker) {
      return store.tradeSetups.find((s) => s.ticker === ticker) || null;
    },
```

- [ ] **Step 4.3: Start and stop the agent with live sources**

In `app.startLiveSources`, add `tradeSetupAgent.start()` at the end of the `Promise.all` array (before `await marketFlowMonitor.start()`):

```js
      tradeSetupAgent.start(),
```

In `app.stopLiveSources`, add before the autosave timer clearing:

```js
    tradeSetupAgent.stop();
```

- [ ] **Step 4.4: Smoke-test the wiring**

```bash
node -e "
import('./src/app.js').then(async ({ createSentimentApp }) => {
  const app = createSentimentApp();
  await app.replay({ reset: true, intervalMs: 0 });
  await new Promise(r => setTimeout(r, 600));
  const regime = app.getMacroRegime();
  const setups = app.getTradeSetups();
  console.log('regime:', regime?.regime);
  console.log('setups:', setups.length);
  if (!regime) throw new Error('macroRegime is null after replay');
  console.log('wiring OK');
})
"
```

Expected output includes `regime: <some string>` and `setups: <number>` and `wiring OK`

- [ ] **Step 4.5: Commit**

```bash
git add src/app.js
git commit -m "feat(app): wire TradeSetupAgent, add getMacroRegime/getTradeSetups/getTradeSetupDetail"
```

---

## Task 5: Add API endpoints and update SSE

**Files:**
- Modify: `src/http/router.js`

- [ ] **Step 5.1: Add three new API routes**

In `src/http/router.js`, after the `/api/events/high-impact` route block (around line 195), add:

```js
  if (pathname === "/api/macro-regime" && request.method === "GET") {
    const regime = app.getMacroRegime();
    if (!regime) {
      response.writeHead(204);
      response.end();
      return;
    }
    sendJson(response, 200, regime);
    return;
  }

  if (pathname === "/api/trade-setups" && request.method === "GET") {
    const filters = {
      action: query.action || null,
      minConviction: query.minConviction ? Number(query.minConviction) : null,
      provisional: query.provisional !== undefined ? query.provisional === "true" : null
    };
    const setups = app.getTradeSetups(filters);
    sendJson(response, 200, {
      as_of: new Date().toISOString(),
      macro_regime: app.getMacroRegime(),
      count: setups.length,
      setups
    });
    return;
  }

  if (pathname?.startsWith("/api/trade-setups/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const setup = app.getTradeSetupDetail(ticker);
    if (!setup) {
      sendJson(response, 404, { error: `Trade setup for ${ticker} not found` });
      return;
    }
    sendJson(response, 200, setup);
    return;
  }
```

- [ ] **Step 5.2: Add macro_regime and trade_setups to the SSE initial snapshot**

Find the `sseWrite(response, { type: "snapshot", ...` call in the `/api/stream` handler and update it to:

```js
    sseWrite(response, {
      type: "snapshot",
      health: app.getHealth(),
      watchlist: app.getWatchlistSnapshot(app.config.defaultWindow),
      fundamentals: app.getFundamentalsSnapshot(),
      macro_regime: app.getMacroRegime(),
      trade_setups: app.getTradeSetups()
    });
```

- [ ] **Step 5.3: Verify endpoints respond**

```bash
node src/server.js &
sleep 2
curl -s http://127.0.0.1:3000/api/macro-regime | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).regime || '204'))"
curl -s http://127.0.0.1:3000/api/trade-setups | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const r=JSON.parse(d); console.log('count:', r.count); })"
kill %1
```

Expected: `regime` is a string, `count` is a number.

- [ ] **Step 5.4: Commit**

```bash
git add src/http/router.js
git commit -m "feat(router): add /api/macro-regime, /api/trade-setups, /api/trade-setups/ticker/:ticker; update SSE snapshot"
```

---

## Task 6: Frontend — HTML structure

**Files:**
- Modify: `src/public/index.html`

> **NOTE:** This task adds structural scaffolding only. Task 7 (app.js render logic) and Task 8 (styles.css) complete the UI. Before writing the final styles and render logic in Tasks 7–8, **invoke the `frontend-design` skill** to ensure production-grade design quality.

- [ ] **Step 6.1: Add "Setups" to the top nav**

Find the `<nav class="topnav"` block. After the `<a class="topnav-link" href="/fundamentals.html">Fundamentals</a>` line, add:

```html
          <button class="topnav-link" data-view="setups" type="button">Setups</button>
```

- [ ] **Step 6.2: Add "Setups" to the side nav**

Find the `<aside class="side-nav"` block. After the `<button class="side-link" data-view="alerts"` block, add:

```html
      <button class="side-link" data-view="setups" type="button">
        <span class="material-symbols-outlined">insights</span>
        <span>Setups</span>
      </button>
```

- [ ] **Step 6.3: Add the macro regime bar**

After the closing `</header>` tag, add:

```html
    <div class="macro-regime-bar" id="macro-regime-bar" data-regime="neutral">
      <span class="macro-regime-label" id="macro-regime-label">MACRO</span>
      <span class="macro-regime-badge" id="macro-regime-badge">—</span>
      <span class="macro-regime-breadth" id="macro-regime-breadth"></span>
      <span class="macro-regime-confidence" id="macro-regime-confidence"></span>
      <span class="macro-regime-staleness" id="macro-regime-staleness" hidden>STALE</span>
      <span class="macro-regime-updated" id="macro-regime-updated"></span>
    </div>
```

- [ ] **Step 6.4: Add the setups view panel**

Find the last `<div class="view" data-view-panel="system">` block and its closing `</div>`. After it, add:

```html
    <div class="view" data-view-panel="setups">
      <div class="setups-header">
        <div class="setups-summary" id="setups-summary">
          <!-- populated by app.js -->
        </div>
        <div class="setups-filters" id="setups-filters">
          <button class="setup-filter-btn active" data-filter="all" type="button">All</button>
          <button class="setup-filter-btn" data-filter="long" type="button">Long</button>
          <button class="setup-filter-btn" data-filter="short" type="button">Short</button>
          <button class="setup-filter-btn" data-filter="watch" type="button">Watch</button>
          <label class="setup-provisional-toggle">
            <input type="checkbox" id="setups-provisional-toggle"> Provisional only
          </label>
        </div>
      </div>
      <div class="setups-list" id="setups-list">
        <div class="setups-empty" id="setups-empty">No setups generated yet. Waiting for data.</div>
      </div>
      <div class="setup-drawer" id="setup-drawer" hidden>
        <button class="setup-drawer-close" id="setup-drawer-close" type="button" aria-label="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="setup-drawer-content" id="setup-drawer-content"></div>
      </div>
    </div>
```

- [ ] **Step 6.5: Commit**

```bash
git add src/public/index.html
git commit -m "feat(html): add Setups nav, macro regime bar, setups panel scaffold"
```

---

## Task 7: Frontend — app.js render and SSE

**Files:**
- Modify: `src/public/app.js`

> **REQUIRED:** Invoke the `frontend-design` skill before implementing the render functions in steps 7.3–7.6. The skill will guide the visual design of the setup cards and detail drawer. Complete steps 7.1–7.2 first (state + SSE wiring), then invoke the skill, then implement the render functions.

- [ ] **Step 7.1: Add state fields**

In the `const state = { ... }` object, add after `selectedSector: null`:

```js
  macroRegime: null,
  tradeSetups: [],
  setupFilter: "all",
  setupProvisionalOnly: false,
  selectedSetup: null
```

- [ ] **Step 7.2: Add element refs**

In the `const elements = { ... }` object, add:

```js
  macroRegimeBar: document.querySelector("#macro-regime-bar"),
  macroRegimeBadge: document.querySelector("#macro-regime-badge"),
  macroRegimeBreadth: document.querySelector("#macro-regime-breadth"),
  macroRegimeConfidence: document.querySelector("#macro-regime-confidence"),
  macroRegimeStaleness: document.querySelector("#macro-regime-staleness"),
  macroRegimeUpdated: document.querySelector("#macro-regime-updated"),
  setupsSummary: document.querySelector("#setups-summary"),
  setupsList: document.querySelector("#setups-list"),
  setupsEmpty: document.querySelector("#setups-empty"),
  setupDrawer: document.querySelector("#setup-drawer"),
  setupDrawerClose: document.querySelector("#setup-drawer-close"),
  setupDrawerContent: document.querySelector("#setup-drawer-content"),
  setupFilterBtns: [...document.querySelectorAll(".setup-filter-btn")],
  setupsProvisionalToggle: document.querySelector("#setups-provisional-toggle")
```

- [ ] **Step 7.3: Add SSE handlers for new event types**

Find the SSE `onmessage` handler (where `snapshot`, `sentiment_state_update`, etc. are handled). Add:

```js
        if (event.type === "snapshot") {
          // existing snapshot handling...
          if (event.macro_regime) {
            state.macroRegime = event.macro_regime;
            renderMacroRegimeBar();
          }
          if (event.trade_setups) {
            state.tradeSetups = event.trade_setups;
            renderSetups();
          }
        }

        if (event.type === "macro_regime_update") {
          state.macroRegime = event;
          renderMacroRegimeBar();
        }

        if (event.type === "trade_setup_refresh") {
          fetchTradeSetups();
        }
```

- [ ] **Step 7.4: Add fetchTradeSetups function**

```js
async function fetchTradeSetups() {
  try {
    const res = await fetch("/api/trade-setups");
    if (!res.ok) return;
    const data = await res.json();
    state.tradeSetups = data.setups || [];
    if (data.macro_regime) {
      state.macroRegime = data.macro_regime;
      renderMacroRegimeBar();
    }
    renderSetups();
  } catch {
    // silently ignore — SSE will retry
  }
}
```

- [ ] **Step 7.5: Implement renderMacroRegimeBar**

```js
function renderMacroRegimeBar() {
  const r = state.macroRegime;
  if (!r || !elements.macroRegimeBar) return;

  elements.macroRegimeBar.dataset.regime = r.regime;
  elements.macroRegimeBadge.textContent = r.regime.replace("_", "-").toUpperCase() + (r.bias === "bullish" ? " ▲" : r.bias === "bearish" ? " ▼" : "");
  elements.macroRegimeBreadth.textContent = `${r.breadth.bullish_sectors}/${r.breadth.bullish_sectors + r.breadth.bearish_sectors + r.breadth.neutral_sectors} sectors bullish`;
  elements.macroRegimeConfidence.textContent = `conf ${(r.confidence * 100).toFixed(0)}%`;

  const updatedAt = new Date(r.as_of);
  elements.macroRegimeUpdated.textContent = updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const staleMs = Date.now() - updatedAt.getTime();
  const isStale = staleMs > 30 * 60 * 1000;
  elements.macroRegimeStaleness.hidden = !isStale;
  elements.macroRegimeBar.classList.toggle("is-stale", isStale);
}
```

- [ ] **Step 7.6: Implement renderSetups and renderSetupCard**

> **At this point, invoke the `frontend-design` skill** for the card and drawer visual design, then implement using the skill's guidance.

```js
function getFilteredSetups() {
  return state.tradeSetups.filter((s) => {
    if (state.setupFilter !== "all" && s.action !== state.setupFilter) return false;
    if (state.setupProvisionalOnly && !s.provisional) return false;
    return true;
  });
}

function renderSetups() {
  const setups = getFilteredSetups();

  // Summary row
  const counts = { long: 0, short: 0, watch: 0, no_trade: 0 };
  for (const s of state.tradeSetups) counts[s.action] = (counts[s.action] || 0) + 1;
  elements.setupsSummary.innerHTML = `
    <span class="setup-count long">${counts.long} LONG</span>
    <span class="setup-count short">${counts.short} SHORT</span>
    <span class="setup-count watch">${counts.watch} WATCH</span>
    <span class="setup-count no-trade">${counts.no_trade} NO TRADE</span>
  `;

  if (!setups.length) {
    elements.setupsList.innerHTML = "";
    elements.setupsEmpty.hidden = false;
    return;
  }

  elements.setupsEmpty.hidden = true;
  elements.setupsList.innerHTML = setups.map((s) => renderSetupCard(s)).join("");

  elements.setupsList.querySelectorAll(".setup-card").forEach((card) => {
    card.addEventListener("click", () => {
      const ticker = card.dataset.ticker;
      state.selectedSetup = state.tradeSetups.find((s) => s.ticker === ticker) || null;
      renderSetupDrawer();
    });
  });
}

function convictionDots(conviction) {
  const filled = Math.round(conviction * 5);
  return Array.from({ length: 5 }, (_, i) => `<span class="conviction-dot ${i < filled ? "filled" : ""}"></span>`).join("");
}

function renderSetupCard(s) {
  const provisional = s.provisional
    ? `<span class="setup-provisional-badge">PROVISIONAL · bootstrap fundamentals</span>`
    : "";
  const flags = s.risk_flags.length
    ? `<div class="setup-risk-flags">${s.risk_flags.map((f) => `<span class="risk-flag">${f.replace(/_/g, " ")}</span>`).join("")}</div>`
    : "";
  const sentimentPct = Math.round(((s.evidence.sentiment.signal + 1) / 2) * 100);
  const mfPct = Math.round(((s.evidence.money_flow.signal + 1) / 2) * 100);
  const fundPct = s.evidence.fundamentals ? Math.round(((s.evidence.fundamentals.signal + 1) / 2) * 100) : 50;

  return `
    <div class="setup-card action-${s.action} ${s.provisional ? "provisional" : ""}" data-ticker="${s.ticker}">
      <div class="setup-card-header">
        <div class="setup-ticker-block">
          <span class="setup-ticker">${s.ticker}</span>
          <span class="setup-timeframe">${s.timeframe}</span>
        </div>
        <div class="setup-action-block">
          <span class="setup-action-badge action-${s.action}">${s.action.replace("_", " ").toUpperCase()}</span>
          <div class="setup-conviction-meter">${convictionDots(s.conviction)}</div>
          <span class="setup-conviction-value">${(s.conviction * 100).toFixed(0)}</span>
        </div>
      </div>
      ${provisional}
      <div class="setup-regime-tags">
        ${s.evidence.fundamentals ? `<span class="setup-tag">${s.evidence.fundamentals.regime_label?.replace(/_/g, " ") || ""}</span>` : ""}
        ${s.evidence.fundamentals ? `<span class="setup-tag">${s.evidence.fundamentals.valuation_label || ""}</span>` : ""}
        ${s.macro_regime ? `<span class="setup-tag macro">${s.macro_regime.regime.replace("_", "-")} macro</span>` : ""}
      </div>
      <div class="setup-thesis">${s.thesis}</div>
      <div class="setup-evidence-bars">
        <div class="evidence-bar-row">
          <span class="evidence-label">Sentiment</span>
          <div class="evidence-bar-track"><div class="evidence-bar-fill" style="width:${sentimentPct}%"></div></div>
          <span class="evidence-value">${s.evidence.sentiment.signal >= 0 ? "+" : ""}${s.evidence.sentiment.signal.toFixed(2)}</span>
        </div>
        <div class="evidence-bar-row">
          <span class="evidence-label">Money Flow</span>
          <div class="evidence-bar-track"><div class="evidence-bar-fill" style="width:${mfPct}%"></div></div>
          <span class="evidence-value">${s.evidence.money_flow.signal >= 0 ? "+" : ""}${s.evidence.money_flow.signal.toFixed(2)}</span>
        </div>
        <div class="evidence-bar-row">
          <span class="evidence-label">Fundamentals</span>
          <div class="evidence-bar-track"><div class="evidence-bar-fill ${!s.evidence.fundamentals ? "provisional" : ""}" style="width:${fundPct}%"></div></div>
          <span class="evidence-value">${s.evidence.fundamentals ? (s.evidence.fundamentals.signal >= 0 ? "+" : "") + s.evidence.fundamentals.signal.toFixed(2) : "—"}</span>
        </div>
      </div>
      <div class="setup-guidance-row">
        <div class="guidance-item"><span class="guidance-label">ENTRY</span><span class="guidance-text">${s.entry_guidance}</span></div>
        <div class="guidance-item"><span class="guidance-label">STOP</span><span class="guidance-text">${s.stop_guidance}</span></div>
        <div class="guidance-item size"><span class="guidance-label">SIZE</span><span class="guidance-text size-${s.position_size_guidance}">${s.position_size_guidance.toUpperCase()} position</span></div>
      </div>
      ${flags}
    </div>
  `;
}

function renderSetupDrawer() {
  const s = state.selectedSetup;
  if (!s || !elements.setupDrawer) return;

  elements.setupDrawerContent.innerHTML = `
    <div class="drawer-header">
      <span class="drawer-ticker">${s.ticker}</span>
      <span class="setup-action-badge action-${s.action}">${s.action.replace("_", " ").toUpperCase()}</span>
      ${s.provisional ? `<span class="setup-provisional-badge">PROVISIONAL</span>` : ""}
    </div>
    <div class="drawer-section">
      <div class="drawer-label">THESIS</div>
      <div class="drawer-text">${s.thesis}</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">CONVICTION</div>
      <div class="drawer-conviction">
        ${convictionDots(s.conviction)}
        <span>${(s.conviction * 100).toFixed(0)} / 100</span>
      </div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">EVIDENCE</div>
      <table class="drawer-evidence-table">
        <tr><td>Sentiment</td><td>${s.evidence.sentiment.signal >= 0 ? "+" : ""}${s.evidence.sentiment.signal.toFixed(3)}</td><td>conf ${(s.evidence.sentiment.confidence * 100).toFixed(0)}%</td><td>Δ ${s.evidence.sentiment.momentum_delta >= 0 ? "+" : ""}${s.evidence.sentiment.momentum_delta.toFixed(3)}</td></tr>
        <tr><td>Money Flow</td><td>${s.evidence.money_flow.signal >= 0 ? "+" : ""}${s.evidence.money_flow.signal.toFixed(3)}</td><td>${s.evidence.money_flow.event_count} events</td><td>${s.evidence.money_flow.dominant_bucket}</td></tr>
        ${s.evidence.fundamentals ? `<tr><td>Fundamentals</td><td>${s.evidence.fundamentals.signal >= 0 ? "+" : ""}${s.evidence.fundamentals.signal.toFixed(3)}</td><td>${s.evidence.fundamentals.direction_label}</td><td>${s.evidence.fundamentals.regime_label}</td></tr>` : "<tr><td>Fundamentals</td><td colspan='3'>provisional / missing</td></tr>"}
        ${s.macro_regime ? `<tr><td>Macro</td><td>${s.macro_regime.regime}</td><td>${s.macro_regime.bias}</td><td>conf ${(s.macro_regime.confidence * 100).toFixed(0)}%</td></tr>` : ""}
      </table>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">GUIDANCE</div>
      <div class="drawer-guidance"><strong>Entry:</strong> ${s.entry_guidance}</div>
      <div class="drawer-guidance"><strong>Stop:</strong> ${s.stop_guidance}</div>
      <div class="drawer-guidance"><strong>Target:</strong> ${s.target_guidance}</div>
      <div class="drawer-guidance"><strong>Size:</strong> ${s.position_size_guidance.toUpperCase()} (conviction ${(s.conviction * 100).toFixed(0)})</div>
    </div>
    ${s.risk_flags.length ? `
    <div class="drawer-section">
      <div class="drawer-label">RISK FLAGS</div>
      <div class="drawer-flags">${s.risk_flags.map((f) => `<span class="risk-flag">${f.replace(/_/g, " ")}</span>`).join("")}</div>
    </div>` : ""}
  `;

  elements.setupDrawer.hidden = false;
}
```

- [ ] **Step 7.7: Wire filter buttons and provisional toggle**

Add event listeners after the existing listener wiring (near the bottom of app.js where button listeners are attached):

```js
elements.setupFilterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    elements.setupFilterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.setupFilter = btn.dataset.filter;
    renderSetups();
  });
});

if (elements.setupsProvisionalToggle) {
  elements.setupsProvisionalToggle.addEventListener("change", (e) => {
    state.setupProvisionalOnly = e.target.checked;
    renderSetups();
  });
}

if (elements.setupDrawerClose) {
  elements.setupDrawerClose.addEventListener("click", () => {
    elements.setupDrawer.hidden = true;
    state.selectedSetup = null;
  });
}
```

- [ ] **Step 7.8: Call fetchTradeSetups on initial load**

Find where the app initializes (typically after SSE connection is established or on DOMContentLoaded). Add:

```js
fetchTradeSetups();
```

- [ ] **Step 7.9: Commit**

```bash
git add src/public/app.js
git commit -m "feat(frontend): add setups panel state, SSE handlers, fetch, and render logic"
```

---

## Task 8: Frontend — styles

**Files:**
- Modify: `src/public/styles.css`

> **REQUIRED:** Invoke the `frontend-design` skill here. Show it the setup card HTML from Task 7.6, the macro regime bar from Task 6.3, and the drawer HTML from Task 7.6. Ask it to design production-grade, non-generic styles for: macro regime bar (color-coded by regime), setup card (action-colored left border, conviction meter dots, evidence bars, provisional amber treatment), and detail drawer. Implement the styles it produces.

At minimum the following rules must be present. The frontend-design skill should enrich and replace these stubs with production-quality implementations:

```css
/* Macro regime bar */
.macro-regime-bar { display: flex; align-items: center; gap: 12px; padding: 6px 20px; font-size: 12px; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06); }
.macro-regime-bar[data-regime="risk_on"] { background: rgba(34,197,94,0.08); color: #4ade80; }
.macro-regime-bar[data-regime="risk_off"] { background: rgba(239,68,68,0.08); color: #f87171; }
.macro-regime-bar[data-regime="mixed"] { background: rgba(251,191,36,0.08); color: #fbbf24; }
.macro-regime-bar[data-regime="neutral"] { background: rgba(148,163,184,0.06); color: #94a3b8; }
.macro-regime-bar.is-stale { opacity: 0.5; }
.macro-regime-staleness { color: #f87171; font-size: 10px; }

/* Setup cards */
.setups-list { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.setup-card { border-radius: 10px; padding: 16px; background: rgba(255,255,255,0.04); border-left: 3px solid transparent; cursor: pointer; transition: background 0.15s; }
.setup-card:hover { background: rgba(255,255,255,0.07); }
.setup-card.action-long { border-left-color: #4ade80; }
.setup-card.action-short { border-left-color: #f87171; }
.setup-card.action-watch { border-left-color: #fbbf24; }
.setup-card.action-no_trade { border-left-color: #475569; }
.setup-card.provisional { border-left-color: #fb923c; }

/* Action badges */
.setup-action-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.05em; }
.setup-action-badge.action-long { background: rgba(74,222,128,0.15); color: #4ade80; }
.setup-action-badge.action-short { background: rgba(248,113,113,0.15); color: #f87171; }
.setup-action-badge.action-watch { background: rgba(251,191,36,0.15); color: #fbbf24; }
.setup-action-badge.action-no_trade { background: rgba(71,85,105,0.15); color: #94a3b8; }

/* Conviction meter */
.setup-conviction-meter { display: flex; gap: 3px; }
.conviction-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.15); }
.conviction-dot.filled { background: #60a5fa; }

/* Evidence bars */
.setup-evidence-bars { margin: 10px 0; display: flex; flex-direction: column; gap: 5px; }
.evidence-bar-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.evidence-label { width: 80px; color: #94a3b8; }
.evidence-bar-track { flex: 1; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
.evidence-bar-fill { height: 100%; background: #60a5fa; border-radius: 2px; transition: width 0.3s; }
.evidence-bar-fill.provisional { background: #fb923c; }
.evidence-value { width: 40px; text-align: right; font-size: 11px; color: #e2e8f0; }

/* Provisional badge */
.setup-provisional-badge { font-size: 10px; font-weight: 600; color: #fb923c; background: rgba(251,146,60,0.1); padding: 2px 6px; border-radius: 3px; }

/* Risk flags */
.setup-risk-flags { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
.risk-flag { font-size: 10px; color: #f87171; background: rgba(248,113,113,0.1); padding: 2px 6px; border-radius: 3px; }

/* Guidance */
.setup-guidance-row { font-size: 11px; color: #94a3b8; margin-top: 10px; display: flex; flex-direction: column; gap: 3px; }
.guidance-label { font-weight: 600; color: #64748b; width: 45px; display: inline-block; }
.guidance-text.size-full { color: #4ade80; }
.guidance-text.size-half { color: #60a5fa; }
.guidance-text.size-quarter { color: #fbbf24; }
.guidance-text.size-starter { color: #94a3b8; }

/* Summary counts */
.setups-summary { display: flex; gap: 16px; padding: 12px 16px; }
.setup-count { font-size: 12px; font-weight: 700; }
.setup-count.long { color: #4ade80; }
.setup-count.short { color: #f87171; }
.setup-count.watch { color: #fbbf24; }
.setup-count.no-trade { color: #475569; }

/* Filter buttons */
.setups-filters { display: flex; gap: 8px; padding: 0 16px 12px; align-items: center; flex-wrap: wrap; }
.setup-filter-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; padding: 4px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
.setup-filter-btn.active { background: rgba(96,165,250,0.15); border-color: #60a5fa; color: #60a5fa; }
.setup-provisional-toggle { font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 4px; cursor: pointer; }

/* Drawer */
.setup-drawer { position: fixed; right: 0; top: 0; height: 100%; width: 420px; max-width: 95vw; background: #0f172a; border-left: 1px solid rgba(255,255,255,0.1); overflow-y: auto; z-index: 100; padding: 24px; box-shadow: -8px 0 32px rgba(0,0,0,0.4); }
.setup-drawer-close { position: absolute; top: 16px; right: 16px; background: none; border: none; color: #94a3b8; cursor: pointer; }
.drawer-label { font-size: 10px; font-weight: 700; color: #475569; letter-spacing: 0.1em; margin-bottom: 6px; }
.drawer-section { margin-bottom: 20px; }
.drawer-evidence-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.drawer-evidence-table td { padding: 4px 8px 4px 0; color: #94a3b8; }
.drawer-evidence-table td:first-child { color: #e2e8f0; font-weight: 500; }
.drawer-guidance { font-size: 12px; color: #94a3b8; margin-bottom: 4px; line-height: 1.5; }
.drawer-flags { display: flex; flex-wrap: wrap; gap: 4px; }
.drawer-conviction { display: flex; align-items: center; gap: 8px; font-size: 14px; }
```

- [ ] **Step 8.1: Commit**

```bash
git add src/public/styles.css
git commit -m "feat(styles): add macro regime bar, setup card, conviction meter, provisional badge, and drawer styles"
```

---

## Task 9: Update check.js smoke tests

**Files:**
- Modify: `scripts/check.js`

- [ ] **Step 9.1: Add trade setup assertions at the end of check.js**

After the `const fundamentalDetail = ...` block and before the final `console.log`, add:

```js
await new Promise(r => setTimeout(r, 600)); // allow debounced agent to fire

const macroRegime = app.getMacroRegime();
const tradeSetups = app.getTradeSetups();
const longSetups = app.getTradeSetups({ action: "long" });
const provisionalSetups = app.getTradeSetups({ provisional: true });

if (!macroRegime || typeof macroRegime.regime !== "string") {
  throw new Error("macroRegime is missing or has no regime after replay.");
}

if (!Array.isArray(tradeSetups)) {
  throw new Error("getTradeSetups() did not return an array.");
}

// Validate shape of first setup if any exist
const firstSetup = tradeSetups[0];
if (firstSetup) {
  for (const key of ["setup_id", "ticker", "action", "conviction", "provisional",
    "thesis", "risk_flags", "evidence", "direction_score"]) {
    if (!(key in firstSetup)) throw new Error(`Trade setup missing field: ${key}`);
  }
  if (!["long", "short", "watch", "no_trade"].includes(firstSetup.action)) {
    throw new Error(`Invalid action: ${firstSetup.action}`);
  }
  if (firstSetup.conviction < 0 || firstSetup.conviction > 1) {
    throw new Error(`Conviction out of range: ${firstSetup.conviction}`);
  }
}

// Provisional setups must have conviction ≤ 0.55
for (const s of provisionalSetups) {
  if (s.conviction > 0.55) {
    throw new Error(`Provisional setup ${s.ticker} has conviction ${s.conviction} > 0.55`);
  }
}

// Long setups must have positive direction score
for (const s of longSetups) {
  if (s.direction_score <= 0) {
    throw new Error(`Long setup ${s.ticker} has non-positive direction_score ${s.direction_score}`);
  }
}
```

- [ ] **Step 9.2: Add the new fields to the console.log output**

In the final `console.log` object, add:

```js
      macro_regime: macroRegime?.regime,
      trade_setups_total: tradeSetups.length,
      trade_setups_long: longSetups.length,
      trade_setups_provisional: provisionalSetups.length,
```

- [ ] **Step 9.3: Run the full check suite**

```bash
node scripts/check.js
```

Expected: JSON output containing `macro_regime`, `trade_setups_total`, `trade_setups_long`, `trade_setups_provisional` fields. No thrown errors.

- [ ] **Step 9.4: Commit**

```bash
git add scripts/check.js
git commit -m "test(check): add macro regime and trade setup assertions to smoke suite"
```

---

## Task 10: Update OpenAPI and README

**Files:**
- Modify: `openapi/openapi.yaml`
- Modify: `README.md`

- [ ] **Step 10.1: Add the three new paths to openapi.yaml**

After the `/api/events/high-impact` path block, add:

```yaml
  /api/macro-regime:
    get:
      summary: Current macro regime snapshot derived from market and sector sentiment states.
      responses:
        "200":
          description: Macro regime snapshot.
          content:
            application/json:
              schema:
                type: object
                properties:
                  regime:
                    type: string
                    enum: [risk_on, risk_off, neutral, mixed]
                  confidence:
                    type: number
                  bias:
                    type: string
                    enum: [bullish, bearish, neutral]
                  breadth:
                    type: object
                  market_sentiment_1h:
                    type: number
                  market_sentiment_1d:
                    type: number
                  momentum_delta:
                    type: number
                  signals_used:
                    type: array
                    items:
                      type: string
                  explanation:
                    type: string
        "204":
          description: Macro regime not yet computed (server just started).
  /api/trade-setups:
    get:
      summary: Trade setup decisions combining sentiment, money flow, fundamentals, and macro regime.
      parameters:
        - in: query
          name: action
          schema:
            type: string
            enum: [long, short, watch, no_trade]
        - in: query
          name: minConviction
          schema:
            type: number
            minimum: 0
            maximum: 1
        - in: query
          name: provisional
          schema:
            type: boolean
      responses:
        "200":
          description: Trade setup list with macro regime context.
          content:
            application/json:
              schema:
                type: object
                properties:
                  as_of:
                    type: string
                    format: date-time
                  macro_regime:
                    type: object
                  count:
                    type: integer
                  setups:
                    type: array
                    items:
                      type: object
  /api/trade-setups/ticker/{ticker}:
    get:
      summary: Trade setup detail for a single ticker.
      parameters:
        - in: path
          name: ticker
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Single trade setup object.
        "404":
          description: No setup found for this ticker.
```

- [ ] **Step 10.2: Update README.md**

Find the "Current runtime notes" bullet list and add:

```markdown
- The system includes a Trade Setup Agent (decision layer) that combines sentiment, money flow, fundamentals, and macro regime into explainable `long / short / watch / no_trade` setups available at `/api/trade-setups`.
- A macro regime snapshot (derived from market and sector sentiment states) is available at `/api/macro-regime`.
```

- [ ] **Step 10.3: Commit**

```bash
git add openapi/openapi.yaml README.md
git commit -m "docs: document /api/macro-regime and /api/trade-setups in openapi and README"
```

---

## Task 11: End-to-end smoke test

- [ ] **Step 11.1: Run the full check suite**

```bash
node scripts/check.js
```

Expected: No errors. Output JSON includes `macro_regime`, `trade_setups_total`.

- [ ] **Step 11.2: Start the server and verify endpoints**

```bash
node src/server.js &
sleep 3
curl -s http://127.0.0.1:3000/api/macro-regime
curl -s "http://127.0.0.1:3000/api/trade-setups?action=long"
curl -s "http://127.0.0.1:3000/api/trade-setups?minConviction=0.4"
kill %1
```

Expected: Valid JSON from each endpoint. `/api/macro-regime` has a `regime` field. `/api/trade-setups` has `count` and `setups` array.

- [ ] **Step 11.3: Verify SSE stream includes new fields**

```bash
node src/server.js &
sleep 3
curl -sN --max-time 5 http://127.0.0.1:3000/api/stream | head -20
kill %1
```

Expected: SSE stream includes `"macro_regime"` and `"trade_setups"` keys in the initial `snapshot` event.

- [ ] **Step 11.4: Open browser and verify Setups panel renders**

Start server and open `http://127.0.0.1:3000`. Navigate to the Setups view. Verify:
- Macro regime bar is visible and color-coded under the topbar
- Setups panel shows summary counts
- At least one setup card renders with action badge, conviction dots, evidence bars
- Clicking a card opens the detail drawer
- Provisional setups show the amber badge

- [ ] **Step 11.5: Final commit**

```bash
git add .
git commit -m "feat: Trade Setup Agent — macro regime, setups generation, API, and dashboard integration"
```

---

## Deployment to Raspberry Pi

After all tasks pass locally:

```bash
# On the Pi
git pull
sudo systemctl restart sentiment-analyst

# Verify
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/macro-regime
curl http://127.0.0.1:3000/api/trade-setups
```

**No `npm install` required** — zero new dependencies added.

---

## Self-review notes

**Spec coverage verified:**
- ✅ `long/short/watch/no_trade` classification with conviction
- ✅ Provisional cap (0.55) for bootstrap fundamentals
- ✅ Macro regime standalone + embedded in setups
- ✅ Three new API endpoints
- ✅ SSE push via `macro_regime_update` and `trade_setup_refresh`
- ✅ Sentiment + money flow + fundamentals all feed direction score
- ✅ Source quality weighting (insider > institutional > tape)
- ✅ Alert history wired into money flow signal
- ✅ Tape-only cap at `watch`
- ✅ Macro regime as threshold modifier (not double-counted in direction score)
- ✅ `momentum_delta` affects conviction
- ✅ Risk flags generated deterministically
- ✅ `thesis` is deterministic template (no LLM)
- ✅ `position_size_guidance` from conviction
- ✅ `timeframe` derived from dominant window
- ✅ Evidence gate (doc_count ≥ 2 + recent doc within 48h)
- ✅ Persistence via existing autosave (no new persistence code)
- ✅ Frontend: macro regime bar + setups panel + cards + drawer
- ✅ `frontend-design` skill invocation noted at Task 7.6 and Task 8
- ✅ OpenAPI documented
- ✅ README updated
- ✅ `scripts/check.js` extended with assertions

**Type consistency verified:** `computeMacroRegime`, `generateTradeSetups`, `createTradeSetupAgent` are consistently named across all tasks. `getMacroRegime`, `getTradeSetups`, `getTradeSetupDetail` are consistent between app.js (Task 4) and router.js (Task 5).
