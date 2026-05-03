# Source Reliability Layer

This layer makes the input side of the trading system more resilient before evidence reaches sentiment aggregation, alerts, and trade setup generation.

## News Flow

The live news collector now tries providers in order for each ticker:

1. Marketaux linked market news when `MARKETAUX_API_KEY` is configured.
2. Google News RSS search.
3. Yahoo Finance ticker RSS fallback.

If Marketaux is unavailable, unconfigured, quota-limited, or returns no fresh entity match for a ticker, Google/Yahoo RSS can still feed the same normalization, scoring, Evidence Quality, and dashboard pipeline.

Health is tracked in two places:

- `live_sources.marketaux_news`: Marketaux provider status, configured state, requested symbols, fetched articles, and linked-news ingest count.
- `live_sources.google_news_rss`: aggregate live-news fallback status and provider success/failure counters.

- `provider_success.marketaux`: successful Marketaux reads.
- `provider_success.google_news`: successful Google provider reads.
- `provider_success.yahoo_finance`: successful Yahoo fallback reads.
- `provider_failures`: provider-level failures or empty responses.
- `last_error`: only set when all configured providers fail for a ticker batch.

Useful Marketaux knobs:

```bash
MARKETAUX_ENABLED=true
MARKETAUX_API_KEY=your_key_here
MARKETAUX_SYMBOLS_PER_REQUEST=20
MARKETAUX_MAX_ITEMS_PER_TICKER=3
MARKETAUX_REQUEST_TIMEOUT_MS=12000
MARKETAUX_REQUEST_RETRIES=1
```

## Market Data Flow

Market data now supports these providers:

1. Alpaca Market Data through `MARKET_DATA_PROVIDER=alpaca`.
2. Twelve Data through `MARKET_DATA_PROVIDER=twelvedata`.
3. Synthetic fallback through `MARKET_DATA_PROVIDER=synthetic`.

Alpaca is preferred when Alpaca market data credentials are present and no provider is explicitly selected. Twelve Data remains a useful backup and can still be selected explicitly.

Useful Alpaca market-data knobs:

```bash
MARKET_DATA_PROVIDER=alpaca
ALPACA_MARKET_DATA_ENABLED=true
ALPACA_MARKET_DATA_FEED=iex
ALPACA_API_KEY=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
```

The Fundamental Market Reference worker also accepts `FUNDAMENTAL_MARKET_DATA_PROVIDER=alpaca`. In that mode Alpaca updates price/change fields, while SEC filings and the existing fundamental model continue to supply business-quality metrics. Use Twelve Data if you need provider-supplied market cap, enterprise value, beta, and valuation fields from the same adapter.

## Signal Verification Levels

Every evidence item now carries a verification level before it can influence alerts, money-flow radar, deterministic selection, LLM selection, or final selection:

- `official_filing`: SEC-backed insider, 13F, or company-filing evidence.
- `delayed_trade_prints`: provider trade prints from Polygon/IEX. These can create `block_trade_buying` or `block_trade_selling`, but direction is still inferred from print price versus a reference price.
- `bar_derived_inferred`: market-flow radar from OHLCV bar anomalies. This can support `abnormal_volume_buying` or `abnormal_volume_selling`, but it is not a confirmed block print.
- `provider_linked_news`: structured news provider evidence such as Marketaux entity-linked news.
- `rss_headline_only`: Google/Yahoo RSS fallback. Useful for discovery, but source-check before treating it as a catalyst.
- `social_stream`: social/crowd evidence, useful as context only unless confirmed elsewhere.

The Evidence Quality Agent exposes these as:

- `observation_level`
- `verification_status`
- `reliability_multiplier`
- `reliability_warnings`

The multiplier reduces downstream score weight for weaker provenance. For example, bar-derived flow and RSS headline matches can still appear in the dashboard, but they should not carry the same weight as official filings or direct delayed trade prints.

Important rule: `market_flow` can no longer create `block_trade_*` events. Only the trade-print collector may create block-trade labels. Bar-derived market-flow signals are labeled as abnormal-volume evidence with a warning.

## SEC Flow

SEC collectors now use retry-aware request helpers:

- SEC Form 4 insider filings.
- SEC 13F institutional holdings.
- SEC fundamentals/company facts.

Timeouts are reported as explicit timeout messages instead of generic aborts. Retry count is controlled by:

```bash
SEC_REQUEST_RETRIES=1
```

## Config

Useful knobs:

```bash
LIVE_NEWS_REQUEST_RETRIES=1
LIVE_NEWS_REQUEST_TIMEOUT_MS=12000
SEC_REQUEST_RETRIES=1
SEC_REQUEST_TIMEOUT_MS=15000
```

Increase retries cautiously on the Pi. Retries improve reliability, but too many can increase polling latency and API pressure.

## Why This Matters

The Evidence Quality Agent exposed that too many live items were `low_signal` or `context`. The first fix is not to loosen quality criteria. The first fix is to improve source reliability and source diversity so the quality layer receives better raw evidence.
