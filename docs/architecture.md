# System Architecture

This document describes the four-layer architecture of the Sentiment Analyst + Trade Setup system, the responsibility of each layer, and how data flows between them.

---

## Layer overview

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1 — Ingestion                                    │
│  live-news · market-flow · sec-insider                  │
│  sec-institutional · sec-fundamentals                   │
└────────────────────────┬────────────────────────────────┘
                         │ raw documents / signals
┌────────────────────────▼────────────────────────────────┐
│  Layer 2 — Scoring & State                              │
│  pipeline.js  →  sentimentStates · documentScores       │
│                   alertHistory                          │
│  fundamentals.js  →  fundamentals.byTicker / bySector  │
└────────────────────────┬────────────────────────────────┘
                         │ store events (bus)
┌────────────────────────▼────────────────────────────────┐
│  Layer 3 — Decision  ← NEW                              │
│  macro-regime.js  →  store.macroRegime                  │
│  trade-setup.js   →  store.tradeSetups                  │
└────────────────────────┬────────────────────────────────┘
                         │ store reads
┌────────────────────────▼────────────────────────────────┐
│  Layer 4 — Presentation                                 │
│  router.js  →  REST endpoints · SSE stream              │
│  dashboard  →  Sentiment · Fundamentals · Setups panels │
└─────────────────────────────────────────────────────────┘
```

The decision layer is read-only with respect to all upstream state. It reads from the store and writes only to its own two keys (`macroRegime`, `tradeSetups`). It does not call any external services and does not modify sentiment states, document scores, or fundamentals.

---

## Layer 1 — Ingestion

Collectors poll external sources and push raw documents into the pipeline.

| Module | Source | What it produces |
|---|---|---|
| `src/domain/live-news.js` | Google News RSS | Raw news documents per ticker |
| `src/domain/market-flow.js` | Market data + tape | Block trade, abnormal volume, and market-flow signals |
| `src/domain/sec-insider.js` | SEC EDGAR Form 4 | Insider buy/sell transactions |
| `src/domain/sec-institutional.js` | SEC EDGAR 13F | Institutional position changes |
| `src/domain/sec-fundamentals.js` | SEC EDGAR XBRL | Financial facts for scoring |
| `src/domain/market-data.js` | Price provider (TwelveData / synthetic) | OHLCV bars for market-data service |
| `src/domain/fundamental-market-data.js` | Price provider | Live price reference for fundamentals |

All collectors are started and stopped through `app.startLiveSources()` / `app.stopLiveSources()`. They write nothing to the store directly — they push events into `createPipeline(store)`.

---

## Layer 2 — Scoring & State

Two independent engines read raw events and maintain scored state in the in-memory store.

### Sentiment pipeline (`src/domain/pipeline.js`)

Processes every incoming document through five sequential steps:

1. **Normalize** — `normalize.js` maps raw fields to a canonical schema
2. **Deduplicate** — `dedupe.js` assigns cluster IDs to suppress duplicate coverage
3. **Score** — `score.js` applies rule-based classification + simulated LLM scoring
4. **Aggregate** — `aggregate.js` recomputes per-ticker and per-sector sentiment states across five windows (15m, 1h, 4h, 1d, 7d)
5. **Alert** — detects smart-money patterns (accumulation, distribution, stacking) and appends to `store.alertHistory`

Primary store outputs:
- `store.documentScores` — every scored document
- `store.normalizedDocuments` — canonical form of every ingested document
- `store.sentimentStates` — per-entity, per-window aggregated sentiment (entity types: `ticker`, `sector`, `market`)
- `store.alertHistory` — triggered smart-money alert events

### Fundamentals engine (`src/domain/fundamentals.js`)

Independently scores company fundamentals from XBRL facts. Runs on a separate trigger (`fundamental_score_update` bus event) and is not coupled to the sentiment pipeline timing.

Primary store outputs:
- `store.fundamentals.byTicker` — `Map<ticker, FundamentalScore>` with composite score, factor breakdown, direction label, valuation label, data freshness
- `store.fundamentals.bySector` — sector-level attractiveness scores

Both engines emit events on `store.bus` when their state changes.

---

## Layer 3 — Decision (Trade Setup Agent)

The decision layer is the newest and highest-level layer. It synthesizes all scored state into actionable, explainable trade setups.

### Macro Regime (`src/domain/macro-regime.js`)

A pure function — no side effects, no I/O.

**Inputs (from store):**
- `store.sentimentStates` where `entity_type === "market"` — 1h and 1d market-wide sentiment
- `store.sentimentStates` where `entity_type === "sector"` — breadth across all covered sectors
- `store.alertHistory` — used as a corroboration signal for confidence

**Output:** A single regime snapshot written to `store.macroRegime`:

```
regime:     "risk_on" | "risk_off" | "mixed" | "neutral"
confidence: 0.0 – 1.0
bias:       "bullish" | "bearish" | "neutral"
breadth:    { bullish_sectors, bearish_sectors, neutral_sectors, breadth_score }
```

Classification rules:
- `risk_on` — market 1h sentiment ≥ 0.25 AND breadth ≥ 60% bullish sectors
- `risk_off` — market 1h sentiment ≤ −0.25 AND breadth ≤ 40% bullish sectors
- `mixed` — low absolute sentiment but sectors diverge
- `neutral` — insufficient data (< 5 sectors or < 20 total documents)

The macro regime is **not** used in the direction score calculation to avoid double-counting. It acts as a **threshold modifier** on the long/short classification gates and as a minor input to the conviction score.

### Trade Setup Agent (`src/domain/trade-setup.js`)

An event-driven agent that debounces 500ms on `store.bus` events and runs after any sentiment or fundamental update.

**Trigger:** `store.bus` events `"snapshot"` and `"fundamental_score_update"`. Debounced at 500ms so that replay batches produce one run, not hundreds.

**Minimum evidence gate:** A ticker is skipped unless it has at least one sentiment state with `doc_count ≥ 2` and at least one scored document within the last 48 hours. Tickers below this threshold produce no entry in `store.tradeSetups`.

**Per-ticker signal assembly:**

| Signal | Inputs | Weight in direction score |
|---|---|---|
| Sentiment | Weighted avg of 1h (0.5×), 4h (0.3×), 1d (0.2×) `weighted_sentiment` | 0.45 |
| Money flow | Insider (1.0×), institutional (0.9×), tape (0.6×) scored events; alert bonus ±0.15 per smart-money alert, capped ±0.3 | 0.30 |
| Fundamentals | `direction_label` → numeric × `final_confidence` | 0.25 |

Direction score = `sentiment × 0.45 + money_flow × 0.30 + fundamental × 0.25`, clamped to [−1, +1].

Conviction score = `sent_conf × 0.35 + mf_conf × 0.25 + fund_conf × 0.25 + macro_conf × 0.15`, ± 0.08 momentum adjustment.

**Action classification:**

| Action | Condition |
|---|---|
| `long` | direction ≥ long_threshold AND conviction ≥ 0.45 |
| `short` | direction ≤ short_threshold AND conviction ≥ 0.45 |
| `watch` | \|direction\| ≥ 0.15 OR conviction ≥ 0.35 |
| `no_trade` | otherwise |

Long/short thresholds shift by macro regime: `risk_on` lowers the long gate to 0.25; `risk_off` raises it to 0.40. The short gate mirrors this in the negative direction.

**Tape-only rule:** If all money flow events are tape-type (block trade / abnormal volume) with no insider or institutional signal, the action is capped at `watch` regardless of score.

**Provisional flag:** A setup is `provisional: true` — conviction capped at 0.55 — when fundamentals are missing, data freshness is below 0.8, or the market reference price is not live.

**Output:** Each setup includes action, conviction, position size guidance (full / half / quarter / starter), entry / stop / target guidance, a deterministic thesis string, risk flags, and a full evidence breakdown. Written to `store.tradeSetups`, sorted by action priority then conviction.

**Store writes:** `store.macroRegime` and `store.tradeSetups` — both persisted by the existing autosave timer at no additional cost.

**Bus events emitted:**
- `macro_regime_update` — fired when the regime label changes
- `trade_setup_refresh` — fired after every agent run with summary counts

---

## Layer 4 — Presentation

### REST API (`src/http/router.js`)

| Endpoint | Description |
|---|---|
| `GET /api/health` | Server health and source liveness |
| `GET /api/config` | Dashboard and universe config |
| `GET /api/sentiment/watchlist` | Leaderboard and global sentiment state |
| `GET /api/sentiment/ticker/:ticker` | Per-ticker sentiment detail with price history |
| `GET /api/sentiment/sector/:sector` | Sector sentiment detail |
| `GET /api/news/recent` | Recent scored documents |
| `GET /api/money-flow` | Aggregate smart-money snapshot |
| `GET /api/money-flow/ticker/:ticker` | Ticker-level money flow detail |
| `GET /api/events/high-impact` | High-impact, high-confidence events |
| `GET /api/fundamentals/dashboard` | Fundamental leaderboard, sectors, changes |
| `GET /api/fundamentals/ticker/:ticker` | Full factor pack and filing context |
| `GET /api/fundamentals/sector/:sector` | Sector attractiveness |
| `GET /api/macro-regime` | Current macro regime snapshot (204 if not yet computed) |
| `GET /api/trade-setups` | All setups, filterable by action / minConviction / provisional |
| `GET /api/trade-setups/ticker/:ticker` | Single setup detail |
| `GET /api/stream` | SSE stream for dashboard |
| `POST /api/replay` | Trigger sample data replay |

### SSE stream

The initial `snapshot` event includes `macro_regime` and `trade_setups` fields alongside health and watchlist data. Live events push `macro_regime_update` (on regime label change) and `trade_setup_refresh` (on every agent run) so the dashboard stays current without polling.

### Dashboard (`src/public/`)

| Panel | File | What it shows |
|---|---|---|
| Overview / Markets / Watch / Alerts / System | `index.html` + `app.js` | Sentiment leaderboard, sector grid, alert timeline, system health |
| Macro regime bar | `index.html` (persistent, all views) | Regime label, breadth, confidence, staleness indicator |
| Setups | `index.html` + `app.js` | Setup cards with action badge, conviction meter, evidence bars, entry/stop/target guidance; detail drawer on click |
| Fundamentals | `fundamentals.html` | Factor leaderboard, sector attractiveness, filing timeline |

---

## Store (`src/domain/store.js`)

Single in-memory object shared across all layers. Persisted to SQLite (or PostgreSQL) via `persistence.saveStoreSnapshot()` on an autosave timer. Hydrated from the last snapshot on restart via `persistence.hydrateStore()`.

Key fields written by each layer:

| Field | Written by |
|---|---|
| `documentScores`, `normalizedDocuments` | Pipeline (Layer 2) |
| `sentimentStates`, `alertHistory` | Pipeline (Layer 2) |
| `fundamentals.byTicker`, `fundamentals.bySector` | Fundamentals engine (Layer 2) |
| `macroRegime` | Trade Setup Agent (Layer 3) |
| `tradeSetups` | Trade Setup Agent (Layer 3) |

No layer writes to another layer's fields. The decision layer is strictly read-only with respect to all Layer 2 state.

---

## Production swap points

- Replace the in-memory store with PostgreSQL + Redis hot snapshots.
- Replace the simulated LLM scorer in `score.js` with a real structured-output model call.
- Replace `data/sample-events.json` replay with continuous live collectors (already partially live via Google News, SEC, and market-flow collectors).
- Swap `data/sample-fundamentals.json` with live XBRL ingestion from SEC EDGAR (architecture documented in [docs/fundamental-architecture.md](./fundamental-architecture.md)).
- Add historical audit table for trade setup generations (each run's output stored for backtesting and calibration).