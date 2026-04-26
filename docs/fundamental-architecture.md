# Fundamental Analyst Architecture

This document turns the planning note into a build-oriented contract for the next implementation stage after the local MVP.

## Current MVP

The repository now includes a deterministic Fundamental Analyst runtime with:

- replayable sample company fundamentals in [data/sample-fundamentals.json](../data/sample-fundamentals.json)
- a scoring engine in [src/domain/fundamentals.js](../src/domain/fundamentals.js)
- live HTTP endpoints in [src/http/router.js](../src/http/router.js)
- a dedicated dashboard in [src/public/fundamentals.html](../src/public/fundamentals.html)

The MVP is intentionally deterministic and offline-first. It proves the score model, dashboard flow, and contract boundaries before the live data adapters are introduced.

## Next production layers

### 1. Universe and mapping layer

Build a restart-safe universe service that maintains:

- ticker, company, sector, industry, exchange, and market-cap metadata
- ticker to CIK mapping
- peer-group keys by sector, industry, and size bucket
- alias mapping for alternate ticker forms and ADRs

Primary persistence target:

- `coverage_universe`

### 2. Filing ingestion layer

Add a collector for official SEC submissions metadata and XBRL facts.

Recommended live flow:

1. poll submissions metadata by CIK
2. detect new 10-Q, 10-K, 20-F, 40-F, 6-K, and material 8-K updates
3. persist each filing event
4. fetch or refresh structured facts for affected companies
5. enqueue feature recomputation only for impacted tickers

Primary persistence targets:

- `filing_events`
- `financial_periods`
- `financial_facts`

### 3. Canonical normalization layer

Map raw facts into stable internal fields before ratio logic runs.

Rules:

- keep original taxonomy, concept, and as-reported labels
- store canonical mappings separately from raw concepts
- support both quarterly and TTM reconstruction
- attach normalization notes when concepts are estimated or substituted

Primary persistence targets:

- `financial_facts`
- `peer_normalizations`

### 4. Feature and scoring layer

This stays deterministic.

The runtime in [src/domain/fundamentals.js](../src/domain/fundamentals.js) should remain the reference for:

- factor buckets
- sector scoring formula
- composite weighting
- confidence formula
- label assignment
- change-event generation

Production swap:

- replace sample input with persisted `financial_facts` and `market_reference`
- keep the output payloads stable

Primary persistence targets:

- `fundamental_features`
- `sector_features`
- `fundamental_scores`
- `fundamental_states`

### 5. Interpretation layer

The LLM must not calculate ratios. It should only interpret the deterministic factor pack.

Required behavior:

- consume precomputed factors only
- emit strict JSON
- classify contradictions and caveats
- generate short explanation text and reason codes

This can later enrich:

- `fundamental_scores.score_metadata`
- dashboard explanation fields

### 6. Calibration layer

Store realized outcomes so factor weights and confidence can be recalibrated.

Track:

- forward 1m, 3m, 6m, and 12m returns
- drawdowns
- follow-through after earnings
- strategist value-add if the agent is used in a larger system

Primary persistence target:

- `factor_outcomes`

## Contract files

The current contract set for fundamentals is:

- [schemas/fundamental-score.schema.json](../schemas/fundamental-score.schema.json)
- [schemas/fundamental-sector.schema.json](../schemas/fundamental-sector.schema.json)
- [schemas/fundamental-change.schema.json](../schemas/fundamental-change.schema.json)
- [schemas/fundamental-ticker-response.schema.json](../schemas/fundamental-ticker-response.schema.json)
- [schemas/fundamentals-dashboard.schema.json](../schemas/fundamentals-dashboard.schema.json)
- [openapi/openapi.yaml](../openapi/openapi.yaml)
- [sql/postgres-schema.sql](../sql/postgres-schema.sql)

## Recommended next implementation order

1. Add SEC submissions and Company Facts collectors.
2. Persist coverage, filings, periods, and facts into PostgreSQL.
3. Recompute fundamental features from persisted facts instead of sample JSON.
4. Add a real structured-output LLM adapter for explanation fields.
5. Add Redis-backed hot snapshots for the dashboard and leaderboard.
6. Add backtest and calibration jobs for factor outcomes.
