# Sentiment Analyst MVP

This project implements a dependency-light version of the Sentiment Analyst pipeline described in the source note. The codebase is organized around contract-first development: database DDL, JSON Schemas, and the HTTP API spec are defined before the runtime pipeline.

## Runtime shape

1. `src/domain/pipeline.js` orchestrates ingestion, normalization, deduplication, scoring, evidence-quality evaluation, aggregation, alerting, and event fanout.
2. `src/domain/store.js` keeps the in-memory runtime state used by the MVP server.
3. `src/http/router.js` serves JSON endpoints and an SSE stream for the dashboard.
4. `src/public/` contains the browser dashboard.
5. `data/sample-events.json` provides deterministic replayable market events for local verification.

## Production swap points

- Replace the in-memory store with PostgreSQL, Redis, and object storage implementations.
- Replace the simulated LLM scorer with a real structured-output model call.
- Replace `scripts/replay.js` and `data/sample-events.json` with live collectors.
- Keep the schema and API contracts stable while changing the underlying adapters.

## Key design choices

- JSON Schemas and SQL DDL are exact and versionable.
- Confidence is split into classification confidence and signal quality inputs before aggregation.
- Deduplication is deterministic and explainable.
- Evidence quality is a reusable backend engine. It runs before aggregation so dashboards, alerts, macro, and trade setup decisions share the same trust label and downstream weight.
- Runtime reliability is a reusable backend guardrail. It observes source health and Pi pressure, then adjusts trade setup conviction when live data quality is constrained.
- Real-time browser updates use Server-Sent Events for the MVP so the stack stays dependency-light.

## Evidence quality layer

The Evidence Quality Agent lives in `src/domain/evidence-quality.js`. It receives a normalized document, its dedupe cluster, and its document score, then emits:

- `data_quality_label`
- `display_tier`
- `downstream_weight`
- factor scores for freshness, source reliability, classification confidence, duplication, corroboration, extraction quality, and mapping confidence

The sentiment aggregator uses `downstream_weight` and `display_tier` before computing state. Alerts suppress low-value duplicate evidence. Trade setups use average evidence quality and runtime reliability to adjust conviction. The dashboard exposes the same verdict in feeds, signal drawers, system telemetry, and trade setup cards.
