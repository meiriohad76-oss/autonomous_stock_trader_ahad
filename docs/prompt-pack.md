# Prompt Pack

Use these prompts when handing the repository to Codex or Claude for the next implementation stages.

## 1. Replace the simulated LLM scorer

```text
You are working inside the Sentiment Analyst MVP repository.

Goal:
Replace the deterministic simulated LLM scorer with a real structured-output model client while preserving the existing schema contracts.

Requirements:
- Keep the JSON output aligned with schemas/document-score.schema.json
- Keep the taxonomy fixed from src/domain/taxonomy.js
- Add retries, timeout handling, and malformed-output recovery
- Do not break scripts/check.js or scripts/replay.js
- Add a provider adapter boundary so the scorer can later support OpenAI and Anthropic separately

Deliverables:
- Updated scorer module
- Provider adapter interface
- Environment variable documentation
- Tests or validation hooks for malformed JSON and low-confidence fallbacks
```

## 2. Replace in-memory state with PostgreSQL and Redis

```text
You are working inside the Sentiment Analyst MVP repository.

Goal:
Swap the in-memory runtime state for PostgreSQL persistence and Redis-backed hot state while keeping the HTTP API stable.

Requirements:
- Use sql/postgres-schema.sql as the source of truth
- Preserve all current endpoints and payload shapes
- Make replay idempotent
- Store raw documents before normalization
- Persist dedupe clusters, document scores, sentiment states, source stats, and alert history
- Keep a local development mode that can still run without external services

Deliverables:
- Database access layer
- Redis cache layer
- Migration or bootstrapping instructions
- Updated README with local and production run modes
```

## 3. Add live collectors

```text
You are working inside the Sentiment Analyst MVP repository.

Goal:
Add real collectors for RSS, filings, and one structured market news API.

Requirements:
- Implement collectors as restart-safe adapters
- Normalize all input into the existing raw and normalized contracts
- Add source-specific rate limiting and backoff
- Preserve the sample replay path for offline development
- Emit health metrics for collector freshness and error counts

Deliverables:
- Collector modules
- Source config and credentials documentation
- Collector freshness data in /api/health
- Tests or replay fixtures for each collector
```

## 4. Deepen the dashboard

```text
You are working inside the Sentiment Analyst MVP repository.

Goal:
Upgrade the browser dashboard while preserving the current data contract.

Requirements:
- Keep the current visual language unless a stronger, deliberate redesign clearly improves usability
- Add a ticker trend chart and sector comparison chart
- Add loading, empty, and error states
- Keep the layout responsive on desktop and mobile
- Avoid adding heavy dependencies unless they materially improve the result

Deliverables:
- Updated src/public/index.html
- Updated src/public/app.js
- Updated src/public/styles.css
- Brief changelog in README
```

## 5. Add live SEC and XBRL ingestion for the Fundamental Analyst

```text
You are working inside the Sentiment Analyst MVP repository.

Goal:
Replace the sample-fundamentals replay source with live SEC submissions and Company Facts ingestion while preserving the current Fundamental Analyst API and dashboard payloads.

Requirements:
- Use sql/postgres-schema.sql as the persistence contract
- Preserve the payload shapes behind /api/fundamentals/dashboard, /api/fundamentals/ticker/{ticker}, and /api/fundamentals/sector/{sector}
- Poll SEC submissions metadata safely and respectfully
- Normalize raw concepts into canonical fields before scoring
- Keep all ratio, sector, and confidence logic deterministic
- Support a local fallback mode that still runs from data/sample-fundamentals.json when network access is disabled
- Add freshness and coverage telemetry into /api/health

Deliverables:
- SEC submissions collector
- Company Facts / XBRL facts collector
- Canonical mapping layer
- PostgreSQL persistence path for coverage, filings, periods, and facts
- Replay fixture or offline fallback for tests
```
