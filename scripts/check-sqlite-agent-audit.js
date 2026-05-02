process.env.DATABASE_ENABLED = "true";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.SQLITE_BACKUP_ENABLED = "false";
process.env.LIGHTWEIGHT_STATE_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";
process.env.DATABASE_PATH = process.env.DATABASE_PATH || "data/runtime/test-agent-audit.sqlite";

const assert = await import("node:assert/strict");
const path = await import("node:path");
const { mkdirSync, rmSync } = await import("node:fs");
const { DatabaseSync } = await import("node:sqlite");
const { config } = await import("../src/config.js");
const { createPersistence } = await import("../src/domain/persistence.js");
const { createStore } = await import("../src/domain/store.js");
const { buildFinalSelectionSnapshot } = await import("../src/domain/final-selection.js");

const dbPath = config.databasePath;
mkdirSync(path.dirname(dbPath), { recursive: true });
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });

const testConfig = {
  ...config,
  executionMinConviction: 0.62,
  executionMaxPositionPct: 0.04,
  executionAllowShorts: false,
  executionDefaultEquityUsd: 100000,
  portfolioMaxPositionPct: 0.03,
  portfolioMaxGrossExposurePct: 0.35,
  portfolioMaxPositions: 10,
  portfolioMaxNewPositionsPerCycle: 2,
  portfolioMaxSectorExposurePct: 0.12,
  portfolioCashReservePct: 0.1,
  portfolioDefaultStopLossPct: 0.05,
  portfolioDefaultTakeProfitPct: 0.08,
  portfolioExecutionMinConviction: 0.62
};

const store = createStore(testConfig);
const persistence = createPersistence({ config: testConfig });
await persistence.init();

const asOf = new Date().toISOString();
const portfolioPolicy = {
  portfolioWeeklyTargetPct: 0.03,
  portfolioExecutionMinConviction: 0.62,
  portfolioMaxWeeklyDrawdownPct: 0.04,
  portfolioMaxPositions: 10,
  portfolioMaxNewPositionsPerCycle: 2,
  portfolioMaxPositionPct: 0.03,
  portfolioMaxGrossExposurePct: 0.35,
  portfolioMaxSectorExposurePct: 0.12,
  portfolioCashReservePct: 0.1,
  portfolioDefaultStopLossPct: 0.05,
  portfolioDefaultTakeProfitPct: 0.08,
  portfolioTrailingStopPct: 0.03,
  portfolioAllowAdds: false,
  portfolioAllowReductions: true
};
const riskSnapshot = {
  as_of: asOf,
  status: "ok",
  equity: 100000,
  buying_power: 90000,
  gross_exposure_pct: 0.05,
  open_orders: 0,
  hard_blocks: [],
  positions: []
};
const positionMonitor = {
  as_of: asOf,
  status: "ok",
  risk_status: "ok",
  positions: [],
  position_count: 0,
  open_order_count: 0,
  review_count: 0,
  close_candidate_count: 0
};
const tradeSetups = {
  as_of: asOf,
  window: "1h",
  counts: { long: 1, watch: 1 },
  setups: [
    {
      ticker: "AAPL",
      company_name: "Apple",
      sector: "Technology",
      action: "long",
      conviction: 0.78,
      setup_label: "confirmed_long",
      position_size_pct: 0.03,
      timeframe: "swing",
      current_price: 200,
      stop_loss: 190,
      take_profit: 220,
      summary: "AAPL has aligned deterministic evidence.",
      thesis: ["fundamentals and money flow are supportive"],
      risk_flags: [],
      evidence: { positive: ["supportive money-flow signal"], negative: [] },
      evidence_quality: { average_downstream_weight: 0.78, alert_quality_items: 1, weak_quality_items: 0 },
      fundamentals: {
        screen_stage: "eligible",
        direction_label: "bullish_supportive",
        composite_fundamental_score: 0.72,
        final_confidence: 0.92
      },
      macro_regime: { regime_label: "risk_on", bias_label: "constructive", exposure_multiplier: 1 },
      score_components: { gap: 0.24, raw_long: 0.82, long: 0.78, raw_short: 0.12, short: 0.12 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 },
      recent_documents: [{ headline: "Linked source", source_name: "fixture", published_at: asOf, url: "https://example.test/aapl" }]
    },
    {
      ticker: "MSFT",
      company_name: "Microsoft",
      sector: "Technology",
      action: "watch",
      conviction: 0.54,
      setup_label: "watch",
      position_size_pct: 0,
      timeframe: "watch",
      current_price: 300,
      summary: "MSFT remains watch-only.",
      thesis: ["evidence is present but below trade threshold"],
      risk_flags: ["supporting evidence quality is thin"],
      evidence: { positive: [], negative: [] },
      fundamentals: { screen_stage: "eligible", direction_label: "neutral" },
      score_components: { gap: 0.04 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
    }
  ]
};
const llmSelection = {
  as_of: asOf,
  enabled: true,
  configured: true,
  provider: "fixture",
  model: "fixture-reviewer",
  mode: "fixture_json_review",
  status: "ready",
  prompt_version: "llm_selection_committee_v2",
  counts: { long: 1, watch: 1, short: 0, no_trade: 0 },
  recommendations: [
    {
      ticker: "AAPL",
      company_name: "Apple",
      sector: "Technology",
      action: "long",
      confidence: 0.82,
      selected: true,
      deterministic_action: "long",
      deterministic_conviction: 0.78,
      disagreement_with_deterministic: "none",
      rationale: "Fixture LLM agrees with the deterministic long.",
      supporting_factors: ["fundamentals and money flow are supportive"],
      concerns: [],
      evidence_alignment: "all supplied lanes align",
      risk_assessment: "no fixture hard block",
      confidence_reason: "high confidence because deterministic and LLM lanes agree",
      missing_data: [],
      reviewer: "fixture"
    },
    {
      ticker: "MSFT",
      company_name: "Microsoft",
      sector: "Technology",
      action: "watch",
      confidence: 0.56,
      selected: false,
      deterministic_action: "watch",
      deterministic_conviction: 0.54,
      disagreement_with_deterministic: "none",
      rationale: "Fixture LLM keeps MSFT on watch.",
      supporting_factors: [],
      concerns: ["supporting evidence quality is thin"],
      evidence_alignment: "watch-only alignment",
      risk_assessment: "thin evidence",
      confidence_reason: "moderate confidence only",
      missing_data: ["stronger fresh evidence"],
      reviewer: "fixture"
    }
  ]
};
const finalSelection = buildFinalSelectionSnapshot({
  config: testConfig,
  tradeSetups,
  llmSelection,
  portfolioPolicy,
  riskSnapshot,
  positionMonitor,
  window: "1h",
  limit: 5
});
const passed = finalSelection.candidates.find((candidate) => candidate.ticker === "AAPL");
assert.ok(passed?.execution_allowed, "Fixture should produce an executable final selection.");

store.llmSelectionHistory = [llmSelection];
store.finalSelectionHistory = [finalSelection];
store.tradingSelectionPassHistory = [{
  id: `${finalSelection.as_of}:1h:AAPL:long`,
  as_of: finalSelection.as_of,
  window: "1h",
  candidate: passed
}];
store.riskSnapshotHistory = [riskSnapshot];
store.positionMonitorHistory = [positionMonitor];
store.executionIntentHistory = [{
  id: `${asOf}:AAPL:long`,
  as_of: asOf,
  preview: {
    ok: true,
    dry_run: true,
    broker_ready: false,
    execution_allowed: true,
    intent: {
      allowed: true,
      ticker: "AAPL",
      action: "long",
      side: "buy",
      estimated_notional_usd: 3000,
      estimated_quantity: 15,
      current_price: 200,
      order: { symbol: "AAPL", side: "buy", qty: "15" }
    },
    risk: { allowed: true, blocked_reason: null }
  }
}];
store.agencyCycleHistory = [{
  as_of: asOf,
  mode: "ready_for_paper_approval",
  status: "ready",
  baseline_ready: true,
  data_progress: { pct: 100 },
  current_worker_key: "execution",
  can_use_for_decisions: true,
  can_preview_orders: true,
  can_submit_orders: false,
  workers: Array.from({ length: 12 }, (_, index) => ({ step: index + 1, key: `worker_${index + 1}` })),
  final_selection: { counts: finalSelection.counts }
}];

await persistence.saveStoreSnapshot(store);

const db = new DatabaseSync(dbPath, { readOnly: true });
function count(table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
}
function first(table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 1`).get();
}

const counts = {
  llm_selection_reviews: count("llm_selection_reviews"),
  final_selection_candidates: count("final_selection_candidates"),
  trading_selection_passes: count("trading_selection_passes"),
  risk_snapshots: count("risk_snapshots"),
  position_monitor_snapshots: count("position_monitor_snapshots"),
  execution_intents: count("execution_intents"),
  agency_cycle_states: count("agency_cycle_states")
};

assert.equal(counts.llm_selection_reviews, 2, "LLM review rows should persist per candidate.");
assert.equal(counts.final_selection_candidates, 2, "Final Selection candidates should persist per candidate.");
assert.equal(counts.trading_selection_passes, 1, "Only executable final selections should persist as passes.");
assert.equal(counts.risk_snapshots, 1, "Risk snapshot should persist.");
assert.equal(counts.position_monitor_snapshots, 1, "Portfolio monitor snapshot should persist.");
assert.equal(counts.execution_intents, 1, "Execution preview intent should persist.");
assert.equal(counts.agency_cycle_states, 1, "Agency cycle state should persist.");

const passRow = first("trading_selection_passes");
assert.equal(passRow.ticker, "AAPL", "Passed selection row should identify the ticker.");
assert.equal(passRow.final_action, "long", "Passed selection row should identify the final action.");
assert.ok(JSON.parse(passRow.payload_json).candidate.selection_report, "Passed selection row should preserve the selection report payload.");

const finalRow = db.prepare("SELECT * FROM final_selection_candidates WHERE ticker = 'AAPL'").get();
assert.equal(finalRow.execution_allowed, 1, "Final candidate row should expose execution_allowed.");
assert.ok(JSON.parse(finalRow.score_components).deterministic !== undefined, "Final candidate row should persist score components.");

const rehydrated = createStore(testConfig);
await persistence.hydrateStore(rehydrated);
assert.ok(rehydrated.finalSelectionHistory.length >= 1, "Hydration should restore final-selection audit history.");
assert.ok(rehydrated.tradingSelectionPassHistory.length >= 1, "Hydration should restore passed-selection audit history.");

db.close();

console.log(JSON.stringify({
  status: "ok",
  database_path: dbPath,
  counts,
  passed_selection: {
    ticker: passRow.ticker,
    final_action: passRow.final_action,
    final_conviction: passRow.final_conviction
  }
}, null, 2));
