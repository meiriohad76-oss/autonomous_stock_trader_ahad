const { buildAgencyCycleStatus, chooseAgencyCycleAdvance } = await import("../src/domain/agency-cycle.js");

const cycle = buildAgencyCycleStatus({
  readiness: { ready: true },
  runtimeReliability: { status: "constrained" },
  workflowStatus: {
    status: "not_ready",
    can_use_for_decisions: false,
    can_preview_orders: false,
    can_submit_orders: false,
    live_data: {
      fresh_decision_evidence_count: 0,
      live_pricing_ready: true,
      sources: [{ key: "market_data", status: "fresh", fallback_mode: false }]
    },
    blockers: ["Collect fresh live evidence before compiling actionable trades."],
    warnings: ["Runtime is constrained; keep heavy collectors manual."],
    next_actions: ["Run one-shot Live News / SEC Form 4 / Market Flow."]
  },
  tradeSetups: {
    counts: { long: 0, short: 0, watch: 3, no_trade: 2 },
    setups: []
  },
  executionStatus: {
    broker: { configured: false, ready_for_order_submission: false }
  },
  riskSnapshot: { status: "ok", hard_blocks: [] },
  positionMonitor: { position_count: 0, open_order_count: 0 },
  portfolioPolicy: { status: "ok", summary: "Policy clear.", hard_blocks: [] },
  llmSelection: {
    status: "shadow",
    mode: "shadow",
    recommendations: [
      { ticker: "AAPL", action: "watch" },
      { ticker: "MSFT", action: "watch" },
      { ticker: "NVDA", action: "watch" }
    ]
  },
  finalSelection: {
    counts: { final_buy: 0, final_sell: 0, executable: 0, review: 0, watch: 3, visible: 3 },
    candidates: []
  },
  secQueue: {
    tracked_companies: 168,
    pending_bootstrap_companies: 80,
    coverage_ratio: 0.52
  },
  executionLog: []
});

if (!cycle.workers || cycle.workers.length !== 12) {
  throw new Error(`Expected 12 agency workers, got ${cycle.workers?.length || 0}.`);
}

for (const worker of cycle.workers) {
  if (!worker.data_state || typeof worker.progress_pct !== "number" || !worker.progress_label) {
    throw new Error(`Worker ${worker.key} is missing data readiness/progress telemetry.`);
  }
}

if (!cycle.data_progress || typeof cycle.data_progress.pct !== "number" || !cycle.data_progress.label) {
  throw new Error("Agency cycle is missing aggregate data progress telemetry.");
}

if (!cycle.initial_baseline || cycle.baseline_ready !== false || cycle.mode !== "initial_baseline") {
  throw new Error("Agency cycle should expose initial baseline readiness separately from ongoing updates.");
}

if (!cycle.refresh_cadence || !cycle.workers.every((worker) => worker.load_phase && worker.refresh_cadence_label && worker.refresh_state)) {
  throw new Error("Agency cycle workers should expose baseline phase and refresh cadence telemetry.");
}

if (cycle.current_worker_key !== "signals") {
  throw new Error(`Expected Signals Agent to be current blocker, got ${cycle.current_worker_key}.`);
}

const pendingFundamentals = cycle.workers.find((worker) => worker.key === "fundamentals");
if (pendingFundamentals.data_state !== "review" || pendingFundamentals.loading) {
  throw new Error("Pending SEC catch-up should show review/background progress, not endless loading.");
}

const signalAdvance = chooseAgencyCycleAdvance(cycle);
if (signalAdvance.type !== "runtime_bundle" || !signalAdvance.actions?.some((action) => action.source === "market_flow")) {
  throw new Error("Signals advance should run a guarded refresh bundle that includes money flow.");
}

if (cycle.can_submit_orders) {
  throw new Error("Cycle should not allow paper submission while evidence is missing.");
}

const readyCycle = buildAgencyCycleStatus({
  readiness: { ready: true },
  runtimeReliability: { status: "healthy" },
  workflowStatus: {
    status: "ready",
    can_use_for_decisions: true,
    can_preview_orders: true,
    can_submit_orders: true,
    live_data: {
      fresh_decision_evidence_count: 4,
      live_pricing_ready: true,
      sources: [{ key: "market_flow", status: "fresh", fallback_mode: false }]
    },
    blockers: [],
    warnings: [],
    next_actions: []
  },
  tradeSetups: {
    counts: { long: 2, short: 1, watch: 3, no_trade: 2 },
    setups: [{ action: "long" }, { action: "short" }]
  },
  executionStatus: {
    broker: { configured: true, ready_for_order_submission: true }
  },
  riskSnapshot: { status: "ok", hard_blocks: [] },
  positionMonitor: { position_count: 1, open_order_count: 0 },
  portfolioPolicy: { status: "ok", summary: "Policy clear.", hard_blocks: [] },
  llmSelection: {
    status: "shadow",
    mode: "shadow",
    recommendations: [{ ticker: "AAPL", action: "long" }, { ticker: "MSFT", action: "long" }]
  },
  finalSelection: {
    counts: { final_buy: 2, final_sell: 0, executable: 2, review: 0, watch: 0, visible: 2 },
    candidates: [
      { ticker: "AAPL", final_action: "long", execution_allowed: true },
      { ticker: "MSFT", final_action: "long", execution_allowed: true }
    ]
  },
  secQueue: {
    tracked_companies: 168,
    pending_bootstrap_companies: 0,
    coverage_ratio: 1
  },
  executionLog: Array.from({ length: 12 }, (_, index) => ({ id: index }))
});

if (readyCycle.status !== "paper_ready" || !readyCycle.can_submit_orders) {
  throw new Error("Expected ready cycle to be paper-ready.");
}

if (!readyCycle.baseline_ready || readyCycle.data_progress.phase !== "ongoing_updates") {
  throw new Error("Ready cycle should move out of initial baseline and into ongoing updates.");
}

if (!readyCycle.workers.every((worker) => typeof worker.progress_pct === "number" && worker.data_state)) {
  throw new Error("Ready cycle workers should all expose data progress fields.");
}

const noCandidateCycle = buildAgencyCycleStatus({
  readiness: { ready: true },
  runtimeReliability: { status: "healthy" },
  workflowStatus: {
    status: "review_required",
    can_use_for_decisions: true,
    can_preview_orders: false,
    can_submit_orders: false,
    live_data: {
      fresh_decision_evidence_count: 3,
      live_pricing_ready: false,
      sources: [
        { key: "market_flow", label: "Market Flow", status: "fresh", fallback_mode: false },
        { key: "market_data", label: "Market Data", status: "fallback", fallback_mode: true },
        { key: "fundamental_market_data", label: "Fundamental Market Reference", status: "fallback", fallback_mode: true }
      ]
    },
    blockers: [],
    warnings: ["Live pricing is not confirmed."],
    next_actions: []
  },
  tradeSetups: {
    counts: { tracked_tickers: 168, long: 0, short: 0, watch: 0, no_trade: 0 },
    setups: []
  },
  executionStatus: {
    broker: { configured: false, ready_for_order_submission: false }
  },
  riskSnapshot: { status: "ok", hard_blocks: [] },
  positionMonitor: { position_count: 0, open_order_count: 0 },
  portfolioPolicy: { status: "ok", summary: "Policy clear.", hard_blocks: [] },
  llmSelection: {
    status: "shadow",
    mode: "shadow",
    recommendations: []
  },
  finalSelection: {
    counts: { final_buy: 0, final_sell: 0, executable: 0, review: 0, watch: 0, visible: 0 },
    candidates: []
  },
  secQueue: {
    tracked_companies: 168,
    pending_bootstrap_companies: 144,
    live_sec_companies: 24,
    coverage_ratio: 0.143
  },
  executionLog: []
});

const noCandidateDeterministic = noCandidateCycle.workers.find((worker) => worker.key === "deterministic_selection");
if (noCandidateDeterministic.data_state !== "review" || noCandidateDeterministic.loading) {
  throw new Error("Deterministic selector should show computed/no-candidate review, not loading forever.");
}

const blockedMarket = noCandidateCycle.workers.find((worker) => worker.key === "market");
if (blockedMarket.data_state !== "blocked" || blockedMarket.loading) {
  throw new Error("Market Agent should show blocked live-pricing state, not endless loading, when providers are fallback.");
}

const readyAdvance = chooseAgencyCycleAdvance(readyCycle);
if (!["position_monitor", "learning_review", "execution_preview"].includes(readyAdvance.type)) {
  throw new Error(`Unexpected ready advance action: ${readyAdvance.type}.`);
}

console.log(JSON.stringify({
  status: "ok",
  workers: cycle.workers.length,
  current_worker: cycle.current_worker_label,
  signal_advance: signalAdvance.label,
  ready_mode: readyCycle.mode
}, null, 2));
