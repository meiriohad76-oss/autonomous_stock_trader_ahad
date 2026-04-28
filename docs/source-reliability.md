# Source Reliability Layer

This layer makes the input side of the trading system more resilient before evidence reaches sentiment aggregation, alerts, and trade setup generation.

## News Flow

The live news collector now tries providers in order for each ticker:

1. Google News RSS search.
2. Yahoo Finance ticker RSS fallback.

If Google News fails or returns no items for a ticker, Yahoo Finance can still feed the same normalization, scoring, Evidence Quality, and dashboard pipeline.

Health is tracked under `live_sources.google_news_rss`:

- `provider_success.google_news`: successful Google provider reads.
- `provider_success.yahoo_finance`: successful Yahoo fallback reads.
- `provider_failures`: provider-level failures or empty responses.
- `last_error`: only set when all configured providers fail for a ticker batch.

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
