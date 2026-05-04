const WORKERS = [
  {
    key: "universe",
    label: "Universe Agent",
    view: "universe",
    automation: "automatic_on_startup",
    mission: "Keep the agency inside the S&P 100 plus QQQ holdings boundary.",
    action: { kind: "runtime", action: "refresh_universe", label: "Refresh Universe", icon: "sync" }
  },
  {
    key: "fundamentals",
    label: "Fundamentals Agent",
    view: "universe",
    automation: "automatic_scoring_plus_sec_batches",
    mission: "Rank the allowed stocks by factor quality, valuation, growth, stability, and confidence.",
    action: { kind: "runtime", action: "poll_once", source: "sec_fundamentals", label: "SEC Batch", icon: "account_balance" }
  },
  {
    key: "market",
    label: "Market Agent",
    view: "markets",
    automation: "automatic_snapshot_plus_one_shot_refresh",
    mission: "Read market regime, sector breadth, and market-flow pressure.",
    action: { kind: "runtime", action: "poll_once", source: "fundamental_market_data", label: "Refresh Pricing", icon: "query_stats", limit: 25 }
  },
  {
    key: "signals",
    label: "Signals Agent",
    view: "alerts",
    automation: "automatic_collectors_plus_one_shot_refresh",
    mission: "Collect live alerts, news, insider, institutional, unusual-volume, and block-print evidence.",
    action: { kind: "runtime", action: "poll_once", source: "live_news", label: "Poll News", icon: "newspaper" }
  },
  {
    key: "policy",
    label: "Portfolio Policy Agent",
    view: "portfolio",
    automation: "automatic_policy_gate_user_editable",
    mission: "Own the user-editable portfolio rules: weekly target, drawdown, position caps, cash reserve, stops, targets, adds, and reductions.",
    action: { kind: "view", view: "portfolio", label: "Open Policy", icon: "tune" }
  },
  {
    key: "deterministic_selection",
    label: "Deterministic Selection Agent",
    view: "trading",
    automation: "automatic_ranking",
    mission: "Score the allowed universe with the rules engine: fundamentals, market context, signals, money flow, runtime trust, and price plan.",
    action: { kind: "view", view: "trading", label: "Open Rules Selector", icon: "assignment" }
  },
  {
    key: "llm_selection",
    label: "LLM Selection Agent",
    view: "trading",
    automation: "automatic_parallel_shadow_review",
    mission: "Review the same evidence pack in parallel, explain support and concerns, and flag disagreements with the deterministic selector.",
    action: { kind: "view", view: "trading", label: "Open LLM Selector", icon: "psychology_alt" }
  },
  {
    key: "final_selection",
    label: "Final Selection Agent",
    view: "trading",
    automation: "automatic_policy_arbitration",
    mission: "Arbitrate deterministic and LLM outputs, apply portfolio policy, and produce the final buy/sell/review list.",
    action: { kind: "view", view: "trading", label: "Open Final Selection", icon: "fact_check" }
  },
  {
    key: "risk",
    label: "Risk Manager",
    view: "risk",
    automation: "automatic_gate",
    mission: "Review recommendations against exposure, sizing, open orders, buying power, and runtime reliability.",
    action: { kind: "view", view: "risk", label: "Open Risk", icon: "shield" }
  },
  {
    key: "execution",
    label: "Execution Agent",
    view: "execution",
    automation: "automatic_preview_manual_paper_approval",
    mission: "Prepare Alpaca paper tickets after Selection and Risk approval, then wait for explicit user approval.",
    action: { kind: "view", view: "execution", label: "Open Execution", icon: "order_approve" }
  },
  {
    key: "portfolio",
    label: "Portfolio Monitor",
    view: "portfolio",
    automation: "automatic_broker_monitor",
    mission: "Watch positions, open orders, sell/reduce candidates, and weekly progress.",
    action: { kind: "view", view: "portfolio", label: "Open Portfolio", icon: "account_balance_wallet" }
  },
  {
    key: "learning",
    label: "Learning Agent",
    view: "learning",
    automation: "automatic_outcome_review",
    mission: "Compare paper decisions with revenue/loss and recommend algorithm improvements for every worker.",
    action: { kind: "view", view: "learning", label: "Open Learning", icon: "psychology" }
  }
];

const MARKET_REFRESH_ACTIONS = [
  { action: "poll_once", source: "fundamental_market_data", label: "Refresh Pricing", limit: 25 },
  { action: "poll_once", source: "market_flow", label: "Poll Market Flow" }
];

const SIGNAL_REFRESH_ACTIONS = [
  { action: "poll_once", source: "live_news", label: "Poll News" },
  { action: "poll_once", source: "sec_form4", label: "Poll Form 4" },
  { action: "poll_once", source: "trade_prints", label: "Poll Prints" },
  { action: "poll_once", source: "market_flow", label: "Poll Money Flow" }
];

function countTradeSetups(tradeSetups = {}) {
  const setups = tradeSetups.setups || [];
  const counts = tradeSetups.counts || {};
  return {
    long: counts.long || setups.filter((setup) => setup.action === "long").length,
    short: counts.short || setups.filter((setup) => setup.action === "short").length,
    watch: counts.watch || setups.filter((setup) => setup.action === "watch").length,
    noTrade: counts.no_trade || setups.filter((setup) => setup.action === "no_trade").length,
    visible: setups.length
  };
}

function countFinalSelection(finalSelection = {}) {
  const counts = finalSelection?.counts || {};
  const candidates = finalSelection?.candidates || [];
  return {
    finalBuy: counts.final_buy ?? candidates.filter((item) => item.execution_allowed && item.final_action === "long").length,
    finalSell: counts.final_sell ?? candidates.filter((item) => item.execution_allowed && item.final_action === "short").length,
    executable: counts.executable ?? candidates.filter((item) => item.execution_allowed).length,
    review: counts.review ?? candidates.filter((item) => item.final_action === "review").length,
    watch: counts.watch ?? candidates.filter((item) => item.final_action === "watch").length,
    visible: counts.visible ?? candidates.length
  };
}

function sourceByKey(workflowStatus = {}) {
  return (workflowStatus.live_data?.sources || []).reduce((acc, source) => {
    acc[source.key] = source;
    return acc;
  }, {});
}

function sourceIsFresh(source) {
  return source?.status === "fresh" && !source?.fallback_mode;
}

function sourceIsPolling(source) {
  return Boolean(source?.polling);
}

function sourceLabel(source, fallback) {
  return source?.label || fallback;
}

function clampProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function defaultDataState(status) {
  if (["complete", "ready", "reviewing", "paper_ready"].includes(status)) {
    return "ready";
  }
  if (status === "review") {
    return "review";
  }
  if (["blocked", "failed"].includes(status)) {
    return "blocked";
  }
  if (status === "gated") {
    return "gated";
  }
  if (status === "waiting") {
    return "loading";
  }
  return "observing";
}

function dataStateLabel(value) {
  return String(value || "observing").replace(/_/g, " ");
}

function dataReadyForState(value) {
  return ["ready", "review", "gated"].includes(value);
}

function loadPhaseLabel(value) {
  return String(value || "ongoing_updates").replace(/_/g, " ");
}

function refreshStateLabel(value) {
  return String(value || "scheduled").replace(/_/g, " ");
}

function msNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function minPositive(values = []) {
  const positives = values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  return positives.length ? Math.min(...positives) : 0;
}

function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(Number(ms || 0) / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
  }
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} day`;
}

function estimateAt(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(Date.now() + numeric).toISOString();
}

function estimateLabel(ms, fallback = "unknown") {
  if (ms === null || ms === undefined || ms === "") {
    return fallback;
  }
  const numeric = Number(ms);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (numeric <= 0) {
    return "complete";
  }
  return `about ${formatDuration(numeric)}`;
}

function completionEstimate({ phase = "initial_baseline", ms = null, label = null, basis = null, blocked = false } = {}) {
  const numeric = Number(ms);
  const hasMs = ms !== null && ms !== undefined && ms !== "" && Number.isFinite(numeric);
  const safeMs = hasMs ? Math.max(0, Math.round(numeric)) : null;
  return {
    phase,
    blocked: Boolean(blocked),
    ms: safeMs,
    label: label || estimateLabel(safeMs, blocked ? "blocked until configuration changes" : "unknown"),
    at: estimateAt(safeMs),
    basis: basis || null
  };
}

function normalizeEstimate(value = null, ready = false) {
  if (value && typeof value === "object") {
    return completionEstimate(value);
  }
  if (ready) {
    return completionEstimate({ phase: "complete", ms: 0, basis: "Worker baseline is ready." });
  }
  return null;
}

function cadenceLabel(ms, fallback = "manual/on change") {
  return msNumber(ms) ? `every ${formatDuration(ms)}` : fallback;
}

function maxPositive(values = []) {
  const positives = values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  return positives.length ? Math.max(...positives) : 0;
}

function runtimeSourceByKey(runtimeReliability = {}) {
  return (runtimeReliability.sources || []).reduce((acc, source) => {
    acc[source.key] = source;
    return acc;
  }, {});
}

function sourceCooldownMs(source = {}) {
  const cooldowns = Array.isArray(source.provider_cooldowns) ? source.provider_cooldowns : [];
  return maxPositive(cooldowns.map((item) => Number(item.seconds_remaining || 0) * 1000));
}

function sourceCooldownLabel(source = {}) {
  const cooldowns = Array.isArray(source.provider_cooldowns) ? source.provider_cooldowns : [];
  const active = cooldowns
    .map((item) => ({
      provider: item.provider || source.provider || "provider",
      ms: Number(item.seconds_remaining || 0) * 1000
    }))
    .filter((item) => Number.isFinite(item.ms) && item.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  if (!active.length) {
    return null;
  }
  return `${active[0].provider} cooldown ${formatDuration(active[0].ms)}`;
}

function sourceUnconfigured(source = {}) {
  return source.status === "unconfigured" || source.configured === false;
}

function batchCompletionMs({ remaining = 0, batchSize = 1, batchesPerCycle = 1, cycleMs = 0, cooldownMs = 0 } = {}) {
  const left = Math.max(0, Number(remaining || 0));
  if (!left) {
    return 0;
  }
  const capacity = Math.max(1, Number(batchSize || 1) * Math.max(1, Number(batchesPerCycle || 1)));
  const cycles = Math.max(1, Math.ceil(left / capacity));
  return Math.max(0, Number(cooldownMs || 0)) + cycles * msNumber(cycleMs, 0);
}

function rotationEstimateMs({ target = 0, perPoll = 0, intervalMs = 0 } = {}) {
  const total = Math.max(0, Number(target || 0));
  const batch = Math.max(0, Number(perPoll || 0));
  const interval = msNumber(intervalMs, 0);
  if (!total || !batch || !interval) {
    return null;
  }
  return Math.ceil(total / batch) * interval;
}

function latestSourceAt(source = {}) {
  return source.last_success_at || source.last_poll_at || source.last_backup_at || null;
}

function nextAtFrom(source = {}, intervalMs = 0, override = null) {
  if (override) {
    return override;
  }
  const last = latestSourceAt(source);
  const interval = msNumber(intervalMs);
  if (!last || !interval) {
    return null;
  }
  const lastTime = new Date(last).getTime();
  if (!Number.isFinite(lastTime)) {
    return null;
  }
  return new Date(lastTime + interval).toISOString();
}

function sourceReady(source) {
  return sourceIsFresh(source);
}

function marketProgress(sources) {
  const pricingReady = sourceReady(sources.market_data) || sourceReady(sources.fundamental_market_data);
  const flowEnabled = sources.market_flow?.enabled !== false;
  const flowReady = !flowEnabled || sourceReady(sources.market_flow);
  const polling = [sources.market_data, sources.fundamental_market_data, sources.market_flow].some((source) => sourceIsPolling(source));
  const target = flowEnabled ? 2 : 1;
  const current = (pricingReady ? 1 : 0) + (flowEnabled && flowReady ? 1 : 0);
  const remaining = [
    !pricingReady && "Live pricing/reference",
    flowEnabled && !flowReady && "Market Flow"
  ].filter(Boolean);

  return {
    current,
    target,
    pct: target ? clampProgress((current / target) * 100) : 0,
    polling,
    remaining,
    pricing_ready: pricingReady,
    flow_ready: flowReady
  };
}

function refreshStateFor({ sources = [], baselineReady = true, intervalMs = 0, nextRefreshAt = null }) {
  const presentSources = sources.filter(Boolean);
  const activeSources = presentSources.filter((source) => source.enabled !== false);
  if (activeSources.some((source) => source.polling)) {
    return "refreshing";
  }
  if (!activeSources.length && presentSources.length) {
    return "disabled";
  }
  if (activeSources.some((source) => source.fallback_mode || source.fallback_active || source.status === "fallback")) {
    return "blocked";
  }
  if (!baselineReady) {
    return "baseline_pending";
  }
  if (!activeSources.some((source) => latestSourceAt(source))) {
    return "waiting";
  }
  if (nextRefreshAt && msNumber(intervalMs) && new Date(nextRefreshAt).getTime() <= Date.now()) {
    return "due";
  }
  return "scheduled";
}

function workerStatus(status, detail, data = {}) {
  return { status, detail, data };
}

function statusClass(status) {
  if (["complete", "ready", "reviewing", "paper_ready"].includes(status)) {
    return "bullish";
  }
  if (["blocked", "failed"].includes(status)) {
    return "bearish";
  }
  return "neutral";
}

function currentWorker(workers, { canPreview = false, canSubmit = false } = {}) {
  const pendingBaselineWorker = workers.find((worker) => worker.baseline_required && !worker.baseline_ready);
  if (pendingBaselineWorker) {
    return pendingBaselineWorker;
  }

  const executionWorker = workers.find((worker) => worker.key === "execution");
  if ((canPreview || canSubmit) && executionWorker) {
    return executionWorker;
  }

  return (
    workers.find((worker) => worker.data_state === "blocked" && !worker.data_ready) ||
    workers.find((worker) => worker.status === "blocked") ||
    workers.find((worker) => worker.data_state === "loading" && !worker.data_ready) ||
    workers.find((worker) => worker.status === "review" && !worker.data_ready) ||
    workers.find((worker) => ["deterministic_selection", "llm_selection", "final_selection"].includes(worker.key) && ["waiting", "review"].includes(worker.status)) ||
    workers.find((worker) => worker.data_state === "review" && !worker.data_ready) ||
    workers.find((worker) => worker.data_state === "gated") ||
    workers.find((worker) => worker.status === "ready") ||
    workers[workers.length - 1]
  );
}

function automationLabel(value) {
  return String(value || "automatic").replace(/_/g, " ");
}

function buildWorker(base, index, status, detail, metric, action = base.action, data = {}) {
  const dataState = data.data_state || defaultDataState(status);
  const progressPct = clampProgress(data.progress_pct ?? (dataReadyForState(dataState) ? 100 : 0));
  const remaining = Array.isArray(data.remaining) ? data.remaining.filter(Boolean) : [];
  const baselineRequired = data.baseline_required ?? true;
  const baselineReady = data.baseline_ready ?? data.data_ready ?? dataReadyForState(dataState);
  const loadPhase = data.load_phase || (!baselineRequired ? "supervised_gate" : baselineReady ? "ongoing_updates" : "initial_baseline");
  const refreshCadenceMs = data.refresh_cadence_ms ?? null;
  const refreshState = data.refresh_state || (data.loading || dataState === "loading" ? "refreshing" : baselineReady ? "scheduled" : "baseline_pending");
  const estimate = normalizeEstimate(data.completion_estimate, Boolean(baselineReady));
  const fullExtractionEstimate = normalizeEstimate(data.full_extraction_estimate, false);

  return {
    step: index + 1,
    key: base.key,
    label: base.label,
    view: base.view,
    mission: base.mission,
    automation: base.automation,
    automation_label: automationLabel(base.automation),
    status,
    status_class: statusClass(status),
    detail,
    metric,
    data_state: dataState,
    data_state_label: dataStateLabel(dataState),
    data_ready: data.data_ready ?? dataReadyForState(dataState),
    baseline_required: baselineRequired,
    baseline_ready: Boolean(baselineReady),
    baseline_state: baselineReady ? "ready" : dataState === "blocked" ? "blocked" : "pending",
    load_phase: loadPhase,
    load_phase_label: loadPhaseLabel(loadPhase),
    loading: Boolean(data.loading || dataState === "loading"),
    progress_pct: progressPct,
    progress_label: data.progress_label || `${progressPct}%`,
    progress_current: data.progress_current ?? null,
    progress_target: data.progress_target ?? null,
    completion_estimate: estimate,
    estimated_completion_ms: estimate?.ms ?? null,
    estimated_completion_label: estimate?.label || null,
    estimated_completion_at: estimate?.at || null,
    estimation_basis: estimate?.basis || null,
    full_extraction_estimate: fullExtractionEstimate,
    full_extraction_estimate_ms: fullExtractionEstimate?.ms ?? null,
    full_extraction_estimate_label: fullExtractionEstimate?.label || null,
    refresh_cadence_ms: refreshCadenceMs,
    refresh_cadence_label: data.refresh_cadence_label || cadenceLabel(refreshCadenceMs),
    refresh_state: refreshState,
    refresh_state_label: refreshStateLabel(refreshState),
    next_refresh_at: data.next_refresh_at || null,
    remaining,
    primary_action: action || null
  };
}

function sourceProgress(keys, sources) {
  const expected = keys
    .map((key) => sources[key] ? { key, source: sources[key] } : null)
    .filter(Boolean)
    .filter(({ source }) => source.enabled !== false);
  const completed = expected.filter(({ source }) => sourceIsFresh(source));
  const polling = expected.some(({ source }) => sourceIsPolling(source));
  const remaining = expected
    .filter(({ source }) => !sourceIsFresh(source))
    .map(({ key, source }) => sourceLabel(source, prettyKey(key)));

  return {
    current: completed.length,
    target: expected.length,
    pct: expected.length ? clampProgress((completed.length / expected.length) * 100) : 0,
    polling,
    remaining
  };
}

function prettyKey(value) {
  return String(value || "").replace(/_/g, " ");
}

function aggregateDataProgress(workers) {
  const total = workers.length || 1;
  const average = Math.round(workers.reduce((sum, worker) => sum + Number(worker.progress_pct || 0), 0) / total);
  const baselineWorkers = workers.filter((worker) => worker.baseline_required !== false);
  const baselineTotal = baselineWorkers.length || 1;
  const baselineReady = baselineWorkers.filter((worker) => worker.baseline_ready).length;
  const baselineBlocked = baselineWorkers.filter((worker) => worker.baseline_state === "blocked" || worker.data_state === "blocked").length;
  const baselineLoading = baselineWorkers.filter((worker) => worker.loading || worker.refresh_state === "refreshing").length;
  const baselineAverage = Math.round(
    baselineWorkers.reduce((sum, worker) => sum + Number(worker.progress_pct || 0), 0) / baselineTotal
  );
  const baselineFinished = baselineReady === baselineWorkers.length && baselineWorkers.length > 0;
  const pendingBaselineWorkers = baselineWorkers.filter((worker) => !worker.baseline_ready);
  const pendingBaselineEstimates = pendingBaselineWorkers
    .map((worker) => ({
      key: worker.key,
      label: worker.label,
      ms: worker.estimated_completion_ms,
      basis: worker.estimation_basis
    }))
    .filter((item) => item.ms !== null && item.ms !== undefined && Number.isFinite(Number(item.ms)));
  const slowestBaselineEstimate = pendingBaselineEstimates
    .sort((a, b) => Number(b.ms) - Number(a.ms))[0] || null;
  const blockedBaselineEstimate = pendingBaselineWorkers.find((worker) => worker.completion_estimate?.blocked) || null;
  const actionRequiredBaselineEstimate = pendingBaselineWorkers.find((worker) =>
    /waiting|manual|action/i.test(String(worker.estimated_completion_label || worker.completion_estimate?.label || ""))
  ) || null;
  const nonTimedBaselineEstimate = blockedBaselineEstimate || actionRequiredBaselineEstimate;
  const baselineEstimateMs = baselineFinished
    ? 0
    : nonTimedBaselineEstimate
      ? null
      : slowestBaselineEstimate
      ? Number(slowestBaselineEstimate.ms)
      : null;
  const updateActive = workers.filter((worker) => worker.refresh_state === "refreshing").length;
  const updateDue = workers.filter((worker) => worker.refresh_state === "due").length;
  const nextRefreshAt = workers
    .map((worker) => worker.next_refresh_at)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0] || null;
  const counts = workers.reduce(
    (acc, worker) => {
      acc[worker.data_state] = (acc[worker.data_state] || 0) + 1;
      if (worker.data_ready) {
        acc.ready_total += 1;
      }
      if (worker.loading) {
        acc.loading_total += 1;
      }
      return acc;
    },
    { ready_total: 0, loading_total: 0 }
  );
  const blocked = counts.blocked || 0;
  const loading = counts.loading_total || 0;
  const gated = counts.gated || 0;
  const review = counts.review || 0;

  return {
    pct: clampProgress(average),
    phase: baselineFinished ? "ongoing_updates" : "initial_baseline",
    phase_label: baselineFinished ? "ongoing updates" : "initial baseline",
    ready_count: counts.ready_total || 0,
    loading_count: loading,
    blocked_count: blocked,
    gated_count: gated,
    review_count: review,
    worker_count: workers.length,
    finished: baselineFinished && loading === 0 && blocked === 0,
    baseline: {
      ready: baselineFinished,
      pct: clampProgress(baselineAverage),
      ready_count: baselineReady,
      required_count: baselineWorkers.length,
      loading_count: baselineLoading,
      blocked_count: baselineBlocked,
      estimated_completion_ms: baselineEstimateMs,
      estimated_completion_label: nonTimedBaselineEstimate
        ? nonTimedBaselineEstimate.estimated_completion_label || "action needed"
        : baselineEstimateMs === null ? "unknown" : estimateLabel(baselineEstimateMs),
      estimated_completion_at: estimateAt(baselineEstimateMs),
      estimation_basis: nonTimedBaselineEstimate
        ? `Action needed for pending worker: ${nonTimedBaselineEstimate.label}. ${nonTimedBaselineEstimate.estimation_basis || ""}`.trim()
        : slowestBaselineEstimate
        ? `Slowest pending worker: ${slowestBaselineEstimate.label}. ${slowestBaselineEstimate.basis || ""}`.trim()
        : baselineFinished
          ? "All required baseline workers are ready."
          : "At least one pending worker is blocked by configuration or missing telemetry.",
      label: baselineFinished
        ? "Initial baseline is complete"
        : `${baselineReady}/${baselineWorkers.length} baseline agents ready`
    },
    ongoing_refresh: {
      active_count: updateActive,
      due_count: updateDue,
      next_refresh_at: nextRefreshAt,
      label: baselineFinished
        ? updateActive
          ? `${updateActive} scheduled update(s) running`
          : updateDue
            ? `${updateDue} scheduled update(s) due`
            : "Waiting for the next scheduled refresh"
        : "Ongoing refreshes start after the initial baseline is complete"
    },
    label:
      !baselineFinished
        ? `${baselineReady}/${baselineWorkers.length} baseline agents ready`
        : loading > 0
          ? `${loading} worker(s) refreshing now`
          : blocked > 0
          ? `${blocked} worker(s) blocked`
          : gated > 0
            ? "Data loaded; execution gates remain supervised"
            : "All worker data is ready"
  };
}

export function chooseAgencyCycleAdvance(cycle = {}) {
  const current = (cycle.workers || []).find((worker) => worker.key === cycle.current_worker_key) || null;
  const key = current?.key || cycle.current_worker_key;

  if (!key) {
    return {
      type: "noop",
      label: "No cycle action",
      reason: "Agency cycle state is not available yet."
    };
  }

  if (key === "universe") {
    return {
      type: "runtime",
      label: "Refresh Universe",
      reason: "The Universe Agent needs the allowed S&P 100 plus QQQ scope loaded.",
      payload: { action: "refresh_universe" }
    };
  }

  if (key === "fundamentals") {
    return {
      type: "runtime",
      label: "Run SEC Fundamentals Batch",
      reason: "The Fundamentals Agent needs more SEC-backed rows before larger paper sizing.",
      payload: { action: "poll_once", source: "sec_fundamentals" }
    };
  }

  if (key === "market") {
    return {
      type: "runtime_bundle",
      label: "Refresh Market Context",
      reason: "The Market Agent needs pricing plus market-flow context before Selection uses sector winds.",
      actions: MARKET_REFRESH_ACTIONS
    };
  }

  if (key === "signals") {
    return {
      type: "runtime_bundle",
      label: "Refresh Signals And Money Flow",
      reason: "The Signals Agent owns ticker-level evidence including news, insider flow, tape prints, and inferred money flow.",
      actions: SIGNAL_REFRESH_ACTIONS
    };
  }

  if (key === "policy") {
    return {
      type: "view",
      label: "Open Portfolio Policy",
      reason: "Portfolio policy is user-editable and gates sizing, capacity, stops, targets, cash reserve, and final selection.",
      view: "portfolio"
    };
  }

  if (key === "deterministic_selection") {
    return current?.status === "waiting"
      ? {
          type: "runtime_bundle",
          label: "Refresh Selection Inputs",
          reason: "The deterministic selector has no buy/sell setup yet, so the safest next step is to refresh pricing, market flow, news, and insider evidence.",
          actions: [
            { action: "poll_once", source: "fundamental_market_data", label: "Refresh Pricing", limit: 25 },
            { action: "poll_once", source: "market_flow", label: "Poll Market Flow" },
            { action: "poll_once", source: "live_news", label: "Poll News" },
            { action: "poll_once", source: "sec_form4", label: "Poll Form 4" }
          ]
        }
      : {
          type: "view",
          label: "Open Deterministic Selector",
          reason: "The rules-based selector updates automatically from current Fundamentals, Market, Signals, and runtime inputs.",
          view: "trading"
        };
  }

  if (key === "llm_selection") {
    return {
      type: "view",
      label: "Open LLM Selector",
      reason: "The LLM selection lane runs in parallel and explains agreement, demotion, or disagreement with the deterministic selector.",
      view: "trading"
    };
  }

  if (key === "final_selection") {
    return current?.status === "waiting"
      ? {
          type: "runtime_bundle",
          label: "Refresh Final Selection Inputs",
          reason: "Final Selection has no candidate yet. Refresh live inputs, then rerun deterministic, LLM-shadow, policy, and risk snapshots.",
          actions: [
            { action: "poll_once", source: "fundamental_market_data", label: "Refresh Pricing", limit: 25 },
            { action: "poll_once", source: "market_flow", label: "Poll Market Flow" },
            { action: "poll_once", source: "live_news", label: "Poll News" },
            { action: "poll_once", source: "sec_form4", label: "Poll Form 4" }
          ]
        }
      : {
          type: "view",
          label: "Open Final Selection",
          reason: "Final Selection applies dual-selector agreement plus portfolio policy before Risk and Execution.",
          view: "trading"
        };
  }

  if (key === "risk") {
    return {
      type: "risk_snapshot",
      label: "Refresh Risk Snapshot",
      reason: "Risk review is read-only and checks exposure, buying power, open orders, and runtime pressure."
    };
  }

  if (key === "execution") {
    return cycle.can_preview_orders
      ? {
          type: "execution_preview",
          label: "Preview Top Paper Ticket",
          reason: "Execution can create a dry-run Alpaca paper ticket, but this advance will not submit an order."
        }
      : {
          type: "view",
          label: "Open Execution Agent",
          reason: "Execution is gated. Review broker and paper-submit requirements before any order can be approved.",
          view: "execution"
        };
  }

  if (key === "portfolio") {
    return {
      type: "position_monitor",
      label: "Refresh Portfolio Monitor",
      reason: "Portfolio refresh is read-only and checks positions, open orders, sell/reduce candidates, and weekly progress."
    };
  }

  if (key === "learning") {
    return {
      type: "learning_review",
      label: "Refresh Learning Review",
      reason: "Learning review is read-only and updates outcome attribution and worker improvement suggestions."
    };
  }

  return {
    type: "view",
    label: "Open Current Worker",
    reason: "Open the current worker dashboard for manual review.",
    view: current?.view || "overview"
  };
}

export function buildAgencyCycleStatus({
  config = {},
  readiness,
  runtimeReliability,
  workflowStatus,
  tradeSetups,
  executionStatus,
  riskSnapshot,
  positionMonitor,
  portfolioPolicy = null,
  llmSelection = null,
  finalSelection = null,
  secQueue,
  executionLog = [],
  advanceLog = []
}) {
  const cfg = {
    agencyBaselineUniverseMinCount: 160,
    agencyBaselineRequireFullSec: true,
    agencyBaselineMinSecCoveragePct: 1,
    agencyBaselineMinSignalSources: 3,
    agencyInitialBaselineCycleMs: 300_000,
    agencyOngoingCycleMs: 900_000,
    marketDataRefreshMs: 300_000,
    marketFlowPollMs: 300_000,
    liveNewsPollMs: 900_000,
    liveNewsRssFallbackMaxTickers: 20,
    fundamentalMarketDataRefreshMs: 900_000,
    fundamentalMarketDataMaxCompaniesPerPoll: 25,
    fundamentalSecBaselinePollMs: 900_000,
    fundamentalSecPollMs: 21_600_000,
    agencyBaselineSecBatchesPerRun: 4,
    secForm4PollMs: 600_000,
    sec13fPollMs: 43_200_000,
    earningsPollMs: 14_400_000,
    stocktwitsPollMs: 300_000,
    tradePrintsPollMs: 300_000,
    executionSyncMs: 180_000,
    ...config
  };
  const setupCounts = countTradeSetups(tradeSetups);
  const tradableCount = setupCounts.long + setupCounts.short;
  const finalCounts = countFinalSelection(finalSelection);
  const finalSelectionCandidates = Array.isArray(finalSelection?.candidates) ? finalSelection.candidates : [];
  const finalSelectionLlmReviews = finalSelectionCandidates
    .filter((candidate) => candidate?.llm_explanation)
    .map((candidate) => candidate.llm_explanation);
  const effectiveLlmSelection =
    llmSelection ||
    (finalSelection?.llm_agent
      ? {
          ...finalSelection.llm_agent,
          recommendations: finalSelectionLlmReviews
        }
      : null);
  const sources = sourceByKey(workflowStatus);
  const broker = executionStatus?.broker || positionMonitor?.broker || {};
  const riskBlocked = riskSnapshot?.status === "blocked" || Boolean(riskSnapshot?.hard_blocks?.length);
  const policyBlocked = portfolioPolicy?.status === "blocked" || Boolean(portfolioPolicy?.hard_blocks?.length);
  const positionCount = positionMonitor?.position_count || positionMonitor?.positions?.length || 0;
  const openOrderCount = positionMonitor?.open_order_count || positionMonitor?.open_orders?.length || 0;
  const decisionCount = Array.isArray(executionLog) ? executionLog.length : 0;
  const outcomeSample = decisionCount + positionCount;
  const secCoveragePct = Math.round(Number(secQueue?.coverage_ratio || 0) * 100);
  const trackedCount = secQueue?.tracked_companies || 0;
  const pendingSec = secQueue?.pending_live_sec_companies ?? 0;
  const freshDecisionEvidence = workflowStatus?.live_data?.fresh_decision_evidence_count || 0;
  const livePricingReady = Boolean(workflowStatus?.live_data?.live_pricing_ready);
  const secLiveCount = secQueue?.live_sec_companies ?? Math.max(0, trackedCount - pendingSec);
  const secAutoStart = cfg.autoStartSecFundamentals !== false && secQueue?.auto_start !== false;
  const secPolling = Boolean(secQueue?.polling && secAutoStart);
  const selectorRan =
    Number(tradeSetups?.counts?.tracked_tickers || 0) > 0 ||
    setupCounts.visible > 0 ||
    setupCounts.long + setupCounts.short + setupCounts.watch + setupCounts.noTrade > 0;
  const runtimeSources = runtimeSourceByKey(runtimeReliability);
  const marketSourceProgress = marketProgress(sources);
  const signalSourceProgress = sourceProgress(
    [
      "live_news",
      "marketaux_news",
      "sec_form4",
      "earnings_calendar",
      "stocktwits_stream",
      "trade_prints",
      "market_flow",
      "sec_13f"
    ],
    sources
  );
  const signalBaselineTarget = signalSourceProgress.target
    ? Math.max(1, Math.min(Number(cfg.agencyBaselineMinSignalSources || 3), signalSourceProgress.target))
    : 1;
  const signalSourcesBaselineReady = signalSourceProgress.current >= signalBaselineTarget;
  const pricingProgress = livePricingReady ? 65 : marketSourceProgress.pct >= 67 ? 55 : marketSourceProgress.pct >= 34 ? 35 : 0;
  const marketProgressPct = clampProgress(Math.max(marketSourceProgress.pct, pricingProgress));
  const marketDataState = livePricingReady
    ? marketSourceProgress.remaining.length || marketSourceProgress.polling ? "review" : "ready"
    : marketSourceProgress.polling
      ? "loading"
      : "blocked";
  const signalProgressPct = signalSourcesBaselineReady
    ? Math.max(freshDecisionEvidence > 0 ? 75 : 80, signalSourceProgress.target ? signalSourceProgress.pct : 100)
    : signalSourceProgress.pct;
  const signalDataState = signalSourcesBaselineReady
    ? freshDecisionEvidence > 0 && !signalSourceProgress.remaining.length
      ? "ready"
      : "review"
    : signalSourceProgress.polling
      ? "loading"
      : "blocked";
  const fundamentalsProgressPct = trackedCount ? secCoveragePct : 0;
  const upstreamSelectionProgress = clampProgress((fundamentalsProgressPct + marketProgressPct + signalProgressPct) / 3);
  const selectionProgressPct = tradableCount
    ? 100
    : setupCounts.watch
      ? Math.max(85, upstreamSelectionProgress)
      : upstreamSelectionProgress;
  const llmProgressPct = effectiveLlmSelection?.recommendations?.length ? 100 : Math.max(0, selectionProgressPct - 20);
  const finalSelectionProgressPct = finalCounts.executable
    ? 100
    : finalCounts.review || finalCounts.watch
      ? 90
      : Math.max(0, Math.min(selectionProgressPct, llmProgressPct) - 10);
  const executionCanPreview = Boolean(workflowStatus?.can_preview_orders) && (!finalSelection || finalCounts.executable > 0);
  const executionProgressPct = broker.ready_for_order_submission
    ? 100
    : broker.configured
      ? 80
      : executionCanPreview
        ? 70
        : 40;
  const portfolioProgressPct = broker.configured ? 100 : 45;
  const learningProgressPct = clampProgress((Math.min(outcomeSample, 10) / 10) * 100);
  const minSecCoveragePct = Math.max(0, Math.min(1, Number(cfg.agencyBaselineMinSecCoveragePct || 1)));
  const universeBaselineReady = trackedCount >= Number(cfg.agencyBaselineUniverseMinCount || 160);
  const fundamentalsBaselineReady = Boolean(
    trackedCount &&
    (
      pendingSec === 0 ||
      (!cfg.agencyBaselineRequireFullSec && Number(secQueue?.coverage_ratio || 0) >= minSecCoveragePct)
    )
  );
  const marketBaselineReady = Boolean(livePricingReady && marketSourceProgress.pricing_ready && marketSourceProgress.flow_ready);
  const signalsBaselineReady = Boolean(signalSourcesBaselineReady);
  const policyBaselineReady = Boolean(portfolioPolicy);
  const upstreamBaselineReady =
    universeBaselineReady && fundamentalsBaselineReady && marketBaselineReady && signalsBaselineReady && policyBaselineReady;
  const deterministicBaselineReady = Boolean(selectorRan);
  const llmBaselineReady = Boolean(effectiveLlmSelection) && deterministicBaselineReady;
  const finalBaselineReady = Boolean(finalSelection) && deterministicBaselineReady && llmBaselineReady;
  const riskBaselineReady = Boolean(riskSnapshot);
  const executionBaselineReady = Boolean(broker.configured || broker.ready_for_order_submission);
  const portfolioBaselineReady = Boolean(positionMonitor && (broker.configured || positionCount || openOrderCount));
  const learningBaselineReady = true;

  const secRuntimeSource = runtimeSources.sec_fundamentals || sources.sec_fundamentals || {};
  const marketRuntimeSources = ["market_data", "fundamental_market_data", "market_flow"].map((key) => runtimeSources[key] || sources[key]).filter(Boolean);
  const signalRuntimeSources = [
    "live_news",
    "marketaux_news",
    "sec_form4",
    "earnings_calendar",
    "stocktwits_stream",
    "trade_prints",
    "market_flow",
    "sec_13f"
  ].map((key) => runtimeSources[key] || sources[key]).filter(Boolean);
  const marketCadenceMs = Math.max(300_000, minPositive([
    runtimeSources.market_data?.interval_ms,
    runtimeSources.fundamental_market_data?.interval_ms,
    runtimeSources.market_flow?.interval_ms,
    cfg.marketDataRefreshMs,
    cfg.fundamentalMarketDataRefreshMs,
    cfg.marketFlowPollMs
  ]));
  const signalsCadenceMs = Math.max(300_000, minPositive([
    runtimeSources.live_news?.interval_ms,
    runtimeSources.marketaux_news?.interval_ms,
    runtimeSources.sec_form4?.interval_ms,
    runtimeSources.trade_prints?.interval_ms,
    runtimeSources.market_flow?.interval_ms,
    cfg.liveNewsPollMs,
    cfg.secForm4PollMs,
    cfg.marketFlowPollMs
  ]));
  const agencyCycleCadenceMs = msNumber(upstreamBaselineReady ? cfg.agencyOngoingCycleMs : cfg.agencyInitialBaselineCycleMs, 900_000);
  const secCadenceMs = msNumber(
    fundamentalsBaselineReady ? cfg.fundamentalSecPollMs : cfg.fundamentalSecBaselinePollMs,
    fundamentalsBaselineReady ? 21_600_000 : 900_000
  );
  const secBatchSize = Math.max(1, Number(secQueue?.next_batch_size || secQueue?.refresh_limit || 1));
  const secRemainingBatches = pendingSec ? Math.ceil(pendingSec / secBatchSize) : 0;
  const secBatchesPerRun = Math.max(1, Number(cfg.agencyBaselineSecBatchesPerRun || 1));
  const secBaselineRunsRemaining = pendingSec ? Math.ceil(secRemainingBatches / secBatchesPerRun) : 0;
  const secRunEstimate = pendingSec
    ? `${secRemainingBatches} batch(es), about ${secBaselineRunsRemaining} baseline run(s)`
    : null;
  const secCooldownMs = sourceCooldownMs(secRuntimeSource);
  const secCatchupEstimate = pendingSec
    ? completionEstimate({
        phase: "full_extraction",
        ms: batchCompletionMs({
          remaining: pendingSec,
          batchSize: secBatchSize,
          batchesPerCycle: secBatchesPerRun,
          cycleMs: cfg.agencyInitialBaselineCycleMs,
          cooldownMs: secCooldownMs
        }),
        basis: `SEC catch-up still has ${pendingSec} allowed-universe name(s) awaiting live SEC data: ${secBatchSize} companies/batch, ${secBatchesPerRun} batch(es)/baseline run, baseline cadence ${cadenceLabel(cfg.agencyInitialBaselineCycleMs)}${sourceCooldownLabel(secRuntimeSource) ? `, ${sourceCooldownLabel(secRuntimeSource)}` : ""}.`
      })
    : completionEstimate({ phase: "complete", ms: 0, basis: "All tracked companies are SEC-backed." });
  const secEstimate = fundamentalsBaselineReady
    ? completionEstimate({
        phase: "complete",
        ms: 0,
        label: pendingSec ? "baseline ready; background catch-up remains" : "complete",
        basis: pendingSec
          ? `${secLiveCount}/${trackedCount} companies are SEC-backed, meeting the ${Math.round(minSecCoveragePct * 100)}% baseline threshold. Remaining names continue as background SEC catch-up.`
          : "SEC-backed fundamentals baseline is complete."
      })
    : trackedCount && !secAutoStart
      ? completionEstimate({
          phase: "initial_baseline",
          ms: null,
          label: "waiting for SEC Batch",
          basis: "SEC fundamentals auto-start is disabled on this Pi profile. Click SEC Batch or Run Initial Baseline to process the next bounded SEC batch."
        })
    : trackedCount
      ? completionEstimate({
          phase: "initial_baseline",
          ms: batchCompletionMs({
            remaining: pendingSec,
            batchSize: secBatchSize,
            batchesPerCycle: secBatchesPerRun,
            cycleMs: cfg.agencyInitialBaselineCycleMs,
            cooldownMs: secCooldownMs
          }),
          basis: `SEC limit plan: ${secBatchSize} companies/batch, ${secBatchesPerRun} batch(es)/baseline run, baseline cadence ${cadenceLabel(cfg.agencyInitialBaselineCycleMs)}${sourceCooldownLabel(secRuntimeSource) ? `, ${sourceCooldownLabel(secRuntimeSource)}` : ""}.`
        })
      : completionEstimate({
          phase: "initial_baseline",
          ms: cfg.agencyInitialBaselineCycleMs,
          basis: `Waiting for Universe Agent; baseline cadence ${cadenceLabel(cfg.agencyInitialBaselineCycleMs)}.`
        });
  const marketCooldownMs = maxPositive(marketRuntimeSources.map((source) => sourceCooldownMs(source)));
  const marketMissingInputs = Math.max(0, Number(marketSourceProgress.target || 0) - Number(marketSourceProgress.current || 0));
  const marketBlockedByConfig = marketRuntimeSources.some((source) => ["market_data", "fundamental_market_data"].includes(source.key) && sourceUnconfigured(source));
  const marketEstimate = marketBaselineReady
    ? completionEstimate({ phase: "complete", ms: 0, basis: "Live pricing/reference and market-flow inputs are fresh." })
    : marketBlockedByConfig
      ? completionEstimate({
          phase: "blocked",
          ms: null,
          blocked: true,
          label: "blocked until live pricing is configured",
          basis: "Market Agent needs MARKET_DATA_PROVIDER/FUNDAMENTAL_MARKET_DATA_PROVIDER credentials before time-based extraction can complete."
        })
      : completionEstimate({
          phase: "initial_baseline",
          ms: Math.max(marketCooldownMs, Math.max(1, marketMissingInputs) * marketCadenceMs),
          basis: `Market plan: ${marketSourceProgress.current}/${marketSourceProgress.target || 2} inputs fresh, pricing/flow cadence ${cadenceLabel(marketCadenceMs)}${marketCooldownMs ? `, ${marketRuntimeSources.map(sourceCooldownLabel).filter(Boolean).join(", ")}` : ""}.`
        });
  const marketReferenceSource = runtimeSources.fundamental_market_data || sources.fundamental_market_data || {};
  const marketReferencePerPoll = Math.max(
    1,
    Number(cfg.fundamentalMarketDataMaxCompaniesPerPoll || marketReferenceSource.last_batch_size || 1)
  );
  const marketReferenceCached = Math.max(0, Math.min(trackedCount || 0, Number(marketReferenceSource.cache_entries || 0)));
  const marketReferenceRemaining = Math.max(0, Number(trackedCount || 0) - marketReferenceCached);
  const marketReferenceRotationMs = trackedCount
    ? batchCompletionMs({
        remaining: marketReferenceRemaining || trackedCount,
        batchSize: marketReferencePerPoll,
        batchesPerCycle: 1,
        cycleMs: cfg.fundamentalMarketDataRefreshMs,
        cooldownMs: sourceCooldownMs(marketReferenceSource)
      })
    : null;
  const marketFullEstimate = marketReferenceRotationMs === null
    ? null
    : completionEstimate({
        phase: marketReferenceRemaining ? "full_extraction" : "complete",
        ms: marketReferenceRemaining ? marketReferenceRotationMs : 0,
        label: marketReferenceRemaining ? null : "full reference coverage complete",
        basis: `Full market-reference rotation: ${marketReferenceCached}/${trackedCount} cached, ${marketReferencePerPoll} companies/poll, ${cadenceLabel(cfg.fundamentalMarketDataRefreshMs)}.`
      });
  const signalCooldownMs = maxPositive(signalRuntimeSources.map((source) => sourceCooldownMs(source)));
  const signalMissingSources = Math.max(0, signalBaselineTarget - Number(signalSourceProgress.current || 0));
  const signalBlockedByConfig = signalSourceProgress.target === 0;
  const signalEstimate = signalsBaselineReady
    ? completionEstimate({ phase: "complete", ms: 0, basis: "Fresh decision evidence and required signal sources are available." })
    : signalBlockedByConfig
      ? completionEstimate({
          phase: "blocked",
          ms: null,
          blocked: true,
          label: "blocked until at least one signal source is enabled",
          basis: "Signals Agent has no enabled source in the current runtime plan."
        })
      : completionEstimate({
          phase: "initial_baseline",
          ms: Math.max(signalCooldownMs, Math.max(1, signalMissingSources) * signalsCadenceMs),
          basis: `Signal plan: ${signalSourceProgress.current}/${signalBaselineTarget} required sources fresh, cadence ${cadenceLabel(signalsCadenceMs)}${signalCooldownMs ? `, ${signalRuntimeSources.map(sourceCooldownLabel).filter(Boolean).join(", ")}` : ""}.`
        });
  const marketauxSource = runtimeSources.marketaux_news || sources.marketaux_news || {};
  const liveNewsSource = runtimeSources.live_news || sources.live_news || {};
  const newsSymbolsPerPoll = Math.max(
    1,
    Number(
      marketauxSource.enabled !== false && marketauxSource.max_requests_per_poll && marketauxSource.symbols_per_request
        ? Number(marketauxSource.max_requests_per_poll || 1) * Number(marketauxSource.symbols_per_request || 1)
        : liveNewsSource.requested_symbols || liveNewsSource.rss_fallback_symbols || cfg.liveNewsRssFallbackMaxTickers || 1
    )
  );
  const newsUniverseSize = Number(marketauxSource.universe_symbols || liveNewsSource.universe_symbols || trackedCount || 0);
  const newsRotationMs = rotationEstimateMs({
    target: newsUniverseSize,
    perPoll: newsSymbolsPerPoll,
    intervalMs: cfg.liveNewsPollMs
  });
  const signalsFullEstimate = newsRotationMs === null
    ? null
    : completionEstimate({
        phase: "full_extraction",
        ms: newsRotationMs + sourceCooldownMs(marketauxSource || liveNewsSource),
        basis: `Full signal/news universe rotation: ${newsUniverseSize} symbols, about ${newsSymbolsPerPoll} symbols/poll, ${cadenceLabel(cfg.liveNewsPollMs)}.`
      });
  const upstreamEstimateMs = upstreamBaselineReady
    ? 0
    : maxPositive([secEstimate.ms, marketEstimate.ms, signalEstimate.ms]);
  const upstreamBlocked = [secEstimate, marketEstimate, signalEstimate].some((estimate) => estimate?.blocked);
  const upstreamBasis = `Waits on upstream data workers; agency cycle cadence ${cadenceLabel(agencyCycleCadenceMs)}.`;
  const selectorEstimate = deterministicBaselineReady
    ? completionEstimate({ phase: "complete", ms: 0, basis: "Selector has current upstream inputs." })
    : upstreamBlocked
      ? completionEstimate({ phase: "blocked", ms: null, blocked: true, label: "blocked until upstream data is ready", basis: upstreamBasis })
      : completionEstimate({
          phase: "initial_baseline",
          ms: upstreamEstimateMs + agencyCycleCadenceMs,
          basis: upstreamBasis
        });
  const llmEstimate = llmBaselineReady
    ? completionEstimate({ phase: "complete", ms: 0, basis: "LLM/shadow selection lane has reviewed the current pack." })
    : selectorEstimate.blocked
      ? completionEstimate({ phase: "blocked", ms: null, blocked: true, label: "blocked until selector output exists", basis: upstreamBasis })
      : completionEstimate({
          phase: "initial_baseline",
          ms: Number(selectorEstimate.ms || 0) + agencyCycleCadenceMs,
          basis: `Runs after deterministic candidate pack; parallel review cadence ${cadenceLabel(agencyCycleCadenceMs)}.`
        });
  const finalEstimate = finalBaselineReady
    ? completionEstimate({ phase: "complete", ms: 0, basis: "Final selector has current deterministic and LLM/shadow outputs." })
    : selectorEstimate.blocked
      ? completionEstimate({ phase: "blocked", ms: null, blocked: true, label: "blocked until selector outputs exist", basis: upstreamBasis })
      : completionEstimate({
          phase: "initial_baseline",
          ms: Math.max(Number(selectorEstimate.ms || 0), Number(llmEstimate.ms || 0)) + agencyCycleCadenceMs,
          basis: `Final arbitration runs after deterministic and LLM/shadow outputs; cadence ${cadenceLabel(agencyCycleCadenceMs)}.`
        });
  const workerTiming = {
    universe: {
      refresh_cadence_ms: 86_400_000,
      refresh_cadence_label: "daily on startup/refresh",
      refresh_state: universeBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: universeBaselineReady
        ? completionEstimate({ phase: "complete", ms: 0, basis: "Allowed S&P 100 plus QQQ universe is loaded." })
        : completionEstimate({
            phase: "initial_baseline",
            ms: cfg.agencyInitialBaselineCycleMs,
            basis: `Universe refresh runs in the next baseline cycle; cadence ${cadenceLabel(cfg.agencyInitialBaselineCycleMs)}.`
          })
    },
    fundamentals: {
      refresh_cadence_ms: secCadenceMs,
      refresh_cadence_label: fundamentalsBaselineReady
        ? `ongoing SEC refresh ${cadenceLabel(secCadenceMs)}`
        : secAutoStart
          ? `initial SEC catch-up ${cadenceLabel(secCadenceMs)}`
          : "manual SEC batch",
      completion_estimate: secEstimate,
      full_extraction_estimate: secCatchupEstimate,
      refresh_state: secAutoStart
        ? refreshStateFor({
            sources: [secRuntimeSource],
            baselineReady: fundamentalsBaselineReady,
            intervalMs: secCadenceMs,
            nextRefreshAt: secQueue?.next_poll_at || null
          })
        : fundamentalsBaselineReady
          ? "scheduled"
          : "baseline_pending",
      next_refresh_at: secQueue?.next_poll_at || nextAtFrom(secRuntimeSource, secCadenceMs)
    },
    market: {
      refresh_cadence_ms: marketCadenceMs,
      refresh_cadence_label: `pricing/flow ${cadenceLabel(marketCadenceMs)}`,
      completion_estimate: marketEstimate,
      full_extraction_estimate: marketFullEstimate,
      refresh_state: refreshStateFor({
        sources: marketRuntimeSources,
        baselineReady: marketBaselineReady,
        intervalMs: marketCadenceMs
      }),
      next_refresh_at: marketRuntimeSources.map((source) => nextAtFrom(source, source.interval_ms || marketCadenceMs)).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null
    },
    signals: {
      refresh_cadence_ms: signalsCadenceMs,
      refresh_cadence_label: `signals/flow ${cadenceLabel(signalsCadenceMs)}`,
      completion_estimate: signalEstimate,
      full_extraction_estimate: signalsFullEstimate,
      refresh_state: refreshStateFor({
        sources: signalRuntimeSources,
        baselineReady: signalsBaselineReady,
        intervalMs: signalsCadenceMs
      }),
      next_refresh_at: signalRuntimeSources.map((source) => nextAtFrom(source, source.interval_ms || signalsCadenceMs)).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null
    },
    policy: {
      refresh_cadence_ms: null,
      refresh_cadence_label: "on user policy change",
      refresh_state: policyBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: policyBaselineReady
        ? completionEstimate({ phase: "complete", ms: 0, basis: "Portfolio policy is loaded." })
        : completionEstimate({ phase: "blocked", ms: null, blocked: true, label: "blocked until policy is loaded", basis: "Policy is local configuration; reload app telemetry after editing .env or saving policy." })
    },
    deterministic_selection: {
      refresh_cadence_ms: agencyCycleCadenceMs,
      refresh_cadence_label: `agency cycle ${cadenceLabel(agencyCycleCadenceMs)}`,
      refresh_state: deterministicBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: selectorEstimate
    },
    llm_selection: {
      refresh_cadence_ms: agencyCycleCadenceMs,
      refresh_cadence_label: `parallel review ${cadenceLabel(agencyCycleCadenceMs)}`,
      refresh_state: llmBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: llmEstimate
    },
    final_selection: {
      refresh_cadence_ms: agencyCycleCadenceMs,
      refresh_cadence_label: `final arbitration ${cadenceLabel(agencyCycleCadenceMs)}`,
      refresh_state: finalBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: finalEstimate
    },
    risk: {
      refresh_cadence_ms: agencyCycleCadenceMs,
      refresh_cadence_label: `risk snapshot ${cadenceLabel(agencyCycleCadenceMs)}`,
      refresh_state: riskBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: riskBaselineReady
        ? completionEstimate({ phase: "complete", ms: 0, basis: "Risk snapshot is available." })
        : completionEstimate({ phase: "initial_baseline", ms: agencyCycleCadenceMs, basis: `Risk snapshot is refreshed by the agency cycle; cadence ${cadenceLabel(agencyCycleCadenceMs)}.` })
    },
    execution: {
      refresh_cadence_ms: cfg.executionSyncMs,
      refresh_cadence_label: `broker sync ${cadenceLabel(cfg.executionSyncMs)}`,
      refresh_state: executionBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: executionBaselineReady
        ? completionEstimate({ phase: "complete", ms: 0, basis: "Execution broker/previews are configured for the current supervised mode." })
        : completionEstimate({ phase: "blocked", ms: null, blocked: true, label: "blocked until Alpaca paper credentials are configured", basis: "Execution Agent needs broker credentials or MCP broker config; time alone will not complete this worker." })
    },
    portfolio: {
      refresh_cadence_ms: cfg.executionSyncMs,
      refresh_cadence_label: `position sync ${cadenceLabel(cfg.executionSyncMs)}`,
      refresh_state: portfolioBaselineReady ? "scheduled" : "baseline_pending",
      completion_estimate: portfolioBaselineReady
        ? completionEstimate({ phase: "complete", ms: 0, basis: "Portfolio monitor has broker or local position telemetry." })
        : completionEstimate({ phase: "blocked", ms: null, blocked: true, label: "blocked until broker account access is configured", basis: "Portfolio Monitor needs Alpaca/MCP account access or visible local positions." })
    },
    learning: {
      refresh_cadence_ms: cfg.agencyOngoingCycleMs,
      refresh_cadence_label: `outcome review ${cadenceLabel(cfg.agencyOngoingCycleMs)}`,
      refresh_state: "scheduled",
      completion_estimate: completionEstimate({ phase: "complete", ms: 0, basis: "Learning Agent can run with the current paper outcome sample, even if recommendations are limited." })
    }
  };
  const workerBaseline = {
    universe: { baseline_ready: universeBaselineReady },
    fundamentals: { baseline_ready: fundamentalsBaselineReady },
    market: { baseline_ready: marketBaselineReady },
    signals: { baseline_ready: signalsBaselineReady },
    policy: { baseline_ready: policyBaselineReady },
    deterministic_selection: { baseline_ready: deterministicBaselineReady },
    llm_selection: { baseline_ready: llmBaselineReady },
    final_selection: { baseline_ready: finalBaselineReady },
    risk: { baseline_ready: riskBaselineReady },
    execution: { baseline_ready: executionBaselineReady, baseline_required: false },
    portfolio: { baseline_ready: portfolioBaselineReady, baseline_required: false },
    learning: { baseline_ready: learningBaselineReady }
  };

  const statuses = {
    universe: trackedCount
      ? workerStatus("complete", `${trackedCount} allowed names loaded.`, {
          data_state: "ready",
          progress_pct: 100,
          progress_current: trackedCount,
          progress_target: trackedCount,
          progress_label: `${trackedCount}/${trackedCount} names loaded`
        })
      : workerStatus("blocked", "Allowed universe is not loaded yet.", {
          data_state: "blocked",
          progress_pct: 0,
          progress_current: 0,
          progress_target: 168,
          progress_label: "0/168 names loaded",
          remaining: ["S&P 100 + QQQ universe"]
        }),
    fundamentals: trackedCount
      ? pendingSec
        ? workerStatus("review", `${pendingSec} names still need live SEC fundamentals.`, {
            data_state: secPolling ? "loading" : "review",
            loading: secPolling,
            data_ready: secLiveCount > 0,
            progress_pct: fundamentalsProgressPct,
            progress_current: secLiveCount,
            progress_target: trackedCount,
            progress_label: `${secLiveCount}/${trackedCount} SEC-backed${secPolling ? "; polling now" : secAutoStart ? "; background catch-up" : "; manual batch needed"}`,
            remaining: [
              `${pendingSec} names awaiting live SEC fundamentals`,
              secRunEstimate,
              secQueue?.next_poll_at ? `next auto SEC batch ${secQueue.next_poll_at}` : "run initial baseline to continue now"
            ]
          })
        : workerStatus("complete", "SEC-backed fundamentals coverage is complete.", {
            data_state: "ready",
            progress_pct: 100,
            progress_current: trackedCount,
            progress_target: trackedCount,
            progress_label: `${trackedCount}/${trackedCount} SEC-backed`
          })
      : workerStatus("waiting", "Waiting for the Universe Agent.", {
          data_state: "loading",
          loading: true,
          progress_pct: 0,
          progress_label: "waiting for universe",
          remaining: ["Universe Agent"]
        }),
    market: livePricingReady || sourceIsFresh(sources.market_flow) || sourceIsFresh(sources.market_data) || sourceIsFresh(sources.fundamental_market_data)
      ? workerStatus(marketDataState === "blocked" ? "blocked" : "complete", marketDataState === "blocked" ? "Market context is partial, but live pricing is not confirmed." : "Market and pricing context is available.", {
          data_state: marketDataState,
          loading: marketSourceProgress.polling,
          data_ready: livePricingReady,
          progress_pct: marketProgressPct,
          progress_current: marketSourceProgress.current,
          progress_target: marketSourceProgress.target,
          progress_label: livePricingReady
            ? `${marketSourceProgress.current}/${marketSourceProgress.target || 2} required market inputs fresh`
            : `${marketSourceProgress.current}/${marketSourceProgress.target || 2} required market inputs fresh; live pricing not confirmed`,
          remaining: marketSourceProgress.remaining
        })
      : workerStatus("waiting", "Market context needs a pricing or flow refresh.", {
          data_state: marketDataState,
          loading: marketSourceProgress.polling,
          data_ready: false,
          progress_pct: marketProgressPct,
          progress_current: marketSourceProgress.current,
          progress_target: marketSourceProgress.target,
          progress_label: `${marketSourceProgress.current}/${marketSourceProgress.target || 2} required market inputs fresh; live pricing not confirmed`,
          remaining: marketSourceProgress.remaining.length ? marketSourceProgress.remaining : ["live pricing", "market flow"]
        }),
    signals: freshDecisionEvidence > 0
      ? workerStatus("complete", `${freshDecisionEvidence} fresh decision evidence item(s) are available.`, {
          data_state: signalDataState,
          loading: signalSourceProgress.polling,
          data_ready: true,
          progress_pct: signalProgressPct,
          progress_current: signalSourceProgress.current,
          progress_target: signalSourceProgress.target,
          progress_label: `${freshDecisionEvidence} fresh evidence; ${signalSourceProgress.current}/${signalSourceProgress.target || 1} signal sources fresh`,
          remaining: signalSourceProgress.remaining
        })
      : signalSourcesBaselineReady
        ? workerStatus("complete", "Signal sources are fresh, but no alert/watch evidence is strong enough for a trade setup.", {
            data_state: "review",
            loading: signalSourceProgress.polling,
            data_ready: true,
            progress_pct: signalProgressPct,
            progress_current: signalSourceProgress.current,
            progress_target: signalSourceProgress.target,
            progress_label: `0 fresh trade-grade evidence; ${signalSourceProgress.current}/${signalSourceProgress.target || 1} signal sources fresh`,
            remaining: signalSourceProgress.remaining.length
              ? [`optional/degraded source(s): ${signalSourceProgress.remaining.join(", ")}`]
              : ["wait for stronger alert/watch evidence"]
          })
      : workerStatus("blocked", "Fresh alerts/watch evidence is missing.", {
          data_state: signalDataState,
          loading: signalSourceProgress.polling,
          progress_pct: signalProgressPct,
          progress_current: signalSourceProgress.current,
          progress_target: signalSourceProgress.target,
          progress_label: `${signalSourceProgress.current}/${signalSourceProgress.target || 1} signal sources fresh`,
          remaining: signalSourceProgress.remaining.length ? signalSourceProgress.remaining : ["fresh live news, filings, or money flow"]
        }),
    policy: policyBlocked
      ? workerStatus("blocked", portfolioPolicy?.summary || "Portfolio policy is blocking new selections.", {
          data_state: "blocked",
          progress_pct: 0,
          progress_label: "policy blocked",
          remaining: portfolioPolicy?.hard_blocks || ["portfolio policy block"]
        })
      : portfolioPolicy?.status === "caution"
        ? workerStatus("review", portfolioPolicy.summary || "Portfolio policy has caution flags.", {
            data_state: "review",
            progress_pct: 90,
            progress_label: "policy loaded with cautions"
          })
        : workerStatus("complete", portfolioPolicy?.summary || "Portfolio policy is available.", {
            data_state: "ready",
            progress_pct: 100,
            progress_label: "policy loaded"
          }),
    deterministic_selection: tradableCount
      ? workerStatus("complete", `${tradableCount} deterministic buy/sell setup(s) can be reviewed.`, {
          data_state: "ready",
          progress_pct: 100,
          progress_current: tradableCount,
          progress_target: Math.max(1, tradableCount),
          progress_label: `${tradableCount} buy/sell setup(s)`
        })
      : setupCounts.watch
        ? workerStatus("review", `${setupCounts.watch} deterministic watch setup(s), no buy/sell candidate yet.`, {
            data_state: "review",
            progress_pct: selectionProgressPct,
            progress_current: setupCounts.watch,
            progress_target: Math.max(1, setupCounts.watch),
            progress_label: `${setupCounts.watch} watch setup(s)`,
            remaining: ["buy/sell threshold"]
          })
        : workerStatus("waiting", "No deterministic setup clears the trade threshold.", {
            data_state: selectorRan ? "review" : "loading",
            loading: !selectorRan,
            data_ready: selectorRan,
            progress_pct: selectorRan ? 100 : selectionProgressPct,
            progress_label: selectorRan ? "selector ran; no buy/sell setup clears threshold" : `inputs ${upstreamSelectionProgress}% ready`,
            remaining: ["stronger aligned fundamentals, market, and signal inputs"]
          }),
    llm_selection: effectiveLlmSelection?.recommendations?.length
      ? workerStatus(["waiting_for_provider", "enabled_without_provider"].includes(effectiveLlmSelection.status) ? "review" : "complete", `${effectiveLlmSelection.recommendations.length} LLM-lane review(s); mode ${automationLabel(effectiveLlmSelection.mode)}.`, {
          data_state: ["waiting_for_provider", "enabled_without_provider"].includes(effectiveLlmSelection.status) ? "review" : "ready",
          progress_pct: 100,
          progress_current: effectiveLlmSelection.recommendations.length,
          progress_target: effectiveLlmSelection.recommendations.length,
          progress_label: `${effectiveLlmSelection.recommendations.length} reviews complete`,
          remaining: ["external LLM provider"]?.filter(() => ["waiting_for_provider", "enabled_without_provider"].includes(effectiveLlmSelection.status))
        })
      : workerStatus("waiting", "LLM selection has not reviewed current candidates yet.", {
          data_state: selectorRan ? "review" : "loading",
          loading: !selectorRan,
          data_ready: selectorRan,
          progress_pct: selectorRan ? 100 : llmProgressPct,
          progress_label: selectorRan ? "no deterministic candidate pack to review" : "waiting for selection candidates",
          remaining: ["deterministic candidate pack"]
        }),
    final_selection: policyBlocked
      ? workerStatus("blocked", "Final Selection is blocked by Portfolio Policy.", {
          data_state: "blocked",
          progress_pct: 0,
          progress_label: "policy blocked",
          remaining: ["Portfolio Policy Agent"]
        })
      : finalCounts.executable
        ? workerStatus("ready", `${finalCounts.executable} final executable candidate(s) passed dual-selector and policy gates.`, {
            data_state: "ready",
            progress_pct: 100,
            progress_current: finalCounts.executable,
            progress_target: Math.max(1, finalCounts.visible || finalCounts.executable),
            progress_label: `${finalCounts.executable} executable final candidate(s)`
          })
        : finalCounts.review || finalCounts.watch
          ? workerStatus("review", `${finalCounts.review} review and ${finalCounts.watch} watch candidate(s), no final executable candidate.`, {
              data_state: "review",
              progress_pct: finalSelectionProgressPct,
              progress_current: finalCounts.review + finalCounts.watch,
              progress_target: Math.max(1, finalCounts.visible || finalCounts.review + finalCounts.watch),
              progress_label: `${finalCounts.review + finalCounts.watch} review/watch candidate(s)`,
              remaining: ["executable buy/sell candidate"]
            })
          : workerStatus("waiting", "No final selection candidate is available.", {
              data_state: selectorRan ? "review" : "loading",
              loading: !selectorRan,
              data_ready: selectorRan,
              progress_pct: selectorRan ? 100 : finalSelectionProgressPct,
              progress_label: selectorRan ? "selection completed; no final candidate" : "waiting for selector output",
              remaining: ["deterministic and LLM selection output"]
            }),
    risk: riskBlocked
      ? workerStatus("blocked", riskSnapshot?.blocked_reason || "Portfolio risk hard block is active.", {
          data_state: "blocked",
          progress_pct: 0,
          progress_label: "risk blocked",
          remaining: riskSnapshot?.hard_blocks || [riskSnapshot?.blocked_reason || "risk hard block"]
        })
      : workerStatus("ready", `Risk status is ${riskSnapshot?.status || positionMonitor?.risk_status || "available"}.`, {
          data_state: "ready",
          progress_pct: 100,
          progress_label: "risk checks complete"
        }),
    execution: broker.ready_for_order_submission
      ? workerStatus("paper_ready", "Alpaca paper submission is available behind confirmation gates.", {
          data_state: "ready",
          progress_pct: 100,
          progress_label: "paper submit gate ready"
        })
      : broker.configured
        ? workerStatus("gated", "Broker is configured, but paper submission is still guarded.", {
            data_state: "gated",
            progress_pct: executionProgressPct,
            progress_label: "broker configured; submit guarded",
            remaining: ["BROKER_SUBMIT_ENABLED=true"]
          })
        : workerStatus("gated", "Broker credentials are not configured; previews only.", {
            data_state: "gated",
            progress_pct: executionProgressPct,
            progress_label: "broker credentials missing",
            remaining: ["Alpaca paper credentials"]
          }),
    portfolio: positionCount || openOrderCount
      ? workerStatus("reviewing", `${positionCount} position(s), ${openOrderCount} open order(s).`, {
          data_state: "ready",
          progress_pct: 100,
          progress_current: positionCount + openOrderCount,
          progress_target: positionCount + openOrderCount,
          progress_label: `${positionCount} position(s), ${openOrderCount} order(s)`
        })
      : workerStatus("waiting", "No broker positions or open orders to monitor yet.", {
          data_state: broker.configured ? "ready" : "gated",
          progress_pct: portfolioProgressPct,
          progress_label: broker.configured ? "broker monitor ready; no positions" : "broker monitor waiting for credentials",
          remaining: broker.configured ? [] : ["broker account access"]
        }),
    learning: outcomeSample >= 10
      ? workerStatus("reviewing", `${outcomeSample} decisions/positions are available for learning.`, {
          data_state: "ready",
          progress_pct: 100,
          progress_current: outcomeSample,
          progress_target: 10,
          progress_label: `${outcomeSample}/10 outcomes collected`
        })
      : workerStatus("waiting", `Collecting baseline paper outcomes: ${outcomeSample}/10.`, {
          data_state: "review",
          loading: false,
          data_ready: true,
          progress_pct: learningProgressPct,
          progress_current: outcomeSample,
          progress_target: 10,
          progress_label: `${outcomeSample}/10 outcomes collected`,
          remaining: [`${Math.max(0, 10 - outcomeSample)} more paper outcomes`]
        })
  };

  const workers = WORKERS.map((worker, index) => {
    const status = statuses[worker.key];
    const metric = {
      universe: `${trackedCount || 0} names`,
      fundamentals: `${secCoveragePct}% SEC`,
      market: livePricingReady ? "pricing ready" : runtimeReliability?.status || "unknown",
      signals: `${freshDecisionEvidence} fresh`,
      policy: portfolioPolicy?.status || "policy",
      deterministic_selection: `${setupCounts.long}/${setupCounts.short} buy/sell`,
      llm_selection: effectiveLlmSelection?.mode || "shadow",
      final_selection: `${finalCounts.finalBuy}/${finalCounts.finalSell} final`,
      risk: riskSnapshot?.status || positionMonitor?.risk_status || "unknown",
      execution: broker.ready_for_order_submission ? "paper ready" : broker.configured ? "gated" : "preview only",
      portfolio: `${positionCount} pos / ${openOrderCount} ord`,
      learning: `${outcomeSample}/10 sample`
    }[worker.key];
    return buildWorker(worker, index, status.status, status.detail, metric, worker.action, {
      ...status.data,
      ...(workerBaseline[worker.key] || {}),
      ...(workerTiming[worker.key] || {})
    });
  });

  const dataProgress = aggregateDataProgress(workers);
  const baselineReady = Boolean(dataProgress.baseline?.ready);

  const hasFinalSelection = Boolean(finalSelection);
  const workflowCanPreview = Boolean(workflowStatus?.can_preview_orders) && (!hasFinalSelection || finalCounts.executable > 0);
  const workflowCanSubmit = Boolean(workflowStatus?.can_submit_orders) && (!hasFinalSelection || finalCounts.executable > 0);
  const workflowCanUseForDecisions = Boolean(workflowStatus?.can_use_for_decisions);
  const canPreview = baselineReady && workflowCanPreview;
  const canSubmit = baselineReady && workflowCanSubmit;
  const canUseForDecisions = baselineReady && workflowCanUseForDecisions;
  const current = currentWorker(workers, { canPreview, canSubmit });
  const mode = canSubmit
    ? "ready_for_paper_approval"
    : canPreview
      ? "ready_for_preview"
      : !baselineReady
        ? "initial_baseline"
      : canUseForDecisions
        ? "analysis_ready"
        : "collecting_inputs";
  const nextActions = [
    current?.detail,
    ...(workflowStatus?.next_actions || [])
  ].filter(Boolean).slice(0, 5);

  return {
    as_of: new Date().toISOString(),
    mode,
    mode_label: automationLabel(mode),
    status: canSubmit ? "paper_ready" : canPreview ? "ready" : !baselineReady ? "baseline_loading" : workflowStatus?.status || "not_ready",
    status_class: canSubmit || canPreview ? "bullish" : workflowStatus?.status === "review_required" || !baselineReady ? "neutral" : "bearish",
    summary: canSubmit
      ? "The agency can prepare a supervised Alpaca paper approval."
      : canPreview
        ? "The agency can preview final-selected trade tickets, but submission remains guarded."
        : !baselineReady
          ? "The agency is building the initial baseline before the first full decision cycle."
          : "The agency is still collecting or refreshing inputs before trade decisions.",
    supervision: "Universe, fundamentals, market, signals, policy, deterministic selection, LLM selection, final selection, risk checks, monitoring, and learning run automatically from available telemetry. Alpaca paper submission remains supervised and requires explicit approval.",
    current_worker_key: current?.key || null,
    current_worker_label: current?.label || null,
    current_worker_step: current?.step || null,
    primary_action: current?.primary_action || null,
    can_use_for_decisions: canUseForDecisions,
    can_preview_orders: canPreview,
    can_submit_orders: canSubmit,
    baseline_ready: baselineReady,
    initial_baseline: dataProgress.baseline,
    ongoing_refresh: dataProgress.ongoing_refresh,
      refresh_cadence: {
        initial_baseline_cycle_ms: cfg.agencyInitialBaselineCycleMs,
        ongoing_cycle_ms: cfg.agencyOngoingCycleMs,
        baseline_sec_batches_per_run: cfg.agencyBaselineSecBatchesPerRun,
        recommendation:
        "Run a bounded initial baseline cycle every 5 minutes until all required workers are baseline-ready; each baseline run may process several SEC fundamentals batches. After that, run the agency cycle every 15 minutes during market hours, with source collectors following their own safer API-specific intervals."
      },
    data_progress: dataProgress,
    workers,
    blockers: workflowStatus?.blockers || [],
    warnings: workflowStatus?.warnings || [],
    next_actions: nextActions,
    recent_advances: advanceLog.slice(0, 5)
  };
}
