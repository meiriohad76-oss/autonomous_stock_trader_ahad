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

function buildWorker(base, index, status, detail, metric, action = base.action, data = {}) {
  const dataState = data.data_state || defaultDataState(status);
  const progressPct = clampProgress(data.progress_pct ?? (dataReadyForState(dataState) ? 100 : 0));
  const remaining = Array.isArray(data.remaining) ? data.remaining.filter(Boolean) : [];

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
    loading: Boolean(data.loading || dataState === "loading"),
    progress_pct: progressPct,
    progress_label: data.progress_label || `${progressPct}%`,
    progress_current: data.progress_current ?? null,
    progress_target: data.progress_target ?? null,
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
    ready_count: counts.ready_total || 0,
    loading_count: loading,
    blocked_count: blocked,
    gated_count: gated,
    review_count: review,
    worker_count: workers.length,
    finished: loading === 0 && blocked === 0,
    label:
      loading > 0
        ? `${loading} worker(s) still loading data`
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
  const secLiveCount = Math.max(0, trackedCount - pendingSec);
  const marketSourceProgress = sourceProgress(["market_data", "fundamental_market_data", "market_flow"], sources);
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
  const pricingProgress = livePricingReady ? 65 : marketSourceProgress.pct >= 67 ? 55 : marketSourceProgress.pct >= 34 ? 35 : 0;
  const marketProgressPct = clampProgress(Math.max(marketSourceProgress.pct, pricingProgress));
  const signalProgressPct = freshDecisionEvidence > 0
    ? Math.max(75, signalSourceProgress.target ? signalSourceProgress.pct : 100)
    : signalSourceProgress.pct;
  const fundamentalsProgressPct = trackedCount ? secCoveragePct : 0;
  const upstreamSelectionProgress = clampProgress((fundamentalsProgressPct + marketProgressPct + signalProgressPct) / 3);
  const selectionProgressPct = tradableCount
    ? 100
    : setupCounts.watch
      ? Math.max(85, upstreamSelectionProgress)
      : upstreamSelectionProgress;
  const llmProgressPct = llmSelection?.recommendations?.length ? 100 : Math.max(0, selectionProgressPct - 20);
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
        ? workerStatus("review", `${pendingSec} bootstrap rows still need SEC confirmation.`, {
            data_state: "loading",
            loading: true,
            data_ready: false,
            progress_pct: fundamentalsProgressPct,
            progress_current: secLiveCount,
            progress_target: trackedCount,
            progress_label: `${secLiveCount}/${trackedCount} SEC-backed`,
            remaining: [`${pendingSec} bootstrap fundamentals rows`]
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
      ? workerStatus("complete", "Market and pricing context is available.", {
          data_state: marketSourceProgress.remaining.length ? "loading" : "ready",
          loading: marketSourceProgress.remaining.length > 0 || marketSourceProgress.polling,
          data_ready: marketSourceProgress.remaining.length === 0,
          progress_pct: marketProgressPct,
          progress_current: marketSourceProgress.current,
          progress_target: marketSourceProgress.target,
          progress_label: `${marketSourceProgress.current}/${marketSourceProgress.target || 3} market inputs fresh`,
          remaining: marketSourceProgress.remaining
        })
      : workerStatus("waiting", "Market context needs a pricing or flow refresh.", {
          data_state: "loading",
          loading: true,
          progress_pct: marketProgressPct,
          progress_current: marketSourceProgress.current,
          progress_target: marketSourceProgress.target,
          progress_label: `${marketSourceProgress.current}/${marketSourceProgress.target || 3} market inputs fresh`,
          remaining: marketSourceProgress.remaining.length ? marketSourceProgress.remaining : ["live pricing", "market flow"]
        }),
    signals: freshDecisionEvidence > 0
      ? workerStatus("complete", `${freshDecisionEvidence} fresh decision evidence item(s) are available.`, {
          data_state: signalSourceProgress.remaining.length ? "loading" : "ready",
          loading: signalSourceProgress.remaining.length > 0 || signalSourceProgress.polling,
          data_ready: signalSourceProgress.remaining.length === 0,
          progress_pct: signalProgressPct,
          progress_current: signalSourceProgress.current,
          progress_target: signalSourceProgress.target,
          progress_label: `${freshDecisionEvidence} fresh evidence; ${signalSourceProgress.current}/${signalSourceProgress.target || 1} signal sources fresh`,
          remaining: signalSourceProgress.remaining
        })
      : workerStatus("blocked", "Fresh alerts/watch evidence is missing.", {
          data_state: "blocked",
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
            data_state: upstreamSelectionProgress >= 75 ? "review" : "loading",
            loading: upstreamSelectionProgress < 75,
            data_ready: upstreamSelectionProgress >= 75,
            progress_pct: selectionProgressPct,
            progress_label: `inputs ${upstreamSelectionProgress}% ready`,
            remaining: ["stronger aligned fundamentals, market, and signal inputs"]
          }),
    llm_selection: llmSelection?.recommendations?.length
      ? workerStatus(["waiting_for_provider", "enabled_without_provider"].includes(llmSelection.status) ? "review" : "complete", `${llmSelection.recommendations.length} LLM-lane review(s); mode ${automationLabel(llmSelection.mode)}.`, {
          data_state: ["waiting_for_provider", "enabled_without_provider"].includes(llmSelection.status) ? "review" : "ready",
          progress_pct: 100,
          progress_current: llmSelection.recommendations.length,
          progress_target: llmSelection.recommendations.length,
          progress_label: `${llmSelection.recommendations.length} reviews complete`,
          remaining: ["external LLM provider"]?.filter(() => ["waiting_for_provider", "enabled_without_provider"].includes(llmSelection.status))
        })
      : workerStatus("waiting", "LLM selection has not reviewed current candidates yet.", {
          data_state: "loading",
          loading: true,
          progress_pct: llmProgressPct,
          progress_label: "waiting for selection candidates",
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
              data_state: "loading",
              loading: true,
              progress_pct: finalSelectionProgressPct,
              progress_label: "waiting for selector output",
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
          data_state: "loading",
          loading: true,
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
      llm_selection: llmSelection?.mode || "shadow",
      final_selection: `${finalCounts.finalBuy}/${finalCounts.finalSell} final`,
      risk: riskSnapshot?.status || positionMonitor?.risk_status || "unknown",
      execution: broker.ready_for_order_submission ? "paper ready" : broker.configured ? "gated" : "preview only",
      portfolio: `${positionCount} pos / ${openOrderCount} ord`,
      learning: `${outcomeSample}/10 sample`
    }[worker.key];
    return buildWorker(worker, index, status.status, status.detail, metric, worker.action, status.data);
  });

  const dataProgress = aggregateDataProgress(workers);

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
    data_progress: dataProgress,
    workers,
    blockers: workflowStatus?.blockers || [],
    warnings: workflowStatus?.warnings || [],
    next_actions: nextActions,
    recent_advances: advanceLog.slice(0, 5)
  };
}
