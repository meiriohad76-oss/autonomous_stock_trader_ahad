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
    action: { kind: "runtime", action: "poll_once", source: "market_flow", label: "Poll Flow", icon: "monitoring" }
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
    key: "selection",
    label: "Selection Agent",
    view: "trading",
    automation: "automatic_ranking",
    mission: "Combine fundamentals, market context, and signals into buy, sell, watch, and blocked recommendations.",
    action: { kind: "view", view: "trading", label: "Open Selection", icon: "assignment" }
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
  { action: "poll_once", source: "fundamental_market_data", label: "Refresh Pricing" },
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

function sourceByKey(workflowStatus = {}) {
  return (workflowStatus.live_data?.sources || []).reduce((acc, source) => {
    acc[source.key] = source;
    return acc;
  }, {});
}

function sourceIsFresh(source) {
  return source?.status === "fresh" && !source?.fallback_mode;
}

function workerStatus(status, detail) {
  return { status, detail };
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

function currentWorker(workers) {
  return (
    workers.find((worker) => ["blocked", "gated", "waiting"].includes(worker.status)) ||
    workers.find((worker) => worker.status === "review") ||
    workers.find((worker) => worker.status === "ready") ||
    workers[workers.length - 1]
  );
}

function automationLabel(value) {
  return String(value || "automatic").replace(/_/g, " ");
}

function buildWorker(base, index, status, detail, metric, action = base.action) {
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
    primary_action: action || null
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

  if (key === "selection") {
    return {
      type: "view",
      label: "Open Selection Agent",
      reason: "Selection updates automatically from current Fundamentals, Market, and Signals inputs.",
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
  readiness,
  runtimeReliability,
  workflowStatus,
  tradeSetups,
  executionStatus,
  riskSnapshot,
  positionMonitor,
  secQueue,
  executionLog = [],
  advanceLog = []
}) {
  const setupCounts = countTradeSetups(tradeSetups);
  const tradableCount = setupCounts.long + setupCounts.short;
  const sources = sourceByKey(workflowStatus);
  const broker = executionStatus?.broker || positionMonitor?.broker || {};
  const riskBlocked = riskSnapshot?.status === "blocked" || Boolean(riskSnapshot?.hard_blocks?.length);
  const positionCount = positionMonitor?.position_count || positionMonitor?.positions?.length || 0;
  const openOrderCount = positionMonitor?.open_order_count || positionMonitor?.open_orders?.length || 0;
  const decisionCount = Array.isArray(executionLog) ? executionLog.length : 0;
  const outcomeSample = decisionCount + positionCount;
  const secCoveragePct = Math.round(Number(secQueue?.coverage_ratio || 0) * 100);
  const trackedCount = secQueue?.tracked_companies || 0;
  const pendingSec = secQueue?.pending_bootstrap_companies || 0;
  const freshDecisionEvidence = workflowStatus?.live_data?.fresh_decision_evidence_count || 0;
  const livePricingReady = Boolean(workflowStatus?.live_data?.live_pricing_ready);

  const statuses = {
    universe: trackedCount
      ? workerStatus("complete", `${trackedCount} allowed names loaded.`)
      : workerStatus("blocked", "Allowed universe is not loaded yet."),
    fundamentals: trackedCount
      ? pendingSec
        ? workerStatus("review", `${pendingSec} bootstrap rows still need SEC confirmation.`)
        : workerStatus("complete", "SEC-backed fundamentals coverage is complete.")
      : workerStatus("waiting", "Waiting for the Universe Agent."),
    market: livePricingReady || sourceIsFresh(sources.market_flow) || sourceIsFresh(sources.market_data) || sourceIsFresh(sources.fundamental_market_data)
      ? workerStatus("complete", "Market and pricing context is available.")
      : workerStatus("waiting", "Market context needs a pricing or flow refresh."),
    signals: freshDecisionEvidence > 0
      ? workerStatus("complete", `${freshDecisionEvidence} fresh decision evidence item(s) are available.`)
      : workerStatus("blocked", "Fresh alerts/watch evidence is missing."),
    selection: tradableCount
      ? workerStatus("ready", `${tradableCount} buy/sell setup(s) can be reviewed.`)
      : setupCounts.watch
        ? workerStatus("review", `${setupCounts.watch} watch setup(s), no buy/sell candidate yet.`)
        : workerStatus("waiting", "No current setup clears the final threshold."),
    risk: riskBlocked
      ? workerStatus("blocked", riskSnapshot?.blocked_reason || "Portfolio risk hard block is active.")
      : workerStatus("ready", `Risk status is ${riskSnapshot?.status || positionMonitor?.risk_status || "available"}.`),
    execution: broker.ready_for_order_submission
      ? workerStatus("paper_ready", "Alpaca paper submission is available behind confirmation gates.")
      : broker.configured
        ? workerStatus("gated", "Broker is configured, but paper submission is still guarded.")
        : workerStatus("gated", "Broker credentials are not configured; previews only."),
    portfolio: positionCount || openOrderCount
      ? workerStatus("reviewing", `${positionCount} position(s), ${openOrderCount} open order(s).`)
      : workerStatus("waiting", "No broker positions or open orders to monitor yet."),
    learning: outcomeSample >= 10
      ? workerStatus("reviewing", `${outcomeSample} decisions/positions are available for learning.`)
      : workerStatus("waiting", `Collecting baseline paper outcomes: ${outcomeSample}/10.`)
  };

  const workers = WORKERS.map((worker, index) => {
    const status = statuses[worker.key];
    const metric = {
      universe: `${trackedCount || 0} names`,
      fundamentals: `${secCoveragePct}% SEC`,
      market: livePricingReady ? "pricing ready" : runtimeReliability?.status || "unknown",
      signals: `${freshDecisionEvidence} fresh`,
      selection: `${setupCounts.long}/${setupCounts.short} buy/sell`,
      risk: riskSnapshot?.status || positionMonitor?.risk_status || "unknown",
      execution: broker.ready_for_order_submission ? "paper ready" : broker.configured ? "gated" : "preview only",
      portfolio: `${positionCount} pos / ${openOrderCount} ord`,
      learning: `${outcomeSample}/10 sample`
    }[worker.key];
    return buildWorker(worker, index, status.status, status.detail, metric);
  });

  const canPreview = Boolean(workflowStatus?.can_preview_orders);
  const canSubmit = Boolean(workflowStatus?.can_submit_orders);
  const canUseForDecisions = Boolean(workflowStatus?.can_use_for_decisions);
  const executionWorker = workers.find((worker) => worker.key === "execution");
  const current = (canSubmit || canPreview) && executionWorker ? executionWorker : currentWorker(workers);
  const mode = canSubmit
    ? "ready_for_paper_approval"
    : canPreview
      ? "ready_for_preview"
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
    status: canSubmit ? "paper_ready" : canPreview ? "ready" : workflowStatus?.status || "not_ready",
    status_class: canSubmit || canPreview ? "bullish" : workflowStatus?.status === "review_required" ? "neutral" : "bearish",
    summary: canSubmit
      ? "The agency can prepare a supervised Alpaca paper approval."
      : canPreview
        ? "The agency can preview trade tickets, but submission remains guarded."
        : "The agency is still collecting or refreshing inputs before trade decisions.",
    supervision: "Analysis, ranking, risk checks, monitoring, and learning run automatically from available telemetry. Alpaca paper submission remains supervised and requires explicit approval.",
    current_worker_key: current?.key || null,
    current_worker_label: current?.label || null,
    current_worker_step: current?.step || null,
    primary_action: current?.primary_action || null,
    can_use_for_decisions: canUseForDecisions,
    can_preview_orders: canPreview,
    can_submit_orders: canSubmit,
    workers,
    blockers: workflowStatus?.blockers || [],
    warnings: workflowStatus?.warnings || [],
    next_actions: nextActions,
    recent_advances: advanceLog.slice(0, 5)
  };
}
