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
POST /api/runtime-reliability/actions
```

`/api/health` includes a compact `runtime_reliability` section. `/api/runtime-reliability` returns the complete source-by-source view.

## Operator actions

The action endpoint is intentionally one-shot. It does not turn on permanent background polling and it does not rewrite `.env`.

Supported payloads:

```json
{ "action": "snapshot" }
{ "action": "refresh_universe" }
{ "action": "backup_now" }
{ "action": "apply_profile", "profile": "emergency", "apply": false }
{ "action": "apply_profile", "profile": "live_news_only", "apply": true }
{ "action": "poll_once", "source": "live_news" }
{ "action": "poll_once", "source": "market_flow" }
{ "action": "poll_once", "source": "sec_form4" }
{ "action": "poll_once", "source": "sec_13f" }
{ "action": "poll_once", "source": "sec_fundamentals" }
{ "action": "poll_once", "source": "fundamental_market_data" }
```

Disabled sources are blocked by default and return a clear error. Enable the relevant `.env` flag before running that source.

## Runtime profiles

Profiles are predefined `.env` operating modes:

- `emergency`: lowest-load recovery mode
- `live_news_only`: first live-data step using RSS news only
- `pi_light`: balanced Pi mode with expensive collectors manual
- `full_live`: maximum live coverage for a stable machine or off-Pi deployment

Profile actions are preview-only unless `apply=true` is included. Applying a profile writes `.env`, updates in-process config where possible, and returns a message reminding the operator to restart the service so timers and startup behavior fully reload.

The same profiles are available from the terminal:

```bash
npm run runtime:profiles
npm run runtime:profile -- preview live_news_only
npm run runtime:profile -- apply live_news_only --yes
sudo systemctl restart sentiment-analyst.service
```

The CLI creates an `.env` backup under `data/env-backups/` before writing.

## Current limits

The agent still does not automatically rewrite `.env`, restart collectors, or pause collectors. That is intentional: the Pi should not be surprised by hidden automation.

The next safe step is to add explicit operator actions:

- pause or resume a collector
- require confirmation before enabling high-cost sources
- apply a recommended `.env` profile
