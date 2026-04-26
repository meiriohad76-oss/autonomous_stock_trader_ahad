<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# now let's design the Fundamental Analyst  :

pipeline: inputs, schema, scoring fields, prompt design, and confidence logic.
include a detailed architecture and instructions that i will later use to actually build that as an autonomous agent that will be build in claude code or codex.
also, deign a dashboard to display agent's results in real time (it will be displayed in a web page).

Yes — here is a production-grade design for the **Fundamental Analyst** agent. This agent should convert company filings, financial statements, sector context, and valuation data into a structured **fundamental quality + valuation + growth + sector attractiveness** signal that the Chief Strategist can use alongside the other agents, and the SEC’s EDGAR APIs are a strong base because they provide real-time submissions metadata plus structured XBRL financial data without API keys.[^1]

## Agent objective

The Fundamental Analyst should not behave like a generic “LLM stock picker.” It should act as a **top-down, evidence-based ranking engine** that starts with sector attractiveness, then scores each company on financial quality, growth, valuation, capital efficiency, balance-sheet strength, and reporting confidence.[^2][^3][^1]

## Core responsibilities

This agent should do six things consistently. It must collect structured fundamentals, normalize them across companies and time, compute comparable ratios, classify company and sector state, generate a weighted scorecard, and publish both raw factor values and an interpretable final verdict for downstream agents and the dashboard.[^4][^1]

- Ingest company financials, filings, sector data, and reference metadata[^5]
- Normalize fiscal periods and accounting fields into a canonical model
- Calculate financial ratios and trend features across several lookback windows[^6][^2]
- Rank sectors first, then stocks within sectors, matching your original top-down idea[^3][^1]
- Produce a structured investment-quality assessment with confidence, not prose alone[^1]
- Persist every score and underlying factor for audit, replay, and backtesting[^1]


## What the agent should answer

For every covered stock, the agent should answer:

- Is this company financially strong or weak?
- Is the business improving or deteriorating?
- Is the stock expensive, fair, or cheap relative to peers and itself?
- Is the sector currently attractive?
- How reliable is the data behind this judgment?
- Is the fundamental setup good enough to support a bullish trade candidate?[^2][^4][^1]


## High-level architecture

Build this as a modular pipeline with **sector engine**, **company fundamentals engine**, **ratio engine**, **LLM interpretation layer**, **scoring engine**, **memory/calibration layer**, and **dashboard/API layer**. That architecture matches your requirement for a multi-agent system and keeps deterministic financial computation separate from narrative interpretation.[^3][^1]

### Pipeline stages

1. Universe builder selects covered stocks and maps each to sector, industry, exchange, CIK, ticker aliases, and benchmark group.[^1]
2. Source connectors fetch filings metadata, structured statements, market/reference data, and sector reference inputs.[^5]
3. A normalization service maps raw fields into a canonical financial schema across annual and quarterly periods .
4. A feature engine computes profitability, growth, leverage, liquidity, efficiency, valuation, and quality metrics.[^6][^2]
5. A sector engine computes relative sector attractiveness from aggregated constituent fundamentals and sector-level context.[^7][^1]
6. A scoring engine produces company and sector scores and combines them into a final fundamental conviction score.[^4][^3]
7. An LLM interpretation layer explains what changed, flags anomalies, and generates structured reason codes using the raw computed factors rather than re-deriving the math.[^1]
8. An aggregation layer maintains current ranks, changes since prior run, and trend states for the dashboard and downstream agents.
9. A memory layer stores realized outcomes so weights and confidence can be recalibrated over time, matching your goal of learning from wins and losses.[^1]

## Recommended input sources

Your first version should rely mostly on structured official or normalized fundamentals, not scraped prose. The SEC EDGAR APIs provide real-time company submissions, ticker metadata, and XBRL company facts, including 10-Q, 10-K, 8-K, 20-F, 40-F, and 6-K related data, and those APIs are updated throughout the day with no authentication required .

### Input groups

| Group | Examples | Use |
| :-- | :-- | :-- |
| Official filings | SEC submissions API, companyfacts API, companyconcept API | Authoritative financial statements, filing recency, accounting facts |
| Market/reference data | Price, market cap, EV, shares outstanding, beta | Valuation ratios, size buckets, peer comparison [^6] |
| Sector classification | GICS / internal sector mapping | Sector-first ranking and peer normalization [^7][^3] |
| Analyst/reference vendors | Zacks, Seeking Alpha, Investing.com from your existing subscriptions [^1] | Supplemental estimates, consensus trends, sector commentary |
| Economic/sector context | Rates, inflation, commodity proxies, sector ETF data | Contextual sector attractiveness and regime overlay [^8][^7] |

## Build philosophy

Use deterministic calculations for all accounting and ratio work. The LLM should **interpret** and **summarize** the computed factor set, not invent financial values or estimate ratios from text.[^9]

## Canonical data model

A strong schema matters more than fancy modeling because later you will want reliable ranking, auditability, and comparisons across companies, sectors, and time .

### `coverage_universe`

```json
{
  "ticker": "AAPL",
  "company_name": "Apple Inc.",
  "cik": "0000320193",
  "exchange": "NASDAQ",
  "country": "US",
  "sector": "Information Technology",
  "industry": "Technology Hardware",
  "is_active": true,
  "benchmark_group": "large_cap_us"
}
```


### `filing_events`

```json
{
  "filing_id": "uuid",
  "ticker": "AAPL",
  "cik": "0000320193",
  "form_type": "10-Q",
  "filing_date": "2026-04-24",
  "accepted_at": "2026-04-24T20:15:00Z",
  "accession_no": "0000320193-26-000123",
  "period_end": "2026-03-31",
  "source_url": "https://...",
  "is_restated": false,
  "contains_xbrl": true
}
```


### `financial_periods`

```json
{
  "period_id": "uuid",
  "ticker": "AAPL",
  "fiscal_year": 2026,
  "fiscal_quarter": 1,
  "period_type": "quarterly",
  "period_start": "2026-01-01",
  "period_end": "2026-03-31",
  "filing_id": "uuid",
  "currency": "USD",
  "is_latest": true
}
```


### `financial_facts`

```json
{
  "fact_id": "uuid",
  "period_id": "uuid",
  "ticker": "AAPL",
  "taxonomy": "us-gaap",
  "concept": "RevenueFromContractWithCustomerExcludingAssessedTax",
  "canonical_field": "revenue",
  "value": 123456789000,
  "unit": "USD",
  "source_form": "10-Q",
  "as_reported_label": "Net sales"
}
```


### `fundamental_features`

```json
{
  "feature_id": "uuid",
  "ticker": "AAPL",
  "as_of": "2026-04-25T13:30:00Z",
  "window_basis": "latest_quarter",
  "revenue_growth_yoy": 0.085,
  "eps_growth_yoy": 0.112,
  "gross_margin": 0.442,
  "operating_margin": 0.318,
  "net_margin": 0.247,
  "roe": 1.32,
  "roic": 0.41,
  "debt_to_equity": 1.78,
  "net_debt_to_ebitda": 0.55,
  "current_ratio": 0.94,
  "interest_coverage": 28.4,
  "fcf_margin": 0.256,
  "fcf_conversion": 1.08,
  "asset_turnover": 1.17,
  "pe_ttm": 29.8,
  "ev_to_ebitda_ttm": 21.3,
  "price_to_sales_ttm": 7.5,
  "peg": 2.1
}
```


### `sector_features`

```json
{
  "sector_feature_id": "uuid",
  "sector": "Information Technology",
  "as_of": "2026-04-25T13:30:00Z",
  "median_revenue_growth": 0.074,
  "median_operating_margin": 0.198,
  "median_roic": 0.121,
  "median_pe_ttm": 24.3,
  "earnings_revision_breadth": 0.61,
  "sector_price_momentum_3m": 0.083,
  "sector_attractiveness_score": 0.72
}
```


### `fundamental_scores`

```json
{
  "score_id": "uuid",
  "ticker": "AAPL",
  "as_of": "2026-04-25T13:30:00Z",
  "sector": "Information Technology",
  "quality_score": 0.87,
  "growth_score": 0.79,
  "valuation_score": 0.42,
  "balance_sheet_score": 0.74,
  "efficiency_score": 0.88,
  "earnings_stability_score": 0.81,
  "sector_score": 0.72,
  "reporting_confidence_score": 0.93,
  "data_freshness_score": 0.96,
  "peer_comparability_score": 0.84,
  "llm_confidence": 0.79,
  "rule_confidence": 0.91,
  "final_confidence": 0.87,
  "composite_fundamental_score": 0.76,
  "rating_label": "fundamentally_strong",
  "valuation_label": "slightly_expensive",
  "direction_label": "bullish_supportive",
  "reason_codes": ["high_roic", "strong_margin_profile", "solid_fcf", "above_peer_valuation"]
}
```


### `fundamental_state`

```json
{
  "state_id": "uuid",
  "ticker": "AAPL",
  "as_of": "2026-04-25T13:30:00Z",
  "rank_in_sector": 3,
  "rank_global": 12,
  "sector": "Information Technology",
  "composite_fundamental_score": 0.76,
  "confidence": 0.87,
  "score_delta_30d": 0.04,
  "regime": "strong_but_not_cheap",
  "top_strengths": ["roic", "margin", "cash_flow"],
  "top_weaknesses": ["valuation", "current_ratio"]
}
```


## Feature families

The factor engine should organize metrics into stable families so the final score is explainable and tunable.[^2][^6]

### Core factor buckets

- Profitability: gross margin, operating margin, EBITDA margin, net margin.
- Growth: revenue growth, EPS growth, EBITDA growth, FCF growth, multi-quarter acceleration.
- Quality: ROE, ROA, ROIC, accruals quality, FCF conversion.
- Balance sheet: debt-to-equity, net debt-to-EBITDA, current ratio, interest coverage.
- Efficiency: asset turnover, inventory turnover, receivables days, cash conversion.
- Valuation: P/E, EV/EBITDA, EV/Sales, P/B, FCF yield, PEG.
- Stability: margin variance, earnings consistency, revenue consistency, restatement flags.
- Sector context: sector strength, sector valuation stretch, revision breadth, macro suitability.[^8][^7]


## Top-down sector-first logic

Your document explicitly says the fundamental analyst should start with a sector outlook and identify “hot” bullish sectors, then evaluate company health inside them, which is a sound way to keep company rankings grounded in broader opportunity context.[^1]

### Sector engine output

For each sector, compute:

- Sector profitability median.
- Sector growth breadth.
- Sector valuation percentile versus history.
- Earnings revision breadth if available from subscribed sources.
- Price trend overlay for context, not dominance.
- Macro suitability score, for example whether rates, energy prices, or policy environment help or hurt the sector.[^7][^8]


### Sector attractiveness score

A practical first formula:

$$
\text{sector\_score} =
0.30 \times \text{growth\_breadth}
+ 0.20 \times \text{profitability\_strength}
+ 0.20 \times \text{revision\_breadth}
+ 0.15 \times \text{relative\_valuation}
+ 0.15 \times \text{macro\_fit}
$$

Use percentile-normalized inputs, with higher values meaning more attractive sectors.

## Company scoring logic

The company score should separate “good business” from “good stock at current price.” That means quality/growth and valuation must stay distinct until the final combination stage.[^6][^2]

### Suggested factor weights

For a growth-quality long bias system, a sensible starting point is:

- Quality: 25%
- Growth: 20%
- Valuation: 15%
- Balance sheet: 15%
- Efficiency: 10%
- Stability: 10%
- Sector score: 5%

Those are initial weights only and should later be calibrated from realized outcomes.[^1]

### Composite formula

$$
\text{composite\_fundamental\_score} =
0.25Q + 0.20G + 0.15V + 0.15B + 0.10E + 0.10S + 0.05T
$$

Where:

- $Q$ = quality score
- $G$ = growth score
- $V$ = valuation score
- $B$ = balance sheet score
- $E$ = efficiency score
- $S$ = stability score
- $T$ = sector score


## Confidence logic

Confidence should reflect **data quality and comparability**, not whether the company looks attractive. A bad company can be scored with high confidence, and a great-looking company can have low confidence if the data is stale or distorted .

### Confidence inputs

- `reporting_confidence_score`: filing quality, XBRL coverage, restatement risk, clean mapping.
- `data_freshness_score`: how recent the latest filing and market data are .
- `peer_comparability_score`: how comparable this firm is to its peer set.
- `rule_confidence`: completeness and internal consistency of financial computations.
- `llm_confidence`: confidence in interpretation and anomaly explanation.
- `estimate_dependency_score`: penalty if too much depends on vendor estimates rather than reported facts.
- `anomaly_penalty`: penalty for outliers, restatements, one-off distortions, missing fields.


### Final confidence formula

$$
\text{final\_confidence} =
0.30 \times \text{rule\_confidence}
+ 0.20 \times \text{reporting\_confidence\_score}
+ 0.15 \times \text{data\_freshness\_score}
+ 0.15 \times \text{peer\_comparability\_score}
+ 0.10 \times \text{llm\_confidence}
+ 0.10 \times (1 - \text{anomaly\_penalty})
$$

Clamp to 0–1 and apply hard reductions when filings are stale, fields are missing, or accounting comparability is weak.

## Confidence interpretation

- 0.85–1.00: High confidence, safe for strategist weighting.
- 0.70–0.84: Medium confidence, usable but monitor caveats.
- 0.50–0.69: Weak confidence, ranking valid but not decisive.
- Below 0.50: Store for analysis, suppress from decision layer.


## Required scoring fields

Each company should output a compact but complete factor pack.

### Mandatory scores

- `quality_score`
- `growth_score`
- `valuation_score`
- `balance_sheet_score`
- `efficiency_score`
- `earnings_stability_score`
- `sector_score`
- `reporting_confidence_score`
- `data_freshness_score`
- `peer_comparability_score`
- `rule_confidence`
- `llm_confidence`
- `final_confidence`
- `composite_fundamental_score`


### Labels

- `rating_label`: fundamentally_strong, balanced, weak, deteriorating.
- `valuation_label`: cheap, fair, expensive, extremely_expensive.
- `direction_label`: bullish_supportive, neutral, bearish_headwind.
- `regime_label`: compounder, cyclical_recovery, value_trap_risk, quality_at_premium, distressed.


## Normalization rules

Cross-company comparison is hard unless you normalize carefully. The SEC Company Facts API gives structured facts, but different companies still report under different tags or business structures, so you need a canonical mapping layer and peer-aware normalization.[^10]

### Rules

- Map raw XBRL concepts to canonical fields such as revenue, COGS, operating_income, net_income, total_assets, total_debt, cash, capex, CFO .
- Keep both reported values and normalized values.
- Prefer TTM and latest-quarter values for ratios.
- Use z-scores or percentiles within sector/industry/size bucket.
- Winsorize extreme outliers before peer normalization.
- Flag one-offs such as goodwill impairments, large litigation charges, unusual tax effects, or restructuring items.


## LLM role

The LLM should not compute ratios. It should consume the already-computed factor pack, classify the business profile, detect contradictions, and generate concise reason codes and explanatory summaries in strict JSON.[^1]

## Prompt design

### System prompt

```text
You are a financial fundamentals interpretation engine.
You receive precomputed company, peer, and sector factors.
Do not calculate accounting metrics from scratch.
Do not invent missing values.
Your tasks are:
1. classify the company's fundamental profile
2. identify strengths, weaknesses, and contradictions
3. assess whether fundamentals are supportive, neutral, or a headwind for a long trade
4. output strict JSON only

Rules:
- Base your judgment only on the provided fields.
- Distinguish business quality from valuation.
- Prefer reported fundamentals over estimates.
- Penalize stale, incomplete, anomalous, or weakly comparable data.
- If metrics are mixed, say mixed and lower confidence.
- Use only the allowed labels and reason codes.
```


### User prompt template

```json
{
  "company": {
    "ticker": "{{ticker}}",
    "company_name": "{{company_name}}",
    "sector": "{{sector}}",
    "industry": "{{industry}}",
    "market_cap_bucket": "{{market_cap_bucket}}"
  },
  "financial_features": {
    "revenue_growth_yoy": "{{value}}",
    "eps_growth_yoy": "{{value}}",
    "gross_margin": "{{value}}",
    "operating_margin": "{{value}}",
    "net_margin": "{{value}}",
    "roe": "{{value}}",
    "roic": "{{value}}",
    "debt_to_equity": "{{value}}",
    "net_debt_to_ebitda": "{{value}}",
    "current_ratio": "{{value}}",
    "interest_coverage": "{{value}}",
    "fcf_margin": "{{value}}",
    "fcf_conversion": "{{value}}",
    "asset_turnover": "{{value}}",
    "pe_ttm": "{{value}}",
    "ev_to_ebitda_ttm": "{{value}}",
    "price_to_sales_ttm": "{{value}}",
    "peg": "{{value}}"
  },
  "peer_percentiles": {
    "revenue_growth_pctile": "{{value}}",
    "operating_margin_pctile": "{{value}}",
    "roic_pctile": "{{value}}",
    "valuation_pctile": "{{value}}",
    "balance_sheet_pctile": "{{value}}"
  },
  "sector_context": {
    "sector_score": "{{value}}",
    "sector_growth_breadth": "{{value}}",
    "sector_valuation_stretch": "{{value}}",
    "macro_fit": "{{value}}"
  },
  "quality_flags": {
    "restatement_flag": false,
    "missing_fields_count": 0,
    "anomaly_flags": ["none"],
    "data_freshness_score": "{{value}}",
    "reporting_confidence_score": "{{value}}"
  },
  "allowed_labels": {
    "rating_label": ["fundamentally_strong","balanced","weak","deteriorating"],
    "valuation_label": ["cheap","fair","expensive","extremely_expensive"],
    "direction_label": ["bullish_supportive","neutral","bearish_headwind"],
    "regime_label": ["compounder","cyclical_recovery","value_trap_risk","quality_at_premium","distressed","mixed"]
  },
  "required_output": {
    "rating_label": "string",
    "valuation_label": "string",
    "direction_label": "string",
    "regime_label": "string",
    "llm_confidence": "float_0_to_1",
    "strengths": ["string"],
    "weaknesses": ["string"],
    "reason_codes": ["string"],
    "explanation_short": "max_50_words"
  }
}
```


## Example output

```json
{
  "rating_label": "fundamentally_strong",
  "valuation_label": "expensive",
  "direction_label": "bullish_supportive",
  "regime_label": "quality_at_premium",
  "llm_confidence": 0.81,
  "strengths": ["high roic", "strong operating margin", "solid free cash flow conversion"],
  "weaknesses": ["above-peer valuation", "moderate leverage"],
  "reason_codes": ["high_roic", "strong_margin_profile", "premium_valuation"],
  "explanation_short": "Strong quality and cash generation support the business, but valuation limits upside from a purely fundamental perspective."
}
```


## Rule engine before the LLM

A deterministic rule layer should score the company first and send the structured factor pack to the LLM only for interpretation and contradiction detection.

### Pre-LLM steps

- Validate financial statement completeness.
- Compute all canonical ratios.
- Normalize against sector and size peers.
- Detect anomalies and restatements.
- Score each factor family.
- Generate preliminary labels from thresholds.
- Only then invoke the LLM for structured explanation.


### Example rule snippets

- High ROIC + high FCF conversion + strong margins = quality boost.
- Fast growth with weak cash conversion = downgrade quality confidence.
- Cheap valuation with deteriorating margins = potential value trap flag.
- Strong business with stretched valuation = quality_at_premium.
- Weak balance sheet + unstable earnings + expensive valuation = bearish_headwind.


## Memory and calibration

Your document wants the system to learn from past wins and losses, so the Fundamental Analyst should track whether its factor profiles actually correlate with better future outcomes in your selected universe.[^1]

### What to remember

Store for each scoring event:

- full factor pack,
- scores and labels,
- rank in sector and globally,
- subsequent 1m, 3m, 6m, and 12m returns,
- drawdowns,
- earnings miss/beat follow-ups,
- whether fundamental conviction improved strategist performance.


### What memory improves

- Reweight factors by sector.
- Reweight factors by market regime.
- Learn which valuation ratios matter most by industry.
- Penalize factors that look good on paper but are weak predictors in your universe.
- Improve confidence calibration over time.


## Database design

Use a relational store for facts and factor histories, with cache support for live dashboard reads.

### Recommended stack

- PostgreSQL for canonical data, factor history, and ranks.
- Redis for hot leaderboard states and dashboard refreshes.
- Optional object storage for raw filings and snapshots.
- Optional analytical warehouse later if you expand to many markets.

That fits your need for an audit trail, ranking logic, and time-series tracking.[^1]

### Suggested tables

- `coverage_universe`
- `filing_events`
- `financial_periods`
- `financial_facts`
- `consensus_estimates`
- `market_reference`
- `fundamental_features`
- `peer_normalizations`
- `sector_features`
- `fundamental_scores`
- `fundamental_states`
- `factor_outcomes`
- `agent_runs`


## API contract for downstream agents

The Chief Strategist should consume a compact, stable interface rather than raw filings.

### Suggested endpoints

- `GET /api/fundamentals/ticker/{ticker}`
- `GET /api/fundamentals/sector/{sector}`
- `GET /api/fundamentals/leaderboard`
- `GET /api/fundamentals/changes`
- `GET /api/fundamentals/feature-history/{ticker}`
- `WS /ws/fundamentals-stream`


### Example ticker response

```json
{
  "ticker": "AAPL",
  "as_of": "2026-04-25T13:30:00Z",
  "sector": "Information Technology",
  "composite_fundamental_score": 0.76,
  "final_confidence": 0.87,
  "rating_label": "fundamentally_strong",
  "valuation_label": "slightly_expensive",
  "direction_label": "bullish_supportive",
  "top_strengths": ["roic", "margin", "cash_flow"],
  "top_weaknesses": ["valuation"],
  "factor_scores": {
    "quality": 0.87,
    "growth": 0.79,
    "valuation": 0.42,
    "balance_sheet": 0.74
  }
}
```


## Autonomous agent instructions

This is the build-oriented instruction set you can later give to Claude Code or Codex.

### Build instructions

- Build the Fundamental Analyst as a modular service with separate collectors, calculators, scoring, interpretation, persistence, API, and dashboard layers.
- Use official structured financial data as the primary source of truth .
- Keep all accounting and ratio calculations deterministic and fully testable.
- Maintain a canonical mapping layer from raw source concepts to internal fields.
- Support both quarterly and TTM feature generation.
- Rank sectors first, then companies inside sectors, matching the top-down design in the planning document.[^1]
- Normalize factor values against peer groups by sector, industry, and size.
- Store both raw facts and derived features.
- Use the LLM only for structured interpretation and explanation from precomputed features.
- Force strict JSON outputs from the LLM.
- Add replay mode to rerun history after logic changes.
- Add unit tests for ratio formulas, peer normalization, missing-data handling, and confidence logic.
- Add anomaly detectors for restatements, one-offs, and low comparability.


### Runtime instructions

- Refresh market/reference data daily or intraday as needed.
- Refresh filing metadata continuously or every few minutes during reporting season .
- Recompute affected company scores only when new filings, estimates, or market reference data arrive.
- Maintain hot leaderboard snapshots in Redis for fast web delivery.
- Emit metrics for processing latency, coverage completeness, missing-field rates, and confidence distributions.


## Real-time dashboard design

The dashboard should show not just “best stocks,” but **why** the agent believes that, what changed recently, and how strong the data quality is. A real-time finance dashboard benefits from live updates, filtering, and low-latency data delivery rather than static reports.[^11][^12]

## Dashboard layout

Use a single-page web app with six zones.

### Top bar

- Agent health.
- Last full refresh.
- Number of companies covered.
- New filings today.
- Average confidence.
- Data completeness percentage.
- Dark/light mode toggle.


### Left filter rail

- Universe selector.
- Sector selector.
- Market-cap bucket selector.
- Rating filter.
- Confidence filter.
- Valuation filter.
- “Only changed since last run” toggle.


### Main panels

#### Sector outlook

This is the first panel because your design is top-down. Show sectors ranked by sector attractiveness, recent change, breadth, median quality, and valuation stretch.[^8][^7][^1]

#### Company leaderboard

A sortable table with:

- ticker,
- company name,
- sector,
- composite score,
- confidence,
- quality score,
- growth score,
- valuation score,
- balance-sheet score,
- sector rank,
- change since prior run.


#### Live changes feed

A real-time feed of events such as:

- new filing ingested,
- score changed materially,
- sector rank changed,
- confidence dropped,
- anomaly flag raised.


#### Company detail pane

When a row is clicked, show:

- factor score radar or bar chart,
- financial trend mini-charts,
- peer percentile profile,
- valuation versus sector,
- strengths / weaknesses,
- recent filing timeline,
- confidence breakdown.


#### Data quality pane

Show:

- stale data flags,
- missing fields,
- restatement or anomaly flags,
- coverage completeness by sector,
- pipeline latency.


#### Watchlist pane

Show user-selected stocks with:

- latest fundamental score,
- change since prior week/month,
- sector context,
- valuation label,
- fundamental direction label.


## Dashboard widgets

A strong first version should include:

- Sector heatmap colored by sector attractiveness[^13]
- Leaderboard table with sort and filters
- Factor bar chart for selected company
- Trend lines for revenue growth, margin, FCF, ROIC
- Peer percentile chart
- Valuation vs quality scatter plot
- Confidence donut or stacked bar
- Filing/event activity timeline[^12][^11]


## Suggested frontend stack

A suitable implementation is:

- React or Next.js frontend
- FastAPI or Node backend
- WebSocket stream for live changes
- PostgreSQL + Redis backend
- Plotly, Recharts, or ECharts for charts

This matches the requirements of a responsive real-time financial dashboard with filtering, tables, and multiple interactive panels.[^11]

## Dashboard data contract

### WebSocket update example

```json
{
  "type": "fundamental_score_update",
  "ticker": "AAPL",
  "as_of": "2026-04-25T13:30:00Z",
  "composite_fundamental_score": 0.76,
  "final_confidence": 0.87,
  "score_delta_30d": 0.04,
  "rating_label": "fundamentally_strong"
}
```


### Live feed item example

```json
{
  "type": "filing_processed",
  "ticker": "AAPL",
  "form_type": "10-Q",
  "filing_date": "2026-04-24",
  "changes": ["revenue growth improved", "valuation unchanged", "quality score up"],
  "confidence": 0.91
}
```


## Alerts

The Fundamental Analyst should emit selective alerts rather than constant noise.

### Suggested triggers

- `sector_upgrade`: sector score crosses above threshold.
- `company_rank_jump`: stock enters top decile in sector.
- `confidence_drop`: confidence falls sharply due to stale or incomplete data.
- `anomaly_flag`: restatement or unusual accounting distortion.
- `valuation_warning`: strong quality stock becomes extremely expensive.
- `deterioration_alert`: margin, leverage, or cash conversion weakens materially.


## MVP build order

Build in this order:

1. Coverage universe and sector mapping.
2. SEC filings + Company Facts ingestion .
3. Canonical financial schema.
4. Ratio engine and TTM logic.
5. Peer normalization and sector engine.
6. Composite scoring.
7. LLM structured interpretation.
8. API endpoints.
9. Web dashboard.
10. Outcome memory and calibration.
11. Alerts.

## Important design principles

- Never let the LLM compute accounting values.
- Never merge valuation and quality into one opaque number too early.
- Always separate “great company” from “great entry price.”
- Always normalize within peer context.
- Always score confidence independently from attractiveness.
- Always keep an audit trail from filing to factor to final score.


## What success looks like

A good Fundamental Analyst should give you a stable, explainable ranking of sectors and stocks based on real reported business quality and valuation context, not just a textual impression of “good company” or “hot sector”.[^3][^2][^1]

If you want, next I can do one of these:

1. Design the exact PostgreSQL schema with tables, indexes, and SQL for the Fundamental Analyst
2. Write a build-ready API spec and JSON schemas
3. Design the actual web dashboard UI in build-ready detail
4. Create a Claude Code / Codex implementation prompt pack for this agent
<span style="display:none">[^14][^15][^16]</span>

<div align="center">⁂</div>

[^1]: trading-system-planning.docx

[^2]: https://www.investopedia.com/terms/f/fundamentalanalysis.asp

[^3]: https://daloopa.com/blog/analyst-best-practices/guide-to-fundamental-analysis-top-down-approach

[^4]: https://arxiv.org/pdf/2401.00001.pdf

[^5]: https://daloopa.com/blog/analyst-best-practices/comprehensive-guide-to-sec-edgar-api-and-database

[^6]: https://www.ig.com/en/trading-strategies/fundamental-analysis-of-stocks--everything-you-need-to-know-250325

[^7]: https://arxiv.org/html/2401.00001v1

[^8]: https://www.investing.com/academy/analysis/how-to-analyze-sector-rotation/

[^9]: https://sec-api.io/docs/financial-statements

[^10]: https://dealcharts.org/blog/sec-edgar-api-guide

[^11]: https://intrinio.com/blog/building-analytics-dashboards-with-real-time-financial-data

[^12]: https://www.cyfe.com/finance-dashboards/

[^13]: https://finage.co.uk/blog/how-to-visualize-sector-rotation-in-dashboards--695ff22ef0118940953495e1

[^14]: https://www.lucid.now/blog/best-tools-real-time-financial-dashboards/

[^15]: https://www.tradingview.com/scripts/fundamental/

[^16]: https://www.reddit.com/r/algotrading/comments/wctt2c/how_to_extract_financial_fundamentals_from_sec/

