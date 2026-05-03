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

const placeholderCredentialNames = new Set();

function isPlaceholderCredential(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  const compact = lower.replace(/[\s._-]+/g, "_");

  return (
    /^your_/.test(compact) ||
    /^replace_with_/.test(compact) ||
    /^replace_/.test(compact) ||
    /^paste_/.test(compact) ||
    /^insert_/.test(compact) ||
    /_here$/.test(compact) ||
    ["changeme", "change_me", "todo", "tbd", "none", "null", "undefined", "xxx", "xxxxx"].includes(compact) ||
    /^<[^>]+>$/.test(normalized)
  );
}

function envCredential(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return "";
  }

  const value = stripWrappingQuotes(String(raw).trim());
  if (!value) {
    return "";
  }

  if (isPlaceholderCredential(value)) {
    placeholderCredentialNames.add(name);
    return "";
  }

  return value;
}

function firstCredential(...names) {
  for (const name of names) {
    const value = envCredential(name);
    if (value) {
      return value;
    }
  }
  return "";
}

const autonomousDataEnabled = envBoolean("AGENCY_AUTONOMOUS_DATA_ENABLED", "true", "true");
const twelveDataApiKey = envCredential("TWELVE_DATA_API_KEY");
const marketauxApiKey = envCredential("MARKETAUX_API_KEY");
const stocktwitsApiKey = envCredential("STOCKTWITS_API_KEY");
const polygonApiKey = envCredential("POLYGON_API_KEY");
const iexApiKey = envCredential("IEX_API_KEY");
const genericTradePrintsApiKey = envCredential("TRADE_PRINTS_API_KEY");
const alpacaMarketDataApiKeyId = firstCredential(
  "ALPACA_MARKET_DATA_API_KEY_ID",
  "ALPACA_API_KEY_ID",
  "ALPACA_API_KEY"
);
const alpacaMarketDataApiSecretKey = firstCredential(
  "ALPACA_MARKET_DATA_API_SECRET_KEY",
  "ALPACA_API_SECRET_KEY",
  "ALPACA_SECRET_KEY"
);
const alpacaApiKeyId = firstCredential("ALPACA_API_KEY_ID", "ALPACA_API_KEY");
const alpacaApiSecretKey = firstCredential("ALPACA_API_SECRET_KEY", "ALPACA_SECRET_KEY");
const llmSelectionApiKey = firstCredential("LLM_SELECTION_API_KEY", "OPENAI_API_KEY");
const llmSelectionProvider = String(process.env.LLM_SELECTION_PROVIDER || (llmSelectionApiKey ? "openai" : "shadow")).toLowerCase();
const llmSelectionModel =
  process.env.LLM_SELECTION_MODEL || (llmSelectionProvider === "openai" ? "gpt-5.4-mini" : "policy-aware-shadow-reviewer");
const llmSelectionApiUrl =
  process.env.LLM_SELECTION_API_URL || (llmSelectionProvider === "openai" ? "https://api.openai.com/v1/responses" : "");
const earningsApiKey = firstCredential("EARNINGS_API_KEY", "TWELVE_DATA_API_KEY");
const hasTwelveDataKey = Boolean(twelveDataApiKey);
const hasStocktwitsKey = Boolean(stocktwitsApiKey);
const hasPolygonKey = Boolean(polygonApiKey);
const hasIexKey = Boolean(iexApiKey);
const hasGenericTradePrintsKey = Boolean(genericTradePrintsApiKey);
const hasAlpacaMarketDataKey = Boolean(alpacaMarketDataApiKeyId && alpacaMarketDataApiSecretKey);
const alpacaMarketDataEnabled =
  String(process.env.ALPACA_MARKET_DATA_ENABLED || (hasAlpacaMarketDataKey ? "true" : "false")).toLowerCase() !==
  "false";
const marketauxEnabled =
  String(process.env.MARKETAUX_ENABLED || (marketauxApiKey ? "true" : "false")).toLowerCase() !==
  "false";
const stocktwitsEnabled =
  String(process.env.STOCKTWITS_ENABLED || (hasStocktwitsKey ? "true" : "false")).toLowerCase() !== "false";
const tradePrintsEnabled =
  String(
    process.env.TRADE_PRINTS_ENABLED ||
      (hasGenericTradePrintsKey || hasPolygonKey || hasIexKey ? "true" : "false")
  ).toLowerCase() !== "false";

function marketProvider(envName, { allowAlpaca = true } = {}) {
  const requested = process.env[envName];
  if (autonomousDataEnabled && allowAlpaca && alpacaMarketDataEnabled && hasAlpacaMarketDataKey && (!requested || requested === "synthetic")) {
    return "alpaca";
  }
  if (autonomousDataEnabled && hasTwelveDataKey && (!requested || requested === "synthetic")) {
    return "twelvedata";
  }
  return requested || (allowAlpaca && alpacaMarketDataEnabled && hasAlpacaMarketDataKey ? "alpaca" : hasTwelveDataKey ? "twelvedata" : "synthetic");
}

const selectedMarketDataProvider = marketProvider("MARKET_DATA_PROVIDER");
const selectedFundamentalMarketDataProvider = marketProvider("FUNDAMENTAL_MARKET_DATA_PROVIDER");
const selectedMarketDataIsTwelve = selectedMarketDataProvider === "twelvedata";
const selectedFundamentalMarketDataIsTwelve = selectedFundamentalMarketDataProvider === "twelvedata";
const selectedTradePrintsProvider =
  String(process.env.TRADE_PRINTS_PROVIDER || "").trim().toLowerCase() ||
  (hasPolygonKey || hasGenericTradePrintsKey ? "polygon" : hasIexKey ? "iex" : "polygon");
const selectedTradePrintsApiKey =
  genericTradePrintsApiKey ||
  (selectedTradePrintsProvider === "iex" ? iexApiKey : polygonApiKey) ||
  "";
const selectionWorkflowTestMode =
  String(process.env.SELECTION_WORKFLOW_TEST_MODE || "false").toLowerCase() === "true";
const selectionWorkflowTestLongThreshold = Number(process.env.SELECTION_WORKFLOW_TEST_LONG_THRESHOLD || 0.36);
const selectionWorkflowTestShortThreshold = Number(process.env.SELECTION_WORKFLOW_TEST_SHORT_THRESHOLD || 0.36);
const selectionWorkflowTestDirectionGap = Number(process.env.SELECTION_WORKFLOW_TEST_DIRECTION_GAP || 0.04);
const selectionWorkflowTestWatchThreshold = Number(process.env.SELECTION_WORKFLOW_TEST_WATCH_THRESHOLD || 0.25);
const selectionWorkflowTestFinalConviction = Number(process.env.SELECTION_WORKFLOW_TEST_FINAL_CONVICTION || 0.28);
const selectionWorkflowTestLlmMinConfidence = Number(process.env.SELECTION_WORKFLOW_TEST_LLM_MIN_CONFIDENCE || 0.25);
const selectionWorkflowTestMaxRuntimePenalty = Number(process.env.SELECTION_WORKFLOW_TEST_MAX_RUNTIME_PENALTY || 0.04);
const selectionWorkflowTestMaxRiskPenalty = Number(process.env.SELECTION_WORKFLOW_TEST_MAX_RISK_PENALTY || 0.03);

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
  agencyInitialBaselineCycleMs: envNumber("AGENCY_INITIAL_BASELINE_CYCLE_MS", 300000, 600000),
  agencyOngoingCycleMs: envNumber("AGENCY_ONGOING_CYCLE_MS", 900000, 900000),
  agencyBaselineUniverseMinCount: Number(process.env.AGENCY_BASELINE_UNIVERSE_MIN_COUNT || 160),
  agencyBaselineRequireFullSec:
    String(process.env.AGENCY_BASELINE_REQUIRE_FULL_SEC || "true").toLowerCase() === "true",
  agencyBaselineMinSecCoveragePct: Number(process.env.AGENCY_BASELINE_MIN_SEC_COVERAGE_PCT || 0.99),
  agencyBaselineMinSignalSources: Number(process.env.AGENCY_BASELINE_MIN_SIGNAL_SOURCES || 3),
  agencyBaselineSecBatchesPerRun: envNumber("AGENCY_BASELINE_SEC_BATCHES_PER_RUN", 4, 3),
  seedDataOnEmpty: String(process.env.SEED_DATA_ON_EMPTY || "false").toLowerCase() === "true",
  seedDataInDecisions: String(process.env.SEED_DATA_IN_DECISIONS || "false").toLowerCase() === "true",
  liveNewsEnabled: String(process.env.LIVE_NEWS_ENABLED || "true").toLowerCase() !== "false",
  liveNewsPollMs: envNumber("LIVE_NEWS_POLL_MS", 900000, 900000),
  liveNewsMaxItemsPerTicker: envNumber("LIVE_NEWS_MAX_ITEMS_PER_TICKER", 3, 2),
  liveNewsLookbackHours: Number(process.env.LIVE_NEWS_LOOKBACK_HOURS || 24),
  liveNewsUniverseMode: process.env.LIVE_NEWS_UNIVERSE_MODE || "full",
  liveNewsRssFallbackMaxTickers: envNumber("LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS", 20, 10),
  liveNewsRequestTimeoutMs: Number(process.env.LIVE_NEWS_REQUEST_TIMEOUT_MS || 12000),
  liveNewsRequestRetries: envNumber("LIVE_NEWS_REQUEST_RETRIES", 1, 0),
  marketauxEnabled,
  marketauxApiKey,
  marketauxBaseUrl: process.env.MARKETAUX_BASE_URL || "https://api.marketaux.com/v1/news/all",
  marketauxMaxItemsPerTicker: envNumber("MARKETAUX_MAX_ITEMS_PER_TICKER", 3, 2),
  marketauxSymbolsPerRequest: envNumber("MARKETAUX_SYMBOLS_PER_REQUEST", 5, 5),
  marketauxMaxRequestsPerPoll: envNumber("MARKETAUX_MAX_REQUESTS_PER_POLL", 1, 1),
  marketauxLimitPerRequest: envNumber("MARKETAUX_LIMIT_PER_REQUEST", 3, 3),
  marketauxRequestTimeoutMs: Number(process.env.MARKETAUX_REQUEST_TIMEOUT_MS || 12000),
  marketauxRequestRetries: envNumber("MARKETAUX_REQUEST_RETRIES", 1, 0),
  autonomousDataEnabled,
  marketDataProvider: selectedMarketDataProvider,
  marketDataInterval: process.env.MARKET_DATA_INTERVAL || "15min",
  marketDataHistoryPoints: Number(process.env.MARKET_DATA_HISTORY_POINTS || 18),
  marketDataCacheMs: Number(process.env.MARKET_DATA_CACHE_MS || 60000),
  marketDataRefreshMs: envNumber("MARKET_DATA_REFRESH_MS", 60000, 300000),
  marketDataRequestTimeoutMs: Number(process.env.MARKET_DATA_REQUEST_TIMEOUT_MS || 12000),
  twelveDataApiKey,
  alpacaMarketDataEnabled,
  alpacaMarketDataApiKeyId,
  alpacaMarketDataApiSecretKey,
  alpacaMarketDataBaseUrl: process.env.ALPACA_MARKET_DATA_BASE_URL || "https://data.alpaca.markets",
  alpacaMarketDataFeed: process.env.ALPACA_MARKET_DATA_FEED || "iex",
  marketFlowEnabled: String(process.env.MARKET_FLOW_ENABLED || "true").toLowerCase() !== "false",
  autoStartMarketFlow: envBoolean("AUTO_START_MARKET_FLOW", "true", "false"),
  marketFlowPollMs: envNumber("MARKET_FLOW_POLL_MS", selectedMarketDataIsTwelve ? 900000 : 60000, 300000),
  marketFlowMaxTickersPerPoll: envNumber("MARKET_FLOW_MAX_TICKERS_PER_POLL", selectedMarketDataIsTwelve ? 3 : 25, 8),
  marketFlowVolumeSpikeThreshold: Number(process.env.MARKET_FLOW_VOLUME_SPIKE_THRESHOLD || 2.2),
  marketFlowMinPriceMoveThreshold: Number(process.env.MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD || 0.01),
  marketFlowBlockTradeSpikeThreshold: Number(process.env.MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD || 3.8),
  marketFlowBlockTradeShockThreshold: Number(process.env.MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD || 2.2),
  marketFlowBlockTradeMinShares: Number(process.env.MARKET_FLOW_BLOCK_TRADE_MIN_SHARES || 500000),
  marketFlowBlockTradeMinNotionalUsd: Number(process.env.MARKET_FLOW_BLOCK_TRADE_MIN_NOTIONAL_USD || 25000000),
  marketFlowAbnormalVolumeMinNotionalUsd: Number(process.env.MARKET_FLOW_ABNORMAL_VOLUME_MIN_NOTIONAL_USD || 10000000),
  fundamentalMarketDataProvider: selectedFundamentalMarketDataProvider,
  autoStartFundamentalMarketData: envBoolean("AUTO_START_FUNDAMENTAL_MARKET_DATA", "true", "false"),
  fundamentalMarketDataCacheMs: Number(process.env.FUNDAMENTAL_MARKET_DATA_CACHE_MS || 900000),
  fundamentalMarketDataRefreshMs: envNumber("FUNDAMENTAL_MARKET_DATA_REFRESH_MS", 900000, 1800000),
  fundamentalMarketDataRequestTimeoutMs: Number(process.env.FUNDAMENTAL_MARKET_DATA_REQUEST_TIMEOUT_MS || 12000),
  fundamentalMarketDataMaxCompaniesPerPoll: envNumber("FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL", selectedFundamentalMarketDataIsTwelve ? 4 : 25, 8),
  fundamentalSecEnabled: String(process.env.FUNDAMENTAL_SEC_ENABLED || "true").toLowerCase() !== "false",
  autoStartSecFundamentals: envBoolean("AUTO_START_SEC_FUNDAMENTALS", "true", "false"),
  fundamentalSecPollMs: Number(process.env.FUNDAMENTAL_SEC_POLL_MS || 21600000),
  fundamentalSecBaselinePollMs: envNumber("FUNDAMENTAL_SEC_BASELINE_POLL_MS", 900000, 900000),
  fundamentalSecLookbackHours: Number(process.env.FUNDAMENTAL_SEC_LOOKBACK_HOURS || 10800),
  fundamentalSecConcurrency: envNumber("FUNDAMENTAL_SEC_CONCURRENCY", 4, 1),
  fundamentalSecMaxCompaniesPerPoll: envNumber("FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL", 0, 8),
  screenerRequireLiveSecForEligible:
    String(process.env.SCREENER_REQUIRE_LIVE_SEC_FOR_ELIGIBLE || "true").toLowerCase() === "true",
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
  brokerSubmitEnabled: selectionWorkflowTestMode
    ? false
    : String(process.env.BROKER_SUBMIT_ENABLED || "false").toLowerCase() === "true",
  brokerRequestTimeoutMs: Number(process.env.BROKER_REQUEST_TIMEOUT_MS || 12000),
  alpacaApiKeyId,
  alpacaApiSecretKey,
  alpacaPaperBaseUrl: process.env.ALPACA_PAPER_BASE_URL || "https://paper-api.alpaca.markets",
  alpacaLiveBaseUrl: process.env.ALPACA_LIVE_BASE_URL || "https://api.alpaca.markets",
  alpacaAllowLiveTrading: String(process.env.ALPACA_ALLOW_LIVE_TRADING || "false").toLowerCase() === "true",
  alpacaMcpConfigPath: resolveFromRoot(process.env.ALPACA_MCP_CONFIG_PATH, path.join(".vscode", "mcp.json")),
  alpacaMcpServerName: process.env.ALPACA_MCP_SERVER_NAME || "alpaca-paper",
  alpacaMcpCommand: process.env.ALPACA_MCP_COMMAND || "",
  alpacaMcpUvPath: process.env.ALPACA_MCP_UV_PATH || process.env.UV_PATH || "",
  alpacaMcpRequestTimeoutMs: Number(process.env.ALPACA_MCP_REQUEST_TIMEOUT_MS || 30000),
  alpacaMcpApiKey: firstCredential("ALPACA_API_KEY", "ALPACA_API_KEY_ID"),
  alpacaMcpSecretKey: firstCredential("ALPACA_SECRET_KEY", "ALPACA_API_SECRET_KEY"),
  alpacaMcpPaperTrade: process.env.ALPACA_PAPER_TRADE || "true",
  alpacaMcpToolsets: process.env.ALPACA_TOOLSETS || "account,trading,assets,stock-data,news",
  selectionWorkflowTestMode,
  selectionWorkflowTestLongThreshold,
  selectionWorkflowTestShortThreshold,
  selectionWorkflowTestDirectionGap,
  selectionWorkflowTestWatchThreshold,
  selectionWorkflowTestFinalConviction,
  selectionWorkflowTestLlmMinConfidence,
  selectionWorkflowTestMaxRuntimePenalty,
  selectionWorkflowTestMaxRiskPenalty,
  executionMinConviction: selectionWorkflowTestMode
    ? selectionWorkflowTestFinalConviction
    : Number(process.env.EXECUTION_MIN_CONVICTION || 0.62),
  executionMinNotionalUsd: Number(process.env.EXECUTION_MIN_NOTIONAL_USD || 25),
  executionMaxOrderNotionalUsd: Number(process.env.EXECUTION_MAX_ORDER_NOTIONAL_USD || 1000),
  executionMaxPositionPct: Number(process.env.EXECUTION_MAX_POSITION_PCT || 0.03),
  executionDefaultEquityUsd: Number(process.env.EXECUTION_DEFAULT_EQUITY_USD || 100000),
  executionAllowShorts: String(process.env.EXECUTION_ALLOW_SHORTS || "false").toLowerCase() === "true",
  executionUseBracketOrders: String(process.env.EXECUTION_USE_BRACKET_ORDERS || "true").toLowerCase() !== "false",
  executionDefaultOrderType: process.env.EXECUTION_DEFAULT_ORDER_TYPE || "market",
  executionDefaultTimeInForce: process.env.EXECUTION_DEFAULT_TIME_IN_FORCE || "day",
  portfolioWeeklyTargetPct: Number(process.env.PORTFOLIO_WEEKLY_TARGET_PCT || 0.03),
  portfolioExecutionMinConviction: selectionWorkflowTestMode
    ? selectionWorkflowTestFinalConviction
    : Number(process.env.PORTFOLIO_EXECUTION_MIN_CONVICTION || process.env.EXECUTION_MIN_CONVICTION || 0.62),
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
  llmSelectionProvider,
  llmSelectionModel,
  llmSelectionMinConfidence: selectionWorkflowTestMode
    ? selectionWorkflowTestLlmMinConfidence
    : Number(process.env.LLM_SELECTION_MIN_CONFIDENCE || 0.58),
  llmSelectionMaxCandidates: Number(process.env.LLM_SELECTION_MAX_CANDIDATES || 12),
  llmSelectionMaxOutputTokens: Number(process.env.LLM_SELECTION_MAX_OUTPUT_TOKENS || 2500),
  llmSelectionRequestTimeoutMs: Number(process.env.LLM_SELECTION_REQUEST_TIMEOUT_MS || 30000),
  llmSelectionApiUrl,
  llmSelectionApiKey,
  riskMaxGrossExposurePct: Number(process.env.RISK_MAX_GROSS_EXPOSURE_PCT || 0.35),
  riskMaxSingleNameExposurePct: Number(process.env.RISK_MAX_SINGLE_NAME_EXPOSURE_PCT || 0.08),
  riskMaxOpenOrders: Number(process.env.RISK_MAX_OPEN_ORDERS || 10),
  riskBlockWhenRuntimeConstrained:
    String(process.env.RISK_BLOCK_WHEN_RUNTIME_CONSTRAINED || "false").toLowerCase() === "true",
  secForm4Enabled: String(process.env.SEC_FORM4_ENABLED || "true").toLowerCase() !== "false",
  secForm4PollMs: Number(process.env.SEC_FORM4_POLL_MS || 600000),
  secForm4MaxTickersPerPoll: envNumber("SEC_FORM4_MAX_TICKERS_PER_POLL", 25, 8),
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
  earningsApiKey,
  earningsLookAheadDays: Number(process.env.EARNINGS_LOOK_AHEAD_DAYS || 14),
  earningsPollMs: Number(process.env.EARNINGS_POLL_MS || 14400000),
  earningsRequestTimeoutMs: Number(process.env.EARNINGS_REQUEST_TIMEOUT_MS || 12000),
  earningsMaxTickersPerPoll: envNumber("EARNINGS_MAX_TICKERS_PER_POLL", 12, 6),
  stocktwitsEnabled,
  stocktwitsApiKey,
  stocktwitsPollMs: Number(process.env.STOCKTWITS_POLL_MS || 300000),
  stocktwitsMaxTickersPerPoll: envNumber("STOCKTWITS_MAX_TICKERS_PER_POLL", 20, 8),
  stocktwitsRequestTimeoutMs: Number(process.env.STOCKTWITS_REQUEST_TIMEOUT_MS || 10000),
  tradePrintsEnabled,
  tradePrintsProvider: selectedTradePrintsProvider,
  polygonApiKey,
  iexApiKey,
  tradePrintsApiKey: selectedTradePrintsApiKey,
  tradePrintsPollMs: Number(process.env.TRADE_PRINTS_POLL_MS || 60000),
  tradePrintsMaxTickersPerPoll: envNumber("TRADE_PRINTS_MAX_TICKERS_PER_POLL", 25, 8),
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
  credentialWarnings: Array.from(placeholderCredentialNames).map((name) => ({
    env: name,
    issue: "placeholder_value_ignored"
  })),
  publicDir: path.join(rootDir, "src", "public"),
  dataDir: path.join(rootDir, "data"),
  sampleEventsPath: path.join(rootDir, "data", "sample-events.json"),
  sampleFundamentalsPath: path.join(rootDir, "data", "sample-fundamentals.json")
};
