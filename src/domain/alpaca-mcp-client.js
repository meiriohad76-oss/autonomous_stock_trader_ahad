import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ALLOWED_TOOLS = new Set([
  "get_account_info",
  "get_all_positions",
  "get_orders",
  "place_stock_order"
]);

function normalizedMode(config) {
  return String(config.brokerTradingMode || "paper").toLowerCase() === "live" ? "live" : "paper";
}

function isPlaceholder(value) {
  const text = String(value || "");
  return !text || text.includes("REPLACE_WITH_") || text.startsWith("your_");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function findExecutable(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

function resolveUvCommand(config) {
  const home = homedir();
  return findExecutable([
    config.alpacaMcpUvPath,
    process.env.UV_PATH,
    path.join(home, "AppData", "Roaming", "Python", "Python314", "Scripts", "uv.exe"),
    path.join(home, "AppData", "Roaming", "Python", "Python313", "Scripts", "uv.exe"),
    path.join(home, ".local", "bin", "uv.exe"),
    path.join(home, ".local", "bin", "uv")
  ]) || config.alpacaMcpUvPath || process.env.UV_PATH || "uv";
}

function envFromProcess(config) {
  return {
    ALPACA_API_KEY: config.alpacaMcpApiKey || process.env.ALPACA_API_KEY || process.env.ALPACA_API_KEY_ID || "",
    ALPACA_SECRET_KEY:
      config.alpacaMcpSecretKey || process.env.ALPACA_SECRET_KEY || process.env.ALPACA_API_SECRET_KEY || "",
    ALPACA_PAPER_TRADE: config.alpacaMcpPaperTrade || process.env.ALPACA_PAPER_TRADE || "true",
    ALPACA_TOOLSETS:
      config.alpacaMcpToolsets || process.env.ALPACA_TOOLSETS || "account,trading,assets,stock-data,news"
  };
}

export function resolveAlpacaMcpLaunchConfig(config) {
  const configPath = config.alpacaMcpConfigPath;
  const serverName = config.alpacaMcpServerName || "alpaca-paper";
  const fallbackEnv = envFromProcess(config);

  if (configPath && existsSync(configPath)) {
    const mcpConfig = readJson(configPath);
    const servers = mcpConfig?.mcp?.servers || mcpConfig?.servers || {};
    const server = servers[serverName];
    if (!server) {
      throw new Error(`${configPath} exists but does not define MCP server "${serverName}".`);
    }

    return {
      source: configPath,
      server_name: serverName,
      uv_command: resolveUvCommand(config),
      command: server.command || config.alpacaMcpCommand || "alpaca-mcp-server",
      args: server.args || [],
      env: {
        ...fallbackEnv,
        ...(server.env || {})
      }
    };
  }

  return {
    source: "environment",
    server_name: serverName,
    uv_command: resolveUvCommand(config),
    command: config.alpacaMcpCommand || process.env.ALPACA_MCP_COMMAND || "alpaca-mcp-server",
    args: config.alpacaMcpArgs || [],
    env: fallbackEnv
  };
}

export function buildAlpacaMcpStatus(config) {
  let launch = null;
  let configError = null;
  try {
    launch = resolveAlpacaMcpLaunchConfig(config);
  } catch (error) {
    configError = error.message;
  }

  const mode = normalizedMode(config);
  const env = launch?.env || envFromProcess(config);
  const hasKeys = !isPlaceholder(env.ALPACA_API_KEY) && !isPlaceholder(env.ALPACA_SECRET_KEY);
  const paperTrade = String(env.ALPACA_PAPER_TRADE || "true").toLowerCase() !== "false";
  const liveBlocked = mode === "live";
  const paperMismatch = mode === "paper" && !paperTrade;
  const configured = Boolean(launch?.command && hasKeys && !configError && !paperMismatch && !liveBlocked);

  return {
    provider: "alpaca",
    adapter: "mcp",
    mode,
    base_url: mode === "live" ? config.alpacaLiveBaseUrl : config.alpacaPaperBaseUrl,
    configured,
    submit_enabled: Boolean(config.brokerSubmitEnabled),
    live_trading_allowed: Boolean(config.alpacaAllowLiveTrading),
    ready_for_account_calls: configured,
    ready_for_order_submission: configured && config.brokerSubmitEnabled && !liveBlocked,
    blocked_reason: configError
      ? "alpaca_mcp_config_error"
      : !hasKeys
        ? "missing_alpaca_mcp_credentials"
        : paperMismatch
          ? "ALPACA_PAPER_TRADE_must_be_true_for_paper_mode"
          : liveBlocked
            ? "alpaca_mcp_adapter_is_currently_paper_only"
            : config.brokerSubmitEnabled
              ? null
              : "BROKER_SUBMIT_ENABLED_is_false",
    mcp: {
      source: launch?.source || "unresolved",
      server_name: launch?.server_name || config.alpacaMcpServerName || "alpaca-paper",
      command_configured: Boolean(launch?.command),
      uv_command_configured: Boolean(launch?.uv_command),
      paper_trade_env: env.ALPACA_PAPER_TRADE || "true",
      stock_order_tool: "place_stock_order",
      config_error: configError
    }
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Alpaca MCP request timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs || 30000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Alpaca MCP process exited with code ${code}.`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function callAlpacaMcpTool(config, toolName, toolArgs = {}) {
  if (!ALLOWED_TOOLS.has(toolName)) {
    throw new Error(`Alpaca MCP tool "${toolName}" is not allowed by this project adapter.`);
  }

  const launch = resolveAlpacaMcpLaunchConfig(config);
  const timeoutMs = config.alpacaMcpRequestTimeoutMs || config.brokerRequestTimeoutMs || 30000;
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
    server_args = json.loads(os.environ.get("ALPACA_MCP_ARGS", "[]"))
    tool_name = os.environ["ALPACA_MCP_TOOL_NAME"]
    tool_args = json.loads(os.environ.get("ALPACA_MCP_TOOL_ARGS", "{}"))
    params = StdioServerParameters(command=os.environ["ALPACA_MCP_COMMAND"], args=server_args, env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, tool_args)
            text = "".join(getattr(item, "text", "") for item in result.content).strip()
            try:
                payload = json.loads(text) if text else None
            except json.JSONDecodeError:
                payload = {"raw": text}
            print(json.dumps({"ok": True, "tool": tool_name, "payload": payload}))

asyncio.run(main())
`;

  const stdout = await runProcess(launch.uv_command, ["run", "--with", "mcp", "python", "-c", pythonScript], {
    encoding: "utf8",
    timeoutMs,
    env: {
      ...process.env,
      ...launch.env,
      ALPACA_MCP_COMMAND: launch.command,
      ALPACA_MCP_ARGS: JSON.stringify(launch.args || []),
      ALPACA_MCP_TOOL_NAME: toolName,
      ALPACA_MCP_TOOL_ARGS: JSON.stringify(toolArgs || {})
    }
  });

  const parsed = JSON.parse(stdout);
  return parsed.payload;
}

export function mapStockOrderToMcpArgs(order) {
  const symbol = String(order?.symbol || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) {
    throw new Error(`Alpaca MCP stock adapter only accepts plain stock symbols. Received "${order?.symbol || ""}".`);
  }

  const side = String(order?.side || "").toLowerCase();
  if (!["buy", "sell"].includes(side)) {
    throw new Error(`Unsupported Alpaca stock order side: ${order?.side || ""}`);
  }

  const args = {
    symbol,
    side,
    type: order.type || "market",
    time_in_force: order.time_in_force || "day"
  };

  [
    "qty",
    "notional",
    "limit_price",
    "stop_price",
    "trail_price",
    "trail_percent",
    "extended_hours",
    "client_order_id",
    "order_class"
  ].forEach((key) => {
    if (order[key] !== undefined && order[key] !== null && order[key] !== "") {
      args[key] = order[key];
    }
  });

  if (order?.take_profit?.limit_price) {
    args.take_profit_limit_price = order.take_profit.limit_price;
  }
  if (order?.stop_loss?.stop_price) {
    args.stop_loss_stop_price = order.stop_loss.stop_price;
  }
  if (order?.stop_loss?.limit_price) {
    args.stop_loss_limit_price = order.stop_loss.limit_price;
  }

  return args;
}
