# Alpaca MCP Server

This project can use Alpaca's official MCP server for paper-trading operations from MCP clients such as VS Code and Claude Code.

## Local install

Installed locally with `uv`:

```powershell
python -m pip install --user uv
uv tool install alpaca-mcp-server
```

Verified version:

```powershell
C:\Users\meiri\.local\bin\alpaca-mcp-server.exe --version
```

Current installed version: `2.0.1`.

## VS Code

Local project config was created at:

```text
.vscode/mcp.json
```

That folder is ignored by Git, so paper keys will not be committed. Replace the placeholders:

```json
"ALPACA_API_KEY": "REPLACE_WITH_ALPACA_PAPER_KEY",
"ALPACA_SECRET_KEY": "REPLACE_WITH_ALPACA_PAPER_SECRET"
```

Keep this value for paper trading:

```json
"ALPACA_PAPER_TRADE": "true"
```

The configured toolsets are intentionally limited:

```json
"ALPACA_TOOLSETS": "account,trading,assets,stock-data,news"
```

This enables paper account, orders, positions, assets, stock data, and news while avoiding crypto/options/corporate-action tools for now.

## Claude Code

After you have paper keys, add the MCP server to Claude Code with:

```powershell
claude mcp add --scope user --transport stdio `
  -e ALPACA_API_KEY=your_alpaca_paper_key `
  -e ALPACA_SECRET_KEY=your_alpaca_paper_secret `
  -e ALPACA_PAPER_TRADE=true `
  -e ALPACA_TOOLSETS=account,trading,assets,stock-data,news `
  alpaca-paper -- C:\Users\meiri\.local\bin\alpaca-mcp-server.exe
```

Then verify in Claude Code:

```text
/mcp
```

## Project smoke test

Run the project-level read-only MCP check:

```powershell
npm run check:alpaca-mcp
```

The check starts the MCP server, lists tools, calls only `get_account_info`, and prints a sanitized account status. It never places orders and never prints keys.

## App broker adapter

The production app can also route the existing Execution, Risk, and Position Monitor agents through the MCP server instead of direct Alpaca REST. This keeps one safety path for preview, risk review, confirmation, and paper order submission.

Set these values in `.env`:

```env
BROKER_PROVIDER=alpaca
BROKER_ADAPTER=mcp
BROKER_TRADING_MODE=paper
BROKER_SUBMIT_ENABLED=false
ALPACA_MCP_CONFIG_PATH=.vscode/mcp.json
ALPACA_MCP_SERVER_NAME=alpaca-paper
ALPACA_MCP_REQUEST_TIMEOUT_MS=30000
ALPACA_PAPER_TRADE=true
```

Then run the read-only broker-adapter check:

```powershell
npm run check:alpaca-mcp-broker
```

This calls account, positions, and open orders through the MCP adapter. It does not place orders.

After restarting the service, confirm the app sees the MCP adapter:

```powershell
curl -s http://127.0.0.1:3000/api/execution/status
```

Look for:

```json
"adapter": "mcp"
```

## Safety

- Use paper keys only.
- Keep `ALPACA_PAPER_TRADE=true`.
- The app MCP adapter is currently paper-only. Use the direct REST adapter for any future separately approved live-trading path.
- Do not add live keys until the project has a separate live-trading approval gate.
- Keep `BROKER_SUBMIT_ENABLED=false` until account, positions, risk, and preview checks pass.
- The app MCP adapter only calls `place_stock_order`; it does not call crypto or options order tools.
- MCP tools can place/cancel orders, so use them through the same project workflow: setup review, risk review, preview, then paper order.
