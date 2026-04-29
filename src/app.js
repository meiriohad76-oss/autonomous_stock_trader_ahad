import { config } from "./config.js";
import { readFile, writeFile } from "node:fs/promises";
import { createFundamentalMarketDataService } from "./domain/fundamental-market-data.js";
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
import { createCorporateEventsCollector } from "./domain/corporate-events.js";
import { createSocialSentimentCollector } from "./domain/social-sentiment.js";
import { createTradePrintsCollector } from "./domain/trade-prints.js";
import { createStore, resetStore } from "./domain/store.js";
import { TICKER_LOOKUP } from "./domain/taxonomy.js";
import { round, scoreToLabel } from "./utils/helpers.js";
import { createTradeSetupAgent } from "./domain/trade-setup.js";

const MARKET_FLOW_SETTINGS_FIELDS = {
  marketFlowVolumeSpikeThreshold: { env: "MARKET_FLOW_VOLUME_SPIKE_THRESHOLD", min: 1, max: 20, digits: 2 },
  marketFlowVolumeZScoreThreshold: { env: "MARKET_FLOW_VOLUME_Z_SCORE_THRESHOLD", min: 0.5, max: 10, digits: 2 },
  marketFlowDollarVolumeZScoreThreshold: { env: "MARKET_FLOW_DOLLAR_VOLUME_Z_SCORE_THRESHOLD", min: 0.5, max: 10, digits: 2 },
  marketFlowMinPriceMoveThreshold: { env: "MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD", min: 0.001, max: 0.2, digits: 4 },
  marketFlowBlockTradeSpikeThreshold: { env: "MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD", min: 1, max: 30, digits: 2 },
  marketFlowBlockTradeShockThreshold: { env: "MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD", min: 1, max: 30, digits: 2 },
  marketFlowPersistenceBars: { env: "MARKET_FLOW_PERSISTENCE_BARS", min: 1, max: 6, digits: 0 },
  marketFlowCloseLocationThreshold: { env: "MARKET_FLOW_CLOSE_LOCATION_THRESHOLD", min: 0.5, max: 0.95, digits: 2 },
  marketFlowBlockTradeMinShares: { env: "MARKET_FLOW_BLOCK_TRADE_MIN_SHARES", min: 10000, max: 1000000000, digits: 0 },
  marketFlowBlockTradeMinNotionalUsd: { env: "MARKET_FLOW_BLOCK_TRADE_MIN_NOTIONAL_USD", min: 100000, max: 10000000000, digits: 0 },
  marketFlowAbnormalVolumeMinNotionalUsd: { env: "MARKET_FLOW_ABNORMAL_VOLUME_MIN_NOTIONAL_USD", min: 100000, max: 10000000000, digits: 0 }
};

const INSIDER_FLOW_EVENT_TYPES = new Set(["insider_buy", "insider_sell", "activist_stake"]);
const INSTITUTIONAL_FLOW_EVENT_TYPES = new Set(["institutional_buying", "institutional_selling"]);
const TAPE_FLOW_EVENT_TYPES = new Set([
  "abnormal_volume_buying",
  "abnormal_volume_selling",
  "block_trade_buying",
  "block_trade_selling"
]);
const MONEY_FLOW_EVENT_TYPES = new Set([
  ...INSIDER_FLOW_EVENT_TYPES,
  ...INSTITUTIONAL_FLOW_EVENT_TYPES,
  ...TAPE_FLOW_EVENT_TYPES
]);
const SMART_MONEY_ALERT_TYPES = new Set([
  "smart_money_accumulation",
  "smart_money_distribution",
  "smart_money_stacking_positive",
  "smart_money_stacking_negative"
]);

function readMarketFlowSettings(currentConfig) {
  return Object.keys(MARKET_FLOW_SETTINGS_FIELDS).reduce((acc, key) => {
    acc[key] = Number(currentConfig[key]);
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

function clampSettingValue(value, spec) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid value for ${spec.env}`);
  }
  const bounded = Math.min(spec.max, Math.max(spec.min, numeric));
  return Number(bounded.toFixed(spec.digits));
}

function moneyFlowBucket(eventType) {
  if (INSIDER_FLOW_EVENT_TYPES.has(eventType)) {
    return "insider";
  }
  if (INSTITUTIONAL_FLOW_EVENT_TYPES.has(eventType)) {
    return "institutional";
  }
  if (TAPE_FLOW_EVENT_TYPES.has(eventType)) {
    return "tape";
  }
  return "other";
}

function moneyFlowNotional(item) {
  const meta = item?.source_metadata || {};
  return Math.abs(
    Number(
      meta.latest_dollar_volume_usd ??
        meta.transaction_value_usd ??
        meta.position_delta_value_usd ??
        0
    ) || 0
  );
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
  const states = store.sentimentStates
    .filter((state) => state.entity_type === "ticker" && state.window === windowKey)
    .filter((state) => (filters.label ? state.sentiment_regime === filters.label : true))
    .filter((state) => (filters.minConfidence ? state.weighted_confidence >= filters.minConfidence : true))
    .sort((a, b) => b.weighted_sentiment - a.weighted_sentiment);

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
    sectors,
    alerts: store.alertHistory.slice(0, 10),
    source_quality: [...store.sourceStats.values()].sort((a, b) => b.rolling_avg_confidence - a.rolling_avg_confidence)
  };
}

async function buildTickerDetail(store, marketDataService, ticker) {
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
        explanation_short: score.explanation_short,
        url: normalized.canonical_url,
        source_metadata: normalized.source_metadata || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

function buildMoneyFlowSnapshot(store, { hours = 48, limit = 120 } = {}) {
  const cutoff = Date.now() - Math.max(1, hours) * 3_600_000;
  const signals = buildRecentDocuments(store, { limit: Math.max(limit * 2, 200) })
    .filter((item) => MONEY_FLOW_EVENT_TYPES.has(item.event_type))
    .filter((item) => {
      const timestamp = new Date(item.timestamp || 0).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    .slice(0, limit);

  const groups = {
    insider: [],
    institutional: [],
    tape: []
  };
  const counts = {
    insider: 0,
    institutional: 0,
    tape: 0,
    bullish: 0,
    bearish: 0,
    block: 0,
    abnormal: 0
  };
  const tickerMap = new Map();
  const stepHours = hours <= 24 ? 1 : hours <= 72 ? 3 : 6;
  const bucketMs = stepHours * 3_600_000;
  const timelineMap = new Map();
  const tapeDiagnostics = {
    maxVolumeSpike: 0,
    maxDollarSpike: 0,
    maxVolumeZScore: 0,
    maxDollarVolumeZScore: 0,
    maxMoveShock: 0,
    maxRangeExpansion: 0,
    maxPersistenceBars: 0
  };

  for (const signal of signals) {
    const bucket = moneyFlowBucket(signal.event_type);
    if (groups[bucket]) {
      groups[bucket].push(signal);
      counts[bucket] += 1;
    }

    if ((signal.sentiment_score || 0) >= 0) {
      counts.bullish += 1;
    } else {
      counts.bearish += 1;
    }

    if (signal.event_type?.startsWith("block_trade")) {
      counts.block += 1;
    }
    if (signal.event_type?.startsWith("abnormal_volume")) {
      counts.abnormal += 1;
    }

    if (signal.ticker) {
      const entry = tickerMap.get(signal.ticker) || {
        ticker: signal.ticker,
        count: 0,
        notional_usd: 0,
        latest_timestamp: signal.timestamp,
        net_sentiment: 0,
        buckets: new Set()
      };
      entry.count += 1;
      entry.notional_usd += moneyFlowNotional(signal);
      entry.latest_timestamp = entry.latest_timestamp > signal.timestamp ? entry.latest_timestamp : signal.timestamp;
      entry.net_sentiment += (signal.sentiment_score || 0) * Math.max(0.1, signal.confidence || 0);
      entry.buckets.add(bucket);
      tickerMap.set(signal.ticker, entry);
    }

    const timestamp = new Date(signal.timestamp);
    const bucketStart = Math.floor(timestamp.getTime() / bucketMs) * bucketMs;
    const point = timelineMap.get(bucketStart) || {
      timestamp: new Date(bucketStart).toISOString(),
      total: 0,
      bullish: 0,
      bearish: 0,
      insider: 0,
      institutional: 0,
      tape: 0
    };
    point.total += 1;
    point[bucket] += 1;
    if ((signal.sentiment_score || 0) >= 0) {
      point.bullish += 1;
    } else {
      point.bearish += 1;
    }
    timelineMap.set(bucketStart, point);

    if (bucket === "tape") {
      const meta = signal.source_metadata || {};
      tapeDiagnostics.maxVolumeSpike = Math.max(tapeDiagnostics.maxVolumeSpike, Number(meta.volume_spike || 0));
      tapeDiagnostics.maxDollarSpike = Math.max(tapeDiagnostics.maxDollarSpike, Number(meta.dollar_volume_spike || 0));
      tapeDiagnostics.maxVolumeZScore = Math.max(tapeDiagnostics.maxVolumeZScore, Number(meta.volume_zscore || 0));
      tapeDiagnostics.maxDollarVolumeZScore = Math.max(
        tapeDiagnostics.maxDollarVolumeZScore,
        Number(meta.dollar_volume_zscore || 0)
      );
      tapeDiagnostics.maxMoveShock = Math.max(tapeDiagnostics.maxMoveShock, Number(meta.move_shock || 0));
      tapeDiagnostics.maxRangeExpansion = Math.max(tapeDiagnostics.maxRangeExpansion, Number(meta.range_expansion || 0));
      tapeDiagnostics.maxPersistenceBars = Math.max(tapeDiagnostics.maxPersistenceBars, Number(meta.persistence_bars || 0));
    }
  }

  return {
    as_of: store.health.lastUpdate,
    lookback_hours: hours,
    summary: {
      total: signals.length,
      insider: counts.insider,
      institutional: counts.institutional,
      tape: counts.tape,
      bullish: counts.bullish,
      bearish: counts.bearish,
      block: counts.block,
      abnormal: counts.abnormal
    },
    groups: {
      insider: groups.insider.slice(0, 8),
      institutional: groups.institutional.slice(0, 8),
      tape: groups.tape.slice(0, 8)
    },
    timeline: [...timelineMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value),
    top_tickers: [...tickerMap.values()]
      .sort((a, b) => b.count - a.count || b.notional_usd - a.notional_usd)
      .slice(0, 8)
      .map((entry) => ({
        ...entry,
        buckets: [...entry.buckets]
      })),
    diagnostics: {
      step_hours: stepHours,
      tape: tapeDiagnostics
    }
  };
}

function buildMoneyFlowTickerDetail(store, ticker, { hours = 168, limit = 60 } = {}) {
  const signals = buildRecentDocuments(store, { ticker, limit: Math.max(limit, 100) })
    .filter((item) => MONEY_FLOW_EVENT_TYPES.has(item.event_type))
    .slice(0, limit);

  if (!signals.length) {
    return null;
  }

  const summary = {
    total: signals.length,
    bullish: 0,
    bearish: 0,
    insider: 0,
    institutional: 0,
    tape: 0,
    block: 0,
    abnormal: 0,
    estimated_notional_usd: 0
  };
  const stepHours = hours <= 48 ? 4 : 12;
  const bucketMs = stepHours * 3_600_000;
  const timelineMap = new Map();

  for (const signal of signals) {
    const bucket = moneyFlowBucket(signal.event_type);
    if (bucket !== "other") {
      summary[bucket] += 1;
    }
    if ((signal.sentiment_score || 0) >= 0) {
      summary.bullish += 1;
    } else {
      summary.bearish += 1;
    }
    if (signal.event_type?.startsWith("block_trade")) {
      summary.block += 1;
    }
    if (signal.event_type?.startsWith("abnormal_volume")) {
      summary.abnormal += 1;
    }
    summary.estimated_notional_usd += moneyFlowNotional(signal);

    const timestamp = new Date(signal.timestamp || signal.published_at || 0);
    const bucketStart = Math.floor(timestamp.getTime() / bucketMs) * bucketMs;
    const point = timelineMap.get(bucketStart) || {
      timestamp: new Date(bucketStart).toISOString(),
      total: 0,
      bullish: 0,
      bearish: 0,
      insider: 0,
      institutional: 0,
      tape: 0
    };
    point.total += 1;
    if (bucket !== "other") {
      point[bucket] += 1;
    }
    if ((signal.sentiment_score || 0) >= 0) {
      point.bullish += 1;
    } else {
      point.bearish += 1;
    }
    timelineMap.set(bucketStart, point);
  }

  const alerts = store.alertHistory
    .filter((alert) => alert.entity_key === ticker && SMART_MONEY_ALERT_TYPES.has(alert.alert_type))
    .slice(0, 8);
  const latestSignal = signals[0];
  const tickerEntry = TICKER_LOOKUP.get(ticker);

  return {
    ticker,
    company: tickerEntry?.company || ticker,
    sector: tickerEntry?.sector || "Other",
    lookback_hours: hours,
    latest_signal_at: latestSignal.timestamp || latestSignal.published_at || null,
    dominant_bucket:
      summary.tape >= summary.institutional && summary.tape >= summary.insider
        ? "tape"
        : summary.institutional >= summary.insider
          ? "institutional"
          : "insider",
    summary: {
      ...summary,
      estimated_notional_usd: round(summary.estimated_notional_usd, 2)
    },
    recent_signals: signals.slice(0, 10),
    recent_alerts: alerts,
    timeline: [...timelineMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value)
  };
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
  const corporateEventsCollector = createCorporateEventsCollector({ config, store, pipeline });
  const socialSentimentCollector = createSocialSentimentCollector({ config, store, pipeline });
  const tradePrintsCollector = createTradePrintsCollector({ config, store, pipeline });

  const app = {
    config,
    store,
    pipeline,
    persistence,
    async initialize() {
      await persistenceReady;
      await persistence.hydrateStore(store);
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
    async replay(options) {
      const sentimentCount = await replaySampleEvents(this, options);
      const fundamentalCount = await fundamentals.replaySample({
        intervalMs: options?.intervalMs ? Math.max(0, Math.floor(options.intervalMs / 2)) : 0
      });
      await persistence.saveStoreSnapshot(store);
      return { sentimentCount, fundamentalCount };
    },
    getConfig() {
      return {
        app_name: "Sentiment Analyst",
        companion_dashboard: "/fundamentals.html",
        deployment_target: config.deploymentTarget,
        public_base_url: config.publicBaseUrl,
        tunnel_provider: config.tunnelProvider,
        sse_heartbeat_ms: config.sseHeartbeatMs,
        dashboard_mutations_enabled: config.dashboardMutationsEnabled,
        database_enabled: config.databaseEnabled,
        database_provider: config.databaseProvider,
        database_target: databaseTargetLabel(config),
        universe_name: config.universeName,
        default_window: config.defaultWindow,
        windows: ["15m", "1h", "4h", "1d", "7d"],
        live_news_enabled: config.liveNewsEnabled,
        market_data_provider: config.marketDataProvider,
        market_flow_enabled: config.marketFlowEnabled,
        market_flow_settings: readMarketFlowSettings(config),
        fundamental_market_data_provider: config.fundamentalMarketDataProvider,
        fundamental_sec_enabled: config.fundamentalSecEnabled,
        sec_form4_enabled: config.secForm4Enabled,
        sec_13f_enabled: config.sec13fEnabled,
        earnings_enabled: config.earningsEnabled,
        stocktwits_enabled: config.stocktwitsEnabled,
        trade_prints_enabled: config.tradePrintsEnabled,
        trade_prints_provider: config.tradePrintsProvider,
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
        live_sources: store.health.liveSources
      };
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
    getMoneyFlowSnapshot(options) {
      return buildMoneyFlowSnapshot(store, options);
    },
    getMoneyFlowTickerDetail(ticker, options) {
      return buildMoneyFlowTickerDetail(store, ticker, options);
    },
    getHighImpactEvents(limit = 10) {
      return buildRecentDocuments(store, { limit: 100 })
        .filter((item) => item.confidence >= 0.7 && Math.abs(item.sentiment_score) >= 0.4)
        .slice(0, limit);
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
    getMacroRegime() {
      return store.macroRegime;
    },
    getTradeSetups({ action = null, minConviction = null, provisional = null } = {}) {
      return store.tradeSetups
        .filter((s) => (action ? s.action === action : true))
        .filter((s) => (minConviction !== null ? s.conviction >= minConviction : true))
        .filter((s) => (provisional !== null ? s.provisional === provisional : true));
    },
    getTradeSetupDetail(ticker) {
      return store.tradeSetups.find((s) => s.ticker === ticker) || null;
    },
    runTradeSetups() {
      tradeSetupAgent.run();
    },
    getEarningsCalendar() {
      return Object.fromEntries(store.earningsCalendar);
    },
    getTrackedFundamentalCompanies() {
      return fundamentals.getTrackedCompanies();
    },
    async replaceFundamentalCompanies(companies, options = {}) {
      return fundamentals.replaceCompanies(companies, options);
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
  const tradeSetupAgent = createTradeSetupAgent(app);
  let autosaveTimer = null;

  app.startLiveSources = async function startLiveSources() {
    await persistenceReady;
    await Promise.all([
      liveNewsCollector.start(),
      marketDataService.start(),
      secInsiderCollector.start(),
      secInstitutionalCollector.start(),
      fundamentalMarketDataService.start({
        getCompanies: () => fundamentals.getTrackedCompanies(),
        onUpdate: async (referenceMap) => fundamentals.refreshMarketReference(referenceMap)
      }),
      secFundamentalsCollector.start(),
      tradeSetupAgent.start(),
      corporateEventsCollector.start(),
      socialSentimentCollector.start(),
      tradePrintsCollector.start()
    ]);
    await marketFlowMonitor.start();

    if (config.databaseEnabled && !autosaveTimer) {
      autosaveTimer = setInterval(() => {
        persistence.saveStoreSnapshot(store).catch((error) => {
          console.error("Persistence autosave failed:", error);
        });
      }, config.databaseAutosaveMs);
    }
  };

  app.stopLiveSources = async function stopLiveSources() {
    tradeSetupAgent.stop();
    liveNewsCollector.stop();
    marketDataService.stop();
    marketFlowMonitor.stop();
    secInsiderCollector.stop();
    secInstitutionalCollector.stop();
    corporateEventsCollector.stop();
    socialSentimentCollector.stop();
    tradePrintsCollector.stop();
    fundamentalMarketDataService.stop();
    secFundamentalsCollector.stop();
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
    await persistenceReady;
    await persistence.saveStoreSnapshot(store);
  };

  return app;
}
