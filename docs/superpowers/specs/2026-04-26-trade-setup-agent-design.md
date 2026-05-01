# Trade Setup Agent — Design Spec

**Date:** 2026-04-26  
**Status:** Approved — ready for implementation planning  
**Author:** Claude Code (brainstorming session)

---

## 1. Purpose

Add a decision layer that combines sentiment states, money flow, fundamentals, and macro regime into explainable, auditable trade setup decisions for the stocks covered by the system (QQQ components + S&P 100).

The agent outputs one of four actions per ticker: `long`, `short`, `watch`, `no_trade`. Each setup is explainable — a human can read it and understand exactly why the setup exists and what would invalidate it.

---

## 2. Architecture position

```
Ingestion layer
  live-news, market-flow, sec-insider, sec-institutional, sec-fundamentals
        │
        ▼
Scoring / state layer
  pipeline.js  →  store.sentimentStates, store.documentScores, store.alertHistory
  fundamentals.js  →  store.fundamentals.byTicker / bySector
        │
        │  store.bus events: "snapshot", "fundamental_score_update"
        ▼
Decision layer  ← NEW
  src/domain/macro-regime.js   (pure function)
  src/domain/trade-setup.js    (event-driven agent, debounced 500ms)
        │
        ▼
Presentation layer
  /api/macro-regime
  /api/trade-setups
  /api/trade-setups/ticker/:ticker
  SSE stream  ← "macro_regime_update", "trade_setup_refresh"
  Sentiment dashboard  ← new "Setups" panel
```

The decision layer reads from the store and writes back to it. It does not call any external services and does not modify any upstream state.

---

## 3. New files

| File | Role |
|---|---|
| `src/domain/macro-regime.js` | Pure function: reads store, returns regime snapshot |
| `src/domain/trade-setup.js` | Event-driven agent: debounced, reads store, writes `store.macroRegime` and `store.tradeSetups`, emits bus events |

---

## 4. Modified files

| File | Change |
|---|---|
| `src/domain/store.js` | Add `macroRegime: null` and `tradeSetups: []` to `createStore` and `resetStore` |
| `src/app.js` | Instantiate `createTradeSetupAgent(app)`, add `getMacroRegime()`, `getTradeSetups(filters)`, `getTradeSetupDetail(ticker)` |
| `src/http/router.js` | Add three new endpoints; add `macro_regime` and `trade_setups` to SSE initial snapshot |
| `src/public/index.html` | Add "Setups" to top nav and side nav; add macro regime bar; add setups view panel |
| `src/public/app.js` | Add state fields, SSE handlers, fetch logic, render functions for setups panel |
| `src/public/styles.css` | Add styles for macro regime bar, setup cards, provisional badge, conviction meter |
| `openapi/openapi.yaml` | Document three new endpoints |
| `README.md` | Note the new decision layer and endpoints |

---

## 5. Macro regime module (`src/domain/macro-regime.js`)

### Inputs (read from store)

- `store.sentimentStates` where `entity_type === "market"` and `entity_key === "market"` — market-wide aggregate across all windows
- `store.sentimentStates` where `entity_type === "sector"` — sector-level states for breadth scoring
- `store.alertHistory` — system-level smart money alerts

### Computation

1. Read market-level sentiment for the 1h and 1d windows.
2. Count sectors with `weighted_sentiment > 0.1` (bullish), `< -0.1` (bearish), else neutral.
3. Compute `breadth_score = bullish_sectors / total_sectors_with_data`.
4. Classify regime:

| Condition | Regime |
|---|---|
| market 1h sentiment ≥ 0.25 AND breadth_score ≥ 0.6 | `risk_on` |
| market 1h sentiment ≤ −0.25 AND breadth_score ≤ 0.4 | `risk_off` |
| \|market 1h sentiment\| < 0.1 AND breadth diverges | `mixed` |
| insufficient data (< 5 sectors or < 20 doc_count total) | `neutral` |

5. `confidence` scales with: number of sectors scored, market state `weighted_confidence`, alert corroboration.
6. `bias` = `"bullish"` if regime is `risk_on`, `"bearish"` if `risk_off`, else `"neutral"`.

### Output shape

```js
{
  as_of: "ISO timestamp",
  regime: "risk_on" | "risk_off" | "neutral" | "mixed",
  confidence: 0.0–1.0,
  bias: "bullish" | "bearish" | "neutral",
  breadth: {
    bullish_sectors: number,
    bearish_sectors: number,
    neutral_sectors: number,
    breadth_score: number
  },
  market_sentiment_1h: number,
  market_sentiment_1d: number,
  momentum_delta: number,
  signals_used: string[],
  explanation: string
}
```

Stored at `store.macroRegime`. A `macro_regime_update` bus event is emitted when `regime` label changes.

---

## 6. Trade setup agent (`src/domain/trade-setup.js`)

### Trigger

Subscribes to `store.bus` events `"snapshot"` and `"fundamental_score_update"`. Debounced at 500ms. Called by `createTradeSetupAgent(app)` factory, started/stopped with live sources.

### Minimum evidence gate

A ticker is skipped (produces no setup) unless:
- At least one sentiment state exists with `doc_count ≥ 2`
- At least one scored document exists for the ticker within the last 48 hours

Tickers with no evidence produce no entry in `store.tradeSetups` — they are not stored as `no_trade`.

### Signal assembly (per ticker)

**Sentiment signal** (`[-1, +1]`)
- Weighted average of 1h (0.5×), 4h (0.3×), 1d (0.2×) `weighted_sentiment`
- `sentiment_confidence` = average of those windows' `weighted_confidence`

**Money flow signal** (`[-1, +1]`)
- Collect money-flow document scores for the ticker (event types: `insider_buy`, `insider_sell`, `activist_stake`, `institutional_buying`, `institutional_selling`, `block_trade_buying`, `block_trade_selling`, `abnormal_volume_buying`, `abnormal_volume_selling`)
- Apply source quality weights: insider 1.0×, institutional 0.9×, tape 0.6×
- Net signed sum of `sentiment_score × impact_score × final_confidence × source_weight`, clamped `[-1, +1]`
- Smart money alert bonus: `smart_money_accumulation` / `smart_money_stacking_positive` adds +0.15; `smart_money_distribution` / `smart_money_stacking_negative` subtracts 0.15 (capped at ±0.3 total from alerts)
- `money_flow_confidence` = average `final_confidence` of contributing events

**Fundamental signal** (`[-1, +1]`)
- `direction_label → numeric`: `bullish_supportive` = +0.8, `neutral` = 0, `bearish_headwind` = −0.8
- Multiply by `fundamentals.final_confidence`
- `fundamental_confidence` = `fundamentals.final_confidence`

### Provisional flag

A setup is `provisional: true` if:
- `fundamentals.data_freshness_score < 0.8`, or
- `fundamentals.market_reference?.live !== true`, or
- No fundamentals entry exists for the ticker

Provisional setups receive a hard conviction cap of `0.55`.

### Direction score

Macro is removed from the direction score (avoids double-counting with threshold modifiers):

```
direction = sentiment_signal × 0.45
          + money_flow_signal × 0.30
          + fundamental_signal × 0.25
```

### Conviction score

```
conviction_raw = sentiment_confidence × 0.35
               + money_flow_confidence × 0.25
               + fundamental_confidence × 0.25
               + macroRegime.confidence × 0.15
```

Momentum adjustment: if 1h `momentum_delta > 0`, add +0.08; if `< 0`, subtract 0.08.  
Cap provisional setups at 0.55.

### Action classification

Base thresholds:
- `long`: direction ≥ 0.30 AND conviction ≥ 0.45
- `short`: direction ≤ −0.30 AND conviction ≥ 0.45
- `watch`: |direction| ≥ 0.15 OR conviction ≥ 0.35
- `no_trade`: otherwise

Macro regime threshold modifiers:

| Macro regime | Long threshold | Short threshold |
|---|---|---|
| `risk_on` | 0.25 | −0.35 |
| `risk_off` | 0.40 | −0.25 |
| `mixed` / `neutral` | 0.30 | −0.30 |

Tape-only rule: if money_flow_confidence > 0 but all money flow events are tape-type (no insider or institutional), the action is capped at `watch` regardless of score.

### Position size guidance

Derived from conviction:

| Conviction | Size guidance |
|---|---|
| ≥ 0.70 | `full` |
| 0.55–0.69 | `half` |
| 0.40–0.54 | `quarter` |
| < 0.40 (watch) | `starter` |

### Timeframe

Derived from the dominant contributing sentiment window:
- 15m or 1h dominant → `intraday`
- 4h or 1d dominant → `1d–4d swing`
- 7d dominant → `positional`

### Risk flags

Generated deterministically from signal data:

| Flag | Condition |
|---|---|
| `provisional_fundamentals` | `provisional === true` |
| `low_macro_confidence` | `macroRegime.confidence < 0.4` |
| `macro_headwind` | macro bias opposes setup direction |
| `tape_only_flow` | money flow is tape-only (no insider/institutional) |
| `high_event_concentration` | sentiment state `event_concentration > 0.6` |
| `low_story_diversity` | sentiment state `source_diversity < 0.3` |
| `deteriorating_sentiment` | `momentum_delta < -0.15` |
| `weak_fundamentals` | `direction_label === "bearish_headwind"` |
| `sector_headwind` | sector `direction_label` opposes setup direction |

### Thesis string

Deterministic template combining top signals. Example:
> "Bullish 1h/4h sentiment with institutional buying ($12.4M) and strong fundamentals (compounder, cheap valuation) in a risk-on macro environment."

### Output shape per setup

```js
{
  setup_id: string,
  generated_at: "ISO timestamp",
  ticker: string,
  action: "long" | "short" | "watch" | "no_trade",
  conviction: number,
  provisional: boolean,
  timeframe: "intraday" | "1d–4d swing" | "positional",
  position_size_guidance: "full" | "half" | "quarter" | "starter",
  entry_guidance: string,
  stop_guidance: string,
  target_guidance: string,
  thesis: string,
  risk_flags: string[],
  evidence: {
    sentiment: {
      signal: number,
      confidence: number,
      windows: { "1h": number, "4h": number, "1d": number },
      momentum_delta: number
    },
    money_flow: {
      signal: number,
      confidence: number,
      event_count: number,
      dominant_bucket: "insider" | "institutional" | "tape" | "none",
      net_notional_usd: number,
      alert_bonus: number
    },
    fundamentals: {
      signal: number,
      confidence: number,
      direction_label: string,
      regime_label: string,
      composite_score: number,
      valuation_label: string
    }
  },
  direction_score: number,
  macro_regime: {
    regime: string,
    bias: string,
    confidence: number
  }
}
```

---

## 7. Store changes

`createStore` and `resetStore` in `src/domain/store.js`:

```js
macroRegime: null,   // populated after first agent run
tradeSetups: []      // replaced in full on each run
```

Both are included in the existing `saveStoreSnapshot` / `hydrateStore` cycle at no extra cost.

---

## 8. App wiring

`createTradeSetupAgent(app)` is instantiated in `app.js` after the store is ready (same pattern as `createSecFundamentalsCollector`). It is started in `startLiveSources` and stopped in `stopLiveSources`.

Three new app methods:
- `app.getMacroRegime()` — returns `store.macroRegime`
- `app.getTradeSetups(filters)` — filters by `action`, `minConviction`, `provisional`
- `app.getTradeSetupDetail(ticker)` — single setup or null

---

## 9. API endpoints

### `GET /api/macro-regime`
Returns `store.macroRegime` or HTTP 204 if not yet computed.

### `GET /api/trade-setups`
Query params: `action`, `minConviction`, `provisional`  
Response:
```json
{
  "as_of": "ISO timestamp",
  "macro_regime": { ... },
  "count": 7,
  "setups": [ ... ]
}
```

### `GET /api/trade-setups/ticker/:ticker`
Returns single setup or HTTP 404.

### SSE stream additions
Initial `snapshot` event gains `macro_regime` and `trade_setups` fields.  
Live events: `macro_regime_update` (on regime label change), `trade_setup_refresh` (on each agent run with `count` summary).

---

## 10. Frontend

### Macro regime bar
Persistent narrow bar below the topbar on all views. Shows regime label, breadth summary, confidence, and last-updated time. Color-coded: green (`risk_on`), red (`risk_off`), amber (`mixed`), grey (`neutral`). Marks "stale" after 30 minutes without update.

### Setups panel
New `"setups"` nav item in top nav and side nav. Panel contains:

1. **Summary row** — count badges per action, filter toggles, provisional toggle
2. **Setup cards** — one per ticker with action badge, conviction meter (5-dot), thesis, evidence bars (sentiment / money flow / fundamentals), entry/stop/target/size guidance, risk flags
3. **Detail drawer** — full evidence breakdown on card click, reusing existing drawer pattern

### Design quality
The `frontend-design` skill **must be invoked** when implementing the Setups panel and setup card components to ensure production-grade, non-generic UI. The macro regime bar and provisional badge styling must be visually distinct and immediately readable.

### Provisional setup treatment
- Amber left border on card
- `PROVISIONAL · bootstrap fundamentals` tag visible
- Never sorted above live-backed setups
- Conviction displayed with a warning indicator

---

## 11. Persistence and auditability

`store.tradeSetups` and `store.macroRegime` are persisted via the existing autosave timer (`persistence.saveStoreSnapshot`) — no new persistence code required. On restart, `hydrateStore` restores last known setups. This provides basic auditability: the last set of setups before a restart is preserved.

Full historical audit (storing each generation run) is out of scope for this iteration but can be added to the `runtime_state` table later.

---

## 12. Testing and smoke checks

- `node scripts/check.js` — existing check should pass unchanged
- `node scripts/replay.js` then `GET /api/trade-setups` — should return setups after replay populates sentiment states and fundamentals
- Verify `store.macroRegime` is non-null after replay
- Verify at least one `long` or `watch` setup is generated from sample data
- Verify provisional setups have `conviction ≤ 0.55`
- Verify SSE stream delivers `trade_setup_refresh` event after replay

---

## 13. Deployment to Raspberry Pi

1. `git pull` on the Pi (no new npm dependencies — no `npm install` needed)
2. `sudo systemctl restart sentiment-analyst`
3. Confirm health at `GET /api/health`
4. Confirm setups at `GET /api/trade-setups`

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Setup generation produces no setups from sample data | Sample events may have thin money flow coverage — agent still produces `watch` setups from sentiment alone |
| Provisional cap (0.55) hides genuinely strong sentiment setups | Acceptable by design: the cap is a trust signal, not a performance signal |
| Debounce collapses too many updates during replay | 500ms is sufficient; replay fires at 180ms intervals so agent runs ~once per replay batch |
| Hydrated setups are stale on restart | Setups regenerate on first `snapshot` event (within seconds of live sources starting) |
