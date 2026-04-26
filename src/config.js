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

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  databaseEnabled: String(process.env.DATABASE_ENABLED || "true").toLowerCase() !== "false",
  databaseProvider: process.env.DATABASE_PROVIDER || "sqlite",
  databasePath: resolveFromRoot(process.env.DATABASE_PATH, path.join("data", "sentiment-analyst.sqlite")),
  databaseUrl: process.env.DATABASE_URL || "",
  databaseAutosaveMs: Number(process.env.DATABASE_AUTOSAVE_MS || 15000),
  sqliteBackupEnabled:
    String(process.env.SQLITE_BACKUP_ENABLED || "true").toLowerCase() !== "false",
  sqliteBackupDir: resolveFromRoot(process.env.SQLITE_BACKUP_DIR, path.join("data", "backups")),
  sqliteBackupIntervalMs: Number(process.env.SQLITE_BACKUP_INTERVAL_MS || 21600000),
  sqliteBackupRetentionCount: Number(process.env.SQLITE_BACKUP_RETENTION_COUNT || 28),
  sqliteBackupRetentionDays: Number(process.env.SQLITE_BACKUP_RETENTION_DAYS || 14),
  sqliteBackupOnStartup: String(process.env.SQLITE_BACKUP_ON_STARTUP || "true").toLowerCase() !== "false",
  universeName: process.env.UNIVERSE_NAME || "S&P 100 + QQQ Holdings",
  defaultWindow: process.env.DEFAULT_WINDOW || "1h",
  alertConfidenceThreshold: Number(process.env.ALERT_CONFIDENCE_THRESHOLD || 0.85),
  liveNewsEnabled: String(process.env.LIVE_NEWS_ENABLED || "true").toLowerCase() !== "false",
  liveNewsPollMs: Number(process.env.LIVE_NEWS_POLL_MS || 300000),
  liveNewsMaxItemsPerTicker: Number(process.env.LIVE_NEWS_MAX_ITEMS_PER_TICKER || 3),
  liveNewsLookbackHours: Number(process.env.LIVE_NEWS_LOOKBACK_HOURS || 24),
  liveNewsRequestTimeoutMs: Number(process.env.LIVE_NEWS_REQUEST_TIMEOUT_MS || 12000),
  marketDataProvider: process.env.MARKET_DATA_PROVIDER || (process.env.TWELVE_DATA_API_KEY ? "twelvedata" : "synthetic"),
  marketDataInterval: process.env.MARKET_DATA_INTERVAL || "15min",
  marketDataHistoryPoints: Number(process.env.MARKET_DATA_HISTORY_POINTS || 18),
  marketDataCacheMs: Number(process.env.MARKET_DATA_CACHE_MS || 60000),
  marketDataRefreshMs: Number(process.env.MARKET_DATA_REFRESH_MS || 60000),
  marketDataRequestTimeoutMs: Number(process.env.MARKET_DATA_REQUEST_TIMEOUT_MS || 12000),
  twelveDataApiKey: process.env.TWELVE_DATA_API_KEY || "",
  marketFlowEnabled: String(process.env.MARKET_FLOW_ENABLED || "true").toLowerCase() !== "false",
  marketFlowPollMs: Number(process.env.MARKET_FLOW_POLL_MS || 60000),
  marketFlowVolumeSpikeThreshold: Number(process.env.MARKET_FLOW_VOLUME_SPIKE_THRESHOLD || 2.2),
  marketFlowMinPriceMoveThreshold: Number(process.env.MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD || 0.01),
  marketFlowBlockTradeSpikeThreshold: Number(process.env.MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD || 3.8),
  marketFlowBlockTradeShockThreshold: Number(process.env.MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD || 2.2),
  marketFlowBlockTradeMinShares: Number(process.env.MARKET_FLOW_BLOCK_TRADE_MIN_SHARES || 500000),
  marketFlowBlockTradeMinNotionalUsd: Number(process.env.MARKET_FLOW_BLOCK_TRADE_MIN_NOTIONAL_USD || 25000000),
  marketFlowAbnormalVolumeMinNotionalUsd: Number(process.env.MARKET_FLOW_ABNORMAL_VOLUME_MIN_NOTIONAL_USD || 10000000),
  fundamentalMarketDataProvider:
    process.env.FUNDAMENTAL_MARKET_DATA_PROVIDER || (process.env.TWELVE_DATA_API_KEY ? "twelvedata" : "synthetic"),
  fundamentalMarketDataCacheMs: Number(process.env.FUNDAMENTAL_MARKET_DATA_CACHE_MS || 900000),
  fundamentalMarketDataRefreshMs: Number(process.env.FUNDAMENTAL_MARKET_DATA_REFRESH_MS || 900000),
  fundamentalMarketDataRequestTimeoutMs: Number(process.env.FUNDAMENTAL_MARKET_DATA_REQUEST_TIMEOUT_MS || 12000),
  fundamentalSecEnabled: String(process.env.FUNDAMENTAL_SEC_ENABLED || "true").toLowerCase() !== "false",
  fundamentalSecPollMs: Number(process.env.FUNDAMENTAL_SEC_POLL_MS || 21600000),
  fundamentalSecLookbackHours: Number(process.env.FUNDAMENTAL_SEC_LOOKBACK_HOURS || 10800),
  fundamentalSecConcurrency: Number(process.env.FUNDAMENTAL_SEC_CONCURRENCY || 4),
  secForm4Enabled: String(process.env.SEC_FORM4_ENABLED || "true").toLowerCase() !== "false",
  secForm4PollMs: Number(process.env.SEC_FORM4_POLL_MS || 600000),
  secForm4LookbackHours: Number(process.env.SEC_FORM4_LOOKBACK_HOURS || 72),
  sec13fEnabled: String(process.env.SEC_13F_ENABLED || "true").toLowerCase() !== "false",
  sec13fPollMs: Number(process.env.SEC_13F_POLL_MS || 43200000),
  sec13fLookbackHours: Number(process.env.SEC_13F_LOOKBACK_HOURS || 2400),
  secRequestTimeoutMs: Number(process.env.SEC_REQUEST_TIMEOUT_MS || 15000),
  secTickerMapCacheMs: Number(process.env.SEC_TICKER_MAP_CACHE_MS || 86400000),
  secUserAgent:
    process.env.SEC_USER_AGENT || "SentimentAnalyst/1.0 contact=local@example.com",
  envPath,
  rootDir,
  publicDir: path.join(rootDir, "src", "public"),
  dataDir: path.join(rootDir, "data"),
  sampleEventsPath: path.join(rootDir, "data", "sample-events.json"),
  sampleFundamentalsPath: path.join(rootDir, "data", "sample-fundamentals.json")
};
