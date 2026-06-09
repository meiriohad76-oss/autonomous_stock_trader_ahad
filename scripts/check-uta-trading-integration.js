process.env.DATABASE_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";

const { buildFinalSelectionSnapshot } = await import("../src/domain/final-selection.js");

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

const config = {
  executionMinConviction: 0.62,
  executionMaxPositionPct: 0.03,
  executionAllowShorts: false,
  executionDefaultEquityUsd: 100000,
  riskMaxGrossExposurePct: 0.35,
  llmSelectionEnabled: false,
  llmSelectionProvider: "shadow"
};

const portfolioPolicy = {
  portfolioExecutionMinConviction: 0.62,
  portfolioMaxPositionPct: 0.03,
  portfolioMaxGrossExposurePct: 0.35,
  portfolioMaxPositions: 10,
  portfolioMaxNewPositionsPerCycle: 3,
  portfolioMaxSectorExposurePct: 0.2,
  portfolioCashReservePct: 0.1,
  portfolioDefaultStopLossPct: 0.05,
  portfolioDefaultTakeProfitPct: 0.08,
  portfolioTrailingStopPct: 0.03,
  portfolioAllowAdds: false
};

const trustedEvidenceBreadth = {
  breadth_gate_pass: true,
  usable_signal_items: 2,
  source_count: 2,
  minimum_items: 2,
  minimum_sources: 2
};

const tradeSetups = {
  as_of: "2026-06-09T00:00:00.000Z",
  setups: [
    {
      ticker: "AAPL",
      company_name: "Apple",
      sector: "Technology",
      action: "long",
      conviction: 0.76,
      setup_label: "confirmed_long",
      position_size_pct: 0.03,
      current_price: 200,
      stop_loss: 188,
      take_profit: 230,
      summary: "AAPL is confirmed long.",
      thesis: ["deterministic evidence is supportive"],
      risk_flags: [],
      evidence: { positive: ["existing signal breadth"], negative: [] },
      evidence_breadth: trustedEvidenceBreadth,
      fundamentals: { screen_stage: "eligible", direction_label: "bullish_supportive" },
      score_components: { gap: 0.2 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
    },
    {
      ticker: "WATCH",
      company_name: "Watch Only",
      sector: "Technology",
      action: "watch",
      conviction: 0.5,
      setup_label: "watch_only",
      position_size_pct: 0,
      current_price: 50,
      summary: "WATCH is not deterministic tradable.",
      thesis: ["watch item"],
      risk_flags: [],
      evidence: { positive: ["watch evidence"], negative: [] },
      evidence_breadth: trustedEvidenceBreadth,
      fundamentals: { screen_stage: "eligible", direction_label: "bullish_supportive" },
      score_components: { gap: 0.04 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
    }
  ]
};

const llmSelection = {
  enabled: false,
  configured: false,
  status: "ok",
  mode: "shadow",
  provider: "shadow",
  model: "policy-aware-shadow-reviewer",
  recommendations: [
    { ticker: "AAPL", action: "long", confidence: 0.72, reviewer: "shadow" },
    { ticker: "WATCH", action: "long", confidence: 0.9, reviewer: "shadow" }
  ]
};

const utaEvidenceByTicker = {
  AAPL: {
    ticker: "AAPL",
    tier: "A",
    direction: "bullish",
    generated_at: "2026-06-09T00:00:00.000Z",
    bluf: { headline: "AAPL - Tier A - Bullish supporting evidence" },
    indicators: {
      A: null,
      B: { notional_zscore: 4.2 },
      C: { notional_ratio: 9.1, net_notional_pressure: 0.7 }
    },
    explain_tier: { verdict: "Tier A", rules: [] },
    calculation_metadata: {
      direction_source: "signed_flow",
      price_is_corroboration_only: true
    }
  },
  WATCH: {
    ticker: "WATCH",
    tier: "A",
    direction: "bullish",
    generated_at: "2026-06-09T00:00:00.000Z",
    bluf: { headline: "WATCH - Tier A - Bullish supporting evidence" },
    indicators: {
      A: null,
      B: { notional_zscore: 5 },
      C: { notional_ratio: 12, net_notional_pressure: 0.8 }
    },
    explain_tier: { verdict: "Tier A", rules: [] },
    calculation_metadata: {
      direction_source: "signed_flow",
      price_is_corroboration_only: true
    }
  }
};

const base = buildFinalSelectionSnapshot({
  config,
  tradeSetups,
  llmSelection,
  portfolioPolicy,
  riskSnapshot: { status: "ok", equity: 100000, buying_power: 100000, gross_exposure_pct: 0, hard_blocks: [] },
  positionMonitor: { positions: [], position_count: 0, open_order_count: 0 },
  limit: 10
});

const enriched = buildFinalSelectionSnapshot({
  config,
  tradeSetups,
  llmSelection,
  portfolioPolicy,
  riskSnapshot: { status: "ok", equity: 100000, buying_power: 100000, gross_exposure_pct: 0, hard_blocks: [] },
  positionMonitor: { positions: [], position_count: 0, open_order_count: 0 },
  utaEvidenceByTicker,
  limit: 10
});

for (const before of base.candidates) {
  const after = enriched.candidates.find((candidate) => candidate.ticker === before.ticker);
  assert(after, "Missing enriched candidate.", { ticker: before.ticker });
  assert(after.final_action === before.final_action, "UTA evidence must not change final action.", { before, after });
  assert(after.execution_allowed === before.execution_allowed, "UTA evidence must not change execution permission.", { before, after });
  assert(after.final_conviction === before.final_conviction, "UTA evidence must not change final conviction.", { before, after });
  assert(after.position_size_pct === before.position_size_pct, "UTA evidence must not change position size.", { before, after });
}

const apple = enriched.candidates.find((candidate) => candidate.ticker === "AAPL");
const watch = enriched.candidates.find((candidate) => candidate.ticker === "WATCH");

assert(apple?.uta_supporting_evidence?.role === "supporting_evidence_only", "UTA evidence should attach as supporting only.", apple);
assert(apple?.selection_report?.evidence_summary?.uta_supporting_evidence?.trading_effect === "none", "UTA report evidence must declare no trading effect.", apple);
assert(apple.reason_codes.includes("uta_supporting_evidence_only"), "UTA supporting reason code missing.", apple);
assert(watch?.execution_allowed === false && watch?.final_action === "watch", "UTA must not promote deterministic watch items.", watch);

console.log(JSON.stringify({
  status: "ok",
  candidates_checked: enriched.candidates.length,
  aapl_execution_allowed: apple.execution_allowed,
  watch_execution_allowed: watch.execution_allowed,
  uta_trading_effect: apple.uta_supporting_evidence.trading_effect
}, null, 2));
