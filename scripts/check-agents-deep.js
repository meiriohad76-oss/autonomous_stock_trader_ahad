import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSentimentApp } from "../src/app.js";

const DEFAULT_WINDOW = "1h";
const DEFAULT_LIMIT = 25;
const DEFAULT_PRICE_LIMIT = 25;
const DEFAULT_SEC_COMPANY_LIMIT = 2;
const DEFAULT_SEC_CONCURRENCY = 1;
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|authorization|password|credential)/i;

const AGENTS = [
  { key: "universe", label: "Universe Agent" },
  { key: "fundamentals", label: "Fundamentals Agent" },
  { key: "market", label: "Market Agent" },
  { key: "signals", label: "Signals Agent" },
  { key: "policy", label: "Portfolio Policy Agent" },
  { key: "deterministic_selection", label: "Deterministic Selection Agent" },
  { key: "llm_selection", label: "LLM Selection Agent" },
  { key: "final_selection", label: "Final Selection Agent" },
  { key: "risk", label: "Risk Manager" },
  { key: "execution", label: "Execution Agent" },
  { key: "portfolio", label: "Portfolio Monitor" },
  { key: "learning", label: "Learning Agent" }
];

const HEALTH_SOURCE_KEYS = {
  fundamental_universe: "fundamental_universe",
  live_news: "google_news_rss",
  marketaux_news: "marketaux_news",
  market_data: "market_data",
  fundamental_market_data: "fundamental_market_data",
  market_flow: "market_flow",
  sec_fundamentals: "sec_fundamentals",
  sec_form4: "sec_form4",
  sec_13f: "sec_13f",
  earnings_calendar: "yahoo_earnings_calendar",
  stocktwits_stream: "stocktwits_stream",
  trade_prints: null,
  lightweight_state: "lightweight_state",
  database_backup: "database_backup"
};

function usage() {
  return `
Deep per-agent diagnostic runner

Usage:
  npm run check:agents -- [options]

Options:
  --agent <key[,key]>       Run only selected agent(s).
  --window <window>         Analysis window. Default: ${DEFAULT_WINDOW}
  --limit <n>               Candidate/detail limit. Default: ${DEFAULT_LIMIT}
  --price-limit <n>         Pricing/reference extraction batch size. Default: ${DEFAULT_PRICE_LIMIT}
  --max-sec-batches <n>     Max SEC fundamentals batches during Fundamentals Agent check. Default: AGENCY_BASELINE_SEC_BATCHES_PER_RUN or 4
  --sec-company-limit <n>   Max SEC companies per diagnostic batch. Default: ${DEFAULT_SEC_COMPANY_LIMIT}. Use 0 to keep .env.
  --sec-concurrency <n>     Max SEC fundamentals request concurrency during diagnostics. Default: ${DEFAULT_SEC_CONCURRENCY}. Use 0 to keep .env.
  --refresh-universe        Force a live Universe Agent refresh. Default: inspect the loaded universe only.
  --no-extract              Do not poll live/external sources; only inspect current state.
  --fail-on-agent-fail      Exit with code 1 when an agent reports fail. Default: write diagnostics and exit 0 unless the script crashes.
  --out <path>              Write full JSON report to this path.
  --help                    Show this help.

Examples:
  npm run check:agents
  npm run check:agents -- --agent market,fundamentals --max-sec-batches 4
  npm run check:agents -- --no-extract
  npm run check:agents -- --agent universe --refresh-universe

Agent keys:
  ${AGENTS.map((agent) => agent.key).join(", ")}
`.trim();
}

function readOptionValue(argv, index, flag) {
  const arg = argv[index];
  const inlinePrefix = `${flag}=`;
  if (arg.startsWith(inlinePrefix)) {
    return { value: arg.slice(inlinePrefix.length), nextIndex: index };
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function parsePositiveInteger(value, label, { allowZero = false } = {}) {
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    throw new Error(`${label} must be ${allowZero ? "zero or a positive integer" : "a positive integer"}.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    window: DEFAULT_WINDOW,
    limit: DEFAULT_LIMIT,
    priceLimit: DEFAULT_PRICE_LIMIT,
    agentKeys: null,
    maxSecBatches: null,
    secCompanyLimit: DEFAULT_SEC_COMPANY_LIMIT,
    secConcurrency: DEFAULT_SEC_CONCURRENCY,
    refreshUniverse: false,
    extract: true,
    failOnAgentFail: false,
    out: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--refresh-universe") {
      options.refreshUniverse = true;
    } else if (arg === "--no-extract") {
      options.extract = false;
    } else if (arg === "--fail-on-agent-fail") {
      options.failOnAgentFail = true;
    } else if (arg === "--agent" || arg.startsWith("--agent=")) {
      const parsed = readOptionValue(argv, index, "--agent");
      options.agentKeys = String(parsed.value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index = parsed.nextIndex;
    } else if (arg === "--window" || arg.startsWith("--window=")) {
      const parsed = readOptionValue(argv, index, "--window");
      options.window = String(parsed.value || DEFAULT_WINDOW);
      index = parsed.nextIndex;
    } else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const parsed = readOptionValue(argv, index, "--limit");
      options.limit = parsePositiveInteger(parsed.value, "--limit");
      index = parsed.nextIndex;
    } else if (arg === "--price-limit" || arg.startsWith("--price-limit=")) {
      const parsed = readOptionValue(argv, index, "--price-limit");
      options.priceLimit = parsePositiveInteger(parsed.value, "--price-limit");
      index = parsed.nextIndex;
    } else if (arg === "--max-sec-batches" || arg.startsWith("--max-sec-batches=")) {
      const parsed = readOptionValue(argv, index, "--max-sec-batches");
      options.maxSecBatches = parsePositiveInteger(parsed.value, "--max-sec-batches", { allowZero: true });
      index = parsed.nextIndex;
    } else if (arg === "--sec-company-limit" || arg.startsWith("--sec-company-limit=")) {
      const parsed = readOptionValue(argv, index, "--sec-company-limit");
      options.secCompanyLimit = parsePositiveInteger(parsed.value, "--sec-company-limit", { allowZero: true });
      index = parsed.nextIndex;
    } else if (arg === "--sec-concurrency" || arg.startsWith("--sec-concurrency=")) {
      const parsed = readOptionValue(argv, index, "--sec-concurrency");
      options.secConcurrency = parsePositiveInteger(parsed.value, "--sec-concurrency", { allowZero: true });
      index = parsed.nextIndex;
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const parsed = readOptionValue(argv, index, "--out");
      options.out = String(parsed.value || "");
      index = parsed.nextIndex;
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

function isDisabledByConfiguration(error) {
  return /disabled by configuration/i.test(error?.message || "");
}

function nowIso() {
  return new Date().toISOString();
}

function durationMs(startedAt) {
  return Date.now() - startedAt;
}

function sanitize(value, depth = 0) {
  if (depth > 8) {
    return "[max_depth]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const maxItems = 50;
    const items = value.slice(0, maxItems).map((item) => sanitize(item, depth + 1));
    if (value.length > maxItems) {
      items.push({ _truncated_items: value.length - maxItems });
    }
    return items;
  }

  return Object.entries(value).reduce((acc, [key, item]) => {
    acc[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitize(item, depth + 1);
    return acc;
  }, {});
}

function compactSource(source = null) {
  if (!source) {
    return null;
  }
  return sanitize({
    key: source.key || null,
    label: source.label || null,
    enabled: source.enabled ?? null,
    configured: source.configured ?? null,
    provider: source.provider || null,
    active_provider: source.active_provider || null,
    provider_chain: source.provider_chain || null,
    status: source.status || null,
    severity: source.severity || null,
    action: source.action || null,
    polling: Boolean(source.polling),
    fallback_mode: Boolean(source.fallback_mode || source.fallback_active),
    last_poll_at: source.last_poll_at || null,
    last_success_at: source.last_success_at || null,
    age_hours: source.age_hours ?? null,
    last_error: source.last_error || null,
    reason: source.reason || null,
    interval_ms: source.interval_ms || null,
    universe_symbols: source.universe_symbols ?? null,
    requested_symbols: source.requested_symbols ?? null,
    last_batch_size: source.last_batch_size ?? null,
    requested_batches: source.requested_batches ?? null,
    total_batches: source.total_batches ?? null,
    max_requests_per_poll: source.max_requests_per_poll ?? null,
    coverage_note: source.coverage_note || null
  });
}

function sourceKeyForRuntime(app, key) {
  if (key === "trade_prints") {
    return `${app.config.tradePrintsProvider}_trade_prints`;
  }
  return HEALTH_SOURCE_KEYS[key] || key;
}

function sourceSnapshot(app, keys = []) {
  const runtimeSources = new Map((app.getRuntimeReliability().sources || []).map((source) => [source.key, source]));
  const healthSources = app.getHealth().live_sources || {};
  return keys.reduce((acc, key) => {
    const healthKey = sourceKeyForRuntime(app, key);
    acc[key] = {
      runtime: compactSource(runtimeSources.get(key) || null),
      health: sanitize(healthSources[healthKey] || null)
    };
    return acc;
  }, {});
}

function stateCounters(app) {
  const store = app.store;
  const companies = store.fundamentals?.leaderboard || [];
  const liveSec = companies.filter((company) => company.data_source === "live_sec_filing").length;
  return {
    raw_documents: store.rawDocuments.length,
    normalized_documents: store.normalizedDocuments.length,
    document_entities: store.documentEntities.length,
    document_scores: store.documentScores.length,
    evidence_items: store.evidenceQuality?.items?.length || 0,
    sentiment_states: store.sentimentStates.length,
    source_stats: store.sourceStats.size,
    fundamentals_total: companies.length,
    fundamentals_live_sec: liveSec,
    fundamentals_awaiting_live_sec: Math.max(0, (app.getSecFundamentalsQueue?.().tracked_companies || companies.length) - liveSec),
    macro_history: store.macroRegimeHistory.length,
    trade_setups: store.tradeSetups?.length || 0,
    trade_setup_history: store.tradeSetupHistory.length,
    earnings_calendar: store.earningsCalendar.size,
    pending_approvals: store.pendingApprovals.size,
    positions: store.positions.size,
    orders: store.orders.size,
    execution_log: store.executionLog.length
  };
}

function deltaCounters(before, after) {
  return Object.keys(after).reduce((acc, key) => {
    acc[key] = Number(after[key] || 0) - Number(before[key] || 0);
    return acc;
  }, {});
}

function summarizeWorker(worker = null) {
  if (!worker) {
    return null;
  }
  return {
    key: worker.key,
    label: worker.label,
    status: worker.status,
    data_state: worker.data_state,
    baseline_ready: worker.baseline_ready,
    load_phase: worker.load_phase,
    refresh_state: worker.refresh_state,
    progress_pct: worker.progress_pct,
    progress_label: worker.progress_label,
    completion_estimate: worker.completion_estimate || null,
    estimated_completion_label: worker.estimated_completion_label || null,
    full_extraction_estimate: worker.full_extraction_estimate || null,
    remaining: worker.remaining || [],
    metric: worker.metric || null
  };
}

function actionResultSummary(result = {}) {
  return sanitize({
    ingested: result.ingested ?? result.ingested_documents ?? null,
    skipped: result.skipped ?? null,
    errors: result.errors ?? null,
    refreshed_companies: result.refreshed_companies ?? null,
    reference_count: result.reference_count ?? null,
    effective_limit: result.effective_limit ?? null,
    liveCompanies: result.liveCompanies ?? null,
    pendingBootstrapCompanies: result.pendingBootstrapCompanies ?? null,
    pendingLiveSecCompanies: result.pendingLiveSecCompanies ?? null,
    refreshBatchSize: result.refreshBatchSize ?? null,
    trackedCompanies: result.trackedCompanies ?? null,
    marketReferenceRefreshSkipped: result.marketReferenceRefreshSkipped ?? null,
    lightweight_state_saved: result.lightweight_state_saved ?? null,
    message: result.message || null,
    value: result.value ?? null
  });
}

function setupCounts(setups = {}) {
  const counts = setups.counts || {};
  return {
    tracked_tickers: counts.tracked_tickers || 0,
    long: counts.long || 0,
    short: counts.short || 0,
    watch: counts.watch || 0,
    no_trade: counts.no_trade || 0,
    visible: setups.setups?.length || 0
  };
}

function finalCounts(finalSelection = {}) {
  const counts = finalSelection.counts || {};
  return {
    final_buy: counts.final_buy || 0,
    final_sell: counts.final_sell || 0,
    executable: counts.executable || 0,
    review: counts.review || 0,
    watch: counts.watch || 0,
    visible: counts.visible || finalSelection.candidates?.length || 0
  };
}

function topTickers(items = [], limit = 5) {
  return items
    .map((item) => item.ticker || item.symbol || item.entity_key)
    .filter(Boolean)
    .slice(0, limit);
}

function statusFrom({ failed = false, warning = false } = {}) {
  if (failed) {
    return "fail";
  }
  if (warning) {
    return "warning";
  }
  return "pass";
}

function buildAgentReport(key, label) {
  return {
    key,
    label,
    status: "pending",
    started_at: nowIso(),
    finished_at: null,
    duration_ms: null,
    worker_before: null,
    worker_after: null,
    extraction_log: [],
    checks: [],
    errors: [],
    output_summary: null
  };
}

function addCheck(agent, key, status, summary, details = {}) {
  agent.checks.push({ key, status, summary, details: sanitize(details) });
}

function finalAgentStatus(agent) {
  if (agent.errors.length || agent.checks.some((item) => item.status === "fail")) {
    return "fail";
  }
  if (agent.checks.some((item) => item.status === "warning")) {
    return "warning";
  }
  return "pass";
}

async function getCycle(app, options) {
  return app.getAgencyCycleStatus({
    window: options.window,
    limit: options.limit,
    minConviction: 0
  });
}

function workerFromCycle(cycle, key) {
  return (cycle.workers || []).find((worker) => worker.key === key) || null;
}

async function runRuntimeAction(app, agent, payload, sourceKeys, emit, { optional = false, checkpoint = null } = {}) {
  const startedAt = Date.now();
  const started = nowIso();
  const beforeCounters = stateCounters(app);
  const beforeSources = sourceSnapshot(app, sourceKeys);
  const entry = {
    ok: "running",
    started_at: started,
    finished_at: null,
    duration_ms: null,
    payload: sanitize(payload),
    result_summary: null,
    counters_before: beforeCounters,
    counters_after: null,
    counter_delta: null,
    sources_before: beforeSources,
    sources_after: null
  };
  agent.extraction_log.push(entry);

  emit("action_start", agent.key, {
    action: payload.action,
    source: payload.source || null,
    limit: payload.limit || payload.company_limit || null
  });
  if (checkpoint) {
    await checkpoint("running");
  }

  try {
    const response = await app.runRuntimeReliabilityAction(payload);
    const afterCounters = stateCounters(app);
    const afterSources = sourceSnapshot(app, sourceKeys);
    Object.assign(entry, {
      ok: true,
      finished_at: nowIso(),
      duration_ms: durationMs(startedAt),
      result_summary: actionResultSummary(response.result || {}),
      counters_after: afterCounters,
      counter_delta: deltaCounters(beforeCounters, afterCounters),
      sources_after: afterSources
    });
    emit("action_ok", agent.key, {
      action: payload.action,
      source: payload.source || null,
      duration_ms: entry.duration_ms,
      result: entry.result_summary
    });
    if (checkpoint) {
      await checkpoint("running");
    }
    return response;
  } catch (error) {
    const afterCounters = stateCounters(app);
    const afterSources = sourceSnapshot(app, sourceKeys);
    const skipped = optional && isDisabledByConfiguration(error);
    const warning = optional && !skipped;
    Object.assign(entry, {
      ok: skipped ? null : false,
      skipped,
      warning,
      finished_at: nowIso(),
      duration_ms: durationMs(startedAt),
      error: error.message,
      counters_after: afterCounters,
      counter_delta: deltaCounters(beforeCounters, afterCounters),
      sources_after: afterSources
    });
    if (skipped || warning) {
      addCheck(
        agent,
        `optional_${payload.source || payload.action}`,
        "warning",
        skipped
          ? `${payload.source || payload.action} is disabled or unconfigured; logged as skipped.`
          : `${payload.source || payload.action} failed; logged as optional source warning.`,
        { error: error.message }
      );
      emit(skipped ? "action_skipped" : "action_warning", agent.key, {
        action: payload.action,
        source: payload.source || null,
        duration_ms: entry.duration_ms,
        error: error.message
      });
      if (checkpoint) {
        await checkpoint("running");
      }
      return null;
    }
    agent.errors.push(error.message);
    emit("action_fail", agent.key, {
      action: payload.action,
      source: payload.source || null,
      duration_ms: entry.duration_ms,
      error: error.message
    });
    if (checkpoint) {
      await checkpoint("running");
    }
    return null;
  }
}

async function recordSkippedAction(app, agent, payload, sourceKeys, emit, summary, details = {}, checkpoint = null) {
  const counters = stateCounters(app);
  const sources = sourceSnapshot(app, sourceKeys);
  const entry = {
    ok: null,
    skipped: true,
    warning: false,
    started_at: nowIso(),
    finished_at: nowIso(),
    duration_ms: 0,
    payload: sanitize(payload),
    reason: summary,
    details: sanitize(details),
    counters_before: counters,
    counters_after: counters,
    counter_delta: deltaCounters(counters, counters),
    sources_before: sources,
    sources_after: sources
  };
  agent.extraction_log.push(entry);
  emit("action_skipped", agent.key, {
    action: payload.action,
    source: payload.source || null,
    reason: summary,
    ...details
  });
  if (checkpoint) {
    await checkpoint("running");
  }
}

function applySecDiagnosticLimits(app, options) {
  const previous = {
    fundamentalSecMaxCompaniesPerPoll: app.config.fundamentalSecMaxCompaniesPerPoll,
    fundamentalSecConcurrency: app.config.fundamentalSecConcurrency
  };

  const companyLimit = Number(options.secCompanyLimit || 0);
  if (Number.isFinite(companyLimit) && companyLimit > 0) {
    const configured = Number(app.config.fundamentalSecMaxCompaniesPerPoll || 0);
    app.config.fundamentalSecMaxCompaniesPerPoll = configured > 0
      ? Math.max(1, Math.min(configured, companyLimit))
      : companyLimit;
  }

  const concurrency = Number(options.secConcurrency || 0);
  if (Number.isFinite(concurrency) && concurrency > 0) {
    const configured = Number(app.config.fundamentalSecConcurrency || 0);
    app.config.fundamentalSecConcurrency = configured > 0
      ? Math.max(1, Math.min(configured, concurrency))
      : concurrency;
  }

  return previous;
}

function restoreSecDiagnosticLimits(app, previous) {
  app.config.fundamentalSecMaxCompaniesPerPoll = previous.fundamentalSecMaxCompaniesPerPoll;
  app.config.fundamentalSecConcurrency = previous.fundamentalSecConcurrency;
}

async function inspectAgent(app, agent, options, emit, checkpoint) {
  const cycleBefore = await getCycle(app, options);
  agent.worker_before = summarizeWorker(workerFromCycle(cycleBefore, agent.key));

  if (agent.key === "universe") {
    if (options.extract && options.refreshUniverse) {
      await runRuntimeAction(app, agent, { action: "refresh_universe" }, ["fundamental_universe"], emit, { checkpoint });
    }
    const queue = app.getSecFundamentalsQueue({ limit: 5 });
    if (options.extract && !options.refreshUniverse) {
      const summary = "Live universe refresh skipped by default; current tracked universe inspected.";
      await recordSkippedAction(app, agent, { action: "refresh_universe" }, ["fundamental_universe"], emit, summary, {
        tracked_companies: queue.tracked_companies,
        command: "npm run check:agents -- --agent universe --refresh-universe"
      }, checkpoint);
      addCheck(agent, "universe_refresh_mode", "pass", `${summary} Use --refresh-universe to force the external refresh.`, {
        tracked_companies: queue.tracked_companies
      });
    }
    agent.output_summary = {
      tracked_companies: queue.tracked_companies,
      live_sec_companies: queue.live_sec_companies,
      pending_live_sec_companies: queue.pending_live_sec_companies ?? queue.pending_bootstrap_companies ?? 0,
      coverage_ratio: queue.coverage_ratio
    };
    addCheck(agent, "tracked_universe", queue.tracked_companies >= app.config.agencyBaselineUniverseMinCount ? "pass" : "fail", `${queue.tracked_companies} tracked names loaded.`);
  }

  if (agent.key === "fundamentals") {
    const maxBatches = options.maxSecBatches ?? Math.max(1, Number(app.config.agencyBaselineSecBatchesPerRun || 4));
    const previousSecLimits = applySecDiagnosticLimits(app, options);
    if (options.extract) {
      try {
        addCheck(agent, "diagnostic_sec_limits", "pass", "SEC diagnostics are capped to avoid overloading the Pi.", {
          max_batches: maxBatches,
          companies_per_batch: app.config.fundamentalSecMaxCompaniesPerPoll || "env_all",
          concurrency: app.config.fundamentalSecConcurrency || "env_default"
        });
        for (let index = 0; index < maxBatches; index += 1) {
          const response = await runRuntimeAction(
            app,
            agent,
            {
              action: "poll_once",
              source: "sec_fundamentals",
              forceUniverse: options.refreshUniverse && index === 0,
              company_limit: app.config.fundamentalSecMaxCompaniesPerPoll || null,
              concurrency: app.config.fundamentalSecConcurrency || null
            },
            ["sec_fundamentals", "fundamental_universe"],
            emit,
            { checkpoint }
          );
          const pending = Number(
            response?.result?.pendingLiveSecCompanies ??
              response?.result?.pendingBootstrapCompanies ??
              app.getSecFundamentalsQueue().pending_live_sec_companies ??
              app.getSecFundamentalsQueue().pending_bootstrap_companies ??
              0
          );
          if (pending === 0) {
            break;
          }
        }
      } finally {
        restoreSecDiagnosticLimits(app, previousSecLimits);
      }
    } else {
      restoreSecDiagnosticLimits(app, previousSecLimits);
    }
    const queue = app.getSecFundamentalsQueue({ limit: 10 });
    agent.output_summary = {
      tracked_companies: queue.tracked_companies,
      live_sec_companies: queue.live_sec_companies,
      pending_live_sec_companies: queue.pending_live_sec_companies ?? queue.pending_bootstrap_companies ?? 0,
      coverage_ratio: queue.coverage_ratio,
      next_batch_size: queue.next_batch_size,
      next_batch: queue.next_batch
    };
    addCheck(
      agent,
      "sec_coverage",
      (queue.pending_live_sec_companies ?? queue.pending_bootstrap_companies ?? 0) === 0 ? "pass" : queue.live_sec_companies > 0 ? "warning" : "fail",
      `${queue.live_sec_companies}/${queue.tracked_companies} companies are SEC-backed.`,
      { pending_live_sec_companies: queue.pending_live_sec_companies ?? queue.pending_bootstrap_companies ?? 0 }
    );
  }

  if (agent.key === "market") {
    if (options.extract) {
      await runRuntimeAction(
        app,
        agent,
        { action: "poll_once", source: "fundamental_market_data", limit: options.priceLimit },
        ["fundamental_market_data", "market_data"],
        emit,
        { checkpoint }
      );
      await runRuntimeAction(app, agent, { action: "poll_once", source: "market_flow" }, ["market_flow", "market_data"], emit, { checkpoint });
    }
    const workflow = await app.getTradingWorkflowStatus({ window: options.window, limit: options.limit, minConviction: 0 });
    const macro = app.getMacroRegime({ window: options.window });
    agent.output_summary = {
      live_pricing_ready: Boolean(workflow.live_data?.live_pricing_ready),
      market_sources: workflow.live_data?.sources?.filter((source) => ["market_data", "fundamental_market_data", "market_flow"].includes(source.key)),
      macro_regime: macro?.regime || macro?.label || null,
      macro_summary: macro?.summary || null
    };
    addCheck(agent, "live_pricing", workflow.live_data?.live_pricing_ready ? "pass" : "fail", workflow.live_data?.live_pricing_ready ? "Live pricing/reference is confirmed." : "Live pricing/reference is not confirmed.");
    addCheck(agent, "market_flow", agent.output_summary.market_sources?.some((source) => source.key === "market_flow" && source.status === "fresh" && !source.fallback_mode) ? "pass" : "warning", "Market flow source status captured.");
  }

  if (agent.key === "signals") {
    if (options.extract) {
      const signalActions = [
        { source: "live_news", sourceKeys: ["live_news", "marketaux_news"] },
        { source: "sec_form4", sourceKeys: ["sec_form4"] },
        { source: "market_flow", sourceKeys: ["market_flow"] },
        { source: "trade_prints", sourceKeys: ["trade_prints"], optional: true },
        { source: "earnings_calendar", sourceKeys: ["earnings_calendar"], optional: true },
        { source: "stocktwits_stream", sourceKeys: ["stocktwits_stream"], optional: true },
        { source: "sec_13f", sourceKeys: ["sec_13f"], optional: true }
      ];
      for (const item of signalActions) {
        await runRuntimeAction(
          app,
          agent,
          { action: "poll_once", source: item.source },
          item.sourceKeys,
          emit,
          { optional: Boolean(item.optional), checkpoint }
        );
      }
    }
    const workflow = await app.getTradingWorkflowStatus({ window: options.window, limit: options.limit, minConviction: 0 });
    const evidence = app.getEvidenceQuality({ limit: 10 });
    const recent = app.getRecentDocuments({ limit: 10 });
    const moneyFlow = app.getMoneyFlowSignals({ limit: 10 });
    agent.output_summary = {
      fresh_decision_evidence_count: workflow.live_data?.fresh_decision_evidence_count || 0,
      display_tiers: workflow.live_data?.display_tiers || {},
      source_rows: workflow.live_data?.sources || [],
      evidence_summary: evidence.summary || null,
      recent_documents: recent.map((item) => ({
        ticker: item.ticker,
        source_name: item.source_name,
        event_type: item.event_type,
        timestamp: item.timestamp,
        source_url: item.source_url || item.url || null
      })),
      money_flow: moneyFlow.map((item) => ({
        ticker: item.ticker,
        event_type: item.event_type,
        timestamp: item.timestamp,
        source_name: item.source_name,
        source_url: item.source_url || item.url || null
      }))
    };
    addCheck(agent, "fresh_evidence", agent.output_summary.fresh_decision_evidence_count > 0 ? "pass" : "fail", `${agent.output_summary.fresh_decision_evidence_count} fresh decision evidence item(s).`);
    addCheck(agent, "source_links", recent.some((item) => item.source_url || item.url) ? "pass" : "warning", "Recent signal source links captured.");
  }

  if (agent.key === "policy") {
    const [settings, policy] = await Promise.all([app.getPortfolioPolicySettings(), app.getPortfolioPolicy()]);
    agent.output_summary = { settings: settings.settings, policy };
    addCheck(agent, "policy_status", policy.status === "blocked" ? "fail" : policy.status === "caution" ? "warning" : "pass", policy.summary || "Portfolio policy loaded.");
  }

  if (agent.key === "deterministic_selection") {
    const setups = app.getTradeSetups({ window: options.window, limit: options.limit, minConviction: 0 });
    agent.output_summary = {
      counts: setupCounts(setups),
      top_tickers: topTickers(setups.setups),
      top_setups: (setups.setups || []).slice(0, 10).map((setup) => ({
        ticker: setup.ticker,
        action: setup.action,
        conviction: setup.conviction,
        setup_label: setup.setup_label,
        summary: setup.summary,
        blocked_reason: setup.blocked_reason || null
      }))
    };
    addCheck(agent, "selector_ran", setupCounts(setups).tracked_tickers > 0 || setupCounts(setups).visible > 0 ? "pass" : "fail", "Deterministic selection output inspected.");
    addCheck(agent, "tradable_setups", setupCounts(setups).long + setupCounts(setups).short > 0 ? "pass" : "warning", `${setupCounts(setups).long}/${setupCounts(setups).short} buy/sell setup(s).`);
  }

  if (agent.key === "llm_selection") {
    const finalSelection = await app.getFinalSelection({ window: options.window, limit: options.limit, minConviction: 0 });
    const llm = finalSelection.llm_agent || finalSelection.llm_selection || {};
    agent.output_summary = sanitize({
      llm_agent: llm,
      recommendation_count: llm.recommendations?.length || finalSelection.candidates?.filter((item) => item.llm_action).length || 0,
      sample: (llm.recommendations || finalSelection.candidates || []).slice(0, 10)
    });
    addCheck(agent, "llm_mode", llm.mode || finalSelection.llm_mode ? "pass" : "warning", `LLM mode: ${llm.mode || finalSelection.llm_mode || "unknown"}.`);
  }

  if (agent.key === "final_selection") {
    const finalSelection = await app.getFinalSelection({ window: options.window, limit: options.limit, minConviction: 0 });
    agent.output_summary = {
      counts: finalCounts(finalSelection),
      top_tickers: topTickers(finalSelection.candidates),
      candidates: (finalSelection.candidates || []).slice(0, 10).map((candidate) => ({
        ticker: candidate.ticker,
        final_action: candidate.final_action,
        execution_allowed: candidate.execution_allowed,
        final_conviction: candidate.final_conviction,
        agreement: candidate.agreement,
        final_reason: candidate.final_reason,
        blocked_reason: candidate.blocked_reason || candidate.policy_reason || null
      }))
    };
    addCheck(agent, "final_candidates", finalCounts(finalSelection).visible > 0 ? "pass" : "warning", `${finalCounts(finalSelection).visible} final candidate(s) visible.`);
    addCheck(agent, "executable_candidates", finalCounts(finalSelection).executable > 0 ? "pass" : "warning", `${finalCounts(finalSelection).executable} executable final candidate(s).`);
  }

  if (agent.key === "risk") {
    const risk = await app.getRiskSnapshot();
    agent.output_summary = sanitize(risk);
    addCheck(agent, "risk_status", risk.status === "blocked" ? "fail" : "pass", risk.blocked_reason || `Risk status: ${risk.status || "ok"}.`);
    addCheck(
      agent,
      "broker_read",
      risk.broker?.degraded ? "warning" : "pass",
      risk.broker?.degraded ? `Broker read degraded: ${risk.broker.last_error || "unknown error"}` : "Broker risk read completed or was not required."
    );
  }

  if (agent.key === "execution") {
    const status = app.getExecutionStatus();
    const finalSelection = await app.getFinalSelection({ window: options.window, limit: options.limit, minConviction: 0 });
    const executable = (finalSelection.candidates || []).find((candidate) => candidate.execution_allowed);
    let preview = null;
    if (executable?.setup_for_execution) {
      preview = await app.previewExecutionOrder({
        ticker: executable.ticker,
        window: options.window,
        setup: executable.setup_for_execution
      });
    }
    agent.output_summary = sanitize({
      status,
      preview_attempted: Boolean(executable?.setup_for_execution),
      preview
    });
    addCheck(agent, "broker_configured", status.broker?.configured ? "pass" : "warning", status.broker?.configured ? "Broker is configured." : "Broker is not configured; previews only.");
    addCheck(agent, "paper_submit_gate", status.broker?.ready_for_order_submission ? "pass" : "warning", status.broker?.ready_for_order_submission ? "Paper submit gate is ready." : "Paper submit gate is closed.");
  }

  if (agent.key === "portfolio") {
    const monitor = await app.getPositionMonitor({ window: options.window, limit: options.limit });
    agent.output_summary = sanitize({
      status: monitor.status || monitor.monitor_status || null,
      position_count: monitor.position_count || 0,
      open_order_count: monitor.open_order_count || 0,
      close_candidate_count: monitor.close_candidate_count || 0,
      reduce_candidate_count: monitor.reduce_candidate_count || 0,
      broker: monitor.broker || null,
      account: monitor.account || null,
      positions: (monitor.positions || []).slice(0, 10),
      open_orders: (monitor.open_orders || []).slice(0, 10)
    });
    addCheck(agent, "portfolio_monitor", "pass", `${monitor.position_count || 0} position(s), ${monitor.open_order_count || 0} open order(s).`);
    addCheck(
      agent,
      "broker_monitor",
      monitor.broker?.degraded || !monitor.broker?.configured ? "warning" : "pass",
      monitor.broker?.degraded
        ? `Broker monitor degraded: ${monitor.broker.last_error || "unknown error"}`
        : monitor.broker?.configured
          ? "Broker monitor configured."
          : "Broker monitor is waiting for credentials/config."
    );
  }

  if (agent.key === "learning") {
    const [monitor, finalSelection] = await Promise.all([
      app.getPositionMonitor({ window: options.window, limit: options.limit }),
      app.getFinalSelection({ window: options.window, limit: options.limit, minConviction: 0 })
    ]);
    const executionLog = app.getExecutionLog();
    const sampleSize = executionLog.length + (monitor.position_count || 0);
    agent.output_summary = sanitize({
      outcome_sample: sampleSize,
      execution_decisions: executionLog.length,
      visible_positions: monitor.position_count || 0,
      final_selection_counts: finalCounts(finalSelection),
      recent_execution_log: executionLog.slice(0, 10)
    });
    addCheck(agent, "outcome_sample", sampleSize >= 10 ? "pass" : "warning", `${sampleSize}/10 paper outcomes available for learning.`);
  }

  const cycleAfter = await getCycle(app, options);
  agent.worker_after = summarizeWorker(workerFromCycle(cycleAfter, agent.key));
}

async function runDiagnostics(options) {
  const app = createSentimentApp();
  const startedAt = Date.now();
  const events = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = options.out
    ? path.resolve(options.out)
    : path.join(app.config.rootDir, "data", "runtime", "agent-diagnostics", `agent-diagnostics-${timestamp}.json`);
  const jsonlPath = outputPath.replace(/\.json$/i, ".jsonl");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(jsonlPath, "");
  console.error(`[agent-diagnostics] report_path ${outputPath}`);
  console.error(`[agent-diagnostics] event_log_path ${jsonlPath}`);

  let eventWrite = Promise.resolve();
  const report = {
    status: "initializing",
    started_at: nowIso(),
    finished_at: null,
    duration_ms: null,
    options: sanitize(options),
    environment: sanitize({
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      config: {
        pi_performance_mode: app.config.piPerformanceMode,
        database_enabled: app.config.databaseEnabled,
        database_provider: app.config.databaseProvider,
        autonomous_data_enabled: app.config.autonomousDataEnabled,
        market_data_provider: app.config.marketDataProvider,
        fundamental_market_data_provider: app.config.fundamentalMarketDataProvider,
        marketaux_enabled: app.config.marketauxEnabled,
        marketaux_configured: Boolean(app.config.marketauxApiKey),
        twelve_data_configured: Boolean(app.config.twelveDataApiKey),
        alpaca_market_data_configured: Boolean(app.config.alpacaMarketDataApiKeyId && app.config.alpacaMarketDataApiSecretKey),
        broker_provider: app.config.brokerProvider,
        broker_adapter: app.config.brokerAdapter,
        broker_submit_enabled: app.config.brokerSubmitEnabled
      }
    }),
    before: null,
    agents: [],
    events,
    after: null,
    summary: null
  };

  async function flushEvents() {
    await eventWrite;
  }

  async function checkpoint(status = report.status) {
    report.status = status;
    report.duration_ms = durationMs(startedAt);
    await flushEvents();
    await writeFile(outputPath, JSON.stringify(report, null, 2));
  }

  function emit(event, agentKey, details = {}) {
    const entry = {
      at: nowIso(),
      event,
      agent: agentKey,
      details: sanitize(details)
    };
    events.push(entry);
    eventWrite = eventWrite
      .then(() => appendFile(jsonlPath, `${JSON.stringify(entry)}\n`))
      .catch((error) => {
        console.error(`[agent-diagnostics] failed_to_write_event_log ${error.message}`);
      });
    const suffix = details.error ? ` error=${details.error}` : "";
    console.error(`[agent-diagnostics] ${entry.at} ${agentKey || "system"} ${event}${suffix}`);
  }

  const requestedAgentKeys = options.agentKeys?.some((key) => key.toLowerCase() === "all") ? null : options.agentKeys;
  const selectedAgents = requestedAgentKeys
    ? AGENTS.filter((agent) => requestedAgentKeys.includes(agent.key))
    : AGENTS;
  const unknownAgents = requestedAgentKeys
    ? requestedAgentKeys.filter((key) => !AGENTS.some((agent) => agent.key === key))
    : [];
  if (unknownAgents.length) {
    throw new Error(`Unknown agent key(s): ${unknownAgents.join(", ")}`);
  }

  try {
    await checkpoint("initializing");
    emit("initialize_start", "system");
    await app.initialize();
    app.setStartupStatus({ http_listening: true, initialized: true, live_sources_started: false, phase: "diagnostic" });
    emit("initialize_ok", "system", {
      database_provider: app.config.databaseProvider,
      database_enabled: app.config.databaseEnabled,
      autonomous_data_enabled: app.config.autonomousDataEnabled
    });

    report.status = "running";
    report.before = {
      counters: stateCounters(app),
      health: sanitize(app.getHealth()),
      runtime_reliability: sanitize(app.getRuntimeReliability()),
      agency_cycle: sanitize(await getCycle(app, options))
    };
    await checkpoint("running");

    for (const spec of selectedAgents) {
      const agentStartedAt = Date.now();
      const agent = buildAgentReport(spec.key, spec.label);
      report.agents.push(agent);
      emit("agent_start", spec.key);
      await checkpoint("running");
      try {
        await inspectAgent(app, agent, options, emit, checkpoint);
      } catch (error) {
        agent.errors.push(error.message);
        emit("agent_fail", spec.key, { error: error.message });
      } finally {
        agent.status = finalAgentStatus(agent);
        agent.finished_at = nowIso();
        agent.duration_ms = durationMs(agentStartedAt);
        emit("agent_done", spec.key, {
          status: agent.status,
          checks: agent.checks.map((item) => ({ key: item.key, status: item.status })),
          errors: agent.errors
        });
        await checkpoint("running");
      }
    }

    report.after = {
      counters: stateCounters(app),
      health: sanitize(app.getHealth()),
      runtime_reliability: sanitize(app.getRuntimeReliability()),
      agency_cycle: sanitize(await getCycle(app, options)),
      system_doctor: sanitize(await app.getSystemDoctor({ window: options.window, limit: options.limit, minConviction: 0 }))
    };
    const counts = report.agents.reduce(
      (acc, agent) => {
        acc[agent.status] = (acc[agent.status] || 0) + 1;
        return acc;
      },
      { pass: 0, warning: 0, fail: 0 }
    );
    report.status = counts.fail ? "fail" : counts.warning ? "warning" : "pass";
    report.finished_at = nowIso();
    report.duration_ms = durationMs(startedAt);
    report.summary = {
      status: report.status,
      agent_count: report.agents.length,
      pass: counts.pass || 0,
      warning: counts.warning || 0,
      fail: counts.fail || 0,
      failing_agents: report.agents.filter((agent) => agent.status === "fail").map((agent) => agent.key),
      warning_agents: report.agents.filter((agent) => agent.status === "warning").map((agent) => agent.key),
      log_note: "Full extraction logs are in agents[].extraction_log and events[]."
    };

    await checkpoint(report.status);

    return {
      report,
      outputPath,
      jsonlPath
    };
  } catch (error) {
    report.status = "error";
    report.finished_at = nowIso();
    report.duration_ms = durationMs(startedAt);
    report.error = error.message;
    report.summary = {
      status: "error",
      agent_count: report.agents.length,
      log_note: "The diagnostic stopped before completion. Inspect events[] and the JSONL event log for the last completed step."
    };
    emit("diagnostic_error", "system", { error: error.message });
    await checkpoint("error");
    error.reportPath = outputPath;
    error.jsonlPath = jsonlPath;
    throw error;
  } finally {
    await flushEvents();
    try {
      await app.stopLiveSources();
    } catch (error) {
      emit("stop_live_sources_warning", "system", { error: error.message });
      await checkpoint(report.status || "running");
      await flushEvents();
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const { report, outputPath, jsonlPath } = await runDiagnostics(options);
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    report_path: outputPath,
    event_log_path: jsonlPath,
    agents: report.agents.map((agent) => ({
      key: agent.key,
      status: agent.status,
      checks: agent.checks.map((item) => ({ key: item.key, status: item.status, summary: item.summary })),
      errors: agent.errors
    }))
  }, null, 2));

  if (report.status === "fail" && options.failOnAgentFail) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "error",
    error: error.message,
    report_path: error.reportPath || null,
    event_log_path: error.jsonlPath || null
  }, null, 2));
  process.exitCode = 1;
});
