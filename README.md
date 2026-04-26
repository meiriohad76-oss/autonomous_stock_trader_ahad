# Sentiment Analyst MVP

This repository contains a buildable MVP of the Sentiment Analyst pipeline plus a live dashboard, market-flow monitors, fundamentals coverage, persistence, and sample replay data.

## What is included

- Exact PostgreSQL DDL in [sql/postgres-schema.sql](./sql/postgres-schema.sql)
- JSON Schemas in [schemas](./schemas)
- OpenAPI contract in [openapi/openapi.yaml](./openapi/openapi.yaml)
- Runtime pipeline code in [src](./src)
- Sentiment dashboard in [src/public/index.html](./src/public/index.html)
- Fundamental dashboard in [src/public/fundamentals.html](./src/public/fundamentals.html)
- Replayable sample events in [data/sample-events.json](./data/sample-events.json)
- Replayable sample fundamentals in [data/sample-fundamentals.json](./data/sample-fundamentals.json)
- Architecture notes in [docs](./docs)

## Commands

Run these from the project root:

```bash
node scripts/check.js
node scripts/replay.js
node src/server.js
```

If you are testing PostgreSQL:

```bash
node scripts/postgres-smoke.js
```

Open the dashboard at your local bind URL or your public tunnel URL.

## Deployment notes

The app now supports a Raspberry Pi backend with a tunneled public dashboard.

Recommended environment variables for that setup:

```env
HOST=127.0.0.1
PORT=3000
DEPLOYMENT_TARGET=raspberry-pi
TUNNEL_PROVIDER=cloudflare
PUBLIC_BASE_URL=https://your-dashboard-domain.example
SSE_HEARTBEAT_MS=25000
DASHBOARD_MUTATIONS_ENABLED=false
```

Notes:

- Keep `HOST=127.0.0.1` if `cloudflared` runs on the same Pi and proxies local traffic into the app.
- Use `HOST=0.0.0.0` only if you intentionally need LAN access to the Node server itself.
- `DASHBOARD_MUTATIONS_ENABLED=false` is recommended for a public tunnel so replay and settings writes are disabled from the browser UI.
- SSE now sends heartbeat frames to stay healthy behind reverse proxies and tunnels during quiet periods.

See [docs/raspberry-pi-cloudflare.md](./docs/raspberry-pi-cloudflare.md) for a Pi-oriented checklist.

## Current runtime notes

- The app uses Server-Sent Events instead of WebSockets.
- The LLM scorer is still deterministic and rule-backed.
- Storage can use SQLite today and PostgreSQL when you are ready to switch.
- The app includes live Google News, SEC Form 4, SEC 13F, market-data, market-flow, and fundamentals collectors.
- Smart-money analysis now includes insider, institutional, and tape/block-flow views plus flow-specific alerts.

## Persistence

SQLite is already supported and works out of the box through:

- [data/sentiment-analyst.sqlite](./data/sentiment-analyst.sqlite)
- `DATABASE_PROVIDER=sqlite`

If you want to switch to PostgreSQL later, follow [docs/postgres-setup.md](./docs/postgres-setup.md).
