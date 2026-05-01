const { buildAgencyCycleStatus } = await import("../src/domain/agency-cycle.js");

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
  secQueue: {
    tracked_companies: 168,
    pending_bootstrap_companies: 80,
    coverage_ratio: 0.52
  },
  executionLog: []
});

if (!cycle.workers || cycle.workers.length !== 9) {
  throw new Error(`Expected 9 agency workers, got ${cycle.workers?.length || 0}.`);
}

if (cycle.current_worker_key !== "signals") {
  throw new Error(`Expected Signals Agent to be current blocker, got ${cycle.current_worker_key}.`);
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

console.log(JSON.stringify({
  status: "ok",
  workers: cycle.workers.length,
  current_worker: cycle.current_worker_label,
  ready_mode: readyCycle.mode
}, null, 2));
