# Portfolio Risk Agent

The Portfolio Risk Agent is the risk gate between order preview and order submission. It is designed as a reusable backend engine so dashboards, execution endpoints, scripts, and future automation can all ask the same question: "Would this trade keep the account inside the configured risk limits?"

## Position in the system

```text
Trade Setup Agent
-> Execution Agent builds order intent
-> Portfolio Risk Agent evaluates exposure and limits
-> Alpaca broker adapter submits only if both execution and risk allow it
```

## Inputs

When Alpaca credentials are configured, the agent reads:

- account equity and buying power
- current positions
- open orders
- runtime reliability pressure

When credentials are not configured, it uses `EXECUTION_DEFAULT_EQUITY_USD` as an offline planning account. This lets the system keep producing safe dry-run previews before broker setup is complete.

## Checks

The first version enforces:

- maximum gross exposure
- maximum single-name exposure
- maximum open orders
- optional runtime-constrained block

The agent returns both warnings and hard blocks. Warnings tell the UI the account is close to a limit; hard blocks prevent submission.

## Environment variables

```bash
RISK_MAX_GROSS_EXPOSURE_PCT=0.35
RISK_MAX_SINGLE_NAME_EXPOSURE_PCT=0.08
RISK_MAX_OPEN_ORDERS=10
RISK_BLOCK_WHEN_RUNTIME_CONSTRAINED=false
```

`RISK_BLOCK_WHEN_RUNTIME_CONSTRAINED=false` is the Pi-friendly default. It still reports runtime pressure, but it does not block paper-trading previews simply because Pi performance mode is enabled.

## API

```bash
GET /api/risk/status
POST /api/risk/evaluate
```

Example:

```bash
curl -s http://127.0.0.1:3000/api/risk/evaluate \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL","window":"1h"}'
```

The `/api/execution/preview` response also includes a `risk` block, and `/api/execution/orders` refuses submission when risk says no.
