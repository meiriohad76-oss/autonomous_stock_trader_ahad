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
