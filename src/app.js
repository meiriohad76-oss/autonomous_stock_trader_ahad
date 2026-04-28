import { config } from "./config.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  getFundamentalPersistenceFactSeries,
  getFundamentalPersistenceFilings,
  getFundamentalPersistenceTicker,
  summarizeFundamentalPersistence
} from "./domain/fundamental-persistence.js";
import { createFundamentalMarketDataService } from "./domain/fundamental-market-data.js";
import { loadFundamentalUniverse } from "./domain/fundamental-universe.js";
import { createFundamentalsEngine } from "./domain/fundamentals.js";
import { createLiveNewsCollector } from "./domain/live-news.js";
import { createMarketDataService } from "./domain/market-data.js";
import { createMarketFlowMonitor } from "./domain/market-flow.js";
import { createPersistence } from "./domain/persistence.js";
import { createPipeline } from "./domain/pipeline.js";
import { replaySampleEvents } from "./domain/replay.js";
import { createSecFundamentalsCollector } from "./domain/sec-fundamentals.js";
import { createSecInstitutionalCollector } from "./domain/sec-institutional.js";
import { createSecInsiderCollector } from "./domain/sec-insider.js";
import { createStore, resetStore } from "./domain/store.js";
import { TICKER_LOOKUP } from "./domain/taxonomy.js";
import { createMacroRegimeAgent } from "./domain/macro-regime.js";
import { createTradeSetupAgent } from "./domain/trade-setup.js";
import { scoreToLabel } from "./utils/helpers.js";

const MARKET_FLOW_SETTINGS_FIELDS = {
  marketFlowVolumeSpikeThreshold: { env: "MARKET_FLOW_VOLUME_SPIKE_THRESHOLD", min: 1, max: 20, digits: 2 },
  marketFlowMinPriceMoveThreshold: { env: "MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD", min: 0.001, max: 0.2, digits: 4 },
  marketFlowBlockTradeSpikeThreshold: { env: "MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD", min: 1, max: 30, digits: 2 },
  marketFlowBlockTradeShockThreshold: { env: "MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD", min: 1, max: 30, digits: 2 },
  marketFlowBlockTradeMinShares: { env: "MARKET_FLOW_BLOCK_TRADE_MIN_SHARES", min: 10000, max: 1000000000, digits: 0 },
  marketFlowBlockTradeMinNotionalUsd: { env: "MARKET_FLOW_BLOCK_TRADE_MIN_NOTIONAL_USD", min: 100000, max: 10000000000, digits: 0 },
  marketFlowAbnormalVolumeMinNotionalUsd: { env: "MARKET_FLOW_ABNORMAL_VOLUME_MIN_NOTIONAL_USD", min: 100000, max: 10000000000, digits: 0 }
};

const FUNDAMENTAL_SCREENER_FIELDS = {
  screenerRequireLiveSecForEligible: {
    env: "SCREENER_REQUIRE_LIVE_SEC_FOR_ELIGIBLE",
    type: "boolean",
    label: "Require Live SEC For Eligible",
    help: "When enabled, bootstrap placeholders can only reach Watch until live SEC filing data arrives."
  },
  screenerMinReportingConfidence: {
    env: "SCREENER_MIN_REPORTING_CONFIDENCE",
    type: "number",
    min: 0.5,
    max: 1,
    digits: 2,
    step: 0.01,
    label: "Min Reporting Confidence",
    help: "Minimum reporting confidence for the filing-quality check."
  },
  screenerMinDataFreshness: {
    env: "SCREENER_MIN_DATA_FRESHNESS",
    type: "number",
    min: 0.5,
    max: 1,
    digits: 2,
    step: 0.01,
    label: "Min Data Freshness",
    help: "Minimum freshness score for the filing-quality check."
  },
  screenerMaxMissingFields: {
    env: "SCREENER_MAX_MISSING_FIELDS",
    type: "number",
    min: 0,
    max: 10,
    digits: 0,
    step: 1,
    label: "Max Missing Fields",
    help: "Maximum missing-field count allowed in the filing-quality gate."
  },
  screenerMinRevenueGrowth: {
    env: "SCREENER_MIN_REVENUE_GROWTH",
    type: "number",
    min: -0.1,
    max: 0.5,
    digits: 3,
    step: 0.01,
    label: "Min Revenue Growth",
    help: "Revenue growth threshold for the growth check."
  },
  screenerMinEpsGrowth: {
    env: "SCREENER_MIN_EPS_GROWTH",
    type: "number",
    min: -0.1,
    max: 0.8,
    digits: 3,
    step: 0.01,
    label: "Min EPS Growth",
    help: "EPS growth threshold for the growth check."
  },
  screenerMinOperatingMargin: {
    env: "SCREENER_MIN_OPERATING_MARGIN",
    type: "number",
    min: 0,
    max: 0.5,
    digits: 3,
    step: 0.01,
    label: "Min Operating Margin",
    help: "Operating margin threshold for the profitability check."
  },
  screenerMinGrossMargin: {
    env: "SCREENER_MIN_GROSS_MARGIN",
    type: "number",
    min: 0,
    max: 0.9,
    digits: 3,
    step: 0.01,
    label: "Min Gross Margin",
    help: "Gross margin threshold for the profitability check."
  },
  screenerMinCurrentRatio: {
    env: "SCREENER_MIN_CURRENT_RATIO",
    type: "number",
    min: 0.2,
    max: 5,
    digits: 2,
    step: 0.05,
    label: "Min Current Ratio",
    help: "Current ratio threshold for the balance-sheet check."
  },
  screenerMaxNetDebtToEbitda: {
    env: "SCREENER_MAX_NET_DEBT_TO_EBITDA",
    type: "number",
    min: -5,
    max: 10,
    digits: 2,
    step: 0.1,
    label: "Max Net Debt / EBITDA",
    help: "Maximum leverage allowed in the balance-sheet check."
  },
  screenerMinFcfConversion: {
    env: "SCREENER_MIN_FCF_CONVERSION",
    type: "number",
    min: 0,
    max: 1.5,
    digits: 2,
    step: 0.01,
    label: "Min FCF Conversion",
    help: "FCF conversion threshold for the cash-efficiency check."
  },
  screenerMinFcfMargin: {
    env: "SCREENER_MIN_FCF_MARGIN",
    type: "number",
    min: 0,
    max: 0.5,
    digits: 3,
    step: 0.01,
    label: "Min FCF Margin",
    help: "FCF margin threshold for the cash-efficiency check."
  },
  screenerMaxPeTtm: {
    env: "SCREENER_MAX_PE_TTM",
    type: "number",
    min: 1,
    max: 120,
    digits: 1,
    step: 0.5,
    label: "Max P/E TTM",
    help: "P/E ceiling for the valuation sanity check."
  },
  screenerMaxPeg: {
    env: "SCREENER_MAX_PEG",
    type: "number",
    min: 0.1,
    max: 10,
    digits: 2,
    step: 0.1,
    label: "Max PEG",
    help: "PEG ceiling for the valuation sanity check."
  },
  screenerMinFcfYield: {
    env: "SCREENER_MIN_FCF_YIELD",
    type: "number",
    min: 0,
    max: 0.2,
    digits: 3,
    step: 0.005,
    label: "Min FCF Yield",
    help: "FCF yield floor for the valuation sanity check."
  },
  screenerEligibleScore: {
    env: "SCREENER_ELIGIBLE_SCORE",
    type: "number",
    min: 0.3,
    max: 1,
    digits: 2,
    step: 0.01,
    label: "Eligible Score Threshold",
    help: "Minimum fraction of passed checks required for the eligible stage."
  },
  screenerWatchScore: {
    env: "SCREENER_WATCH_SCORE",
    type: "number",
    min: 0.1,
    max: 0.9,
    digits: 2,
    step: 0.01,
    label: "Watch Score Threshold",
    help: "Minimum fraction of passed checks required for the watch stage."
  }
};

function directorySizeBytes(dirPath) {
  if (!dirPath || !existsSync(dirPath)) {
    return 0;
  }

  return readdirSync(dirPath, { withFileTypes: true }).reduce((sum, entry) => {
    const entryPath = `${dirPath}/${entry.name}`;
    if (entry.isDirectory()) {
      return sum + directorySizeBytes(entryPath);
    }
    return sum + statSync(entryPath).size;
  }, 0);
}

function fileSizeBytes(filePath) {
  return filePath && existsSync(filePath) ? statSync(filePath).size : 0;
}

function buildPerformanceSnapshot(currentConfig, store) {
  const memory = process.memoryUsage();
  return {
    as_of: new Date().toISOString(),
    pi_performance_mode: currentConfig.piPerformanceMode,
    process: {
      uptime_seconds: Math.round(process.uptime()),
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      heap_total_bytes: memory.heapTotal,
      external_bytes: memory.external
    },
    data: {
      database_path: currentConfig.databaseProvider === "sqlite" ? currentConfig.databasePath : null,
      database_size_bytes: currentConfig.databaseProvider === "sqlite" ? fileSizeBytes(currentConfig.databasePath) : null,
      data_dir_size_bytes: directorySizeBytes(currentConfig.dataDir),
      backup_dir_size_bytes: directorySizeBytes(currentConfig.sqliteBackupDir)
    },
    workload: {
      raw_documents: store.rawDocuments.length,
      normalized_documents: store.normalizedDocuments.length,
      document_scores: store.documentScores.length,
      sentiment_states: store.sentimentStates.length,
      evidence_items: store.evidenceQuality?.summary?.total_evidence_items || 0
    },
    tuned_settings: {
      database_autosave_ms: currentConfig.databaseAutosaveMs,
      live_news_poll_ms: currentConfig.liveNewsPollMs,
      live_news_max_items_per_ticker: currentConfig.liveNewsMaxItemsPerTicker,
      market_data_refresh_ms: currentConfig.marketDataRefreshMs,
      market_flow_poll_ms: currentConfig.marketFlowPollMs,
      auto_start_market_flow: currentConfig.autoStartMarketFlow,
      fundamental_market_data_refresh_ms: currentConfig.fundamentalMarketDataRefreshMs,
      auto_start_fundamental_market_data: currentConfig.autoStartFundamentalMarketData,
      fundamental_sec_concurrency: currentConfig.fundamentalSecConcurrency,
      auto_start_sec_fundamentals: currentConfig.autoStartSecFundamentals,
      auto_start_sec_13f: currentConfig.autoStartSec13f,
      sec_request_retries: currentConfig.secRequestRetries,
      sqlite_backup_interval_ms: currentConfig.sqliteBackupIntervalMs,
      sqlite_backup_retention_count: currentConfig.sqliteBackupRetentionCount,
      sqlite_backup_on_startup: currentConfig.sqliteBackupOnStartup
    }
  };
}

function readMarketFlowSettings(currentConfig) {
  return Object.keys(MARKET_FLOW_SETTINGS_FIELDS).reduce((acc, key) => {
    acc[key] = Number(currentConfig[key]);
    return acc;
  }, {});
}

function readScreenerSettings(currentConfig) {
  return Object.entries(FUNDAMENTAL_SCREENER_FIELDS).reduce((acc, [key, spec]) => {
    acc[key] = spec.type === "boolean" ? Boolean(currentConfig[key]) : Number(currentConfig[key]);
    return acc;
  }, {});
}

function databaseTargetLabel(currentConfig) {
  if (currentConfig.databaseProvider === "postgres") {
    if (!currentConfig.databaseUrl) {
      return "unconfigured";
    }

    try {
      const parsed = new URL(currentConfig.databaseUrl);
      const host = parsed.hostname || "host";
      const databaseName = parsed.pathname.replace(/^\/+/, "") || "db";
      return `${host}/${databaseName}`;
    } catch {
      return "configured";
    }
  }

  return currentConfig.databasePath || "local file";
}

function databaseBackupConfig(currentConfig) {
  return {
    enabled:
      Boolean(currentConfig.databaseEnabled) &&
      currentConfig.databaseProvider === "sqlite" &&
      Boolean(currentConfig.sqliteBackupEnabled),
    provider: currentConfig.databaseProvider,
    backup_dir:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupDir
        : null,
    interval_ms:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupIntervalMs
        : null,
    retention_count:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupRetentionCount
        : null,
    retention_days:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupRetentionDays
        : null,
    on_startup:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupOnStartup
        : null
  };
}

function clampSettingValue(value, spec) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid value for ${spec.env}`);
  }
  const bounded = Math.min(spec.max, Math.max(spec.min, numeric));
  return Number(bounded.toFixed(spec.digits));
}

function normalizeScreenerSettingValue(value, spec) {
  if (spec.type === "boolean") {
    return String(value).toLowerCase() === "true" || value === true;
  }

  return clampSettingValue(value, spec);
}

async function persistEnvUpdates(filePath, updates) {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return line;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!(key in updates)) {
      return line;
    }

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  await writeFile(filePath, nextLines.join("\n"), "utf8");
}

function buildWatchlistSnapshot(store, windowKey, filters = {}) {
  const fullFundamentalRows = store.fundamentals?.leaderboard || [];
  const fundamentalsByTicker = new Map(fullFundamentalRows.map((row) => [row.ticker, row]));
  const dedupedStates = new Map();

  function resolveTickerMetadata(ticker, fundamentalsRow, sentimentState) {
    const watchlistEntry = TICKER_LOOKUP.get(ticker);
    return {
      company_name: fundamentalsRow?.company_name || sentimentState?.entity_name || watchlistEntry?.company || ticker,
      sector: fundamentalsRow?.sector || watchlistEntry?.sector || "Other",
      industry: fundamentalsRow?.industry || watchlistEntry?.industry || null
    };
  }

  for (const state of store.sentimentStates) {
    if (state.entity_type !== "ticker" || state.window !== windowKey) {
      continue;
    }
    const previous = dedupedStates.get(state.entity_key);
    const currentAsOf = new Date(state.as_of || 0).getTime();
    const previousAsOf = new Date(previous?.as_of || 0).getTime();
    if (!previous || currentAsOf >= previousAsOf) {
      dedupedStates.set(state.entity_key, state);
    }
  }

  const states = fullFundamentalRows
    .map((fundamentalsRow) => {
      const sentimentState = dedupedStates.get(fundamentalsRow.ticker) || null;
      const metadata = resolveTickerMetadata(fundamentalsRow.ticker, fundamentalsRow, sentimentState);
      return {
        state_id: sentimentState?.state_id || null,
        entity_type: "ticker",
        entity_key: fundamentalsRow.ticker,
        entity_name: metadata.company_name,
        window: windowKey,
        as_of: sentimentState?.as_of || fundamentalsRow.as_of || store.health.lastUpdate,
        doc_count: sentimentState?.doc_count || 0,
        unique_story_count: sentimentState?.unique_story_count || 0,
        weighted_sentiment: sentimentState?.weighted_sentiment || 0,
        weighted_impact: sentimentState?.weighted_impact || 0,
        weighted_confidence: sentimentState?.weighted_confidence ?? fundamentalsRow.final_confidence ?? 0,
        story_velocity: sentimentState?.story_velocity || 0,
        momentum_delta: sentimentState?.momentum_delta || 0,
        event_concentration: sentimentState?.event_concentration || 0,
        source_diversity: sentimentState?.source_diversity || 0,
        sentiment_regime: sentimentState?.sentiment_regime || "neutral",
        top_event_types: sentimentState?.top_event_types || [],
        top_reasons: sentimentState?.top_reasons || [],
        state_metadata: sentimentState?.state_metadata || {},
        company_name: metadata.company_name,
        sector: metadata.sector,
        industry: metadata.industry,
        screen_stage: fundamentalsRow?.initial_screen?.stage || null,
        screen_provisional: Boolean(fundamentalsRow?.initial_screen?.provisional),
        composite_fundamental_score: fundamentalsRow?.composite_fundamental_score ?? null,
        fundamental_confidence: fundamentalsRow?.final_confidence ?? null,
        fundamental_rating: fundamentalsRow?.rating_label || null,
        fundamental_data_source: fundamentalsRow?.data_source || null,
        fundamental_direction_label: fundamentalsRow?.direction_label || null,
        sentiment_visible: Boolean(sentimentState)
      };
    })
    .concat(
      [...dedupedStates.values()]
        .filter((sentimentState) => !fundamentalsByTicker.has(sentimentState.entity_key))
        .map((sentimentState) => {
          const metadata = resolveTickerMetadata(sentimentState.entity_key, null, sentimentState);
          return {
            ...sentimentState,
            company_name: metadata.company_name,
            sector: metadata.sector,
            industry: metadata.industry,
            screen_stage: null,
            screen_provisional: false,
            composite_fundamental_score: null,
            fundamental_confidence: null,
            fundamental_rating: null,
            fundamental_data_source: null,
            fundamental_direction_label: null,
            sentiment_visible: true
          };
        })
    )
    .filter((state) => (filters.label ? state.sentiment_regime === filters.label : true))
    .filter((state) => (filters.minConfidence ? state.weighted_confidence >= filters.minConfidence : true))
    .filter((state) => (filters.screenStage ? state.screen_stage === filters.screenStage : true))
    .sort((a, b) => {
      const scoreA =
        Math.abs(Number(a.weighted_sentiment || 0)) * 3 +
        Number(a.weighted_confidence || 0) +
        Math.abs(Number(a.momentum_delta || 0)) * 2 +
        Math.min(2, Number(a.unique_story_count || 0) * 0.2) +
        (a.sentiment_visible ? 0.6 : 0);
      const scoreB =
        Math.abs(Number(b.weighted_sentiment || 0)) * 3 +
        Number(b.weighted_confidence || 0) +
        Math.abs(Number(b.momentum_delta || 0)) * 2 +
        Math.min(2, Number(b.unique_story_count || 0) * 0.2) +
        (b.sentiment_visible ? 0.6 : 0);
      return scoreB - scoreA || Number(b.composite_fundamental_score || 0) - Number(a.composite_fundamental_score || 0);
    });

  const summarizeScreenStages = (rows) => ({
    tracked: rows.length,
    eligible: rows.filter((row) => row.initial_screen?.stage === "eligible" || row.screen_stage === "eligible").length,
    watch: rows.filter((row) => row.initial_screen?.stage === "watch" || row.screen_stage === "watch").length,
    reject: rows.filter((row) => row.initial_screen?.stage === "reject" || row.screen_stage === "reject").length
  });

  const fullUniverseScreening = summarizeScreenStages(fullFundamentalRows);
  const visibleScreening = summarizeScreenStages(states);
  const sentimentVisibleScreening = summarizeScreenStages(states.filter((row) => row.sentiment_visible));

  const sectors = store.sentimentStates
    .filter((state) => state.entity_type === "sector" && state.window === windowKey)
    .sort((a, b) => b.weighted_sentiment - a.weighted_sentiment);

  const market = store.sentimentStates.find(
    (state) => state.entity_type === "market" && state.entity_key === "market" && state.window === windowKey
  );

    return {
      as_of: store.health.lastUpdate,
      window: windowKey,
    market_pulse: market || {
      weighted_sentiment: 0,
      weighted_confidence: 0,
      story_velocity: 0,
      sentiment_regime: "neutral"
    },
      leaderboard: states,
      screener_overview: {
        eligible: visibleScreening.eligible,
        watch: visibleScreening.watch,
        reject: visibleScreening.reject,
        full_universe: fullUniverseScreening,
        visible_universe: visibleScreening,
        sentiment_visible_universe: sentimentVisibleScreening,
        fundamental_sec_live: fullFundamentalRows.filter((row) => row.data_source === "live_sec_filing").length,
        bootstrap: fullFundamentalRows.filter((row) => row.data_source === "bootstrap_placeholder").length
      },
      sectors,
      alerts: store.alertHistory.slice(0, 10),
    source_quality: [...store.sourceStats.values()].sort((a, b) => b.rolling_avg_confidence - a.rolling_avg_confidence)
  };
}

async function buildTickerDetail(store, marketDataService, ticker) {
  const fundamentalsByTicker = new Map((store.fundamentals?.leaderboard || []).map((row) => [row.ticker, row]));
  const tickerMeta = TICKER_LOOKUP.get(ticker);
  const fundamentalRow = fundamentalsByTicker.get(ticker) || null;
  const windows = Object.fromEntries(
    ["15m", "1h", "4h", "1d", "7d"].map((windowKey) => {
      const state = store.sentimentStates.find(
        (item) => item.entity_type === "ticker" && item.entity_key === ticker && item.window === windowKey
      );
      return [
        windowKey,
        state
          ? {
              weighted_sentiment: state.weighted_sentiment,
              confidence: state.weighted_confidence,
              story_velocity: state.story_velocity
            }
          : { weighted_sentiment: 0, confidence: 0, story_velocity: 0 }
      ];
    })
  );

  const scoredDocs = store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      return normalized?.primary_ticker === ticker ? { score, normalized } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.normalized.published_at) - new Date(a.normalized.published_at));

  if (!scoredDocs.length) {
    return null;
  }

  const eventFamilyBreakdown = Object.entries(
    scoredDocs.reduce((acc, item) => {
      acc[item.score.event_family] = (acc[item.score.event_family] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const sourceDistribution = Object.entries(
    scoredDocs.reduce((acc, item) => {
      acc[item.normalized.source_name] = (acc[item.normalized.source_name] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const marketSeries = await marketDataService.getTickerSeries(ticker, scoredDocs, store.health.lastUpdate);

  return {
    ticker,
    company_name: fundamentalRow?.company_name || windows["1h"]?.entity_name || tickerMeta?.company || ticker,
    sector: fundamentalRow?.sector || tickerMeta?.sector || "Other",
    industry: fundamentalRow?.industry || tickerMeta?.industry || null,
    as_of: store.health.lastUpdate,
    windows,
    top_events: scoredDocs.slice(0, 5).map(({ score, normalized }) => ({
      event_type: score.event_type,
      impact_score: score.impact_score,
      headline: normalized.headline,
      confidence: score.final_confidence
    })),
    regime: scoreToLabel(windows["1h"].weighted_sentiment),
    risk_flags: store.alertHistory.filter((alert) => alert.entity_key === ticker).map((alert) => alert.alert_type),
    recent_documents: scoredDocs.slice(0, 10).map(({ score, normalized }) => ({
      published_at: normalized.published_at,
      headline: normalized.headline,
      source_name: normalized.source_name,
      event_type: score.event_type,
      label: score.bullish_bearish_label,
      confidence: score.final_confidence,
      evidence_quality: score.evidence_quality || null,
      display_tier: score.display_tier || score.evidence_quality?.display_tier || null,
      downstream_weight: score.downstream_weight ?? score.evidence_quality?.downstream_weight ?? null,
      explanation_short: score.explanation_short,
      source_metadata: normalized.source_metadata || null,
      url: normalized.canonical_url
    })),
    price_history: marketSeries.price_history,
    sentiment_history: marketSeries.sentiment_history,
    market_snapshot: marketSeries.market_snapshot,
    source_distribution: sourceDistribution,
    event_family_breakdown: eventFamilyBreakdown
  };
}

function buildRecentDocuments(store, { ticker = null, limit = 20 } = {}) {
  return store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      if (!normalized) {
        return null;
      }

      if (ticker && normalized.primary_ticker !== ticker) {
        return null;
      }

      return {
        timestamp: score.scored_at,
        ticker: normalized.primary_ticker,
        headline: normalized.headline,
        source_name: normalized.source_name,
        event_type: score.event_type,
        label: score.bullish_bearish_label,
        sentiment_score: score.sentiment_score,
        impact_score: score.impact_score,
        confidence: score.final_confidence,
        evidence_quality: score.evidence_quality || null,
        display_tier: score.display_tier || score.evidence_quality?.display_tier || null,
        downstream_weight: score.downstream_weight ?? score.evidence_quality?.downstream_weight ?? null,
        explanation_short: score.explanation_short,
        url: normalized.canonical_url,
        source_metadata: normalized.source_metadata || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

export function createSentimentApp() {
  const store = createStore(config);
  const persistence = createPersistence({ config });
  const persistenceReady = persistence.init();
  store.persistence = persistence;
  const pipeline = createPipeline(store);
  const fundamentalMarketDataService = createFundamentalMarketDataService({ config, store });
  const fundamentals = createFundamentalsEngine({ store, config, marketReferenceService: fundamentalMarketDataService });
  const liveNewsCollector = createLiveNewsCollector({ config, store, pipeline });
  const marketDataService = createMarketDataService({ config, store });
  const marketFlowMonitor = createMarketFlowMonitor({ config, store, pipeline, marketDataService });
  const secInsiderCollector = createSecInsiderCollector({ config, store, pipeline });
  const secInstitutionalCollector = createSecInstitutionalCollector({ config, store, pipeline });

  async function bootstrapFundamentalCoverage({ force = false } = {}) {
    const targetUniverse = await loadFundamentalUniverse({ config });
    const trackedTickers = fundamentals.getTrackedCompanies().map((company) => company.ticker).sort();
    const nextTickers = targetUniverse.companies.map((company) => company.ticker).sort();
    const sameUniverse =
      trackedTickers.length === nextTickers.length &&
      trackedTickers.every((ticker, index) => ticker === nextTickers[index]);

    store.health.liveSources.fundamental_universe = {
      enabled: true,
      last_bootstrap_at: new Date().toISOString(),
      universe_name: targetUniverse.universeName,
      tracked_companies: targetUniverse.counts.combined,
      sp100_constituents: targetUniverse.counts.sp100,
      qqq_constituents: targetUniverse.counts.qqq,
      sp100_source: targetUniverse.sources.sp100,
      qqq_source: targetUniverse.sources.qqq,
      last_error: null
    };

    if (!force && sameUniverse) {
      return targetUniverse;
    }

    await fundamentals.replaceCompanies(targetUniverse.companies, {
      asOf: targetUniverse.asOf,
      emitDiff: false
    });
    return targetUniverse;
  }

  async function ensureFundamentalCoverage({ force = false, minTrackedCompanies = 25 } = {}) {
    const trackedCompanies = fundamentals.getTrackedCompanies();
    const shouldBootstrap =
      force ||
      trackedCompanies.length < minTrackedCompanies ||
      !store.health.liveSources.fundamental_universe;

    if (!shouldBootstrap) {
      return null;
    }

    try {
      return await bootstrapFundamentalCoverage({ force });
    } catch (error) {
      store.health.liveSources.fundamental_universe = {
        enabled: true,
        last_bootstrap_at: new Date().toISOString(),
        tracked_companies: trackedCompanies.length,
        last_error: error.message
      };
      console.error("Fundamental universe bootstrap failed:", error);
      return null;
    }
  }

  async function refreshBackupStatus() {
    store.health.databaseBackup = await persistence.getBackupStatus();
    return store.health.databaseBackup;
  }

  const macroRegimeAgent = createMacroRegimeAgent({ store });
  const tradeSetupAgent = createTradeSetupAgent({
    store,
    getMacroRegime: (options = {}) => macroRegimeAgent.getMacroRegime(options)
  });

  const app = {
    config,
    store,
    pipeline,
    persistence,
    async initialize() {
      await persistenceReady;
      await persistence.hydrateStore(store);
      await refreshBackupStatus();
      await ensureFundamentalCoverage();
    },
    async hasPersistedData() {
      await persistenceReady;
      return persistence.hasData();
    },
    async reset() {
      await persistenceReady;
      resetStore(store);
      await persistence.clearAll();
    },
    async replay(options = {}) {
      const trackedCompaniesBeforeReplay =
        options.preserveFundamentals === false ? [] : fundamentals.getTrackedCompanies();
      const shouldPreserveFundamentalUniverse = trackedCompaniesBeforeReplay.length >= 25;
      const sentimentCount = await replaySampleEvents(this, options);
      let fundamentalCount = store.fundamentals.leaderboard.length;

      if (shouldPreserveFundamentalUniverse) {
        if (options.reset || fundamentalCount < trackedCompaniesBeforeReplay.length) {
          fundamentalCount = await fundamentals.replaceCompanies(trackedCompaniesBeforeReplay, {
            asOf: new Date().toISOString(),
            emitDiff: false
          });
        }
      } else if (!options.skipFundamentals) {
        fundamentalCount = await fundamentals.replaySample({
          intervalMs: options.intervalMs ? Math.max(0, Math.floor(options.intervalMs / 2)) : 0
        });
      }

      await persistence.saveStoreSnapshot(store);
      return { sentimentCount, fundamentalCount };
    },
    async bootstrapFundamentalCoverage(options = {}) {
      await persistenceReady;
      return bootstrapFundamentalCoverage(options);
    },
    getConfig() {
      return {
        app_name: "Sentiment Analyst",
        companion_dashboard: "/fundamentals.html",
        pi_performance_mode: config.piPerformanceMode,
        database_enabled: config.databaseEnabled,
        database_provider: config.databaseProvider,
        database_target: databaseTargetLabel(config),
        database_backup: databaseBackupConfig(config),
        universe_name: config.universeName,
        default_window: config.defaultWindow,
        windows: ["15m", "1h", "4h", "1d", "7d"],
        live_news_enabled: config.liveNewsEnabled,
        market_data_provider: config.marketDataProvider,
        market_flow_enabled: config.marketFlowEnabled,
        auto_start_market_flow: config.autoStartMarketFlow,
        market_flow_settings: readMarketFlowSettings(config),
        screener_settings: readScreenerSettings(config),
        fundamental_market_data_provider: config.fundamentalMarketDataProvider,
        auto_start_fundamental_market_data: config.autoStartFundamentalMarketData,
        fundamental_sec_enabled: config.fundamentalSecEnabled,
        auto_start_sec_fundamentals: config.autoStartSecFundamentals,
        sec_form4_enabled: config.secForm4Enabled,
        sec_13f_enabled: config.sec13fEnabled,
        auto_start_sec_13f: config.autoStartSec13f,
        fundamentals_enabled: true
      };
    },
    getHealth() {
      return {
        status: store.health.systemStatus,
        last_update: store.health.lastUpdate,
        queue_depth: store.health.queueDepth,
        llm_latency_ms: store.health.llmLatencyMs,
        documents_processed_today: store.health.documentsProcessedToday,
        fundamental_companies_scored: store.health.fundamentalCompaniesScored,
        fundamental_sectors_covered: store.health.fundamentalSectorsCovered,
        active_sources: store.sourceStats.size,
        live_sources: store.health.liveSources,
        database_backup: store.health.databaseBackup,
        evidence_quality: store.evidenceQuality.summary || null
      };
    },
    getPerformance() {
      return buildPerformanceSnapshot(config, store);
    },
    getWatchlistSnapshot(windowKey, filters) {
      return buildWatchlistSnapshot(store, windowKey, filters);
    },
    async getTickerDetail(ticker) {
      return buildTickerDetail(store, marketDataService, ticker);
    },
    getMarketFlowSettings() {
      return readMarketFlowSettings(config);
    },
    getScreenerSettings() {
      return {
        settings: readScreenerSettings(config),
        fields: Object.entries(FUNDAMENTAL_SCREENER_FIELDS).map(([key, spec]) => ({
          key,
          type: spec.type,
          label: spec.label,
          help: spec.help,
          min: spec.min ?? null,
          max: spec.max ?? null,
          step: spec.step ?? null
        }))
      };
    },
    async updateMarketFlowSettings(nextSettings, { persist = true } = {}) {
      const updates = {};

      for (const [key, spec] of Object.entries(MARKET_FLOW_SETTINGS_FIELDS)) {
        if (!(key in nextSettings)) {
          continue;
        }
        updates[key] = clampSettingValue(nextSettings[key], spec);
      }

      Object.assign(config, updates);

      if (persist && Object.keys(updates).length) {
        const envUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
          acc[MARKET_FLOW_SETTINGS_FIELDS[key].env] = value;
          return acc;
        }, {});
        await persistEnvUpdates(config.envPath, envUpdates);
      }

      store.bus.emit("event", {
        type: "snapshot",
        timestamp: new Date().toISOString(),
        settings_scope: "market_flow"
      });
      await persistenceReady;
      await persistence.saveStoreSnapshot(store);

      return readMarketFlowSettings(config);
    },
    async updateScreenerSettings(nextSettings, { persist = true } = {}) {
      const updates = {};

      for (const [key, spec] of Object.entries(FUNDAMENTAL_SCREENER_FIELDS)) {
        if (!(key in nextSettings)) {
          continue;
        }
        updates[key] = normalizeScreenerSettingValue(nextSettings[key], spec);
      }

      Object.assign(config, updates);

      if (persist && Object.keys(updates).length) {
        const envUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
          acc[FUNDAMENTAL_SCREENER_FIELDS[key].env] =
            FUNDAMENTAL_SCREENER_FIELDS[key].type === "boolean" ? String(value) : value;
          return acc;
        }, {});
        await persistEnvUpdates(config.envPath, envUpdates);
      }

      if (store.fundamentals?.asOf && fundamentals.getTrackedCompanies().length) {
        await fundamentals.replaceCompanies(fundamentals.getTrackedCompanies(), {
          asOf: new Date().toISOString(),
          emitDiff: true
        });
      }

      return this.getScreenerSettings();
    },
    getSectorDetail(sector) {
      const windows = ["15m", "1h", "4h", "1d", "7d"].reduce((acc, windowKey) => {
        const state = store.sentimentStates.find(
          (item) => item.entity_type === "sector" && item.entity_key === sector && item.window === windowKey
        );
        acc[windowKey] = state || null;
        return acc;
      }, {});

      if (!Object.values(windows).some(Boolean)) {
        return null;
      }

      return {
        sector,
        as_of: store.health.lastUpdate,
        windows
      };
    },
    getRecentDocuments(params) {
      return buildRecentDocuments(store, params);
    },
    getHighImpactEvents(limit = 10) {
      return buildRecentDocuments(store, { limit: 100 })
        .filter((item) => item.confidence >= 0.7 && Math.abs(item.sentiment_score) >= 0.4)
        .filter((item) => item.display_tier !== "suppress")
        .slice(0, limit);
    },
    getEvidenceQuality(options = {}) {
      return pipeline.evidenceQualityAgent.getSnapshot(options);
    },
    getFundamentalsSnapshot(filters) {
      return fundamentals.getSnapshot(filters);
    },
    getFundamentalsTickerDetail(ticker) {
      return fundamentals.getTickerDetail(ticker);
    },
    getFundamentalsSectorDetail(sector) {
      return fundamentals.getSectorDetail(sector);
    },
    getFundamentalsChanges(limit) {
      return fundamentals.getChanges(limit);
    },
    getMacroRegime(options = {}) {
      return macroRegimeAgent.getMacroRegime(options);
    },
    getMacroRegimeHistory(limit = 20) {
      return store.macroRegimeHistory.slice(0, limit);
    },
    getTradeSetups(options = {}) {
      return tradeSetupAgent.getTradeSetups(options);
    },
    getTradeSetupTicker(ticker, options = {}) {
      return tradeSetupAgent.getTickerSetup(ticker, options);
    },
    getTradeSetupStorageSummary() {
      const rows = store.tradeSetupHistory || [];
      const latestAsOf = rows[0]?.as_of || null;
      const latestRows = latestAsOf ? rows.filter((row) => row.as_of === latestAsOf) : [];
      return {
        latest_as_of: latestAsOf,
        total_rows: rows.length,
        distinct_tickers: new Set(rows.map((row) => row.ticker)).size,
        action_counts: {
          long: latestRows.filter((row) => row.action === "long").length,
          short: latestRows.filter((row) => row.action === "short").length,
          watch: latestRows.filter((row) => row.action === "watch").length,
          no_trade: latestRows.filter((row) => row.action === "no_trade").length
        },
        latest_macro_regime: store.macroRegimeHistory[0] || null
      };
    },
    getTradeSetupStorageTicker(ticker, limit = 20) {
      return store.tradeSetupHistory
        .filter((row) => row.ticker === ticker)
        .slice(0, limit);
    },
    getFundamentalPersistenceSummary() {
      return summarizeFundamentalPersistence(store.fundamentalWarehouse);
    },
    getFundamentalPersistenceTicker(ticker) {
      return getFundamentalPersistenceTicker(store.fundamentalWarehouse, ticker);
    },
    getFundamentalPersistenceFilings(ticker, limit) {
      return getFundamentalPersistenceFilings(store.fundamentalWarehouse, ticker, limit);
    },
    getFundamentalPersistenceFactSeries(ticker, canonicalField, options = {}) {
      return getFundamentalPersistenceFactSeries(store.fundamentalWarehouse, ticker, canonicalField, options);
    },
    getTrackedFundamentalCompanies() {
      return fundamentals.getTrackedCompanies();
    },
    async replaceFundamentalCompanies(companies, options = {}) {
      return fundamentals.replaceCompanies(companies, options);
    },
    async refreshFundamentals(options = {}) {
      await persistenceReady;
      await ensureFundamentalCoverage({ force: Boolean(options.forceUniverse) });
      const refreshResult = await secFundamentalsCollector.pollOnce();
      return {
        ok: true,
        refresh: refreshResult,
        health: this.getHealth()
      };
    },
    async startLiveSources() {
      return undefined;
    },
    stopLiveSources() {},
    async pollLiveSourcesOnce() {
      const liveNews = await liveNewsCollector.pollOnce();
      const marketFlow = await marketFlowMonitor.pollOnce();
      const secForm4 = await secInsiderCollector.pollOnce();
      const sec13f = await secInstitutionalCollector.pollOnce();

      return {
        live_news: liveNews,
        market_flow: marketFlow,
        sec_form4: secForm4,
        sec_13f: sec13f
      };
    }
  };

  const secFundamentalsCollector = createSecFundamentalsCollector(app);
  let autosaveTimer = null;
  let backupTimer = null;

  app.startLiveSources = async function startLiveSources() {
    await persistenceReady;
    await ensureFundamentalCoverage();
    const starts = [
      liveNewsCollector.start(),
      marketDataService.start(),
      secInsiderCollector.start()
    ];

    if (config.autoStartSec13f) {
      starts.push(secInstitutionalCollector.start());
    }

    if (config.autoStartFundamentalMarketData) {
      starts.push(fundamentalMarketDataService.start({
        getCompanies: () => fundamentals.getTrackedCompanies(),
        onUpdate: async (referenceMap) => fundamentals.refreshMarketReference(referenceMap)
      }));
    }

    if (config.autoStartSecFundamentals) {
      starts.push(secFundamentalsCollector.start());
    }

    await Promise.all(starts);

    if (config.autoStartMarketFlow) {
      await marketFlowMonitor.start();
    }

    if (config.databaseEnabled && !autosaveTimer) {
      autosaveTimer = setInterval(() => {
        persistence.saveStoreSnapshot(store).catch((error) => {
          console.error("Persistence autosave failed:", error);
        });
      }, config.databaseAutosaveMs);
    }

    if (config.databaseEnabled && config.databaseProvider === "sqlite") {
      if (config.sqliteBackupOnStartup) {
        await persistence.backupNow({ reason: "startup" });
      }
      await refreshBackupStatus();
      if (config.sqliteBackupEnabled && !backupTimer) {
        backupTimer = setInterval(() => {
          persistence.backupNow({ reason: "interval" })
            .then(() => refreshBackupStatus())
            .catch((error) => {
              console.error("SQLite backup failed:", error);
            });
        }, config.sqliteBackupIntervalMs);
      }
    }
  };

  app.stopLiveSources = async function stopLiveSources() {
    liveNewsCollector.stop();
    marketDataService.stop();
    marketFlowMonitor.stop();
    secInsiderCollector.stop();
    secInstitutionalCollector.stop();
    fundamentalMarketDataService.stop();
    secFundamentalsCollector.stop();
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
    if (backupTimer) {
      clearInterval(backupTimer);
      backupTimer = null;
    }
    await persistenceReady;
    await persistence.saveStoreSnapshot(store);
    await refreshBackupStatus();
  };

  return app;
}
