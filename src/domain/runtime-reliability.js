import os from "node:os";
import { differenceInHours, round } from "../utils/helpers.js";

const HOUR_MS = 3_600_000;

export const RUNTIME_PROFILES = {
  emergency: {
    label: "Emergency",
    description: "Lowest-load mode for recovering the Pi. Keeps the dashboard and bootstrap universe online without live collectors or SQLite writes.",
    env: {
      PI_PERFORMANCE_MODE: "true",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      LIVE_NEWS_ENABLED: "false",
      MARKET_DATA_PROVIDER: "synthetic",
      MARKET_FLOW_ENABLED: "false",
      AUTO_START_MARKET_FLOW: "false",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "synthetic",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "false",
      FUNDAMENTAL_SEC_ENABLED: "false",
      AUTO_START_SEC_FUNDAMENTALS: "false",
      SEC_FORM4_ENABLED: "false",
      SEC_13F_ENABLED: "false",
      AUTO_START_SEC_13F: "false"
    }
  },
  live_news_only: {
    label: "Live News Only",
    description: "Safe first live-data step. Enables RSS news while keeping heavier SEC and market-flow collectors manual/off.",
    env: {
      PI_PERFORMANCE_MODE: "true",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      LIVE_NEWS_ENABLED: "true",
      LIVE_NEWS_POLL_MS: "900000",
      LIVE_NEWS_MAX_ITEMS_PER_TICKER: "2",
      MARKET_DATA_PROVIDER: "synthetic",
      MARKET_FLOW_ENABLED: "false",
      AUTO_START_MARKET_FLOW: "false",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "synthetic",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "false",
      FUNDAMENTAL_SEC_ENABLED: "false",
      AUTO_START_SEC_FUNDAMENTALS: "false",
      SEC_FORM4_ENABLED: "false",
      SEC_13F_ENABLED: "false",
      AUTO_START_SEC_13F: "false"
    }
  },
  pi_light: {
    label: "Pi Light",
    description: "Balanced Pi mode. Allows news and light market refreshes while keeping expensive SEC fundamentals and 13F manual.",
    env: {
      PI_PERFORMANCE_MODE: "true",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      LIVE_NEWS_ENABLED: "true",
      LIVE_NEWS_POLL_MS: "900000",
      LIVE_NEWS_MAX_ITEMS_PER_TICKER: "2",
      MARKET_DATA_PROVIDER: "synthetic",
      MARKET_DATA_REFRESH_MS: "300000",
      MARKET_FLOW_ENABLED: "true",
      AUTO_START_MARKET_FLOW: "false",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "synthetic",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "false",
      FUNDAMENTAL_SEC_ENABLED: "true",
      AUTO_START_SEC_FUNDAMENTALS: "false",
      FUNDAMENTAL_SEC_CONCURRENCY: "1",
      FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: "8",
      SEC_FORM4_ENABLED: "true",
      SEC_13F_ENABLED: "true",
      AUTO_START_SEC_13F: "false",
      SEC_REQUEST_RETRIES: "0"
    }
  },
  full_live: {
    label: "Full Live",
    description: "Maximum live coverage. Use only after the Pi is stable or persistence/collectors are moved off-Pi.",
    env: {
      PI_PERFORMANCE_MODE: "false",
      DATABASE_ENABLED: "true",
      LIGHTWEIGHT_STATE_ENABLED: "false",
      SQLITE_BACKUP_ENABLED: "true",
      SQLITE_BACKUP_ON_STARTUP: "false",
      LIVE_NEWS_ENABLED: "true",
      LIVE_NEWS_POLL_MS: "300000",
      MARKET_DATA_PROVIDER: "twelvedata",
      MARKET_DATA_REFRESH_MS: "60000",
      MARKET_FLOW_ENABLED: "true",
      AUTO_START_MARKET_FLOW: "true",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "twelvedata",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "true",
      FUNDAMENTAL_SEC_ENABLED: "true",
      AUTO_START_SEC_FUNDAMENTALS: "true",
      FUNDAMENTAL_SEC_CONCURRENCY: "2",
      FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: "24",
      SEC_FORM4_ENABLED: "true",
      SEC_13F_ENABLED: "true",
      AUTO_START_SEC_13F: "true",
      SEC_REQUEST_RETRIES: "1"
    }
  }
};

const PROFILE_CONFIG_READERS = {
  PI_PERFORMANCE_MODE: (config) => config.piPerformanceMode,
  DATABASE_ENABLED: (config) => config.databaseEnabled,
  LIGHTWEIGHT_STATE_ENABLED: (config) => config.lightweightStateEnabled,
  SQLITE_BACKUP_ENABLED: (config) => config.sqliteBackupEnabled,
  SQLITE_BACKUP_ON_STARTUP: (config) => config.sqliteBackupOnStartup,
  LIVE_NEWS_ENABLED: (config) => config.liveNewsEnabled,
  LIVE_NEWS_POLL_MS: (config) => config.liveNewsPollMs,
  LIVE_NEWS_MAX_ITEMS_PER_TICKER: (config) => config.liveNewsMaxItemsPerTicker,
  MARKET_DATA_PROVIDER: (config) => config.marketDataProvider,
  MARKET_DATA_REFRESH_MS: (config) => config.marketDataRefreshMs,
  MARKET_FLOW_ENABLED: (config) => config.marketFlowEnabled,
  AUTO_START_MARKET_FLOW: (config) => config.autoStartMarketFlow,
  FUNDAMENTAL_MARKET_DATA_PROVIDER: (config) => config.fundamentalMarketDataProvider,
  AUTO_START_FUNDAMENTAL_MARKET_DATA: (config) => config.autoStartFundamentalMarketData,
  FUNDAMENTAL_SEC_ENABLED: (config) => config.fundamentalSecEnabled,
  AUTO_START_SEC_FUNDAMENTALS: (config) => config.autoStartSecFundamentals,
  FUNDAMENTAL_SEC_CONCURRENCY: (config) => config.fundamentalSecConcurrency,
  FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: (config) => config.fundamentalSecMaxCompaniesPerPoll,
  SEC_FORM4_ENABLED: (config) => config.secForm4Enabled,
  SEC_13F_ENABLED: (config) => config.sec13fEnabled,
  AUTO_START_SEC_13F: (config) => config.autoStartSec13f,
  SEC_REQUEST_RETRIES: (config) => config.secRequestRetries
};

function enabledLabel(enabled) {
  return enabled ? "enabled" : "disabled";
}

function sourceSpecs(config) {
  return [
    {
      key: "fundamental_universe",
      label: "Fundamental Universe",
      category: "coverage",
      enabled: true,
      autoStart: true,
      intervalMs: 24 * HOUR_MS,
      criticality: "critical",
      notes: "Bootstraps the tracked S&P 100 + QQQ coverage set."
    },
    {
      key: "live_news",
      healthKey: "google_news_rss",
      label: "Live News",
      category: "news",
      enabled: config.liveNewsEnabled,
      autoStart: config.liveNewsEnabled,
      intervalMs: config.liveNewsPollMs,
      criticality: "high",
      notes: "Feeds the sentiment engine with Google/Yahoo RSS headlines."
    },
    {
      key: "market_data",
      label: "Market Data",
      category: "prices",
      enabled: true,
      autoStart: true,
      intervalMs: config.marketDataRefreshMs,
      criticality: "high",
      notes: `Ticker charts and market snapshots use ${config.marketDataProvider}.`
    },
    {
      key: "market_flow",
      label: "Market Flow",
      category: "money_flow",
      enabled: config.marketFlowEnabled,
      autoStart: config.autoStartMarketFlow,
      intervalMs: config.marketFlowPollMs,
      criticality: "medium",
      notes: "Turns abnormal volume and price shocks into money-flow events."
    },
    {
      key: "fundamental_market_data",
      label: "Fundamental Market Reference",
      category: "fundamentals",
      enabled: true,
      autoStart: config.autoStartFundamentalMarketData,
      intervalMs: config.fundamentalMarketDataRefreshMs,
      criticality: "medium",
      notes: `Valuation/reference fields use ${config.fundamentalMarketDataProvider}.`
    },
    {
      key: "sec_fundamentals",
      label: "SEC Fundamentals",
      category: "fundamentals",
      enabled: config.fundamentalSecEnabled,
      autoStart: config.autoStartSecFundamentals,
      intervalMs: config.fundamentalSecPollMs,
      criticality: "high",
      notes: `Refreshes company fundamentals from SEC submissions and Company Facts in batches of ${config.fundamentalSecMaxCompaniesPerPoll || "all"}.`
    },
    {
      key: "sec_form4",
      label: "SEC Form 4 Insider Flow",
      category: "filings",
      enabled: config.secForm4Enabled,
      autoStart: config.secForm4Enabled,
      intervalMs: config.secForm4PollMs,
      criticality: "medium",
      notes: "Tracks insider buying and selling filings."
    },
    {
      key: "sec_13f",
      label: "SEC 13F Institutional Flow",
      category: "filings",
      enabled: config.sec13fEnabled,
      autoStart: config.autoStartSec13f,
      intervalMs: config.sec13fPollMs,
      criticality: "low",
      notes: "Tracks slower quarterly institutional position changes."
    },
    {
      key: "lightweight_state",
      label: "Lightweight State Snapshot",
      category: "storage",
      enabled: config.lightweightStateEnabled && !config.databaseEnabled,
      autoStart: config.lightweightStateEnabled && !config.databaseEnabled,
      intervalMs: null,
      criticality: "medium",
      notes: "Persists a compact JSON runtime snapshot when SQLite/Postgres persistence is disabled."
    },
    {
      key: "database_backup",
      label: "SQLite Backup",
      category: "storage",
      enabled: config.databaseEnabled && config.databaseProvider === "sqlite" && config.sqliteBackupEnabled,
      autoStart: config.databaseEnabled && config.databaseProvider === "sqlite" && config.sqliteBackupEnabled,
      intervalMs: config.sqliteBackupIntervalMs,
      criticality: "medium",
      notes: "Creates local SQLite snapshot backups when SQLite persistence is active."
    }
  ];
}

function latestTimestamp(health = {}) {
  return health.last_success_at || health.last_backup_at || health.last_bootstrap_at || null;
}

function errorMessage(health = {}) {
  return health.last_error || null;
}

function classifySource(spec, health, pressure) {
  const lastSuccessAt = latestTimestamp(health);
  const lastPollAt = health?.last_poll_at || null;
  const lastError = errorMessage(health);
  const ageHours = lastSuccessAt ? differenceInHours(lastSuccessAt) : null;
  const staleAfterHours = Math.max(1, round(((spec.intervalMs || HOUR_MS) * 2.5) / HOUR_MS, 2));
  const hasLiveProvider =
    !["market_data", "fundamental_market_data"].includes(spec.key) ||
    !String(health?.provider || "").includes("synthetic");

  if (!spec.enabled) {
    return {
      status: "disabled",
      action: "leave_disabled",
      severity: "info",
      reason: `${spec.label} is disabled by configuration.`
    };
  }

  if (!spec.autoStart) {
    return {
      status: "manual",
      action: pressure.isConstrained ? "keep_manual" : "manual_refresh_when_needed",
      severity: spec.criticality === "high" ? "warning" : "info",
      reason: `${spec.label} is enabled but not auto-started.`
    };
  }

  if (health?.polling) {
    return {
      status: "polling",
      action: "monitor",
      severity: "info",
      reason: `${spec.label} is currently polling.`
    };
  }

  if (lastError && !lastSuccessAt) {
    return {
      status: "error",
      action: "investigate",
      severity: "critical",
      reason: `${spec.label} has errors and no successful refresh yet.`
    };
  }

  if (lastError && ageHours !== null && ageHours > staleAfterHours) {
    return {
      status: "degraded",
      action: pressure.isConstrained ? "pause_until_stable" : "retry_with_backoff",
      severity: "warning",
      reason: `${spec.label} is stale and has a recent error.`
    };
  }

  if (ageHours !== null && ageHours > staleAfterHours) {
    return {
      status: "stale",
      action: pressure.isConstrained ? "manual_refresh_when_needed" : "refresh",
      severity: spec.criticality === "critical" ? "warning" : "info",
      reason: `${spec.label} has not refreshed within ${staleAfterHours} hours.`
    };
  }

  if (!lastSuccessAt && !lastPollAt) {
    return {
      status: hasLiveProvider ? "pending" : "fallback",
      action: hasLiveProvider ? "start_or_wait" : "accept_fallback",
      severity: hasLiveProvider && spec.criticality === "high" ? "warning" : "info",
      reason: hasLiveProvider
        ? `${spec.label} has not refreshed in this process yet.`
        : `${spec.label} is currently using synthetic/fallback data.`
    };
  }

  if (lastError) {
    return {
      status: "degraded",
      action: pressure.isConstrained ? "keep_running_light" : "retry_with_backoff",
      severity: "warning",
      reason: `${spec.label} has a recent error but also has usable data.`
    };
  }

  return {
    status: hasLiveProvider ? "healthy" : "fallback",
    action: hasLiveProvider ? "keep_running" : "accept_fallback",
    severity: "info",
    reason: hasLiveProvider
      ? `${spec.label} is operating normally.`
      : `${spec.label} is serving deterministic fallback data.`
  };
}

function pressureSnapshot(config) {
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const loadAvg = os.loadavg();
  const cpuCount = Math.max(1, os.cpus()?.length || 1);
  const loadPerCore = loadAvg[0] / cpuCount;
  const rssRatio = totalMemory ? memory.rss / totalMemory : 0;
  const freeRatio = totalMemory ? freeMemory / totalMemory : 1;
  const isConstrained =
    config.piPerformanceMode ||
    loadPerCore >= 0.8 ||
    rssRatio >= 0.35 ||
    freeRatio <= 0.12;

  const reasons = [];
  if (config.piPerformanceMode) {
    reasons.push("Pi performance mode is enabled.");
  }
  if (loadPerCore >= 0.8) {
    reasons.push("CPU load is high for the available cores.");
  }
  if (rssRatio >= 0.35) {
    reasons.push("Node process memory is high relative to system memory.");
  }
  if (freeRatio <= 0.12) {
    reasons.push("System free memory is low.");
  }

  return {
    isConstrained,
    reasons,
    process: {
      uptime_seconds: Math.round(process.uptime()),
      rss_mb: round(memory.rss / 1_048_576, 1),
      heap_used_mb: round(memory.heapUsed / 1_048_576, 1)
    },
    system: {
      platform: os.platform(),
      cpu_count: cpuCount,
      load_1m: round(loadAvg[0], 2),
      load_per_core_1m: round(loadPerCore, 2),
      total_memory_mb: round(totalMemory / 1_048_576, 1),
      free_memory_mb: round(freeMemory / 1_048_576, 1),
      free_memory_ratio: round(freeRatio, 3)
    }
  };
}

function buildPlan(sources, pressure, config) {
  const safeToAutostart = sources
    .filter((source) => source.enabled && source.auto_start && ["healthy", "fallback", "pending"].includes(source.status))
    .map((source) => source.key);
  const keepManual = sources
    .filter((source) => source.enabled && !source.auto_start)
    .map((source) => source.key);
  const investigate = sources
    .filter((source) => ["error", "degraded"].includes(source.status))
    .map((source) => source.key);
  const disabled = sources
    .filter((source) => !source.enabled)
    .map((source) => source.key);

  const recommendations = [];
  if (pressure.isConstrained) {
    recommendations.push("Keep high-cost collectors manual until pressure is stable.");
  }
  if (!config.databaseEnabled) {
    recommendations.push("Persistence is disabled; runtime data will reset on restart.");
  }
  if (config.databaseProvider === "sqlite" && config.databaseEnabled && config.sqliteBackupOnStartup) {
    recommendations.push("Disable startup SQLite backups on the Pi if boot CPU or disk pressure returns.");
  }
  if (investigate.length) {
    recommendations.push(`Investigate degraded sources: ${investigate.join(", ")}.`);
  }
  if (!recommendations.length) {
    recommendations.push("Runtime plan is stable; keep current collector schedule.");
  }

  return {
    safe_to_autostart: safeToAutostart,
    keep_manual: keepManual,
    investigate,
    disabled,
    recommendations
  };
}

function buildAvailableActions(sources, config) {
  const byKey = new Map(sources.map((source) => [source.key, source]));
  const actions = [
    {
      action: "snapshot",
      label: "Refresh Runtime Snapshot",
      source: null,
      safe: true,
      enabled: true,
      description: "Re-read current runtime reliability without polling live sources."
    },
    {
      action: "refresh_universe",
      label: "Refresh Universe",
      source: "fundamental_universe",
      safe: true,
      enabled: true,
      description: "Rebuild the tracked S&P 100 + QQQ coverage universe."
    },
    {
      action: "poll_once",
      label: "Poll News Once",
      source: "live_news",
      safe: true,
      enabled: Boolean(byKey.get("live_news")?.enabled),
      description: "Fetch one batch of Google/Yahoo RSS news without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll Market Flow Once",
      source: "market_flow",
      safe: true,
      enabled: Boolean(byKey.get("market_flow")?.enabled),
      description: "Run one abnormal volume/flow scan without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll SEC Form 4 Once",
      source: "sec_form4",
      safe: true,
      enabled: Boolean(byKey.get("sec_form4")?.enabled),
      description: "Fetch one insider-filing batch without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll SEC 13F Once",
      source: "sec_13f",
      safe: false,
      enabled: Boolean(byKey.get("sec_13f")?.enabled),
      description: "Run one institutional 13F scan. This can be slower than other actions."
    },
    {
      action: "poll_once",
      label: "Poll SEC Fundamentals Once",
      source: "sec_fundamentals",
      safe: false,
      enabled: Boolean(byKey.get("sec_fundamentals")?.enabled),
      description: "Refresh SEC submissions/company facts once. This is the heaviest source."
    },
    {
      action: "poll_once",
      label: "Refresh Fundamental Market Data",
      source: "fundamental_market_data",
      safe: true,
      enabled: true,
      description: "Refresh valuation/reference fields once using the configured provider."
    },
    {
      action: "save_lightweight_state",
      label: "Save Lightweight State",
      source: "lightweight_state",
      safe: true,
      enabled: Boolean(config.lightweightStateEnabled && !config.databaseEnabled),
      description: "Persist the current compact JSON runtime snapshot now."
    },
    {
      action: "backup_now",
      label: "Backup SQLite Now",
      source: "database_backup",
      safe: false,
      enabled: Boolean(config.databaseEnabled && config.databaseProvider === "sqlite" && config.sqliteBackupEnabled),
      description: "Create one SQLite backup now. Avoid during high disk pressure."
    },
    {
      action: "apply_profile",
      label: "Preview Runtime Profile",
      source: null,
      safe: true,
      enabled: true,
      description: "Preview or apply one of the predefined runtime .env profiles."
    }
  ];

  return actions.map((item) => ({
    ...item,
    disabled_reason: item.enabled ? null : `${item.source || item.action} is disabled by current configuration.`
  }));
}

function normalizeProfileValue(value) {
  if (typeof value === "boolean") {
    return String(value);
  }
  return String(value ?? "");
}

function profileDiff(config, profile) {
  return Object.entries(profile.env).map(([key, desired]) => {
    const reader = PROFILE_CONFIG_READERS[key];
    const current = reader ? normalizeProfileValue(reader(config)) : null;
    return {
      key,
      current,
      desired: String(desired),
      matches: current === String(desired)
    };
  });
}

function buildRuntimeProfiles(config, pressure) {
  const profiles = Object.entries(RUNTIME_PROFILES).map(([key, profile]) => {
    const changes = profileDiff(config, profile);
    const changed = changes.filter((item) => !item.matches);
    return {
      key,
      label: profile.label,
      description: profile.description,
      matches_current: changed.length === 0,
      change_count: changed.length,
      env: profile.env,
      changes: changed
    };
  });

  const current = profiles.find((profile) => profile.matches_current)?.key || null;
  let recommended = "pi_light";
  if (!config.databaseEnabled && !config.liveNewsEnabled) {
    recommended = "emergency";
  } else if (!config.databaseEnabled && config.liveNewsEnabled && !config.marketFlowEnabled && !config.secForm4Enabled) {
    recommended = "live_news_only";
  } else if (!pressure.isConstrained && config.databaseEnabled) {
    recommended = "full_live";
  }

  return {
    current,
    recommended,
    profiles
  };
}

function overallStatus(sources, pressure) {
  const criticalErrors = sources.filter((source) => source.severity === "critical").length;
  const warnings = sources.filter((source) => source.severity === "warning").length;

  if (criticalErrors) {
    return "degraded";
  }
  if (pressure.isConstrained && warnings) {
    return "constrained";
  }
  if (pressure.isConstrained || warnings) {
    return "caution";
  }
  return "optimal";
}

export function createRuntimeReliabilityAgent({ config, store }) {
  function getSnapshot() {
    const pressure = pressureSnapshot(config);
    const specs = sourceSpecs(config);
    const sources = specs.map((spec) => {
      const health =
        spec.key === "database_backup"
          ? store.health.databaseBackup || {}
          : store.health.liveSources?.[spec.healthKey || spec.key] || {};
      const classification = classifySource(spec, health, pressure);
      const lastSuccessAt = latestTimestamp(health);

      return {
        key: spec.key,
        label: spec.label,
        category: spec.category,
        enabled: spec.enabled,
        enabled_label: enabledLabel(spec.enabled),
        auto_start: spec.autoStart,
        criticality: spec.criticality,
        status: classification.status,
        action: classification.action,
        severity: classification.severity,
        reason: classification.reason,
        notes: spec.notes,
        provider: health.provider || null,
        polling: Boolean(health.polling),
        last_poll_at: health.last_poll_at || null,
        last_success_at: lastSuccessAt,
        age_hours: lastSuccessAt ? round(differenceInHours(lastSuccessAt), 2) : null,
        last_error: errorMessage(health),
        interval_ms: spec.intervalMs || null
      };
    });

    const status = overallStatus(sources, pressure);

    return {
      as_of: new Date().toISOString(),
      status,
      summary:
        status === "optimal"
          ? "Runtime sources are operating within the current safety plan."
          : "Runtime needs attention before increasing live collector load.",
      pressure,
      source_counts: {
        total: sources.length,
        healthy: sources.filter((source) => source.status === "healthy").length,
        fallback: sources.filter((source) => source.status === "fallback").length,
        manual: sources.filter((source) => source.status === "manual").length,
        degraded: sources.filter((source) => ["degraded", "error"].includes(source.status)).length,
        disabled: sources.filter((source) => source.status === "disabled").length
      },
      collector_plan: buildPlan(sources, pressure, config),
      available_actions: buildAvailableActions(sources, config),
      runtime_profiles: buildRuntimeProfiles(config, pressure),
      sources
    };
  }

  return {
    getSnapshot
  };
}
