import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function isPlaceholder(value) {
  return !value || String(value).includes("REPLACE_WITH_") || String(value).startsWith("your_");
}

function findExecutable(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

function resolveMcpConfig() {
  const configPath = path.join(process.cwd(), ".vscode", "mcp.json");
  if (!existsSync(configPath)) {
    return {
      source: "environment",
      command: process.env.ALPACA_MCP_COMMAND || "alpaca-mcp-server",
      args: [],
      env: {
        ALPACA_API_KEY: process.env.ALPACA_API_KEY || process.env.ALPACA_API_KEY_ID || "",
        ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY || process.env.ALPACA_API_SECRET_KEY || "",
        ALPACA_PAPER_TRADE: process.env.ALPACA_PAPER_TRADE || "true",
        ALPACA_TOOLSETS: process.env.ALPACA_TOOLSETS || "account,trading,assets,stock-data,news"
      }
    };
  }

  const config = readJson(configPath);
  const server = config?.mcp?.servers?.["alpaca-paper"];
  if (!server) {
    throw new Error(".vscode/mcp.json exists but does not define mcp.servers.alpaca-paper.");
  }

  return {
    source: configPath,
    command: server.command,
    args: server.args || [],
    env: server.env || {}
  };
}

const home = homedir();
const uvPath = findExecutable([
  process.env.UV_PATH,
  path.join(home, "AppData", "Roaming", "Python", "Python314", "Scripts", "uv.exe"),
  path.join(home, ".local", "bin", "uv.exe"),
  path.join(home, ".local", "bin", "uv")
]);

const mcpConfig = resolveMcpConfig();
const env = {
  ALPACA_API_KEY: mcpConfig.env.ALPACA_API_KEY || "",
  ALPACA_SECRET_KEY: mcpConfig.env.ALPACA_SECRET_KEY || "",
  ALPACA_PAPER_TRADE: mcpConfig.env.ALPACA_PAPER_TRADE || "true",
  ALPACA_TOOLSETS: mcpConfig.env.ALPACA_TOOLSETS || "account,trading,assets,stock-data,news"
};

if (isPlaceholder(env.ALPACA_API_KEY) || isPlaceholder(env.ALPACA_SECRET_KEY)) {
  console.log(JSON.stringify({
    status: "not_configured",
    source: mcpConfig.source,
    paper_trade_env: env.ALPACA_PAPER_TRADE,
    reason: "Missing Alpaca paper key or secret in .vscode/mcp.json or environment.",
    orders_placed: false
  }, null, 2));
  process.exit(0);
}

if (!uvPath) {
  throw new Error("uv was not found. Install with: python -m pip install --user uv");
}

const pythonScript = `
import asyncio
import json
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    env = {
        "ALPACA_API_KEY": os.environ["ALPACA_API_KEY"],
        "ALPACA_SECRET_KEY": os.environ["ALPACA_SECRET_KEY"],
        "ALPACA_PAPER_TRADE": os.environ.get("ALPACA_PAPER_TRADE", "true"),
        "ALPACA_TOOLSETS": os.environ.get("ALPACA_TOOLSETS", "account,trading,assets,stock-data,news"),
    }
    args = json.loads(os.environ.get("ALPACA_MCP_ARGS", "[]"))
    params = StdioServerParameters(command=os.environ["ALPACA_MCP_COMMAND"], args=args, env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("get_account_info", {})
            text = "".join(getattr(item, "text", "") for item in result.content)
            payload = json.loads(text)
            tool_names = [tool.name for tool in tools.tools]
            print(json.dumps({
                "status": "ok",
                "server_started": True,
                "tool_count": len(tool_names),
                "has_get_account_info": "get_account_info" in tool_names,
                "has_place_stock_order": "place_stock_order" in tool_names,
                "paper_trade_env": env["ALPACA_PAPER_TRADE"],
                "account_status": payload.get("status"),
                "currency": payload.get("currency"),
                "trading_blocked": payload.get("trading_blocked"),
                "account_blocked": payload.get("account_blocked"),
                "transfers_blocked": payload.get("transfers_blocked"),
                "pattern_day_trader": payload.get("pattern_day_trader"),
                "shorting_enabled": payload.get("shorting_enabled"),
                "buying_power_available": bool(payload.get("buying_power")),
                "portfolio_value_available": bool(payload.get("portfolio_value")),
                "orders_placed": False
            }, indent=2))

asyncio.run(main())
`;

const result = spawnSync(uvPath, ["run", "--with", "mcp", "python", "-c", pythonScript], {
  encoding: "utf8",
  env: {
    ...process.env,
    ALPACA_API_KEY: env.ALPACA_API_KEY,
    ALPACA_SECRET_KEY: env.ALPACA_SECRET_KEY,
    ALPACA_PAPER_TRADE: env.ALPACA_PAPER_TRADE,
    ALPACA_TOOLSETS: env.ALPACA_TOOLSETS,
    ALPACA_MCP_COMMAND: mcpConfig.command,
    ALPACA_MCP_ARGS: JSON.stringify(mcpConfig.args || [])
  },
  timeout: 120000
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.stderr.write(result.stderr || "");
  process.stdout.write(result.stdout || "");
  process.exit(result.status || 1);
}

process.stdout.write(result.stdout);
