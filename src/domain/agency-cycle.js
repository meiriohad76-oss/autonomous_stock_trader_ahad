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
  const setupCounts = countTradeSetups(tradeSetups);
  const tradableCount = setupCounts.long + setupCounts.short;
  const finalCounts = countFinalSelection(finalSelection);
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
    policy: policyBlocked
      ? workerStatus("blocked", portfolioPolicy?.summary || "Portfolio policy is blocking new selections.")
      : portfolioPolicy?.status === "caution"
        ? workerStatus("review", portfolioPolicy.summary || "Portfolio policy has caution flags.")
        : workerStatus("complete", portfolioPolicy?.summary || "Portfolio policy is available."),
    deterministic_selection: tradableCount
      ? workerStatus("complete", `${tradableCount} deterministic buy/sell setup(s) can be reviewed.`)
      : setupCounts.watch
        ? workerStatus("review", `${setupCounts.watch} deterministic watch setup(s), no buy/sell candidate yet.`)
        : workerStatus("waiting", "No deterministic setup clears the trade threshold."),
    llm_selection: llmSelection?.recommendations?.length
      ? workerStatus(["waiting_for_provider", "enabled_without_provider"].includes(llmSelection.status) ? "review" : "complete", `${llmSelection.recommendations.length} LLM-lane review(s); mode ${automationLabel(llmSelection.mode)}.`)
      : workerStatus("waiting", "LLM selection has not reviewed current candidates yet."),
    final_selection: policyBlocked
      ? workerStatus("blocked", "Final Selection is blocked by Portfolio Policy.")
      : finalCounts.executable
        ? workerStatus("ready", `${finalCounts.executable} final executable candidate(s) passed dual-selector and policy gates.`)
        : finalCounts.review || finalCounts.watch
          ? workerStatus("review", `${finalCounts.review} review and ${finalCounts.watch} watch candidate(s), no final executable candidate.`)
          : workerStatus("waiting", "No final selection candidate is available."),
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
      policy: portfolioPolicy?.status || "policy",
      deterministic_selection: `${setupCounts.long}/${setupCounts.short} buy/sell`,
      llm_selection: llmSelection?.mode || "shadow",
      final_selection: `${finalCounts.finalBuy}/${finalCounts.finalSell} final`,
      risk: riskSnapshot?.status || positionMonitor?.risk_status || "unknown",
      execution: broker.ready_for_order_submission ? "paper ready" : broker.configured ? "gated" : "preview only",
      portfolio: `${positionCount} pos / ${openOrderCount} ord`,
      learning: `${outcomeSample}/10 sample`
    }[worker.key];
    return buildWorker(worker, index, status.status, status.detail, metric);
  });

  const hasFinalSelection = Boolean(finalSelection);
  const canPreview = Boolean(workflowStatus?.can_preview_orders) && (!hasFinalSelection || finalCounts.executable > 0);
  const canSubmit = Boolean(workflowStatus?.can_submit_orders) && (!hasFinalSelection || finalCounts.executable > 0);
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
        ? "The agency can preview final-selected trade tickets, but submission remains guarded."
        : "The agency is still collecting or refreshing inputs before trade decisions.",
    supervision: "Universe, fundamentals, market, signals, policy, deterministic selection, LLM selection, final selection, risk checks, monitoring, and learning run automatically from available telemetry. Alpaca paper submission remains supervised and requires explicit approval.",
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
