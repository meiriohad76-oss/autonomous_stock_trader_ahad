# Sentiment Analyst MVP

This repository contains a buildable MVP of the Sentiment Analyst pipeline described in the original note. It includes exact contracts, a working runtime pipeline, a live dashboard, and sample replay data so you can iterate locally before wiring in live collectors and a real LLM.

## What is included

- Exact PostgreSQL DDL in [sql/postgres-schema.sql](/C:/Users/meiri/OneDrive/Documents/trading%20system/sql/postgres-schema.sql)
- JSON Schemas in [schemas](/C:/Users/meiri/OneDrive/Documents/trading%20system/schemas)
- OpenAPI contract in [openapi/openapi.yaml](/C:/Users/meiri/OneDrive/Documents/trading%20system/openapi/openapi.yaml)
- A Node runtime pipeline in [src](/C:/Users/meiri/OneDrive/Documents/trading%20system/src)
- A live browser dashboard in [src/public/index.html](/C:/Users/meiri/OneDrive/Documents/trading%20system/src/public/index.html)
- A dedicated Fundamental Analyst dashboard in [src/public/fundamentals.html](/C:/Users/meiri/OneDrive/Documents/trading%20system/src/public/fundamentals.html)
- Replayable sample market events in [data/sample-events.json](/C:/Users/meiri/OneDrive/Documents/trading%20system/data/sample-events.json)
- Replayable sample fundamental coverage in [data/sample-fundamentals.json](/C:/Users/meiri/OneDrive/Documents/trading%20system/data/sample-fundamentals.json)
- Extension docs in [docs/architecture.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/architecture.md) and [docs/prompt-pack.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/prompt-pack.md)

## Commands

Run these from `C:\Users\meiri\OneDrive\Documents\trading system`.

```bash
node scripts/check.js
node scripts/replay.js
node scripts/sqlite-backup.js
node src/server.js
```

Then open `http://127.0.0.1:3000`.

For the new fundamentals view, open `http://127.0.0.1:3000/fundamentals.html`.

## Current runtime notes

- The MVP uses Server-Sent Events instead of WebSockets to stay dependency-light.
- The LLM scorer is simulated deterministically from the rule engine so the full flow remains runnable offline.
- Storage is in memory at runtime, while the exact production storage contracts are already defined in SQL and JSON Schema artifacts.
- The server now includes a live Google News RSS collector for the watchlist. It polls in the background and pushes new items through the same pipeline as the sample replay feed.
- Market data can now come from a real provider-backed adapter. The default is `synthetic`, but if you set `TWELVE_DATA_API_KEY`, the app will automatically switch to `twelvedata` unless you override `MARKET_DATA_PROVIDER`.
- A live market-flow monitor can now turn abnormal price and volume spikes into fast money-flow events when real market data is configured.
- The server now also includes an SEC Form 4 insider-flow collector that polls official EDGAR filings for tracked tickers and turns insider buys/sells into live pipeline events.
- The server now includes an SEC 13F collector that compares recent institutional holdings filings from tracked managers and turns watchlist position changes into institutional flow events.
- The server now also includes a deterministic Fundamental Analyst MVP with sector-first ranking, company scorecards, confidence logic, and a dedicated dashboard page.
- The Fundamental Analyst can now refresh covered companies from live SEC submissions and Company Facts data, with fallback to the local replay dataset when SEC data is unavailable.
- The Fundamental Analyst now also materializes an auditable warehouse-style persistence layer in dedicated tables, exposed through `/api/fundamentals/storage/summary` and `/api/fundamentals/storage/ticker/{ticker}`.
- SQLite deployments now produce scheduled snapshot backups with retention, so the single-machine Pi setup has a recovery path without requiring PostgreSQL first.
- The Fundamental Analyst now exposes a real stage-one initial screener before the full ranking model, with `eligible`, `watch`, and `reject` states.
- The dashboard now also includes a Macro Regime Agent that scores top-down conditions and adjusts long/short thresholds and exposure.
- The dashboard now also includes a Trade Setup Agent that turns sentiment, money flow, alerts, and fundamentals into ranked `long`, `short`, `watch`, and `no_trade` ideas.
- Macro-regime snapshots and trade-setup decisions are now persisted in dedicated audit tables, so the system can inspect prior recommendations after restart.
- The runtime now includes an Evidence Quality Agent that scores every document after classification and before aggregation, so dashboards and downstream agents share one trust layer for freshness, duplication, corroboration, source quality, and display tier.

## SQLite backup and retention

When `DATABASE_PROVIDER=sqlite`, the app can create consistent snapshot backups using SQLite's own `VACUUM INTO` flow. This is safer than copying the live database file directly because the app runs with WAL mode enabled.

Useful environment variables:

```bash
SQLITE_BACKUP_ENABLED=true
SQLITE_BACKUP_DIR=data/backups
SQLITE_BACKUP_INTERVAL_MS=21600000
SQLITE_BACKUP_RETENTION_COUNT=28
SQLITE_BACKUP_RETENTION_DAYS=14
SQLITE_BACKUP_ON_STARTUP=true
```

Useful commands:

```bash
node scripts/sqlite-backup.js
npm run sqlite:backup
```

The dashboard health/config payloads now also report the latest backup status so you can confirm the Pi is protecting its local database.

## Initial screener

The fundamentals flow now starts with an explicit stage-one screen before the final composite ranking. The screener uses the currently tracked coverage set and checks for:

- large-cap scale
- filing quality and freshness
- minimum growth
- minimum profitability
- acceptable balance sheet
- acceptable cash conversion
- valuation sanity

Each company is classified as:

- `eligible`: passes the first-stage gate and enters the ranked candidate set cleanly
- `watch`: worth monitoring, but not strong enough to clear the first screen
- `reject`: fails the current first-pass gate

This stage is exposed in the Fundamentals dashboard and through `/api/fundamentals/dashboard`.

## Trade Setup Agent

The Trade Setup Agent sits on top of the existing collectors and combines:

- short-term sentiment state
- recent high-confidence documents
- money-flow evidence
- alert history
- fundamentals and screener stage
- Evidence Quality Agent weights for recent supporting documents

It produces a ranked trade plan with:

- action: `long`, `short`, `watch`, or `no_trade`
- conviction
- suggested position size
- timeframe
- entry zone
- stop loss
- take profit
- thesis and risk flags

The Trade Setup Agent is also macro-aware. It consumes the current Macro Regime Agent snapshot so that:

- risk-on conditions loosen long thresholds and allow larger gross exposure
- risk-off conditions raise the bar for longs and support defensive or short-biased positioning
- high-dispersion conditions keep the engine selective even when individual names still look interesting

Useful endpoints:

```bash
GET /api/trade-setups
GET /api/trade-setups?window=1h&limit=6
GET /api/trade-setups/ticker/NVDA
GET /api/trade-setups/storage/summary
GET /api/trade-setups/storage/ticker/NVDA
```

## Evidence Quality Agent

The Evidence Quality Agent is the reusable trust layer in the data pipeline. It runs after document scoring and before sentiment aggregation, alerts, macro regime, trade setup generation, and dashboard display.

For each scored document, it evaluates:

- freshness
- source reliability
- classification confidence
- duplicate risk
- corroboration from other recent sources
- extraction quality
- ticker mapping confidence

It produces:

- `data_quality_label`: `high_quality`, `needs_confirmation`, `stale`, `duplicate`, `low_signal`, or `source_limited`
- `display_tier`: `alert`, `watch`, `context`, or `suppress`
- `downstream_weight`: a 0-1 multiplier used by downstream analysis
- `explanation`: a human-readable reason for the quality verdict

Useful endpoint:

```bash
GET /api/evidence-quality
GET /api/evidence-quality?ticker=NVDA
GET /api/evidence-quality?tier=alert
```

Engine contract check:

```bash
npm run check:evidence-quality
```

The detailed design and criteria are documented in [docs/evidence-quality-agent.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/evidence-quality-agent.md).

## Source Reliability

Live news now uses Google News RSS first and Yahoo Finance RSS as a no-key fallback. SEC collectors use retry-aware requests so transient aborts/timeouts are reported clearly and retried before collector health is marked degraded.

Details are documented in [docs/source-reliability.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/source-reliability.md).

## Pi Performance Mode

Set this on Raspberry Pi deployments:

```bash
PI_PERFORMANCE_MODE=true
```

This lowers polling frequency, SEC concurrency, retry pressure, autosave frequency, and SQLite backup churn unless those values are explicitly overridden in `.env`.

Explicit `.env` values always win. For example, if `SQLITE_BACKUP_RETENTION_COUNT=6` is already set, Pi mode will keep using `6`.

Useful endpoint:

```bash
GET /api/performance
```

## Macro Regime Agent

The Macro Regime Agent summarizes the top-down backdrop by combining:

- market-level sentiment state
- sector and ticker breadth
- recent accumulation versus distribution flow
- alert balance
- fundamental breadth and screener pass rate

It classifies the environment into:

- `risk_on`
- `risk_off`
- `high_dispersion`
- `balanced`

Each snapshot includes:

- regime and bias labels
- conviction
- exposure multiplier
- long and short thresholds
- supporting signals and risk flags

Useful endpoints:

```bash
GET /api/macro-regime
GET /api/macro-regime?window=1h
GET /api/macro-regime/history
```

## Agent audit trail

Macro regime and trade setup outputs are written into dedicated relational audit tables in the configured persistence provider. This makes the system easier to inspect, backtest, and debug after restart.

Useful inspection endpoints:

```bash
GET /api/macro-regime/history
GET /api/trade-setups/storage/summary
GET /api/trade-setups/storage/ticker/NVDA
```

## Live news collector

The live collector is enabled by default and uses Google News RSS queries for the current watchlist names. If network access is unavailable, the app still works with replay data and the collector records its status in `/api/health`.

Useful environment variables:

```bash
LIVE_NEWS_ENABLED=true
LIVE_NEWS_POLL_MS=300000
LIVE_NEWS_MAX_ITEMS_PER_TICKER=3
LIVE_NEWS_LOOKBACK_HOURS=24
LIVE_NEWS_REQUEST_TIMEOUT_MS=12000
```

Set `LIVE_NEWS_ENABLED=false` if you want an offline-only session.

## Market data provider

The ticker detail chart and market snapshot now support a real market data provider using Twelve Data's time series API, with automatic fallback to the synthetic local series if no key is configured or the provider request fails.

Useful environment variables:

```bash
MARKET_DATA_PROVIDER=twelvedata
TWELVE_DATA_API_KEY=your_key_here
MARKET_DATA_INTERVAL=15min
MARKET_DATA_HISTORY_POINTS=18
MARKET_DATA_CACHE_MS=60000
MARKET_DATA_REFRESH_MS=60000
MARKET_DATA_REQUEST_TIMEOUT_MS=12000
```

Set `MARKET_DATA_PROVIDER=synthetic` if you want to force the local deterministic adapter.

## Live market flow

The market-flow monitor uses the configured market data provider and scans the latest bars for abnormal volume and price shock conditions. When a spike clears the configured thresholds, it emits fast `money_flow` events like abnormal volume buying/selling or block trade accumulation/distribution.

Useful environment variables:

```bash
MARKET_FLOW_ENABLED=true
MARKET_FLOW_POLL_MS=60000
MARKET_FLOW_VOLUME_SPIKE_THRESHOLD=2.2
MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD=0.01
MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD=3.8
MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD=2.2
```

This monitor only produces meaningful live signals when a real market data provider is configured.

## Fundamental market/reference data

The Fundamental Analyst now supports a live-capable market/reference adapter for valuation and reference fields such as current price, market capitalization, enterprise value, shares outstanding, beta, trailing P/E, EV/EBITDA, price-to-sales, and PEG. The current implementation uses Twelve Data's `quote` and `statistics` endpoints when enabled, with automatic fallback to synthetic reference data if the provider is unavailable or no key is configured.

Useful environment variables:

```bash
FUNDAMENTAL_MARKET_DATA_PROVIDER=twelvedata
TWELVE_DATA_API_KEY=your_key_here
FUNDAMENTAL_MARKET_DATA_CACHE_MS=900000
FUNDAMENTAL_MARKET_DATA_REFRESH_MS=900000
FUNDAMENTAL_MARKET_DATA_REQUEST_TIMEOUT_MS=12000
```

Set `FUNDAMENTAL_MARKET_DATA_PROVIDER=synthetic` if you want to force offline fallback mode for the Fundamental Analyst.

## Live SEC fundamentals

The Fundamental Analyst now includes a live SEC fundamentals collector that polls official EDGAR submissions metadata and Company Facts XBRL data for the covered companies, maps a core canonical metric set, and refreshes the fundamentals leaderboard while preserving the existing replay fallback.

Useful environment variables:

```bash
FUNDAMENTAL_SEC_ENABLED=true
FUNDAMENTAL_SEC_POLL_MS=21600000
FUNDAMENTAL_SEC_LOOKBACK_HOURS=10800
SEC_REQUEST_TIMEOUT_MS=15000
SEC_TICKER_MAP_CACHE_MS=86400000
SEC_USER_AGENT="SentimentAnalyst/1.0 contact=you@example.com"
```

Set a real contact in `SEC_USER_AGENT` for production-style use. Set `FUNDAMENTAL_SEC_ENABLED=false` if you want the Fundamental Analyst to stay replay-only.

## Fundamental warehouse inspection

The app now materializes the current fundamentals run into table-shaped records that mirror the PostgreSQL design, including coverage rows, filing events, financial periods, financial facts, market reference rows, feature rows, score rows, and state rows. These records are written into dedicated relational tables in the configured local persistence provider and are rehydrated on startup, so the warehouse survives restart without relying on a single runtime-state blob.

Useful endpoints:

```bash
GET /api/fundamentals/storage/summary
GET /api/fundamentals/storage/ticker/AAPL
GET /api/fundamentals/storage/ticker/AAPL/filings
GET /api/fundamentals/storage/ticker/AAPL/facts/revenue?periodType=quarterly
```

## SEC Form 4 insider flow

The insider collector uses official SEC endpoints for ticker-to-CIK mapping, company submission history, and filing archive documents. It is enabled by default and polls recent Form 4 and Form 4/A filings for the tracked watchlist names.

Useful environment variables:

```bash
SEC_FORM4_ENABLED=true
SEC_FORM4_POLL_MS=600000
SEC_FORM4_LOOKBACK_HOURS=72
SEC_REQUEST_TIMEOUT_MS=15000
SEC_TICKER_MAP_CACHE_MS=86400000
SEC_USER_AGENT="SentimentAnalyst/1.0 contact=you@example.com"
```

Set a real contact in `SEC_USER_AGENT` for production-style use. Set `SEC_FORM4_ENABLED=false` if you want to disable insider ingestion.

## SEC 13F institutional flow

The institutional collector tracks a small set of major filers and compares the latest and previous 13F information tables for watchlist names. Because 13F is a quarterly filing regime, this is slower-moving than the live news and Form 4 collectors, but it gives the system a first official institutional-flow signal.

Useful environment variables:

```bash
SEC_13F_ENABLED=true
SEC_13F_POLL_MS=43200000
SEC_13F_LOOKBACK_HOURS=2400
```

Set `SEC_13F_ENABLED=false` if you want to disable institutional holdings ingestion.
