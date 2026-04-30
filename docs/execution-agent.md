# Execution Agent

The Execution Agent is the bridge between analysis and brokerage. It is a backend engine, not only a dashboard button. Its job is to turn a Trade Setup Agent recommendation into a guarded broker order preview, and only submit that order when explicit safety gates are enabled.

## Position in the system

```text
Live collectors
-> Evidence Quality Agent
-> Sentiment, Fundamentals, Macro Regime
-> Trade Setup Agent
-> Execution Agent
-> Portfolio Risk Agent
-> Alpaca broker adapter
-> paper/live brokerage account
```

The Execution Agent does not decide whether a stock is interesting. That remains the job of the upstream agents. It asks a narrower question:

- Is the setup actionable (`long` or `short`)?
- Is conviction high enough?
- Is price and position sizing available?
- Is the proposed notional within configured risk limits?
- Is the broker configured?
- Is order submission explicitly enabled?
- Does Portfolio Risk Agent allow the proposed exposure?

## Safety model

The default mode is preview-only. No order can be submitted unless all of these are true:

- `BROKER_PROVIDER=alpaca`
- `BROKER_ADAPTER=rest` or `BROKER_ADAPTER=mcp`
- `BROKER_TRADING_MODE=paper` for paper trading, or `live` for live trading
- direct REST mode has `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` configured
- MCP mode has `.vscode/mcp.json` or MCP environment credentials configured
- `BROKER_SUBMIT_ENABLED=true`
- live trading additionally requires `ALPACA_ALLOW_LIVE_TRADING=true`
- the API caller sends `confirm="paper-trade"` or `confirm="live-trade"`
- the setup action is `long` or `short`
- setup conviction is at least `EXECUTION_MIN_CONVICTION`
- proposed order size passes notional and position-size limits
- Portfolio Risk Agent passes gross exposure, single-name exposure, and open-order checks

Short selling is blocked unless `EXECUTION_ALLOW_SHORTS=true`.

## Alpaca adapters

The default broker adapter is direct Alpaca Trading API:

- paper base URL: `https://paper-api.alpaca.markets`
- live base URL: `https://api.alpaca.markets`
- account endpoint: `GET /v2/account`
- positions endpoint: `GET /v2/positions`
- orders endpoint: `GET /v2/orders`
- submit endpoint: `POST /v2/orders`

The adapter uses Alpaca's documented key headers:

- `APCA-API-KEY-ID`
- `APCA-API-SECRET-KEY`

The optional MCP adapter uses Alpaca's official MCP server. It exposes the same project broker contract to the Execution, Risk, and Position Monitor agents:

- account tool: `get_account_info`
- positions tool: `get_all_positions`
- orders tool: `get_orders`
- submit tool: `place_stock_order`

The project adapter intentionally calls only `place_stock_order` for submission. Crypto and options order tools may exist on the MCP server, but the execution path does not use them.

The MCP adapter is currently paper-only. Keep `BROKER_TRADING_MODE=paper` and `ALPACA_PAPER_TRADE=true` for this path.

## Order construction

The first version builds equity orders from trade setup fields:

- `action=long` becomes `side=buy`
- `action=short` becomes `side=sell`
- quantity is derived from capped notional divided by current price
- default order type is `market`
- default time in force is `day`
- bracket orders are enabled by default when stop loss and take profit are valid
- when bracket orders are enabled, quantity is rounded down to whole shares to avoid fractional bracket-order compatibility issues

The estimated notional is capped by:

- setup `position_size_pct`
- `EXECUTION_MAX_POSITION_PCT`
- `EXECUTION_MAX_ORDER_NOTIONAL_USD`
- account buying power for long orders when credentials are available

## Environment variables

```bash
BROKER_PROVIDER=alpaca
BROKER_ADAPTER=rest
BROKER_TRADING_MODE=paper
BROKER_SUBMIT_ENABLED=false
BROKER_REQUEST_TIMEOUT_MS=12000
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_PAPER_BASE_URL=https://paper-api.alpaca.markets
ALPACA_LIVE_BASE_URL=https://api.alpaca.markets
ALPACA_ALLOW_LIVE_TRADING=false
ALPACA_MCP_CONFIG_PATH=.vscode/mcp.json
ALPACA_MCP_SERVER_NAME=alpaca-paper
ALPACA_MCP_REQUEST_TIMEOUT_MS=30000
ALPACA_PAPER_TRADE=true
EXECUTION_MIN_CONVICTION=0.62
EXECUTION_MIN_NOTIONAL_USD=25
EXECUTION_MAX_ORDER_NOTIONAL_USD=1000
EXECUTION_MAX_POSITION_PCT=0.03
EXECUTION_DEFAULT_EQUITY_USD=100000
EXECUTION_ALLOW_SHORTS=false
EXECUTION_USE_BRACKET_ORDERS=true
EXECUTION_DEFAULT_ORDER_TYPE=market
EXECUTION_DEFAULT_TIME_IN_FORCE=day
```

## API

```bash
GET /api/execution/status
GET /api/execution/account
GET /api/execution/positions
GET /api/execution/orders?status=open&limit=50
POST /api/execution/preview
POST /api/execution/orders
GET /api/risk/status
POST /api/risk/evaluate
```

Preview a generated order:

```bash
curl -s http://127.0.0.1:3000/api/execution/preview \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL","window":"1h"}'
```

Submit a paper order only after credentials and `BROKER_SUBMIT_ENABLED=true` are configured:

```bash
curl -s http://127.0.0.1:3000/api/execution/orders \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL","window":"1h","confirm":"paper-trade"}'
```

## Contract check

```bash
npm run check:execution
```

The check uses local mock setups and never contacts Alpaca.
