process.env.DATABASE_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";

const { buildFinalSelectionSnapshot } = await import("../src/domain/final-selection.js");
const { buildLlmSelectionSnapshot } = await import("../src/domain/llm-selection-agent.js");

const config = {
  executionMinConviction: 0.62,
  executionMaxPositionPct: 0.04,
  executionAllowShorts: false,
  executionDefaultEquityUsd: 100000,
  riskMaxGrossExposurePct: 0.35,
  portfolioMaxPositionPct: 0.03,
  portfolioMaxGrossExposurePct: 0.35,
  portfolioMaxPositions: 10,
  portfolioMaxNewPositionsPerCycle: 1,
  portfolioMaxSectorExposurePct: 0.06,
  portfolioCashReservePct: 0.1,
  portfolioDefaultStopLossPct: 0.05,
  portfolioDefaultTakeProfitPct: 0.08,
  portfolioTrailingStopPct: 0.03,
  portfolioAllowAdds: false,
  llmSelectionEnabled: false,
  llmSelectionProvider: "shadow",
  llmSelectionModel: "policy-aware-shadow-reviewer",
  llmSelectionMinConfidence: 0.58
};

const portfolioPolicy = {
  portfolioWeeklyTargetPct: 0.03,
  portfolioExecutionMinConviction: 0.62,
  portfolioMaxWeeklyDrawdownPct: 0.04,
  portfolioMaxPositions: 10,
  portfolioMaxNewPositionsPerCycle: 1,
  portfolioMaxPositionPct: 0.03,
  portfolioMaxGrossExposurePct: 0.35,
  portfolioMaxSectorExposurePct: 0.06,
  portfolioCashReservePct: 0.1,
  portfolioDefaultStopLossPct: 0.05,
  portfolioDefaultTakeProfitPct: 0.08,
  portfolioTrailingStopPct: 0.03,
  portfolioMinHoldHours: 4,
  portfolioAllowAdds: false,
  portfolioAllowReductions: true
};

const trustedEvidenceBreadth = {
  breadth_gate_pass: true,
  usable_signal_items: 2,
  source_count: 2,
  direct_flow_items: 1,
  minimum_items: 2,
  minimum_sources: 2
};

const tradeSetups = {
  as_of: new Date().toISOString(),
  counts: { long: 3, short: 1, watch: 1 },
  setups: [
    {
      ticker: "AAPL",
      company_name: "Apple",
      sector: "Technology",
      action: "long",
      conviction: 0.76,
      setup_label: "confirmed_long",
      position_size_pct: 0.04,
      current_price: 200,
      stop_loss: 188,
      take_profit: 230,
      summary: "AAPL is confirmed long.",
      thesis: ["short-term sentiment is supportive"],
      risk_flags: [],
      evidence: { positive: ["supportive money-flow signal"], negative: [] },
      evidence_breadth: trustedEvidenceBreadth,
      fundamentals: { screen_stage: "eligible", direction_label: "bullish_supportive" },
      score_components: { gap: 0.22 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
    },
    {
      ticker: "MSFT",
      company_name: "Microsoft",
      sector: "Technology",
      action: "long",
      conviction: 0.73,
      setup_label: "confirmed_long",
      position_size_pct: 0.03,
      current_price: 300,
      stop_loss: 282,
      take_profit: 330,
      summary: "MSFT is confirmed long.",
      thesis: ["fundamental direction is supportive"],
      risk_flags: [],
      evidence: { positive: ["recent positive alert"], negative: [] },
      evidence_breadth: trustedEvidenceBreadth,
      fundamentals: { screen_stage: "eligible", direction_label: "bullish_supportive" },
      score_components: { gap: 0.19 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
    },
    {
      ticker: "TSLA",
      company_name: "Tesla",
      sector: "Consumer Discretionary",
      action: "long",
      conviction: 0.68,
      setup_label: "tactical_long",
      position_size_pct: 0.025,
      current_price: 220,
      stop_loss: 205,
      take_profit: 260,
      summary: "TSLA is tactical long.",
      thesis: ["short-term sentiment is supportive"],
      risk_flags: ["earnings_in_window", "supporting evidence quality is thin"],
      evidence: { positive: [], negative: [] },
      evidence_breadth: {
        ...trustedEvidenceBreadth,
        breadth_gate_pass: false,
        usable_signal_items: 0,
        source_count: 0,
        reason: "insufficient signal breadth: 0/2 fresh alert/watch documents and 0/2 independent sources"
      },
      fundamentals: { screen_stage: "eligible", direction_label: "neutral" },
      score_components: { gap: 0.14 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
    },
    {
      ticker: "NVDA",
      company_name: "Nvidia",
      sector: "Technology",
      action: "watch",
      conviction: 0.54,
      setup_label: "bullish_watch",
      position_size_pct: 0,
      current_price: 900,
      summary: "NVDA is a watch item.",
      thesis: ["market regime is supportive"],
      risk_flags: [],
      evidence: { positive: ["supportive money-flow signal"], negative: [] },
      evidence_breadth: trustedEvidenceBreadth,
      fundamentals: { screen_stage: "eligible", direction_label: "bullish_supportive" },
      score_components: { gap: 0.05 },
      runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
    }
  ]
};

const llmSelection = await buildLlmSelectionSnapshot({
  config,
  tradeSetups,
  portfolioPolicy
});

const finalSelection = buildFinalSelectionSnapshot({
  config,
  tradeSetups,
  llmSelection,
  portfolioPolicy,
  riskSnapshot: {
    status: "ok",
    equity: 100000,
    buying_power: 90000,
    gross_exposure_pct: 0.05,
    hard_blocks: [],
    positions: []
  },
  positionMonitor: {
    positions: [],
    position_count: 0,
    open_order_count: 0
  },
  window: "1h",
  limit: 8
});

const apple = finalSelection.candidates.find((candidate) => candidate.ticker === "AAPL");
const microsoft = finalSelection.candidates.find((candidate) => candidate.ticker === "MSFT");
const tesla = finalSelection.candidates.find((candidate) => candidate.ticker === "TSLA");
const nvidia = finalSelection.candidates.find((candidate) => candidate.ticker === "NVDA");

if (!apple?.execution_allowed || apple.setup_for_execution?.position_size_pct !== 0.03 || apple.required_final_conviction !== 0.62) {
  throw new Error("Final selector should promote the strongest aligned candidate and cap position size.");
}

if (finalSelection.portfolio_policy.execution_min_conviction !== 0.62) {
  throw new Error("Final selector should expose the user-editable execution conviction policy.");
}

if (microsoft?.execution_allowed) {
  throw new Error("Final selector should enforce max new positions per cycle.");
}

if (tesla?.execution_allowed || tesla?.agreement !== "llm_demoted") {
  throw new Error("Final selector should hold demoted qualitative reviews for review.");
}

if (nvidia?.execution_allowed || nvidia?.final_action !== "watch") {
  throw new Error("LLM or qualitative support should not promote deterministic watch items to execution.");
}

if (finalSelection.counts.executable !== 1 || !finalSelection.algorithm?.steps?.length) {
  throw new Error("Final selector should expose procedure metadata and executable counts.");
}

if (
  finalSelection.llm_provider !== "shadow" ||
  finalSelection.llm_mode !== "shadow" ||
  !finalSelection.llm_agent ||
  finalSelection.llm_agent.prompt_version !== "llm_selection_committee_v2"
) {
  throw new Error("Final selector should expose top-level and nested LLM review metadata.");
}

if (
  apple.selection_report?.status !== "approved_for_alpaca_preview" ||
  !apple.selection_report?.agent_votes?.length ||
  !apple.selection_report?.evidence_summary?.why_selected?.length ||
  apple.selection_report?.trade_plan?.position_size_pct !== 0.03
) {
  throw new Error("Final selector should expose a per-stock approval report for executable candidates.");
}

if (
  llmSelection.prompt_version !== "llm_selection_committee_v2" ||
  !llmSelection.instructions_summary ||
  !apple.llm_explanation?.evidence_alignment ||
  !apple.llm_explanation?.confidence_reason
) {
  throw new Error("LLM selector should expose the committee prompt version and richer review fields.");
}

const demotionFixture = buildFinalSelectionSnapshot({
  config,
  tradeSetups: {
    as_of: new Date().toISOString(),
    counts: { short: 2 },
    setups: [
      {
        ticker: "GOOD",
        company_name: "Higher Quality Review",
        sector: "Financials",
        action: "short",
        conviction: 0.6,
        setup_label: "tactical_short",
        position_size_pct: 0.02,
        current_price: 100,
        summary: "GOOD is a demoted short fixture.",
        thesis: ["money-flow evidence is skewed to distribution"],
        risk_flags: ["fails the stage-one screener", "runtime reliability reduces conviction by 6%"],
        evidence: { positive: [], negative: ["adverse money-flow signal"] },
        evidence_breadth: trustedEvidenceBreadth,
        evidence_quality: { average_downstream_weight: 0.76, alert_quality_items: 1, weak_quality_items: 0 },
        fundamentals: {
          screen_stage: "reject",
          direction_label: "bearish_headwind",
          composite_fundamental_score: 0.56,
          final_confidence: 0.94
        },
        score_components: { gap: 0.62, raw_short: 0.66, raw_long: 0, short: 0.6, long: 0 },
        runtime_reliability: { status: "healthy", adjustment_multiplier: 0.94 }
      },
      {
        ticker: "THIN",
        company_name: "Thin Evidence Review",
        sector: "Financials",
        action: "short",
        conviction: 0.6,
        setup_label: "tactical_short",
        position_size_pct: 0.02,
        current_price: 100,
        summary: "THIN is a demoted short fixture.",
        thesis: ["money-flow evidence is skewed to distribution"],
        risk_flags: ["fails the stage-one screener", "runtime reliability reduces conviction by 6%"],
        evidence: { positive: [], negative: ["adverse money-flow signal"] },
        evidence_breadth: trustedEvidenceBreadth,
        evidence_quality: { average_downstream_weight: 0.5, alert_quality_items: 0, weak_quality_items: 4 },
        fundamentals: {
          screen_stage: "reject",
          direction_label: "bearish_headwind",
          composite_fundamental_score: 0.28,
          final_confidence: 0.7
        },
        score_components: { gap: 0.42, raw_short: 0.6, raw_long: 0, short: 0.6, long: 0 },
        runtime_reliability: { status: "healthy", adjustment_multiplier: 0.94 }
      }
    ]
  },
  llmSelection: {
    status: "ok",
    mode: "fixture",
    recommendations: [
      { ticker: "GOOD", action: "watch", confidence: 0.58, reviewer: "fixture", concerns: [] },
      { ticker: "THIN", action: "watch", confidence: 0.58, reviewer: "fixture", concerns: [] }
    ]
  },
  portfolioPolicy,
  riskSnapshot: {
    status: "ok",
    equity: 100000,
    buying_power: 90000,
    gross_exposure_pct: 0.05,
    hard_blocks: [],
    positions: []
  },
  positionMonitor: {
    positions: [],
    position_count: 0,
    open_order_count: 0
  },
  window: "1h",
  limit: 2
});

const higherQualityReview = demotionFixture.candidates.find((candidate) => candidate.ticker === "GOOD");
const thinEvidenceReview = demotionFixture.candidates.find((candidate) => candidate.ticker === "THIN");

if (
  !higherQualityReview?.final_score_components?.setup_quality_adjustment ||
  !thinEvidenceReview?.final_score_components?.setup_quality_adjustment
) {
  throw new Error("Final selector should expose score components for review/watch candidates.");
}

if (higherQualityReview.final_conviction <= thinEvidenceReview.final_conviction) {
  throw new Error("Final selector should not flatten demoted candidates with materially different evidence quality.");
}

if (higherQualityReview.final_conviction - thinEvidenceReview.final_conviction < 0.03) {
  throw new Error("Final selector score dispersion should be visible enough to avoid identical-looking review grades.");
}

const openAiGateFixture = buildFinalSelectionSnapshot({
  config: {
    ...config,
    llmSelectionEnabled: true,
    llmSelectionProvider: "openai",
    executionAllowShorts: true,
    portfolioMaxNewPositionsPerCycle: 3,
    portfolioMaxSectorExposurePct: 0.5
  },
  tradeSetups: {
    as_of: new Date().toISOString(),
    counts: { short: 2 },
    setups: [
      {
        ticker: "OPENAI",
        company_name: "Externally Reviewed",
        sector: "Technology",
        action: "short",
        conviction: 0.7,
        position_size_pct: 0.01,
        current_price: 100,
        summary: "OPENAI is externally reviewed.",
        thesis: ["external review fixture"],
        risk_flags: [],
        evidence: { positive: [], negative: ["adverse signal"] },
        evidence_breadth: trustedEvidenceBreadth,
        fundamentals: { screen_stage: "reject", direction_label: "bearish_headwind", composite_fundamental_score: 0.3, final_confidence: 0.9 },
        score_components: { gap: 0.5, raw_short: 0.7, raw_long: 0, short: 0.7, long: 0 },
        runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
      },
      {
        ticker: "LOCAL",
        company_name: "Local Shadow Only",
        sector: "Technology",
        action: "short",
        conviction: 0.7,
        position_size_pct: 0.01,
        current_price: 100,
        summary: "LOCAL is only shadow reviewed.",
        thesis: ["local review fixture"],
        risk_flags: [],
        evidence: { positive: [], negative: ["adverse signal"] },
        evidence_breadth: trustedEvidenceBreadth,
        fundamentals: { screen_stage: "reject", direction_label: "bearish_headwind", composite_fundamental_score: 0.3, final_confidence: 0.9 },
        score_components: { gap: 0.5, raw_short: 0.7, raw_long: 0, short: 0.7, long: 0 },
        runtime_reliability: { status: "healthy", adjustment_multiplier: 1 }
      }
    ]
  },
  llmSelection: {
    status: "ready",
    mode: "openai_json_review",
    provider: "openai",
    model: "gpt-5.5",
    recommendations: [
      { ticker: "OPENAI", action: "short", confidence: 0.72, reviewer: "openai", concerns: [] },
      { ticker: "LOCAL", action: "short", confidence: 0.72, reviewer: "local_shadow", concerns: [] }
    ]
  },
  portfolioPolicy: {
    ...portfolioPolicy,
    portfolioMaxNewPositionsPerCycle: 3,
    portfolioMaxSectorExposurePct: 0.5
  },
  riskSnapshot: {
    status: "ok",
    equity: 100000,
    buying_power: 90000,
    gross_exposure_pct: 0.05,
    hard_blocks: [],
    positions: []
  },
  positionMonitor: {
    positions: [],
    position_count: 0,
    open_order_count: 0
  },
  window: "1h",
  limit: 2
});

const externallyReviewed = openAiGateFixture.candidates.find((candidate) => candidate.ticker === "OPENAI");
const localOnly = openAiGateFixture.candidates.find((candidate) => candidate.ticker === "LOCAL");
if (!externallyReviewed?.execution_allowed || localOnly?.execution_allowed || !localOnly?.reason_codes?.includes("llm_external_review_missing")) {
  throw new Error("Final selector should require an actual OpenAI review before execution when OpenAI selection is enabled.");
}

const workflowTestPreviewFixture = buildFinalSelectionSnapshot({
  config: {
    ...config,
    selectionWorkflowTestMode: true,
    selectionWorkflowTestAllowLlmDemotionPreview: true,
    executionMinConviction: 0.2,
    executionAllowShorts: false,
    llmSelectionEnabled: true,
    llmSelectionProvider: "openai",
    portfolioMaxNewPositionsPerCycle: 3,
    portfolioMaxSectorExposurePct: 0.5
  },
  tradeSetups: {
    as_of: new Date().toISOString(),
    counts: { long: 1 },
    setups: [
      {
        ticker: "TEST",
        company_name: "Workflow Preview Test",
        sector: "Technology",
        action: "long",
        conviction: 0.32,
        position_size_pct: 0.01,
        current_price: 100,
        summary: "TEST is a low-threshold workflow test candidate.",
        thesis: ["workflow test fixture"],
        risk_flags: ["workflow test mode lowered selection thresholds for supervised end-to-end testing"],
        evidence: { positive: ["fresh workflow fixture signal"], negative: [] },
        evidence_breadth: trustedEvidenceBreadth,
        fundamentals: { screen_stage: "eligible", direction_label: "bullish_supportive", composite_fundamental_score: 0.55, final_confidence: 0.9 },
        score_components: { gap: 0.25, raw_long: 0.36, raw_short: 0, long: 0.32, short: 0 },
        runtime_reliability: { status: "healthy", adjustment_multiplier: 1, test_mode: true }
      }
    ]
  },
  llmSelection: {
    status: "ready",
    mode: "openai_json_review",
    provider: "openai",
    model: "gpt-5.5",
    recommendations: [
      {
        ticker: "TEST",
        action: "watch",
        confidence: 0.56,
        reviewer: "openai",
        rationale: "OpenAI demoted the low-threshold test candidate to watch.",
        concerns: ["workflow test candidate"],
        evidence_alignment: "Evidence is intentionally thin for a path test.",
        confidence_reason: "Review confidence is watch-level."
      }
    ]
  },
  portfolioPolicy: {
    ...portfolioPolicy,
    portfolioExecutionMinConviction: 0.2,
    portfolioMaxNewPositionsPerCycle: 3,
    portfolioMaxSectorExposurePct: 0.5
  },
  riskSnapshot: {
    status: "ok",
    equity: 100000,
    buying_power: 90000,
    gross_exposure_pct: 0.05,
    hard_blocks: [],
    positions: []
  },
  positionMonitor: {
    positions: [],
    position_count: 0,
    open_order_count: 0
  },
  window: "1h",
  limit: 1
});

const workflowTestPreview = workflowTestPreviewFixture.candidates.find((candidate) => candidate.ticker === "TEST");
if (
  !workflowTestPreview?.execution_allowed ||
  workflowTestPreview.selection_report?.status !== "workflow_test_preview" ||
  !workflowTestPreview.reason_codes?.includes("workflow_test_llm_demotion_preview")
) {
  throw new Error("Final selector should expose an explicit test-only preview path without changing production LLM-demotion behavior.");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      executable: finalSelection.counts.executable,
      final_buy: finalSelection.counts.final_buy,
      review: finalSelection.counts.review,
      llm_mode: finalSelection.llm_agent.mode,
      llm_prompt_version: llmSelection.prompt_version,
      top_candidate: apple.ticker,
      report_status: apple.selection_report.status,
      score_dispersion_ok: true,
      microsoft_reason: microsoft.reason_codes[0]
    },
    null,
    2
  )
);
