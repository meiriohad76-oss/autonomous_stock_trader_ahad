import { differenceInHours, round } from "../utils/helpers.js";
import { filterFreshEvidence, isLongHorizonEvidence } from "./freshness-policy.js";

function latestSourceTimestamp(source = {}) {
  return source.last_success_at || source.last_poll_at || source.last_backup_at || null;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceAgeHours(source = {}) {
  const timestamp = latestSourceTimestamp(source);
  return timestamp ? round(differenceInHours(timestamp), 2) : null;
}

function sourceSummary(key, label, source = {}) {
  const timestamp = latestSourceTimestamp(source);
  const fallbackMode = Boolean(source.fallback_mode || source.fallback_active || String(source.provider || "").includes("synthetic"));
  const successMs = timestampMs(source.last_success_at);
  const pollMs = timestampMs(source.last_poll_at);
  const newerError = Boolean(source.last_error && (!successMs || (pollMs && pollMs > successMs)));
  return {
    key,
    label,
    enabled: source.enabled !== false,
    polling: Boolean(source.polling),
    provider: source.provider || null,
    active_provider: source.active_provider || null,
    provider_chain: source.provider_chain || null,
    fallback_mode: fallbackMode,
    fallback_active: Boolean(source.fallback_active),
    last_success_at: source.last_success_at || null,
    last_poll_at: source.last_poll_at || null,
    age_hours: sourceAgeHours(source),
    last_error: source.last_error || null,
    status: newerError && !source.last_success_at
      ? "error"
      : newerError
        ? "degraded"
      : fallbackMode
        ? "fallback"
        : timestamp
          ? "fresh"
          : "waiting"
  };
}

function statusRank(status) {
  return {
    pass: 0,
    warning: 1,
    fail: 2
  }[status] ?? 1;
}

function overallFromSteps(steps) {
  const worst = steps.reduce((current, step) => Math.max(current, statusRank(step.status)), 0);
  if (worst >= 2) {
    return "not_ready";
  }
  if (worst === 1) {
    return "review_required";
  }
  return "ready";
}

function freshMarketEvidence(store, config) {
  const freshScores = filterFreshEvidence(store.documentScores || [], config);
  return freshScores.filter((score) => !isLongHorizonEvidence(score));
}

function evidenceTierCounts(items = []) {
  return items.reduce(
    (acc, item) => {
      const tier = item.display_tier || item.evidence_quality?.display_tier || "context";
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    },
    { alert: 0, watch: 0, context: 0, suppress: 0 }
  );
}

function sourceReady(source = {}) {
  return source.status === "fresh" && !source.fallback_mode;
}

function enabledSourcesByKey(sourceRows = [], keys = []) {
  const wanted = new Set(keys);
  return sourceRows.filter((source) => wanted.has(source.key) && source.enabled !== false);
}

function pushIf(list, condition, value) {
  if (condition) {
    list.push(value);
  }
}

export function buildTradingWorkflowStatus({
  config,
  store,
  readiness,
  runtimeReliability,
  tradeSetups,
  executionStatus,
  riskSnapshot,
  positionMonitor
}) {
  const liveSources = store.health.liveSources || {};
  const freshEvidence = freshMarketEvidence(store, config);
  const evidenceCounts = evidenceTierCounts(freshEvidence);
  const setupCounts = tradeSetups?.counts || {};
  const setups = tradeSetups?.setups || [];
  const longCount = setupCounts.long || setups.filter((item) => item.action === "long").length;
  const shortCount = setupCounts.short || setups.filter((item) => item.action === "short").length;
  const watchCount = setupCounts.watch || setups.filter((item) => item.action === "watch").length;
  const tradableCount = longCount + shortCount;
  const broker = executionStatus?.broker || positionMonitor?.broker || {};
  const riskBlocked = riskSnapshot?.status === "blocked" || Boolean(riskSnapshot?.hard_blocks?.length);
  const seedDecisionMode = Boolean(config.seedDataInDecisions || config.seedDataOnEmpty);
  const freshDecisionEvidenceCount = evidenceCounts.alert + evidenceCounts.watch;
  const sourceRows = [
    sourceSummary("live_news", "Live News", liveSources.google_news_rss),
    ...(config.marketauxEnabled ? [sourceSummary("marketaux_news", "Marketaux Linked News", liveSources.marketaux_news)] : []),
    sourceSummary("sec_form4", "SEC Form 4", liveSources.sec_form4),
    ...(config.sec13fEnabled ? [sourceSummary("sec_13f", "SEC 13F", liveSources.sec_13f)] : []),
    ...((config.earningsEnabled || config.autonomousDataEnabled)
      ? [sourceSummary("earnings_calendar", "Earnings Calendar", liveSources.yahoo_earnings_calendar)]
      : []),
    ...(config.stocktwitsEnabled ? [sourceSummary("stocktwits_stream", "StockTwits Social Pulse", liveSources.stocktwits_stream)] : []),
    ...(config.tradePrintsEnabled
      ? [sourceSummary("trade_prints", "Delayed Trade Prints", liveSources[`${config.tradePrintsProvider}_trade_prints`])]
      : []),
    sourceSummary("market_flow", "Market Flow", liveSources.market_flow),
    sourceSummary("market_data", "Market Data", liveSources.market_data),
    sourceSummary("fundamental_market_data", "Fundamental Market Reference", liveSources.fundamental_market_data),
    sourceSummary("sec_fundamentals", "SEC Fundamentals", liveSources.sec_fundamentals),
    sourceSummary("lightweight_state", "Runtime State", liveSources.lightweight_state)
  ];
  const signalSourceRows = enabledSourcesByKey(sourceRows, [
    "live_news",
    "marketaux_news",
    "sec_form4",
    "sec_13f",
    "earnings_calendar",
    "stocktwits_stream",
    "trade_prints",
    "market_flow"
  ]);
  const readySignalSourceCount = signalSourceRows.filter(sourceReady).length;
  const requiredSignalSourceCount = Math.max(
    1,
    Math.min(Number(config.agencyBaselineMinSignalSources || 3), signalSourceRows.length || 1)
  );
  const signalSourcesReady = readySignalSourceCount >= requiredSignalSourceCount;
  const decisionEvidenceReady = freshDecisionEvidenceCount > 0 || signalSourcesReady;
  const livePricingReady = sourceRows
    .filter((source) => ["market_data", "fundamental_market_data"].includes(source.key))
    .some(sourceReady);

  const steps = [
    {
      key: "system_ready",
      label: "System Ready",
      status: readiness?.ready ? "pass" : "fail",
      summary: readiness?.ready ? "HTTP and app initialization are ready." : `Startup phase: ${readiness?.phase || "unknown"}.`
    },
    {
      key: "production_data_mode",
      label: "Production Data Mode",
      status: seedDecisionMode ? "fail" : "pass",
      summary: seedDecisionMode
        ? "Seed/sample data is allowed by configuration. Do not trade from this mode."
        : "Seed/sample data is blocked from decisions."
    },
    {
      key: "fresh_market_evidence",
      label: "Fresh Market Evidence",
      status: freshDecisionEvidenceCount > 0 ? "pass" : signalSourcesReady ? "warning" : "fail",
      summary: freshDecisionEvidenceCount > 0
        ? `${freshDecisionEvidenceCount} fresh alert/watch evidence item(s) are available.`
        : signalSourcesReady
          ? "Signal sources are fresh, but no alert/watch evidence is strong enough for a trade setup."
          : "Signal sources have not produced fresh decision evidence yet."
    },
    {
      key: "source_reliability",
      label: "Source Reliability",
      status: runtimeReliability?.status === "critical" ? "fail" : ["degraded", "constrained"].includes(runtimeReliability?.status) ? "warning" : "pass",
      summary: runtimeReliability?.summary || "Runtime reliability snapshot is unavailable."
    },
    {
      key: "trade_plan",
      label: "Trade Plan",
      status: tradableCount > 0 ? "pass" : "warning",
      summary: tradableCount > 0
        ? `${tradableCount} tradable setup(s) are ready for preview.`
        : watchCount > 0
          ? `${watchCount} watch setup(s) are available, but no buy/short setup clears the final threshold.`
          : "No current trade setup clears the minimum workflow threshold."
    },
    {
      key: "live_pricing",
      label: "Live Pricing",
      status: livePricingReady ? "pass" : "warning",
      summary: livePricingReady
        ? "Live market/reference pricing is available for order sizing and bracket planning."
        : "Pricing/reference data is fallback, synthetic, or waiting; preview is allowed, but submission should stay gated."
    },
    {
      key: "risk_and_broker",
      label: "Risk And Broker",
      status: riskBlocked ? "fail" : broker.ready_for_order_submission ? "pass" : broker.configured ? "warning" : "warning",
      summary: riskBlocked
        ? `Portfolio Risk Agent is blocking execution: ${riskSnapshot.blocked_reason || "risk limit failed"}.`
        : broker.ready_for_order_submission
          ? "Alpaca paper execution is configured and ready behind confirmation gates."
          : broker.configured
            ? "Broker is configured, but order submission remains guarded."
            : "Broker credentials are not configured; workflow is planning/preview only."
    }
  ];

  const blockers = [];
  pushIf(blockers, !readiness?.ready, "Application is not fully ready yet.");
  pushIf(blockers, seedDecisionMode, "Disable seed data before using decisions for trading.");
  pushIf(blockers, !decisionEvidenceReady, "Collect fresh live signal-source data before compiling actionable trades.");
  pushIf(blockers, riskBlocked, "Resolve Portfolio Risk Agent hard blocks before order submission.");

  const warnings = [];
  pushIf(warnings, runtimeReliability?.status === "constrained", "Runtime is constrained; keep heavy collectors manual and use one-shot refreshes.");
  pushIf(warnings, runtimeReliability?.status === "degraded", "Some source diagnostics are degraded; inspect Runtime Reliability before increasing collector load.");
  pushIf(warnings, sourceRows.some((source) => ["error", "degraded"].includes(source.status)), "One or more live sources reported errors after their last successful refresh.");
  pushIf(warnings, sourceRows.some((source) => source.fallback_mode), "At least one market/reference source is using fallback or synthetic data.");
  pushIf(warnings, !livePricingReady, "Live pricing is not confirmed; keep order submission disabled.");
  pushIf(warnings, !broker.ready_for_order_submission, "Alpaca paper submission is not ready; previews remain useful.");
  pushIf(warnings, tradableCount === 0, watchCount > 0 ? "Current lists are monitor-only until conviction improves." : "No setup clears the current trade threshold; this is a no-trade cycle.");

  const nextActions = [];
  pushIf(nextActions, !readiness?.ready, "Wait for /api/ready to return ready before reviewing lists.");
  pushIf(nextActions, seedDecisionMode, "Set SEED_DATA_ON_EMPTY=false and SEED_DATA_IN_DECISIONS=false, then restart.");
  pushIf(nextActions, !decisionEvidenceReady, "Run Refresh Live or one-shot poll Live News / SEC Form 4 / Market Flow.");
  pushIf(nextActions, runtimeReliability?.status === "constrained", "Use Runtime Reliability actions one at a time and observe Pi load.");
  pushIf(nextActions, tradableCount === 0, watchCount > 0 ? "Review watch setups and wait for stronger evidence or better fundamentals confirmation." : "Treat this cycle as no-trade unless you intentionally lower test thresholds.");
  pushIf(nextActions, !livePricingReady, "Enable a live pricing source before allowing paper order submission.");
  pushIf(nextActions, !broker.configured, "Configure Alpaca paper credentials or the Alpaca MCP broker before submitting paper orders.");
  pushIf(nextActions, broker.configured && !broker.ready_for_order_submission, "Keep using Preview until BROKER_SUBMIT_ENABLED and paper-mode gates are intentionally enabled.");
  pushIf(nextActions, !nextActions.length, "Preview the top setup, inspect risk checks, then submit only if the paper-trade confirmation gate is intentionally enabled.");

  const overallStatus = overallFromSteps(steps);
  const canUseForDecisions = readiness?.ready && !seedDecisionMode && decisionEvidenceReady && !blockers.length;

  return {
    as_of: new Date().toISOString(),
    status: overallStatus,
    can_use_for_decisions: canUseForDecisions,
    can_preview_orders: canUseForDecisions && tradableCount > 0,
    can_submit_orders: canUseForDecisions && tradableCount > 0 && broker.ready_for_order_submission && livePricingReady && !riskBlocked,
    summary:
      overallStatus === "ready"
        ? "Workflow is ready for live-data review and guarded order preview."
        : overallStatus === "review_required"
          ? "Workflow can be reviewed, but warnings must be understood before acting."
          : "Workflow is not ready for trading decisions yet.",
    live_data: {
      freshness_max_hours: config.signalFreshnessMaxHours,
      fresh_market_evidence_count: freshEvidence.length,
      fresh_decision_evidence_count: freshDecisionEvidenceCount,
      display_tiers: evidenceCounts,
      signal_sources_ready: signalSourcesReady,
      decision_evidence_ready: decisionEvidenceReady,
      signal_sources_ready_count: readySignalSourceCount,
      signal_sources_required_count: requiredSignalSourceCount,
      live_pricing_ready: livePricingReady,
      seed_data_on_empty: config.seedDataOnEmpty,
      seed_data_in_decisions: config.seedDataInDecisions,
      sources: sourceRows
    },
    trade_plan: {
      as_of: tradeSetups?.as_of || null,
      tracked_tickers: setupCounts.tracked_tickers || 0,
      long: longCount,
      short: shortCount,
      watch: watchCount,
      no_trade: setupCounts.no_trade || setups.filter((item) => item.action === "no_trade").length,
      visible_setups: setups.length
    },
    execution: {
      broker_status: executionStatus?.status || "unknown",
      broker_ready: Boolean(broker.ready_for_order_submission),
      broker_configured: Boolean(broker.configured),
      submit_enabled: Boolean(broker.submit_enabled),
      risk_status: riskSnapshot?.status || positionMonitor?.risk_status || "unknown",
      position_count: positionMonitor?.position_count || 0,
      open_order_count: positionMonitor?.open_order_count || 0
    },
    steps,
    blockers,
    warnings,
    next_actions: nextActions
  };
}
