# Sentiment Analyst MVP

This project implements a dependency-light version of the Sentiment Analyst pipeline described in the source note. The codebase is organized around contract-first development: database DDL, JSON Schemas, and the HTTP API spec are defined before the runtime pipeline.

## Runtime shape

1. `src/domain/pipeline.js` orchestrates ingestion, normalization, deduplication, scoring, aggregation, alerting, and event fanout.
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
- Real-time browser updates use Server-Sent Events for the MVP so the stack stays dependency-light.
