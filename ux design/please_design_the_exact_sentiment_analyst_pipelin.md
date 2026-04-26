<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# please  design the exact Sentiment Analyst pipeline: inputs, schema, scoring fields, prompt design, and confidence logic.

include a detailed architecture and instructions that i will later use to actually build that as an autonomous agent that will be build in claude code or codex.
also, deign a dashboard to display agent's results in real time (it will be displayed in a web page).

Yes — below is a production-style design for a Sentiment Analyst agent that you can later implement in Claude Code or Codex. The design combines multi-source ingestion, normalization, event classification, sentiment scoring, confidence logic, memory, and a real-time dashboard, and it follows an event-driven pattern that is appropriate for low-latency financial news processing.[^1][^2]

## Agent goal

The Sentiment Analyst should not simply label news as bullish or bearish. It should convert raw market information into ticker-linked, time-decayed, confidence-weighted sentiment signals that the Chief Strategist can consume as one structured input among the other agents.[^2]

## Core responsibilities

The agent should do five jobs well. It must ingest news and filings, map each item to companies and sectors, classify the event type, score sentiment and importance, and then aggregate those results into real-time ticker and sector sentiment states.[^3][^2]

- Ingest multi-source market text in near real time[^1][^2]
- Normalize and deduplicate items before analysis[^1]
- Classify event type, not only polarity[^4]
- Produce structured outputs with confidence and decay[^5][^3]
- Persist all raw and derived records for audit and backtesting[^2][^1]


## High-level architecture

Use an event-driven pipeline with separate stages for source collection, enrichment, LLM scoring, aggregation, storage, and dashboard serving. This pattern is practical because it keeps ingestion, NLP/LLM work, and UI queries decoupled, and similar serverless news-NLP architectures are already used for real-time financial pipelines.[^1]

### Pipeline stages

1. Source connectors pull RSS, APIs, and filing feeds every 1–5 minutes depending on source freshness.[^2][^1]
2. Raw items are written unchanged into a raw store for traceability and replay.[^1]
3. A normalization service extracts title, body, source, published time, URL, tickers, entities, sectors, and source type.[^2][^1]
4. A deduplication service clusters near-identical articles so the same story is not overweighted when syndicated widely.[^1]
5. A scoring service runs event classification, sentiment analysis, impact scoring, and confidence scoring.[^3][^5]
6. An aggregation service updates ticker, sector, and market sentiment states over multiple windows such as 15m, 1h, 4h, 1d, and 7d.[^6][^7]
7. A serving layer exposes REST/WebSocket endpoints for the dashboard and downstream agents.[^8][^9]

## Recommended source inputs

Your first production version should use a small, high-value input set. Google News RSS gives broad coverage, SEC EDGAR gives official company disclosures through APIs that update in real time without authentication, and one structured market-news API reduces parsing work and improves ticker tagging.[^10][^4][^2]

### Input groups

| Group | Sources | Use in pipeline |
| :-- | :-- | :-- |
| Broad news | Google News RSS, Yahoo Finance RSS | Breadth, early headline discovery [^11][^12] |
| Market news APIs | MarketAux, Massive/Polygon, EODHD-like vendors | Cleaner metadata, ticker mapping, source standardization [^10][^4][^13] |
| Official filings | SEC `data.sec.gov`, EDGAR filings search, 8-K/10-Q/10-K/6-K | High-trust event detection, direct company disclosures [^2][^14] |
| Insider / ownership | Form 3/4/5, 13D/13G trackers | Narrative context and executive intent [^15] |
| Calendars | Earnings calendar, macro calendar | Event priors and expected volatility windows [^16] |

## Services design

Build the agent as a set of small services rather than one big script. That will make it easier to implement incrementally in Claude Code or Codex and test each stage separately.[^1]

### Service map

- `collector`: polls RSS/APIs/filings and emits raw events.
- `normalizer`: converts every source into a single canonical schema.
- `entity-linker`: maps text to ticker, company, sector, theme, and macro tags.
- `deduper`: groups same-story or near-same-story items.
- `scorer`: runs rules + LLM prompt to classify event and sentiment.
- `aggregator`: computes rolling sentiment states by ticker/sector/watchlist.
- `memory-manager`: tracks post-event outcomes and model calibration.
- `api-server`: serves dashboard and downstream agent endpoints.
- `alert-engine`: emits Telegram or internal alerts for spikes, reversals, or high-confidence events.[^2]


## Canonical data model

Create one canonical schema that all sources map into. This matters more than model choice because your future backtests and orchestration quality will depend on consistent structured outputs.[^2][^1]

### `raw_documents`

Store the untouched source item.

```json
{
  "raw_id": "uuid",
  "source_name": "google_news",
  "source_type": "rss",
  "source_priority": 0.45,
  "url": "https://...",
  "title": "Company X raises guidance after earnings beat",
  "body": "full or partial text if available",
  "published_at": "2026-04-25T08:15:00Z",
  "fetched_at": "2026-04-25T08:15:12Z",
  "language": "en",
  "author": null,
  "source_metadata": {},
  "raw_payload": {}
}
```


### `normalized_documents`

This is the core document after parsing and entity linking.

```json
{
  "doc_id": "uuid",
  "raw_id": "uuid",
  "canonical_url": "https://...",
  "headline": "Company X raises guidance after earnings beat",
  "summary_text": "short cleaned summary",
  "body_text": "cleaned text",
  "published_at": "2026-04-25T08:15:00Z",
  "source_name": "google_news",
  "source_type": "news",
  "source_trust": 0.62,
  "is_official_filing": false,
  "is_press_release": false,
  "primary_ticker": "XYZ",
  "mentioned_tickers": ["XYZ"],
  "companies": ["Company X"],
  "sector": "Technology",
  "industry": "Software",
  "regions": ["US"],
  "themes": ["earnings", "guidance"],
  "dedupe_cluster_id": "cluster_123",
  "novelty_score": 0.78
}
```


### `document_scores`

One row per scored document.

```json
{
  "score_id": "uuid",
  "doc_id": "uuid",
  "model_version": "sentiment_v1",
  "event_type": "guidance_raise",
  "event_family": "earnings",
  "event_direction": "positive",
  "sentiment_score": 0.74,
  "impact_score": 0.81,
  "relevance_score": 0.93,
  "novelty_score": 0.78,
  "timeliness_score": 0.95,
  "source_reliability_score": 0.62,
  "extraction_quality_score": 0.89,
  "llm_confidence": 0.84,
  "rule_confidence": 0.77,
  "final_confidence": 0.82,
  "horizon": "1d",
  "reason_codes": ["earnings_beat", "guidance_raised", "official_quote_present"],
  "bullish_bearish_label": "bullish",
  "explanation_short": "Raised guidance after an earnings beat is typically price-supportive near term."
}
```


### `sentiment_state`

Aggregated live state by ticker, sector, or watchlist.

```json
{
  "state_id": "uuid",
  "entity_type": "ticker",
  "entity_key": "XYZ",
  "window": "1h",
  "as_of": "2026-04-25T08:20:00Z",
  "doc_count": 14,
  "unique_story_count": 5,
  "weighted_sentiment": 0.41,
  "weighted_impact": 0.57,
  "weighted_confidence": 0.71,
  "momentum_delta": 0.18,
  "sentiment_regime": "bullish",
  "top_event_types": ["earnings", "guidance", "analyst_action"],
  "top_reasons": ["guidance raised", "high novelty", "trusted source"]
}
```


### `event_outcomes`

This is the memory table used for calibration.

```json
{
  "outcome_id": "uuid",
  "doc_id": "uuid",
  "ticker": "XYZ",
  "event_type": "guidance_raise",
  "published_at": "2026-04-25T08:15:00Z",
  "price_t_plus_15m": 1.2,
  "price_t_plus_1h": 2.1,
  "price_t_plus_1d": 3.8,
  "volume_abnormality": 1.7,
  "realized_signal_quality": 0.76
}
```


## Event taxonomy

Do not let the LLM invent unlimited event types. Use a fixed controlled taxonomy so the downstream system remains stable and backtestable.[^4][^2]

### Event families

- Earnings: beat, miss, guidance_raise, guidance_cut, margin_change.
- Corporate actions: merger, acquisition, spin_off, buyback, dividend_change, offering.
- Analyst / market opinion: upgrade, downgrade, target_raise, target_cut.
- Legal / regulatory: investigation, lawsuit, settlement, approval, rejection.
- Product / operations: launch, delay, partnership, contract_win, outage, recall.
- Capital / balance sheet: debt_refinance, liquidity_concern, bankruptcy_risk.
- Insider / ownership: insider_buy, insider_sell, activist_stake, institutional_buying.
- Macro / sector: rate_decision, inflation_surprise, commodity_shock, policy_change.


## Scoring fields

Each document should produce several separate scores instead of one monolithic sentiment number. This is critical because “positive language” and “tradable impact” are not the same thing.[^5][^3]

### Required scores

- `sentiment_score`: range -1 to +1, where negative is bearish and positive is bullish.
- `impact_score`: range 0 to 1, expected market significance if true.
- `relevance_score`: range 0 to 1, how directly it matters to the mapped ticker.
- `novelty_score`: range 0 to 1, how new versus repetitive the information is.
- `timeliness_score`: range 0 to 1, penalizes stale content.
- `source_reliability_score`: range 0 to 1, based on source class and historical trust.
- `extraction_quality_score`: range 0 to 1, how clean and complete the parsed content is.
- `llm_confidence`: range 0 to 1, how certain the model is in its classification.
- `rule_confidence`: range 0 to 1, confidence from deterministic rules and source evidence.
- `final_confidence`: range 0 to 1, combined confidence used by downstream logic.


### Suggested labels

- `bullish_bearish_label`: bearish, neutral, bullish.
- `event_direction`: positive, negative, mixed, unclear.
- `urgency`: low, medium, high.
- `tradeability`: ignore, monitor, actionable.


## Suggested scoring logic

The agent should be hybrid: deterministic rules first, LLM second, aggregator last. That makes it cheaper, more stable, and easier to debug than a pure-LLM flow.[^3][^1]

### Deterministic base rules

Examples:

- Official filing source gets a source bonus.[^2]
- Duplicate cluster members after the first get heavy novelty penalties.[^1]
- Older than 4 hours for intraday trading gets timeliness decay.
- Headlines with no ticker mapping get low relevance.
- Exact event phrases such as “raises guidance,” “SEC investigation,” or “secondary offering” can seed event priors.


### Formula

A practical first version:

$$
\text{document\_alpha} =
\text{sentiment\_score}
\times \text{impact\_score}
\times \text{relevance\_score}
\times \text{novelty\_score}
\times \text{timeliness\_score}
\times \text{final\_confidence}
$$

Use the document alpha as the atomic contribution to ticker sentiment state.

### Final confidence logic

A strong first production formula is:

$$
\text{final\_confidence} =
0.30 \times \text{llm\_confidence}
+ 0.20 \times \text{rule\_confidence}
+ 0.15 \times \text{source\_reliability\_score}
+ 0.15 \times \text{extraction\_quality\_score}
+ 0.10 \times \text{relevance\_score}
+ 0.10 \times \text{novelty\_score}
$$

Clamp the result to 0–1 and add hard penalties when there is ambiguity, weak ticker mapping, or contradictory evidence.

## Confidence interpretation

Use a strict confidence policy so the agent does not overstate weak information.

- 0.85–1.00: High confidence, eligible for actionable signal.
- 0.70–0.84: Medium confidence, valid for strategist input but not standalone action.
- 0.50–0.69: Weak confidence, monitor only.
- Below 0.50: Keep in database, exclude from signal generation.


## Aggregation logic

The dashboard and Chief Strategist should consume aggregated ticker states, not isolated article scores. That reduces noise and better reflects the market narrative over time.[^7][^6]

### Rolling windows

Maintain sentiment states for:

- 15 minutes
- 1 hour
- 4 hours
- 1 day
- 7 days


### Aggregated ticker formula

For each ticker and window:

$$
\text{weighted\_sentiment} =
\frac{\sum \text{document\_alpha}}{\sum \max(0.05,\text{impact\_score}\times\text{relevance\_score}\times\text{final\_confidence})}
$$

Also compute:

- `story_velocity`: number of unique stories per hour.
- `sentiment_momentum`: current window minus previous comparable window.
- `event_concentration`: whether sentiment is driven by one story or many.
- `source_diversity`: how many independent sources support the same direction.


## Time decay rules

News loses value quickly, and filings often persist longer than commentary. So the decay function should depend on event type and source class.[^14][^2]

### Suggested half-lives

- Earnings/guidance: 1 trading day.
- SEC investigation or lawsuit: 2–5 trading days.
- Analyst upgrade/downgrade: 1 trading day.
- Product launch rumor: 4–8 hours.
- Macro releases: 4–12 hours.
- Insider buy/sell: 2–3 trading days.


### Decay formula

$$
\text{decayed\_alpha}(t) = \text{document\_alpha} \times e^{-\lambda t}
$$

Use different $\lambda$ values by event family.

## LLM prompt design

The LLM should produce strictly structured JSON, not prose. The prompt should be narrow, deterministic, and built around your fixed taxonomy.

### System prompt

Use something close to this:

```text
You are a financial event classification engine.
Your task is to analyze one market-related document and return strict JSON only.
You must classify:
1. primary ticker relevance
2. event family and event type from the allowed taxonomy
3. sentiment toward the primary ticker on a short-term trading horizon
4. impact, relevance, novelty, and confidence
5. short explanation and reason codes

Rules:
- Use only the allowed event taxonomy.
- Do not infer facts not present in the text.
- If the text is ambiguous, lower confidence.
- Official filings outweigh commentary.
- Repeated syndicated stories should have lower novelty.
- Sentiment must refer to probable short-term effect on the stock, not general tone.
- Return valid JSON only.
```


### User prompt template

```json
{
  "document": {
    "headline": "{{headline}}",
    "summary_text": "{{summary_text}}",
    "body_text": "{{body_text}}",
    "published_at": "{{published_at}}",
    "source_name": "{{source_name}}",
    "source_type": "{{source_type}}",
    "is_official_filing": {{true_or_false}},
    "primary_ticker": "{{primary_ticker}}",
    "mentioned_tickers": {{mentioned_tickers}},
    "sector": "{{sector}}",
    "novelty_score": {{novelty_score}},
    "source_trust": {{source_trust}}
  },
  "allowed_event_taxonomy": {
    "earnings": ["beat","miss","guidance_raise","guidance_cut","margin_change"],
    "corporate_actions": ["merger","acquisition","spin_off","buyback","dividend_change","offering"],
    "analyst": ["upgrade","downgrade","target_raise","target_cut"],
    "legal_regulatory": ["investigation","lawsuit","settlement","approval","rejection"],
    "product_operations": ["launch","delay","partnership","contract_win","outage","recall"],
    "capital_balance_sheet": ["debt_refinance","liquidity_concern","bankruptcy_risk"],
    "insider_ownership": ["insider_buy","insider_sell","activist_stake","institutional_buying"],
    "macro_sector": ["rate_decision","inflation_surprise","commodity_shock","policy_change"]
  },
  "output_schema": {
    "event_family": "string",
    "event_type": "string",
    "event_direction": "positive|negative|mixed|unclear",
    "bullish_bearish_label": "bullish|neutral|bearish",
    "sentiment_score": "float_-1_to_1",
    "impact_score": "float_0_to_1",
    "relevance_score": "float_0_to_1",
    "llm_confidence": "float_0_to_1",
    "reason_codes": ["string"],
    "explanation_short": "string_max_40_words"
  }
}
```


## Example model output

```json
{
  "event_family": "earnings",
  "event_type": "guidance_raise",
  "event_direction": "positive",
  "bullish_bearish_label": "bullish",
  "sentiment_score": 0.78,
  "impact_score": 0.84,
  "relevance_score": 0.96,
  "llm_confidence": 0.87,
  "reason_codes": ["earnings_beat", "guidance_raised", "direct_company_event"],
  "explanation_short": "Raised guidance after strong earnings is typically supportive for near-term stock performance."
}
```


## Rule engine before the LLM

Do cheap checks before sending to the LLM. This reduces cost and improves consistency.

### Pre-LLM rules

- Reject if no text and no reliable metadata.
- Map ticker using exact symbol, aliases, issuer name, and watchlist dictionary.
- Mark `is_official_filing` for SEC and issuer domains.[^2]
- Generate `novelty_score` from dedupe cluster size.
- Add event priors from regex patterns such as:
    - “raises guidance”
    - “cuts outlook”
    - “under investigation”
    - “announces share repurchase”
    - “files for bankruptcy”

If deterministic confidence exceeds a threshold for very standard cases, you may skip LLM on low-value repeated items and only use rule scoring.

## Memory and self-improvement

Your document explicitly wants memory from wins and losses so the system improves over time, and this is exactly where the Sentiment Analyst can become more than a classifier.[^2]

### What to remember

For every scored item, store:

- predicted label and confidence,
- ticker and event type,
- source family,
- realized price move after 15m, 1h, 1d, 3d,
- realized volatility and volume response,
- whether the move agreed with prediction.


### Use cases for memory

- Recalibrate source trust over time.
- Recalibrate event-type priors by market regime.
- Learn which event families matter for which sectors.
- Downweight sources that are noisy or late.
- Improve confidence estimates via calibration curves.


### Example memory rule

If “analyst target_raise” on small-cap biotech names historically shows weak realized predictive power in your universe, reduce its impact prior even if language looks bullish.

## Database design

A relational database is best for auditability and joins, plus a cache for real-time serving.

### Recommended stack

- PostgreSQL for canonical storage and audit trail.
- Redis for hot ticker sentiment states and WebSocket fanout.
- Object storage for raw payload archives and replay.
- Optional vector index only if you later add semantic similarity search over long text.

This separation fits your need for complete history plus real-time dashboard responsiveness.[^1][^2]

### Suggested PostgreSQL tables

- `raw_documents`
- `normalized_documents`
- `document_entities`
- `dedupe_clusters`
- `document_scores`
- `sentiment_states`
- `source_stats`
- `event_outcomes`
- `agent_runs`
- `alert_history`


## API contract for downstream agents

The Chief Strategist should never read article text directly. It should consume compact sentiment state endpoints.

### Useful endpoints

- `GET /api/sentiment/ticker/{ticker}`
- `GET /api/sentiment/sector/{sector}`
- `GET /api/sentiment/watchlist`
- `GET /api/news/recent?ticker=XYZ`
- `GET /api/events/high-impact`
- `WS /ws/sentiment-stream`


### Example ticker response

```json
{
  "ticker": "XYZ",
  "as_of": "2026-04-25T08:20:00Z",
  "windows": {
    "15m": {"weighted_sentiment": 0.62, "confidence": 0.79},
    "1h": {"weighted_sentiment": 0.48, "confidence": 0.74},
    "1d": {"weighted_sentiment": 0.21, "confidence": 0.68}
  },
  "top_events": [
    {"event_type": "guidance_raise", "impact_score": 0.84, "headline": "..."}
  ],
  "regime": "bullish",
  "risk_flags": []
}
```


## Autonomous agent instructions

Below is the build-oriented instruction set you can later hand to Claude Code or Codex.

### Build instructions

- Build the Sentiment Analyst as a modular event-driven service, not a monolith.
- Use Python or TypeScript, with clear separation between ingestion, normalization, scoring, aggregation, API, and dashboard layers.
- All components must be restart-safe and idempotent.
- Every document must receive a permanent ID and complete audit trail.
- Store raw source payloads before transformation.
- Use a canonical schema for all documents and scores.
- Deduplicate syndicated content before scoring.
- Implement rule-based classification first, then LLM enrichment.
- Force the LLM to return strict JSON matching the schema.
- Cache hot aggregate states in Redis.
- Recompute rolling sentiment windows incrementally.
- Persist event outcomes for post-trade calibration and model evaluation.
- Add unit tests for ticker mapping, dedupe logic, taxonomy enforcement, and confidence computation.
- Add a replay mode so historical days can be reprocessed for debugging and backtesting.


### Orchestration instructions

- Run source collectors on short intervals, typically 1–5 minutes.
- Use a queue between ingestion and scoring so LLM delays do not block collection.
- Use retry policies with dead-letter storage for malformed items.
- Add rate limiting and source-specific backoff.
- Add health endpoints for collector lag, queue depth, LLM latency, and API freshness.
- Emit metrics for documents per minute, unique stories, average confidence, and error counts.


## Real-time dashboard design

The dashboard should be operational, not just pretty. Its job is to tell you what the agent sees now, why it believes it, and whether sentiment is improving or deteriorating.[^9][^6][^7]

## Dashboard layout

Design a single-page web dashboard with six main zones.

### Top bar

- System status: green/yellow/red.
- Last update time.
- Queue depth.
- LLM latency.
- Documents processed today.
- Toggle for dark/light mode.


### Left control rail

- Universe selector: Nifty 100, custom watchlist, sectors.
- Time window selector: 15m, 1h, 4h, 1d, 7d.
- Source filters: news, filings, insider, macro.
- Confidence filter.
- Event-type filter.


### Main panels

#### Market pulse

Show market-wide sentiment gauge, sector heatmap, and story velocity. This gives you a fast read on whether the system is seeing broad bullishness, broad stress, or narrow stock-specific events.[^6][^9]

#### Ticker leaderboard

A sortable table of tickers with:

- ticker,
- weighted sentiment,
- confidence,
- momentum delta,
- top event type,
- unique stories,
- last update,
- alert flag.

Color rows subtly by sentiment regime.

#### Live event feed

A reverse-chronological stream of scored items with:

- timestamp,
- ticker,
- source,
- event type,
- bullish/bearish label,
- confidence,
- short explanation,
- click to expand raw headline and source link.


#### Ticker detail pane

When a ticker is selected, show:

- 15m/1h/1d sentiment trend,
- sentiment versus price overlay,
- top recent events,
- source distribution,
- confidence distribution,
- event family breakdown.


#### Source quality pane

Show:

- sources by volume,
- average confidence by source,
- realized predictive quality by source,
- lag and failure stats.


#### Alerts pane

Show:

- high-confidence polarity reversals,
- abnormal event bursts,
- multi-source confirmation events,
- stale feed warnings.


## Dashboard components

A strong first UI includes these charts and widgets:

- Sentiment gauge for market and selected ticker[^6]
- Sector heatmap colored by weighted sentiment[^1]
- Line chart for sentiment trend over time[^7]
- Combined sentiment-price chart for selected ticker[^7]
- Bar chart of top event families[^6]
- Table for live event feed with filtering and row expansion
- Small KPI cards for throughput, freshness, confidence, and story velocity[^9]


## Suggested frontend stack

Use a web app architecture with:

- React or Next.js frontend,
- fast API backend,
- WebSocket for live updates,
- Plotly or lightweight charting library for charts,
- Tailwind or clean CSS system for fast iteration.

This is a sensible choice for a real-time dashboard because it needs streaming updates, drilldowns, and filtering rather than static reporting.[^9][^7]

## Dashboard data contract

### WebSocket event example

```json
{
  "type": "ticker_update",
  "ticker": "XYZ",
  "as_of": "2026-04-25T08:20:00Z",
  "window": "1h",
  "weighted_sentiment": 0.48,
  "confidence": 0.74,
  "momentum_delta": 0.12,
  "top_event_type": "guidance_raise"
}
```


### Live feed event example

```json
{
  "type": "document_scored",
  "timestamp": "2026-04-25T08:18:00Z",
  "ticker": "XYZ",
  "headline": "Company X raises full-year guidance",
  "source_name": "SEC filing",
  "event_type": "guidance_raise",
  "label": "bullish",
  "sentiment_score": 0.78,
  "impact_score": 0.84,
  "confidence": 0.87,
  "explanation_short": "Raised guidance after strong earnings is typically supportive near term."
}
```


## Alert rules

The Sentiment Analyst should emit alerts only when information quality is high enough.

### Suggested alert triggers

- `high_confidence_negative`: final confidence > 0.85 and sentiment < -0.60
- `high_confidence_positive`: final confidence > 0.85 and sentiment > 0.60
- `polarity_reversal`: 1h sentiment crosses from below -0.20 to above +0.20 or inverse
- `event_burst`: more than N unique high-impact stories for one ticker in 30 minutes
- `source_failure`: source ingestion delayed beyond threshold
- `dashboard_stale`: no updates to hot universe beyond threshold


## MVP build order

Build in this order so you do not overcomplicate version one.

1. Canonical schema and PostgreSQL tables.
2. Google News RSS + one structured news API connector.
3. Basic ticker/entity mapping.
4. Deduplication.
5. Rule-based event classifier.
6. LLM JSON scorer.
7. Rolling ticker sentiment aggregation.
8. Fast API endpoints.
9. Web dashboard with leaderboard, live feed, and ticker detail.
10. Memory calibration from realized price outcomes.
11. Alerts and Telegram integration.[^2]

## Important design choices

A few constraints matter a lot.

- Never use one raw article as a trade signal by itself.
- Never trust sentiment without ticker relevance.
- Never let repeated coverage inflate confidence.
- Never let the LLM invent new schemas or event types.
- Always separate sentiment, impact, and confidence.
- Always save enough history to evaluate whether the agent actually adds predictive value.


## What success looks like

A good Sentiment Analyst is not the one that sounds smartest in natural language. It is the one that consistently produces structured, calibrated, explainable signals that improve downstream decision quality over time.[^5][^3][^2]

If you want, next I can do one of these:

1. Design the exact PostgreSQL schema with tables, indexes, and SQL
2. Write the full JSON schemas and API spec
3. Design the full dashboard UI as a build-ready web app spec
4. Write a Claude Code / Codex implementation prompt pack for this agent
<span style="display:none">[^17][^18][^19][^20][^21][^22][^23]</span>

<div align="center">⁂</div>

[^1]: https://github.com/nakuleshj/news-nlp-pipeline

[^2]: trading-system-planning.docx

[^3]: https://arxiv.org/html/2602.00086v1

[^4]: https://massive.com/docs/rest/stocks/news

[^5]: https://mfacademia.org/index.php/jcssa/article/view/241

[^6]: https://www.lakeshsuryadevara.com/news.html

[^7]: https://apps.apple.com/il/app/fintell-stock-news-sentiment/id6761405592

[^8]: https://sec-api.io/docs

[^9]: https://finance.worldmonitor.app

[^10]: https://www.marketaux.com

[^11]: https://scrapfly.io/blog/posts/guide-to-google-news-api-and-alternatives

[^12]: https://rss.feedspot.com/financial_news_rss_feeds/

[^13]: https://eodhd.com/financial-apis/stock-market-financial-news-api

[^14]: https://www.sec.gov/search-filings/edgar-application-programming-interfaces

[^15]: https://sec-api.io/docs/insider-ownership-trading-api

[^16]: https://eodhd.com/lp/calendar-and-news-api

[^17]: https://dl.acm.org/doi/10.1145/3694860.3694870

[^18]: https://www.irjmets.com/upload_newfiles/irjmets80200081468/paper_file/irjmets80200081468.pdf

[^19]: https://arxiv.org/pdf/2603.05917.pdf

[^20]: https://github.com/janlukasschroeder/sec-api

[^21]: https://github.com/sandesha21/Stock-Market-News-Sentiment-Analysis-and-Summarization

[^22]: https://finlight.me

[^23]: https://github.com/AdityaKanthManne/Real-Time-News-Sentiment-Signal-Engine-for-Trading

