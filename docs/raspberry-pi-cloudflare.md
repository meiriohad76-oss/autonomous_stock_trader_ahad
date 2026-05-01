# Raspberry Pi + Cloudflare Deployment

This project can run with the backend on a Raspberry Pi while the dashboard is exposed through a Cloudflare Tunnel.

## Recommended app env

```env
HOST=127.0.0.1
PORT=3000
DEPLOYMENT_TARGET=raspberry-pi
TUNNEL_PROVIDER=cloudflare
PUBLIC_BASE_URL=https://your-dashboard-domain.example
SSE_HEARTBEAT_MS=25000
DASHBOARD_MUTATIONS_ENABLED=false
DATABASE_PROVIDER=sqlite
DATABASE_PATH=data/sentiment-analyst.sqlite
```

## Why these settings

- `HOST=127.0.0.1`
  Use this when `cloudflared` runs on the same Pi and forwards to the Node process locally.
- `PUBLIC_BASE_URL`
  Lets the app and logs show the real public dashboard URL instead of only the local bind address.
- `SSE_HEARTBEAT_MS`
  Keeps the dashboard event stream alive through the tunnel during quiet periods.
- `DASHBOARD_MUTATIONS_ENABLED=false`
  Prevents public users from triggering replay or writing settings through the dashboard.

## Cloudflare tunnel shape

Typical setup:

- public hostname: `https://your-dashboard-domain.example`
- local service target: `http://127.0.0.1:3000`

Because the frontend calls relative paths like `/api/stream`, `/api/health`, and `/api/news/recent`, the tunnel should expose the same Node service for both the dashboard HTML and the API.

## Before going live

1. Confirm the app starts locally on the Pi.
2. Confirm the dashboard loads through the Cloudflare hostname.
3. Confirm `/api/stream` stays connected for several minutes without dropping.
4. Confirm replay/settings writes are disabled unless you intentionally want them public.
5. Confirm the SQLite or PostgreSQL path is writable by the service user.
