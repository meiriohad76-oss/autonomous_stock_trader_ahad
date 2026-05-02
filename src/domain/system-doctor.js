function cleanList(items = []) {
  return [...new Set(items.filter(Boolean).map((item) => String(item)))];
}

function statusClass(status) {
  if (status === "pass") return "bullish";
  if (status === "fail") return "bearish";
  return "neutral";
}

function check(key, label, status, summary, details = {}) {
  return {
    key,
    label,
    status,
    status_class: statusClass(status),
    summary,
    ...details
  };
}

function sourceByKey(workflowStatus = {}, key) {
  return (workflowStatus.live_data?.sources || []).find((source) => source.key === key) || null;
}

function runtimeSource(runtimeReliability = {}, key) {
  return (runtimeReliability.sources || []).find((source) => source.key === key) || null;
}

function finalCounts(finalSelection = {}) {
  const counts = finalSelection?.counts || {};
  const candidates = finalSelection?.candidates || [];
  return {
    executable: counts.executable ?? candidates.filter((item) => item.execution_allowed).length,
    finalBuy: counts.final_buy ?? candidates.filter((item) => item.execution_allowed && item.final_action === "long").length,
    finalSell: counts.final_sell ?? candidates.filter((item) => item.execution_allowed && item.final_action === "short").length,
    review: counts.review ?? candidates.filter((item) => item.final_action === "review").length,
    visible: counts.visible ?? candidates.length
  };
}

function sourceSummary(source = null) {
  if (!source) {
    return null;
  }
  return {
    status: source.status || null,
    provider: source.provider || null,
    active_provider: source.active_provider || null,
    provider_chain: source.provider_chain || null,
    fallback_mode: Boolean(source.fallback_mode || source.fallback_active),
    last_success_at: source.last_success_at || null,
    last_poll_at: source.last_poll_at || null,
    last_error: source.last_error || null,
    age_hours: source.age_hours ?? null,
    universe_symbols: source.universe_symbols ?? null,
    requested_symbols: source.requested_symbols ?? null
  };
}

function brokerModeSafe(broker = {}) {
  return broker.mode !== "live" || broker.live_trading_allowed;
}

function productStatus({ workflowStatus, agencyCycle }) {
  if (workflowStatus?.can_submit_orders && agencyCycle?.can_submit_orders) {
    return "ready_for_paper_submit";
  }
  if (workflowStatus?.can_preview_orders && agencyCycle?.can_preview_orders) {
    return "ready_for_preview";
  }
  if (workflowStatus?.can_use_for_decisions || agencyCycle?.can_use_for_decisions) {
    return "analysis_ready";
  }
  return "blocked";
}

function productSummary(status) {
  if (status === "ready_for_paper_submit") {
    return "End-to-end paper trading is ready behind the explicit Alpaca approval gate.";
  }
  if (status === "ready_for_preview") {
    return "The agency can preview final paper tickets, but one or more submit gates are still closed.";
  }
  if (status === "analysis_ready") {
    return "The agency can analyze current live evidence, but it is not ready to preview or submit paper orders.";
  }
  return "The product is blocked before reliable trade decisions. Follow the listed next actions first.";
}

export function buildSystemDoctorSnapshot({
  config,
  readiness,
  health,
  runtimeReliability,
  workflowStatus,
  agencyCycle,
  finalSelection,
  executionStatus,
  riskSnapshot,
  positionMonitor,
  portfolioPolicy,
  secQueue
}) {
  const broker = executionStatus?.broker || positionMonitor?.broker || {};
  const counts = finalCounts(finalSelection);
  const trackedCount =
    secQueue?.tracked_companies ||
    health?.fundamental_companies_scored ||
    workflowStatus?.trade_plan?.tracked_tickers ||
    0;
  const secLiveCount = secQueue?.live_sec_companies || health?.live_sources?.sec_fundamentals?.live_companies || 0;
  const pendingBootstrap =
    secQueue?.pending_bootstrap_companies ??
    health?.live_sources?.sec_fundamentals?.pending_bootstrap_companies ??
    0;
  const livePricingReady = Boolean(workflowStatus?.live_data?.live_pricing_ready);
  const decisionEvidence = Number(workflowStatus?.live_data?.fresh_decision_evidence_count || 0);
  const marketDataSource = sourceByKey(workflowStatus, "market_data") || runtimeSource(runtimeReliability, "market_data");
  const fundamentalMarketDataSource =
    sourceByKey(workflowStatus, "fundamental_market_data") || runtimeSource(runtimeReliability, "fundamental_market_data");
  const marketFlowSource = sourceByKey(workflowStatus, "market_flow") || runtimeSource(runtimeReliability, "market_flow");
  const liveNewsSource = sourceByKey(workflowStatus, "live_news") || runtimeSource(runtimeReliability, "live_news");
  const marketauxSource = sourceByKey(workflowStatus, "marketaux_news") || runtimeSource(runtimeReliability, "marketaux_news");
  const riskBlocked = riskSnapshot?.status === "blocked" || Boolean(riskSnapshot?.hard_blocks?.length);
  const seedMode = Boolean(config.seedDataOnEmpty || config.seedDataInDecisions);
  const credentialWarnings = config.credentialWarnings || [];
  const status = productStatus({ workflowStatus, agencyCycle });

  const checks = [
    check(
      "app_ready",
      "Application Ready",
      readiness?.ready ? "pass" : "fail",
      readiness?.ready ? "HTTP and initialization are ready." : `Startup phase is ${readiness?.phase || "unknown"}.`
    ),
    check(
      "credential_sanity",
      "Credential Sanity",
      credentialWarnings.length ? "warning" : "pass",
      credentialWarnings.length
        ? `${credentialWarnings.length} placeholder credential value(s) were ignored.`
        : "No placeholder credentials are being treated as live keys.",
      { credential_warnings: credentialWarnings }
    ),
    check(
      "production_data_mode",
      "Production Data Mode",
      seedMode ? "fail" : "pass",
      seedMode
        ? "Seed/sample data is enabled for decisions. Trading decisions are blocked."
        : "Seed/sample data is blocked from trading decisions."
    ),
    check(
      "allowed_universe",
      "Allowed Universe",
      trackedCount >= 100 ? "pass" : "fail",
      trackedCount >= 100
        ? `${trackedCount} S&P 100 plus QQQ holdings names are loaded.`
        : `${trackedCount} names are loaded; this looks too small for the configured agency universe.`,
      { tracked_count: trackedCount, expected_minimum: 100 }
    ),
    check(
      "fundamentals",
      "Fundamentals Agent",
      pendingBootstrap ? "warning" : trackedCount ? "pass" : "fail",
      trackedCount
        ? `${secLiveCount}/${trackedCount} names are SEC-backed; ${pendingBootstrap} bootstrap rows remain.`
        : "No fundamentals universe is available.",
      { live_sec_count: secLiveCount, pending_bootstrap_count: pendingBootstrap }
    ),
    check(
      "live_pricing",
      "Live Pricing",
      livePricingReady ? "pass" : "warning",
      livePricingReady
        ? "Live pricing/reference data is confirmed for sizing and ticket preview."
        : "Pricing/reference data is fallback, synthetic, waiting, or cooling down; paper submission must stay gated.",
      {
        market_data: sourceSummary(marketDataSource),
        fundamental_market_data: sourceSummary(fundamentalMarketDataSource)
      }
    ),
    check(
      "signals",
      "Signals Agent",
      decisionEvidence > 0 ? "pass" : "fail",
      decisionEvidence > 0
        ? `${decisionEvidence} fresh alert/watch evidence item(s) are available.`
        : "No fresh alert/watch evidence is available for current decisions.",
      {
        fresh_decision_evidence_count: decisionEvidence,
        live_news: sourceSummary(liveNewsSource),
        marketaux_news: sourceSummary(marketauxSource)
      }
    ),
    check(
      "money_flow",
      "Money Flow",
      marketFlowSource?.status === "fresh" || marketFlowSource?.status === "healthy" ? "pass" : "warning",
      marketFlowSource?.last_success_at
        ? `Market flow last refreshed at ${marketFlowSource.last_success_at}.`
        : "Market flow has not produced a usable live refresh yet.",
      { market_flow: sourceSummary(marketFlowSource) }
    ),
    check(
      "final_selection",
      "Final Selection",
      counts.executable ? "pass" : counts.visible ? "warning" : "fail",
      counts.executable
        ? `${counts.executable} final executable candidate(s) are available.`
        : counts.visible
          ? `${counts.visible} candidate(s) are visible, but none are executable after policy/risk gates.`
          : "No final selection candidates are available.",
      counts
    ),
    check(
      "risk",
      "Risk Manager",
      riskBlocked ? "fail" : "pass",
      riskBlocked
        ? riskSnapshot?.blocked_reason || "Risk Manager has a hard block."
        : `Risk status is ${riskSnapshot?.status || positionMonitor?.risk_status || "ok"}.`
    ),
    check(
      "portfolio_policy",
      "Portfolio Policy",
      portfolioPolicy?.status === "blocked" ? "fail" : portfolioPolicy?.status === "caution" ? "warning" : "pass",
      portfolioPolicy?.summary || "Portfolio policy is available for sizing, stops, targets, and exposure caps."
    ),
    check(
      "broker",
      "Alpaca Broker",
      broker.configured && brokerModeSafe(broker) ? "pass" : "warning",
      broker.configured
        ? brokerModeSafe(broker)
          ? `Alpaca ${broker.mode || "paper"} broker is configured.`
          : "Live broker mode is blocked until ALPACA_ALLOW_LIVE_TRADING=true."
        : "Alpaca credentials are not configured; order submission cannot be tested end-to-end.",
      {
        configured: Boolean(broker.configured),
        mode: broker.mode || null,
        submit_enabled: Boolean(broker.submit_enabled),
        ready_for_order_submission: Boolean(broker.ready_for_order_submission),
        blocked_reason: broker.blocked_reason || null
      }
    ),
    check(
      "paper_submission",
      "Paper Submission Gate",
      workflowStatus?.can_submit_orders && agencyCycle?.can_submit_orders ? "pass" : "warning",
      workflowStatus?.can_submit_orders && agencyCycle?.can_submit_orders
        ? "The final paper-order submit path is ready behind explicit confirmation."
        : "Paper submission is intentionally gated until live pricing, final selection, risk, and broker submit settings all pass."
    ),
    check(
      "persistence",
      "Persistence",
      config.databaseEnabled || config.lightweightStateEnabled ? "pass" : "warning",
      config.databaseEnabled
        ? `${config.databaseProvider || "database"} persistence is enabled.`
        : config.lightweightStateEnabled
          ? "Lightweight JSON persistence is enabled."
          : "Persistence is disabled; runtime state will reset on restart."
    )
  ];

  const blockers = cleanList([
    ...(workflowStatus?.blockers || []),
    !readiness?.ready && "Application startup is not ready.",
    seedMode && "Disable seed/sample decision mode.",
    trackedCount < 100 && "Refresh the allowed S&P 100 plus QQQ universe.",
    decisionEvidence <= 0 && "Collect fresh live evidence before selecting trades.",
    riskBlocked && "Resolve Risk Manager hard blocks."
  ]);

  const warnings = cleanList([
    ...(workflowStatus?.warnings || []),
    credentialWarnings.length && "One or more placeholder credential values were ignored.",
    !livePricingReady && "Live pricing is not confirmed; paper submission remains gated.",
    marketauxSource?.last_error && `Marketaux needs attention: ${marketauxSource.last_error}`,
    pendingBootstrap > 0 && `${pendingBootstrap} fundamentals rows still need live SEC confirmation.`,
    counts.visible > 0 && !counts.executable && "Selection has review/watch candidates but no executable final candidate.",
    !broker.configured && "Alpaca broker credentials are missing.",
    broker.configured && !broker.ready_for_order_submission && (broker.blocked_reason || "Broker submission is guarded."),
    runtimeReliability?.status && !["optimal", "healthy"].includes(runtimeReliability.status) && `Runtime reliability is ${runtimeReliability.status}.`
  ]);

  const nextActions = cleanList([
    ...(workflowStatus?.next_actions || []),
    credentialWarnings.length && "Replace placeholder credential values with real keys or leave them blank.",
    trackedCount < 100 && "Run Refresh Universe from the Command or System dashboard.",
    !livePricingReady && "Use Alpaca market-data credentials as the primary live-pricing fallback, then run one agency cycle.",
    decisionEvidence <= 0 && "Run Poll News, Poll Form 4, and Poll Flow from the Signals or System dashboard.",
    counts.visible === 0 && "Run Agency Cycle after live evidence and pricing are refreshed.",
    counts.visible > 0 && !counts.executable && "Open Selection Agent and inspect why candidates were demoted.",
    !broker.configured && "Set Alpaca paper credentials in .env before testing order submission.",
    broker.configured && !broker.submit_enabled && "Keep previewing until you intentionally set BROKER_SUBMIT_ENABLED=true for paper trading.",
    !config.databaseEnabled && !config.lightweightStateEnabled && "Enable SQLite or lightweight JSON persistence before long-running Pi operation."
  ]);

  return {
    as_of: new Date().toISOString(),
    status,
    status_class:
      status === "ready_for_paper_submit" || status === "ready_for_preview"
        ? "bullish"
        : status === "analysis_ready"
          ? "neutral"
          : "bearish",
    summary: productSummary(status),
    can_use_for_decisions: Boolean(workflowStatus?.can_use_for_decisions || agencyCycle?.can_use_for_decisions),
    can_preview_orders: Boolean(workflowStatus?.can_preview_orders && agencyCycle?.can_preview_orders),
    can_submit_orders: Boolean(workflowStatus?.can_submit_orders && agencyCycle?.can_submit_orders),
    target: {
      weekly_return_pct: Number(config.portfolioWeeklyTargetPct || 0.03),
      universe: config.universeName || "S&P 100 + QQQ Holdings",
      mode: broker.mode || config.brokerTradingMode || "paper"
    },
    checks,
    blockers,
    warnings,
    next_actions: nextActions.length ? nextActions : ["The product is ready for supervised paper-ticket preview and approval."],
    live_data: {
      pricing_ready: livePricingReady,
      fresh_decision_evidence_count: decisionEvidence,
      market_data: sourceSummary(marketDataSource),
      fundamental_market_data: sourceSummary(fundamentalMarketDataSource),
      market_flow: sourceSummary(marketFlowSource),
      live_news: sourceSummary(liveNewsSource),
      marketaux_news: sourceSummary(marketauxSource)
    },
    agents: {
      worker_count: agencyCycle?.workers?.length || 0,
      current_worker: agencyCycle?.current_worker_label || null,
      agency_mode: agencyCycle?.mode || null,
      data_progress: agencyCycle?.data_progress || null,
      worker_readiness: (agencyCycle?.workers || []).map((worker) => ({
        key: worker.key,
        label: worker.label,
        data_state: worker.data_state || null,
        progress_pct: worker.progress_pct ?? null,
        progress_label: worker.progress_label || null,
        remaining: worker.remaining || []
      })),
      final_selection: counts,
      risk_status: riskSnapshot?.status || positionMonitor?.risk_status || "unknown",
      broker_status: executionStatus?.status || broker.blocked_reason || "unknown"
    }
  };
}
