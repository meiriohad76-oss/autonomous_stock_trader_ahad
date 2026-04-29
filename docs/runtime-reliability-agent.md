# Runtime Reliability Agent

The Runtime Reliability Agent is the system's traffic-control layer. It is a backend engine, not only a dashboard widget. Its job is to decide whether the current machine and live-source plan are safe enough for more collectors, or whether expensive sources should stay manual.

## Position in the system

The agent runs beside the collectors and observes:

- runtime pressure from Node and the host machine
- live source health from `store.health.liveSources`
- persistence and backup health
- enabled/disabled state from `.env`
- auto-start policy from `.env`
- provider mode, including synthetic fallback providers

It does not replace the sentiment, evidence, fundamentals, macro, or trade setup engines. Instead, it gives those components a shared operational truth about data freshness and source reliability.

## Data flow

```text
Collectors and persistence
-> source health snapshots
-> Runtime Reliability Agent
-> /api/runtime-reliability
-> /api/health.runtime_reliability
-> dashboard/system panels
-> deploy scripts and future orchestrator controls
```

Downstream components should use it as a guardrail:

- dashboards show whether data is live, stale, fallback, disabled, or manual
- trade setup logic can reduce conviction when key sources are degraded
- deploy scripts can check whether the Pi is safe before enabling heavy collectors
- future scheduler/orchestrator logic can use the `collector_plan`

## Source classification

Each source receives:

- `status`: `healthy`, `fallback`, `manual`, `pending`, `polling`, `stale`, `degraded`, `error`, or `disabled`
- `action`: recommended next operational action
- `severity`: `info`, `warning`, or `critical`
- `reason`: human-readable explanation
- timing fields such as `last_success_at`, `last_poll_at`, and `age_hours`

The current source set includes:

- Fundamental Universe
- Live News
- Market Data
- Market Flow
- Fundamental Market Reference
- SEC Fundamentals
- SEC Form 4 Insider Flow
- SEC 13F Institutional Flow
- SQLite Backup

## Runtime pressure

The pressure model checks:

- Pi performance mode
- process RSS memory
- heap usage
- system free memory
- CPU load per core

When the system is constrained, the collector plan recommends keeping expensive collectors manual instead of auto-starting them.

## API

```bash
GET /api/runtime-reliability
GET /api/health
```

`/api/health` includes a compact `runtime_reliability` section. `/api/runtime-reliability` returns the complete source-by-source view.

## Current limits

This first version is advisory. It does not automatically rewrite `.env`, restart collectors, or pause collectors. That is intentional: the Pi should not be surprised by hidden automation.

The next safe step is to add explicit operator actions:

- apply a recommended `.env` profile
- run one collector once
- pause or resume a collector
- require confirmation before enabling high-cost sources
