import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const envPath = path.join(rootDir, ".env");

function resolveFromRoot(value, fallback) {
  const target = value || fallback;
  return path.isAbsolute(target) ? target : path.join(rootDir, target);
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = value;
  }
}

loadDotEnv(envPath);

const piPerformanceMode = String(process.env.PI_PERFORMANCE_MODE || "false").toLowerCase() === "true";

function envNumber(name, fallback, piFallback = fallback) {
  return Number(process.env[name] || (piPerformanceMode ? piFallback : fallback));
}

function envBoolean(name, fallback, piFallback = fallback) {
  const value = process.env[name] ?? (piPerformanceMode ? piFallback : fallback);
  return String(value).toLowerCase() !== "false";
}

const autonomousDataEnabled = envBoolean("AGENCY_AUTONOMOUS_DATA_ENABLED", "true", "true");
const hasTwelveDataKey = Boolean(process.env.TWELVE_DATA_API_KEY);

function marketProvider(envName) {
  const requested = process.env[envName];
  if (autonomousDataEnabled && hasTwelveDataKey && (!requested || requested === "synthetic")) {
    return "twelvedata";
  }
  return requested || (hasTwelveDataKey ? "twelvedata" : "synthetic");
}

export const config = {
  piPerformanceMode,
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  databaseEnabled: String(process.env.DATABASE_ENABLED || "true").toLowerCase() !== "false",
  databaseProvider: process.env.DATABASE_PROVIDER || "sqlite",
  databasePath: resolveFromRoot(process.env.DATABASE_PATH, path.join("data", "sentiment-analyst.sqlite")),
  databaseUrl: process.env.DATABASE_URL || "",
  databaseAutosaveMs: envNumber("DATABASE_AUTOSAVE_MS", 15000, 60000),
  lightweightStateEnabled: envBoolean("LIGHTWEIGHT_STATE_ENABLED", "false", "true"),
  lightweightStatePath: resolveFromRoot(process.env.LIGHTWEIGHT_STATE_PATH, path.join("data", "runtime-state.json")),
  lightweightStateMaxDocuments: envNumber("LIGHTWEIGHT_STATE_MAX_DOCUMENTS", 500, 300),
  sqliteBackupEnabled:
    String(process.env.SQLITE_BACKUP_ENABLED || "true").toLowerCase() !== "false",
  sqliteBackupDir: resolveFromRoot(process.env.SQLITE_BACKUP_DIR, path.join("data", "backups")),
  sqliteBackupIntervalMs: envNumber("SQLITE_BACKUP_INTERVAL_MS", 21600000, 43200000),
  sqliteBackupRetentionCount: envNumber("SQLITE_BACKUP_RETENTION_COUNT", 28, 6),
  sqliteBackupRetentionDays: envNumber("SQLITE_BACKUP_RETENTION_DAYS", 14, 3),
  sqliteBackupOnStartup: envBoolean("SQLITE_BACKUP_ON_STARTUP", "true", "false"),
  universeName: process.env.UNIVERSE_NAME || "S&P 100 + QQQ Holdings",
  defaultWindow: process.env.DEFAULT_WINDOW || "1h",
  alertConfidenceThreshold: Number(process.env.ALERT_CONFIDENCE_THRESHOLD || 0.85),
  signalFreshnessMaxHours: Number(process.env.SIGNAL_FRESHNESS_MAX_HOURS || 72),
  activeAlertFreshnessMaxHours: Number(process.env.ACTIVE_ALERT_FRESHNESS_MAX_HOURS || 24),
  seedDataOnEmpty: String(process.env.SEED_DATA_ON_EMPTY || "false").toLowerCase() === "true",
  seedDataInDecisions: String(process.env.SEED_DATA_IN_DECISIONS || "false").toLowerCase() === "true",
  liveNewsEnabled: String(process.env.LIVE_NEWS_ENABLED || "true").toLowerCase() !== "false",
  liveNewsPollMs: envNumber("LIVE_NEWS_POLL_MS", 300000, 900000),
  liveNewsMaxItemsPerTicker: envNumber("LIVE_NEWS_MAX_ITEMS_PER_TICKER", 3, 2),
  liveNewsLookbackHours: Number(process.env.LIVE_NEWS_LOOKBACK_HOURS || 24),
  liveNewsRequestTimeoutMs: Number(process.env.LIVE_NEWS_REQUEST_TIMEOUT_MS || 12000),
  liveNewsRequestRetries: envNumber("LIVE_NEWS_REQUEST_RETRIES", 1, 0),
  autonomousDataEnabled,
  marketDataProvider: marketProvider("MARKET_DATA_PROVIDER"),
  marketDataInterval: process.env.MARKET_DATA_INTERVAL || "15min",
  marketDataHistoryPoints: Number(process.env.MARKET_DATA_HISTORY_POINTS || 18),
  marketDataCacheMs: Number(process.env.MARKET_DATA_CACHE_MS || 60000),
  marketDataRefreshMs: envNumber("MARKET_DATA_REFRESH_MS", 60000, 300000),
  marketDataRequestTimeoutMs: Number(process.env.MARKET_DATA_REQUEST_TIMEOUT_MS || 12000),
  twelveDataApiKey: process.env.TWELVE_DATA_API_KEY || "",
  marketFlowEnabled: String(process.env.MARKET_FLOW_ENABLED || "true").toLowerCase() !== "false",
  autoStartMarketFlow: envBoolean("AUTO_START_MARKET_FLOW", "true", "false"),
  marketFlowPollMs: envNumber("MARKET_FLOW_POLL_MS", 60000, 300000),
  marketFlowVolumeSpikeThreshold: Number(process.env.MARKET_FLOW_VOLUME_SPIKE_THRESHOLD || 2.2),
  marketFlowMinPriceMoveThreshold: Number(process.env.MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD || 0.01),
  marketFlowBlockTradeSpikeThreshold: Number(process.env.MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD || 3.8),
  marketFlowBlockTradeShockThreshold: Number(process.env.MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD || 2.2),
  marketFlowBlockTradeMinShares: Number(process.env.MARKET_FLOW_BLOCK_TRADE_MIN_SHARES || 500000),
  marketFlowBlockTradeMinNotionalUsd: Number(process.env.MARKET_FLOW_BLOCK_TRADE_MIN_NOTIONAL_USD || 25000000),
  marketFlowAbnormalVolumeMinNotionalUsd: Number(process.env.MARKET_FLOW_ABNORMAL_VOLUME_MIN_NOTIONAL_USD || 10000000),
  fundamentalMarketDataProvider:
    marketProvider("FUNDAMENTAL_MARKET_DATA_PROVIDER"),
  autoStartFundamentalMarketData: envBoolean("AUTO_START_FUNDAMENTAL_MARKET_DATA", "true", "false"),
  fundamentalMarketDataCacheMs: Number(process.env.FUNDAMENTAL_MARKET_DATA_CACHE_MS || 900000),
  fundamentalMarketDataRefreshMs: envNumber("FUNDAMENTAL_MARKET_DATA_REFRESH_MS", 900000, 1800000),
  fundamentalMarketDataRequestTimeoutMs: Number(process.env.FUNDAMENTAL_MARKET_DATA_REQUEST_TIMEOUT_MS || 12000),
  fundamentalMarketDataMaxCompaniesPerPoll: envNumber("FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL", 25, 8),
  fundamentalSecEnabled: String(process.env.FUNDAMENTAL_SEC_ENABLED || "true").toLowerCase() !== "false",
  autoStartSecFundamentals: envBoolean("AUTO_START_SEC_FUNDAMENTALS", "true", "false"),
  fundamentalSecPollMs: Number(process.env.FUNDAMENTAL_SEC_POLL_MS || 21600000),
  fundamentalSecLookbackHours: Number(process.env.FUNDAMENTAL_SEC_LOOKBACK_HOURS || 10800),
  fundamentalSecConcurrency: envNumber("FUNDAMENTAL_SEC_CONCURRENCY", 4, 1),
  fundamentalSecMaxCompaniesPerPoll: envNumber("FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL", 0, 8),
  screenerRequireLiveSecForEligible:
    String(process.env.SCREENER_REQUIRE_LIVE_SEC_FOR_ELIGIBLE || "false").toLowerCase() === "true",
  screenerMinReportingConfidence: Number(process.env.SCREENER_MIN_REPORTING_CONFIDENCE || 0.85),
  screenerMinDataFreshness: Number(process.env.SCREENER_MIN_DATA_FRESHNESS || 0.85),
  screenerMaxMissingFields: Number(process.env.SCREENER_MAX_MISSING_FIELDS || 2),
  screenerMinRevenueGrowth: Number(process.env.SCREENER_MIN_REVENUE_GROWTH || 0.08),
  screenerMinEpsGrowth: Number(process.env.SCREENER_MIN_EPS_GROWTH || 0.1),
  screenerMinOperatingMargin: Number(process.env.SCREENER_MIN_OPERATING_MARGIN || 0.12),
  screenerMinGrossMargin: Number(process.env.SCREENER_MIN_GROSS_MARGIN || 0.35),
  screenerMinCurrentRatio: Number(process.env.SCREENER_MIN_CURRENT_RATIO || 1),
  screenerMaxNetDebtToEbitda: Number(process.env.SCREENER_MAX_NET_DEBT_TO_EBITDA || 3),
  screenerMinFcfConversion: Number(process.env.SCREENER_MIN_FCF_CONVERSION || 0.75),
  screenerMinFcfMargin: Number(process.env.SCREENER_MIN_FCF_MARGIN || 0.08),
  screenerMaxPeTtm: Number(process.env.SCREENER_MAX_PE_TTM || 45),
  screenerMaxPeg: Number(process.env.SCREENER_MAX_PEG || 2.5),
  screenerMinFcfYield: Number(process.env.SCREENER_MIN_FCF_YIELD || 0.02),
  screenerEligibleScore: Number(process.env.SCREENER_ELIGIBLE_SCORE || 0.71),
  screenerWatchScore: Number(process.env.SCREENER_WATCH_SCORE || 0.43),
  brokerProvider: process.env.BROKER_PROVIDER || "alpaca",
  brokerAdapter: String(process.env.BROKER_ADAPTER || "rest").toLowerCase(),
  brokerTradingMode: process.env.BROKER_TRADING_MODE || "paper",
  brokerSubmitEnabled: String(process.env.BROKER_SUBMIT_ENABLED || "false").toLowerCase() === "true",
  brokerRequestTimeoutMs: Number(process.env.BROKER_REQUEST_TIMEOUT_MS || 12000),
  alpacaApiKeyId: process.env.ALPACA_API_KEY_ID || "",
  alpacaApiSecretKey: process.env.ALPACA_API_SECRET_KEY || "",
  alpacaPaperBaseUrl: process.env.ALPACA_PAPER_BASE_URL || "https://paper-api.alpaca.markets",
  alpacaLiveBaseUrl: process.env.ALPACA_LIVE_BASE_URL || "https://api.alpaca.markets",
  alpacaAllowLiveTrading: String(process.env.ALPACA_ALLOW_LIVE_TRADING || "false").toLowerCase() === "true",
  alpacaMcpConfigPath: resolveFromRoot(process.env.ALPACA_MCP_CONFIG_PATH, path.join(".vscode", "mcp.json")),
  alpacaMcpServerName: process.env.ALPACA_MCP_SERVER_NAME || "alpaca-paper",
  alpacaMcpCommand: process.env.ALPACA_MCP_COMMAND || "",
  alpacaMcpUvPath: process.env.ALPACA_MCP_UV_PATH || process.env.UV_PATH || "",
  alpacaMcpRequestTimeoutMs: Number(process.env.ALPACA_MCP_REQUEST_TIMEOUT_MS || 30000),
  alpacaMcpApiKey: process.env.ALPACA_API_KEY || process.env.ALPACA_API_KEY_ID || "",
  alpacaMcpSecretKey: process.env.ALPACA_SECRET_KEY || process.env.ALPACA_API_SECRET_KEY || "",
  alpacaMcpPaperTrade: process.env.ALPACA_PAPER_TRADE || "true",
  alpacaMcpToolsets: process.env.ALPACA_TOOLSETS || "account,trading,assets,stock-data,news",
  executionMinConviction: Number(process.env.EXECUTION_MIN_CONVICTION || 0.62),
  executionMinNotionalUsd: Number(process.env.EXECUTION_MIN_NOTIONAL_USD || 25),
  executionMaxOrderNotionalUsd: Number(process.env.EXECUTION_MAX_ORDER_NOTIONAL_USD || 1000),
  executionMaxPositionPct: Number(process.env.EXECUTION_MAX_POSITION_PCT || 0.03),
  executionDefaultEquityUsd: Number(process.env.EXECUTION_DEFAULT_EQUITY_USD || 100000),
  executionAllowShorts: String(process.env.EXECUTION_ALLOW_SHORTS || "false").toLowerCase() === "true",
  executionUseBracketOrders: String(process.env.EXECUTION_USE_BRACKET_ORDERS || "true").toLowerCase() !== "false",
  executionDefaultOrderType: process.env.EXECUTION_DEFAULT_ORDER_TYPE || "market",
  executionDefaultTimeInForce: process.env.EXECUTION_DEFAULT_TIME_IN_FORCE || "day",
  portfolioWeeklyTargetPct: Number(process.env.PORTFOLIO_WEEKLY_TARGET_PCT || 0.03),
  portfolioMaxWeeklyDrawdownPct: Number(process.env.PORTFOLIO_MAX_WEEKLY_DRAWDOWN_PCT || 0.04),
  portfolioMaxPositions: Number(process.env.PORTFOLIO_MAX_POSITIONS || process.env.EXECUTION_MAX_POSITIONS || 10),
  portfolioMaxNewPositionsPerCycle: Number(process.env.PORTFOLIO_MAX_NEW_POSITIONS_PER_CYCLE || 3),
  portfolioMaxPositionPct: Number(process.env.PORTFOLIO_MAX_POSITION_PCT || process.env.EXECUTION_MAX_POSITION_PCT || 0.03),
  portfolioMaxGrossExposurePct: Number(process.env.PORTFOLIO_MAX_GROSS_EXPOSURE_PCT || process.env.RISK_MAX_GROSS_EXPOSURE_PCT || 0.35),
  portfolioMaxSectorExposurePct: Number(process.env.PORTFOLIO_MAX_SECTOR_EXPOSURE_PCT || 0.18),
  portfolioCashReservePct: Number(process.env.PORTFOLIO_CASH_RESERVE_PCT || 0.1),
  portfolioDefaultStopLossPct: Number(process.env.PORTFOLIO_DEFAULT_STOP_LOSS_PCT || 0.06),
  portfolioDefaultTakeProfitPct: Number(process.env.PORTFOLIO_DEFAULT_TAKE_PROFIT_PCT || 0.09),
  portfolioTrailingStopPct: Number(process.env.PORTFOLIO_TRAILING_STOP_PCT || 0.04),
  portfolioMinHoldHours: Number(process.env.PORTFOLIO_MIN_HOLD_HOURS || 4),
  portfolioAllowAdds: String(process.env.PORTFOLIO_ALLOW_ADDS || "false").toLowerCase() === "true",
  portfolioAllowReductions: String(process.env.PORTFOLIO_ALLOW_REDUCTIONS || "true").toLowerCase() !== "false",
  llmSelectionEnabled: String(process.env.LLM_SELECTION_ENABLED || "false").toLowerCase() === "true",
  llmSelectionProvider: process.env.LLM_SELECTION_PROVIDER || "shadow",
  llmSelectionModel: process.env.LLM_SELECTION_MODEL || "policy-aware-shadow-reviewer",
  llmSelectionMinConfidence: Number(process.env.LLM_SELECTION_MIN_CONFIDENCE || 0.58),
  llmSelectionApiUrl: process.env.LLM_SELECTION_API_URL || "",
  llmSelectionApiKey: process.env.LLM_SELECTION_API_KEY || process.env.OPENAI_API_KEY || "",
  riskMaxGrossExposurePct: Number(process.env.RISK_MAX_GROSS_EXPOSURE_PCT || 0.35),
  riskMaxSingleNameExposurePct: Number(process.env.RISK_MAX_SINGLE_NAME_EXPOSURE_PCT || 0.08),
  riskMaxOpenOrders: Number(process.env.RISK_MAX_OPEN_ORDERS || 10),
  riskBlockWhenRuntimeConstrained:
    String(process.env.RISK_BLOCK_WHEN_RUNTIME_CONSTRAINED || "false").toLowerCase() === "true",
  secForm4Enabled: String(process.env.SEC_FORM4_ENABLED || "true").toLowerCase() !== "false",
  secForm4PollMs: Number(process.env.SEC_FORM4_POLL_MS || 600000),
  secForm4LookbackHours: Number(process.env.SEC_FORM4_LOOKBACK_HOURS || 72),
  sec13fEnabled: String(process.env.SEC_13F_ENABLED || "true").toLowerCase() !== "false",
  autoStartSec13f: envBoolean("AUTO_START_SEC_13F", "true", "false"),
  sec13fPollMs: Number(process.env.SEC_13F_POLL_MS || 43200000),
  sec13fLookbackHours: Number(process.env.SEC_13F_LOOKBACK_HOURS || 2400),
  secRequestTimeoutMs: Number(process.env.SEC_REQUEST_TIMEOUT_MS || 15000),
  secRequestRetries: envNumber("SEC_REQUEST_RETRIES", 1, 0),
  secTickerMapCacheMs: Number(process.env.SEC_TICKER_MAP_CACHE_MS || 86400000),
  secUserAgent:
    process.env.SEC_USER_AGENT || "SentimentAnalyst/1.0 contact=local@example.com",
  earningsEnabled: String(process.env.EARNINGS_ENABLED || "true").toLowerCase() !== "false",
  earningsProvider: process.env.EARNINGS_PROVIDER || "yahoo",
  earningsApiKey: process.env.EARNINGS_API_KEY || process.env.TWELVE_DATA_API_KEY || "",
  earningsLookAheadDays: Number(process.env.EARNINGS_LOOK_AHEAD_DAYS || 14),
  earningsPollMs: Number(process.env.EARNINGS_POLL_MS || 14400000),
  earningsRequestTimeoutMs: Number(process.env.EARNINGS_REQUEST_TIMEOUT_MS || 12000),
  earningsMaxTickersPerPoll: envNumber("EARNINGS_MAX_TICKERS_PER_POLL", 12, 6),
  stocktwitsEnabled: String(process.env.STOCKTWITS_ENABLED || "false").toLowerCase() !== "false",
  stocktwitsApiKey: process.env.STOCKTWITS_API_KEY || "",
  stocktwitsPollMs: Number(process.env.STOCKTWITS_POLL_MS || 300000),
  stocktwitsRequestTimeoutMs: Number(process.env.STOCKTWITS_REQUEST_TIMEOUT_MS || 10000),
  tradePrintsEnabled: String(process.env.TRADE_PRINTS_ENABLED || "false").toLowerCase() !== "false",
  tradePrintsProvider: process.env.TRADE_PRINTS_PROVIDER || "polygon",
  polygonApiKey: process.env.POLYGON_API_KEY || "",
  tradePrintsApiKey: process.env.TRADE_PRINTS_API_KEY || process.env.POLYGON_API_KEY || process.env.IEX_API_KEY || "",
  tradePrintsPollMs: Number(process.env.TRADE_PRINTS_POLL_MS || 60000),
  tradePrintsRequestTimeoutMs: Number(process.env.TRADE_PRINTS_REQUEST_TIMEOUT_MS || 12000),
  tradePrintsBlockTradeMinShares: Number(process.env.TRADE_PRINTS_BLOCK_TRADE_MIN_SHARES || 10000),
  tradePrintsBlockTradeMinNotionalUsd: Number(process.env.TRADE_PRINTS_BLOCK_TRADE_MIN_NOTIONAL_USD || 500000),
  executionEnabled: String(process.env.EXECUTION_ENABLED || "false").toLowerCase() === "true",
  executionConvictionThreshold: Number(process.env.EXECUTION_CONVICTION_THRESHOLD || 0.65),
  executionApprovalMaxPositionPct: Number(process.env.EXECUTION_APPROVAL_MAX_POSITION_PCT || 0.20),
  executionApprovalTimeoutMs: Number(process.env.EXECUTION_APPROVAL_TIMEOUT_MS || 600000),
  executionSyncMs: Number(process.env.EXECUTION_SYNC_MS || 180000),
  executionAccountSizeUsd: Number(process.env.EXECUTION_ACCOUNT_SIZE_USD || 100000),
  executionDailyLossLimitUsd: Number(process.env.EXECUTION_DAILY_LOSS_LIMIT_USD || -2000),
  executionMaxDrawdownPct: Number(process.env.EXECUTION_MAX_DRAWDOWN_PCT || 0.10),
  executionMaxPositions: Number(process.env.EXECUTION_MAX_POSITIONS || 10),
  envPath,
  rootDir,
  publicDir: path.join(rootDir, "src", "public"),
  dataDir: path.join(rootDir, "data"),
  sampleEventsPath: path.join(rootDir, "data", "sample-events.json"),
  sampleFundamentalsPath: path.join(rootDir, "data", "sample-fundamentals.json")
};
