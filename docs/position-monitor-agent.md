# Position Monitor Agent

The Position Monitor Agent watches the brokerage-facing side of the trading system. It is intentionally downstream from the Execution Agent and Portfolio Risk Agent.

## Position in the system

```text
Alpaca account, positions, and open orders
+ current Trade Setup Agent output
+ Portfolio Risk Agent snapshot
-> Position Monitor Agent
-> dashboard, alerts, and future close/rebalance workflows
```

## What it does

The agent compares current positions with the latest trade setup view:

- `hold`: position is still aligned with the current setup
- `review`: setup has weakened, runtime/risk pressure matters, or unrealized P/L is large
- `close_candidate`: the position conflicts with a current `no_trade` or opposite setup

When Alpaca credentials are missing, the agent returns `not_configured` plus the top planning candidates from the Trade Setup Agent. These candidates are labeled with `tradable=true` for `long`/`short` setups and `tradable=false` for `watch`/`no_trade` setups, so the dashboard can still explain why an idea is blocked before paper-trading keys are added.

## Inputs

- Alpaca account, positions, and open orders through the broker adapter.
- Trade Setup Agent output for the active dashboard window.
- Portfolio Risk Agent snapshot for exposure, buying power, and runtime pressure.

## Review criteria

- A long position stays `hold` only when the current trade setup is still `long`.
- A short position stays `hold` only when the current trade setup is still `short`.
- A position becomes `close_candidate` when the latest setup is `no_trade` or conflicts with the held side.
- A position becomes `review` when no current setup exists, portfolio risk is blocked, or unrealized P/L is large enough to deserve human attention.
- Current setup risk flags are copied into the monitor reasons so the dashboard explains why a position needs attention.
- Planning candidates remain visible even when they are not tradable; the Execution Agent preview explains the block instead of hiding the idea.

The monitor does not close positions by itself. It is an engine that produces review actions for the dashboard and future guarded close/rebalance workflows.

## API

```bash
GET /api/positions/monitor
GET /api/positions/monitor?window=1h&limit=25
```

## Contract check

```bash
npm run check:positions
```
