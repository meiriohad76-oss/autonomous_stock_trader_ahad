import { clamp, normalizeTickerSymbol, round } from "../utils/helpers.js";
import { buildPolicyAdjustedSetup } from "./portfolio-policy.js";

function isTradable(action) {
  return action === "long" || action === "short";
}

function normalizeTicker(value) {
  return normalizeTickerSymbol(value);
}

function agreementStatus(deterministicAction, llmAction) {
  if (deterministicAction === llmAction) {
    return "agree";
  }
  if (isTradable(deterministicAction) && isTradable(llmAction)) {
    return "direction_conflict";
  }
  if (isTradable(deterministicAction) && !isTradable(llmAction)) {
    return "llm_demoted";
  }
  if (!isTradable(deterministicAction) && isTradable(llmAction)) {
    return "llm_promoted_without_rules";
  }
  return "both_non_tradable";
}

function effectiveExecutionMinConviction(config, portfolioPolicy) {
  return Number(portfolioPolicy?.portfolioExecutionMinConviction ?? config.executionMinConviction ?? 0.62);
}

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function directionSupportAdjustment(setup, action) {
  const direction = setup.fundamentals?.direction_label || "";
  if (action === "long") {
    if (direction === "bullish_supportive") return 0.012;
    if (direction === "bearish_headwind") return -0.018;
  }
  if (action === "short") {
    if (direction === "bearish_headwind") return 0.012;
    if (direction === "bullish_supportive") return -0.018;
  }
  return 0;
}

function setupQualityAdjustment(setup, action, deterministicConviction) {
  const scoreComponents = setup.score_components || {};
  const evidenceQuality = setup.evidence_quality || {};
  const fundamentals = setup.fundamentals || {};
  const rawDirectionalScore = finiteNumber(
    action === "long"
      ? scoreComponents.raw_long ?? scoreComponents.long
      : action === "short"
        ? scoreComponents.raw_short ?? scoreComponents.short
        : scoreComponents.gap,
    deterministicConviction
  );
  const gap = finiteNumber(scoreComponents.gap, 0);
  const evidenceWeight = finiteNumber(evidenceQuality.average_downstream_weight, null);
  const weakQualityItems = finiteNumber(evidenceQuality.weak_quality_items, 0);
  const alertQualityItems = finiteNumber(evidenceQuality.alert_quality_items, 0);
  const fundamentalConfidence = finiteNumber(fundamentals.final_confidence, null);
  const fundamentalComposite = finiteNumber(fundamentals.composite_fundamental_score, null);

  const directionalScoreAdjustment = clamp((rawDirectionalScore - deterministicConviction) * 0.12, -0.025, 0.025);
  const gapAdjustment = clamp((gap - 0.35) * 0.035, -0.015, 0.018);
  const evidenceWeightAdjustment =
    evidenceWeight === null ? 0 : clamp((evidenceWeight - 0.62) * 0.08, -0.025, 0.025);
  const evidenceTierAdjustment = clamp(alertQualityItems * 0.006 - weakQualityItems * 0.004, -0.02, 0.02);
  const fundamentalConfidenceAdjustment =
    fundamentalConfidence === null ? 0 : clamp((fundamentalConfidence - 0.8) * 0.05, -0.02, 0.02);
  const fundamentalCompositeAdjustment =
    fundamentalComposite === null ? 0 : clamp((fundamentalComposite - 0.5) * 0.04, -0.025, 0.025);
  const directionAdjustment = directionSupportAdjustment(setup, action);
  const total = clamp(
    directionalScoreAdjustment +
      gapAdjustment +
      evidenceWeightAdjustment +
      evidenceTierAdjustment +
      fundamentalConfidenceAdjustment +
      fundamentalCompositeAdjustment +
      directionAdjustment,
    -0.06,
    0.06
  );

  return {
    total: round(total, 4),
    directional_score: round(directionalScoreAdjustment, 4),
    score_gap: round(gapAdjustment, 4),
    evidence_weight: round(evidenceWeightAdjustment, 4),
    evidence_tier: round(evidenceTierAdjustment, 4),
    fundamental_confidence: round(fundamentalConfidenceAdjustment, 4),
    fundamental_composite: round(fundamentalCompositeAdjustment, 4),
    direction_support: round(directionAdjustment, 4)
  };
}

function baseDecision(setup, llm, config, portfolioPolicy) {
  const deterministicAction = setup.action;
  const llmAction = llm?.action || "watch";
  const agreement = agreementStatus(deterministicAction, llmAction);
  const deterministicConviction = Number(setup.conviction || 0);
  const llmConfidence = Number(llm?.confidence || 0);
  const requiredFinalConviction = effectiveExecutionMinConviction(config, portfolioPolicy);
  const agreementBonus = agreement === "agree" && isTradable(deterministicAction)
    ? 0.07
    : agreement === "direction_conflict"
      ? -0.18
      : agreement === "llm_demoted"
        ? -0.09
        : agreement === "llm_promoted_without_rules"
          ? -0.12
          : 0;
  const runtimeMultiplier = Number(setup.runtime_reliability?.adjustment_multiplier || 1);
  const rawRuntimePenalty = clamp(1 - runtimeMultiplier, 0, 0.35);
  const rawRiskFlagPenalty = Math.min(0.12, (setup.risk_flags || []).length * 0.015);
  const runtimePenalty = config.selectionWorkflowTestMode
    ? Math.min(rawRuntimePenalty, Number(config.selectionWorkflowTestMaxRuntimePenalty || 0.04))
    : rawRuntimePenalty;
  const riskFlagPenalty = config.selectionWorkflowTestMode
    ? Math.min(rawRiskFlagPenalty, Number(config.selectionWorkflowTestMaxRiskPenalty || 0.03))
    : rawRiskFlagPenalty;
  const qualityAdjustment = setupQualityAdjustment(setup, deterministicAction, deterministicConviction);
  const baseScore = deterministicConviction * 0.62 + llmConfidence * 0.28;
  const score = clamp(
    baseScore + agreementBonus + qualityAdjustment.total - runtimePenalty - riskFlagPenalty,
    0,
    0.99
  );

  let finalAction = "watch";
  let executionAllowed = false;
  const reasonCodes = [];

  if (agreement === "agree" && isTradable(deterministicAction)) {
    finalAction = deterministicAction;
    executionAllowed = score >= requiredFinalConviction;
    if (!executionAllowed) {
      reasonCodes.push("final_score_below_execution_minimum");
    }
  } else if (agreement === "llm_demoted" || agreement === "direction_conflict") {
    finalAction = "review";
    reasonCodes.push(agreement);
  } else if (agreement === "llm_promoted_without_rules") {
    finalAction = "watch";
    reasonCodes.push("llm_cannot_override_deterministic_no_trade");
  } else if (deterministicAction === "watch" || llmAction === "watch") {
    finalAction = "watch";
  } else {
    finalAction = "no_trade";
  }

  if (deterministicAction === "short" && !config.executionAllowShorts) {
    finalAction = executionAllowed ? "review" : finalAction;
    executionAllowed = false;
    reasonCodes.push("short_trading_disabled");
  }

  return {
    final_action: finalAction,
    execution_allowed: executionAllowed,
    final_conviction: round(score, 3),
    required_final_conviction: round(requiredFinalConviction, 3),
    final_conviction_gap: round(Math.max(0, requiredFinalConviction - score), 3),
    agreement,
    final_score_components: {
      deterministic: round(deterministicConviction * 0.62, 4),
      llm: round(llmConfidence * 0.28, 4),
      base: round(baseScore, 4),
      agreement_bonus: round(agreementBonus, 4),
      setup_quality_adjustment: qualityAdjustment,
      runtime_penalty: round(runtimePenalty, 4),
      raw_runtime_penalty: round(rawRuntimePenalty, 4),
      risk_flag_penalty: round(riskFlagPenalty, 4),
      raw_risk_flag_penalty: round(rawRiskFlagPenalty, 4),
      workflow_test_mode: Boolean(config.selectionWorkflowTestMode)
    },
    reason_codes: reasonCodes
  };
}

function policyGate(key, pass, detail, value = null, limit = null) {
  return { key, pass, detail, value, limit };
}

function policyReason(candidate) {
  const blocked = candidate.policy_gates.filter((gate) => !gate.pass);
  if (candidate.execution_allowed) {
    return `${candidate.ticker} is final-selected because both selectors align and portfolio policy allows the size.`;
  }
  if (blocked.length) {
    return `${candidate.ticker} is held for review because ${blocked[0].detail}`;
  }
  if (candidate.agreement === "llm_demoted") {
    return `${candidate.ticker} needs review because the LLM lane demoted the deterministic trade.`;
  }
  if (candidate.agreement === "llm_promoted_without_rules") {
    return `${candidate.ticker} stays on watch because the LLM lane cannot promote a deterministic no-trade setup by itself.`;
  }
  if (candidate.agreement === "direction_conflict") {
    return `${candidate.ticker} needs review because the two selectors disagree on direction.`;
  }
  return `${candidate.ticker} is not an executable final selection right now.`;
}

function uniqueStrings(items, limit = 8) {
  return [...new Set((items || []).filter(Boolean).map((item) => String(item)))].slice(0, limit);
}

function reportStatus(candidate) {
  if (candidate.execution_allowed && isTradable(candidate.final_action)) {
    return "approved_for_alpaca_preview";
  }
  if (candidate.final_action === "review") {
    return "requires_human_review";
  }
  if (candidate.final_action === "watch") {
    return "watch_only";
  }
  return "not_selected";
}

function agentVote(agent, status, result, evidence = null, detail = null) {
  return { agent, status, result, evidence, detail };
}

function passedOrReview(condition, reviewStatus = "review") {
  return condition ? "passed" : reviewStatus;
}

function evidencePhrase(setup = {}) {
  const positiveCount = setup.evidence?.positive?.length || 0;
  const negativeCount = setup.evidence?.negative?.length || 0;
  const quality = setup.evidence_quality?.label || setup.evidence_quality?.status || null;
  return `${positiveCount} positive / ${negativeCount} negative evidence item(s)${quality ? `, ${quality}` : ""}.`;
}

function buildSelectionReport(candidate, { portfolioPolicy, riskSnapshot, positionMonitor, config }) {
  const setup = candidate.setup || {};
  const deterministic = candidate.deterministic_explanation || {};
  const llm = candidate.llm_explanation || {};
  const failedGates = candidate.policy_gates.filter((gate) => !gate.pass);
  const approved = candidate.execution_allowed && isTradable(candidate.final_action);
  const adjustedSetup = candidate.setup_for_execution || {};
  const stopLoss = adjustedSetup.stop_loss ?? setup.stop_loss ?? null;
  const takeProfit = adjustedSetup.take_profit ?? setup.take_profit ?? null;
  const currentPrice = adjustedSetup.current_price ?? setup.current_price ?? null;
  const equity = Number(riskSnapshot?.equity || positionMonitor?.account?.equity || config.executionDefaultEquityUsd || 0);
  const estimatedNotional = equity && candidate.position_size_pct ? round(equity * Number(candidate.position_size_pct || 0), 2) : null;
  const llmReviewer = llm?.reviewer || (llm?.action ? "external_or_shadow_reviewer" : "unavailable");

  const whySelected = uniqueStrings(
    [
      candidate.final_reason,
      approved ? "Deterministic and LLM selection lanes agree on a tradable action." : null,
      approved ? "Portfolio policy gates passed for this cycle." : null,
      setup.fundamentals?.screen_stage ? `Fundamentals stage: ${setup.fundamentals.screen_stage}.` : null,
      setup.macro_regime?.regime_label ? `Market regime: ${setup.macro_regime.regime_label}.` : null,
      setup.summary,
      llm.evidence_alignment,
      llm.confidence_reason,
      ...(deterministic.thesis || []),
      ...(llm.supporting_factors || [])
    ],
    10
  );

  const concerns = uniqueStrings(
    [
      ...(deterministic.risk_flags || []),
      ...(deterministic.negative_evidence || []),
      ...(llm.concerns || []),
      llm.risk_assessment,
      ...(llm.missing_data || []).map((item) => `Missing/weak data: ${item}`),
      ...failedGates.map((gate) => gate.detail),
      candidate.final_conviction_gap ? `Final conviction is short by ${round(candidate.final_conviction_gap * 100, 1)} percentage points.` : null
    ],
    10
  );

  return {
    ticker: candidate.ticker,
    company_name: candidate.company_name,
    sector: candidate.sector,
    generated_at: new Date().toISOString(),
    status: reportStatus(candidate),
    title: `${candidate.ticker} Selection Report`,
    headline: approved
      ? `${candidate.ticker} passed Final Selection and is ready for supervised Alpaca preview.`
      : `${candidate.ticker} did not pass every gate for execution yet.`,
    executive_summary: approved
      ? `${candidate.ticker} is selected because the deterministic selector and LLM lane agree on ${candidate.final_action}, final conviction is ${round(candidate.final_conviction * 100, 1)}%, and portfolio policy currently allows the proposed size.`
      : `${candidate.ticker} is visible for review because the workflow produced evidence, but ${candidate.final_reason}`,
    approval_scope: "This report approves only a supervised paper-trade preview. Alpaca submission still requires explicit user approval.",
    agent_votes: [
      agentVote("Universe Agent", "passed", "Inside allowed universe", "Candidate came from the S&P 100 + QQQ workflow boundary."),
      agentVote(
        "Fundamentals Agent",
        passedOrReview(setup.fundamentals?.screen_stage === "eligible"),
        setup.fundamentals?.screen_stage || "unknown",
        setup.fundamentals?.direction_label || "No fundamentals direction label available.",
        setup.fundamentals?.summary || null
      ),
      agentVote(
        "Market Agent",
        setup.macro_regime?.regime_label ? "passed" : "review",
        setup.macro_regime?.regime_label || "unknown",
        setup.macro_regime?.bias_label || setup.macro_regime?.summary || "No market-regime label available."
      ),
      agentVote("Signals Agent", (setup.evidence?.positive || []).length ? "passed" : "review", evidencePhrase(setup), uniqueStrings(setup.evidence?.positive, 3).join(" | ") || "No positive signal summary available."),
      agentVote("Deterministic Selection Agent", isTradable(candidate.deterministic_action) ? "passed" : "review", candidate.deterministic_action, `${round(Number(candidate.deterministic_conviction || 0) * 100, 1)}% conviction.`),
      agentVote("LLM Selection Agent", candidate.agreement === "agree" ? "passed" : "review", candidate.llm_action, `${llmReviewer}; ${round(Number(candidate.llm_confidence || 0) * 100, 1)}% confidence.`),
      agentVote("Final Selection Agent", approved ? "passed" : "review", candidate.final_action, `${round(Number(candidate.final_conviction || 0) * 100, 1)}% final conviction; ${round(Number(candidate.required_final_conviction || 0) * 100, 1)}% required.`),
      agentVote("Risk Manager", riskSnapshot?.status === "blocked" ? "blocked" : "passed", riskSnapshot?.status || "not_blocked", failedGates.length ? failedGates[0].detail : "No hard risk block is active."),
      agentVote("Execution Agent", approved ? "ready_for_preview" : "gated", approved ? "Alpaca preview can be prepared" : "Not ready for Alpaca preview", "No order is submitted automatically.")
    ],
    scoring: {
      deterministic_conviction: candidate.deterministic_conviction,
      llm_confidence: candidate.llm_confidence,
      final_conviction: candidate.final_conviction,
      required_final_conviction: candidate.required_final_conviction,
      final_conviction_gap: candidate.final_conviction_gap,
      agreement: candidate.agreement,
      components: candidate.final_score_components
    },
    evidence_summary: {
      why_selected: whySelected,
      concerns,
      recent_documents: (setup.recent_documents || []).slice(0, 5).map((doc) => ({
        headline: doc.headline,
        source_name: doc.source_name,
        published_at: doc.published_at,
        event_type: doc.event_type,
        confidence: doc.confidence
      }))
    },
    policy_gates: candidate.policy_gates.map((gate) => ({
      key: gate.key,
      pass: gate.pass,
      detail: gate.detail,
      value: gate.value,
      limit: gate.limit
    })),
    trade_plan: {
      action: candidate.final_action,
      side: candidate.final_action === "long" ? "buy" : candidate.final_action === "short" ? "sell_short" : "none",
      position_size_pct: candidate.position_size_pct,
      estimated_notional_usd: estimatedNotional,
      current_price: currentPrice,
      entry_zone: adjustedSetup.entry_zone || setup.entry_zone || null,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      stop_loss_pct: portfolioPolicy.portfolioDefaultStopLossPct,
      take_profit_pct: portfolioPolicy.portfolioDefaultTakeProfitPct
    }
  };
}

function buildDeterministicExplanation(setup) {
  return {
    action: setup.action,
    conviction: setup.conviction,
    summary: setup.summary,
    thesis: setup.thesis || [],
    positive_evidence: setup.evidence?.positive || [],
    negative_evidence: setup.evidence?.negative || [],
    risk_flags: setup.risk_flags || [],
    score_components: setup.score_components || null,
    decision_thresholds: setup.decision_thresholds || null,
    decision_blockers: setup.decision_blockers || []
  };
}

function existingPositionSymbols(positionMonitor = {}) {
  return new Set((positionMonitor.positions || []).map((position) => normalizeTicker(position.symbol)));
}

function currentPositionCount(positionMonitor = {}, riskSnapshot = {}) {
  return Number(positionMonitor.position_count ?? riskSnapshot.positions?.length ?? 0);
}

function currentOpenOrderCount(positionMonitor = {}, riskSnapshot = {}) {
  return Number(positionMonitor.open_order_count ?? riskSnapshot.open_orders ?? 0);
}

function buildInitialCandidates({ tradeSetups, llmSelection, portfolioPolicy, riskSnapshot, positionMonitor, config }) {
  const llmByTicker = new Map((llmSelection?.recommendations || []).map((item) => [item.ticker, item]));
  const riskBlocked = riskSnapshot?.status === "blocked" || Boolean(riskSnapshot?.hard_blocks?.length);

  return (tradeSetups?.setups || []).map((setup) => {
    const llm = llmByTicker.get(setup.ticker) || null;
    const decision = baseDecision(setup, llm, config, portfolioPolicy);
    const sizePct = round(
      clamp(
        Number(setup.position_size_pct || 0),
        0,
        Math.min(Number(portfolioPolicy.portfolioMaxPositionPct || 0.03), Number(config.executionMaxPositionPct || 0.03))
      ),
      4
    );
    const finalConvictionGateApplies = isTradable(decision.final_action);
    const policyGates = [
      policyGate("risk_manager", !riskBlocked, riskBlocked ? "Risk Manager is blocking new execution." : "Risk Manager is not hard-blocking.", riskSnapshot?.status || "unknown", "not_blocked"),
      policyGate("single_position_size", sizePct <= Number(portfolioPolicy.portfolioMaxPositionPct || 0.03), "Position size is inside the policy cap.", sizePct, portfolioPolicy.portfolioMaxPositionPct),
      policyGate(
        "final_conviction_minimum",
        !finalConvictionGateApplies || decision.final_conviction >= decision.required_final_conviction,
        finalConvictionGateApplies
          ? "Final conviction must clear the user policy minimum."
          : "Final conviction minimum applies only to final buy/sell candidates.",
        decision.final_conviction,
        decision.required_final_conviction
      )
    ];

    return {
      ticker: setup.ticker,
      company_name: setup.company_name,
      sector: setup.sector || "Unknown",
      deterministic_action: setup.action,
      deterministic_conviction: setup.conviction,
      llm_action: llm?.action || "unavailable",
      llm_confidence: llm?.confidence ?? null,
      final_action: decision.final_action,
      final_conviction: decision.final_conviction,
      required_final_conviction: decision.required_final_conviction,
      final_conviction_gap: decision.final_conviction_gap,
      final_score_components: decision.final_score_components,
      execution_allowed: decision.execution_allowed && !riskBlocked,
      agreement: decision.agreement,
      reason_codes: [...decision.reason_codes],
      policy_gates: policyGates,
      position_size_pct: sizePct,
      deterministic_explanation: buildDeterministicExplanation(setup),
      llm_explanation: llm,
      setup
    };
  });
}

function applyPortfolioProcedure({ candidates, portfolioPolicy, riskSnapshot, positionMonitor, config }) {
  const existingSymbols = existingPositionSymbols(positionMonitor);
  const positionCount = currentPositionCount(positionMonitor, riskSnapshot);
  const openOrderCount = currentOpenOrderCount(positionMonitor, riskSnapshot);
  const equity = Math.max(1, Number(riskSnapshot?.equity || positionMonitor?.account?.equity || config.executionDefaultEquityUsd || 1));
  const buyingPowerPct = Number(riskSnapshot?.buying_power || positionMonitor?.account?.buying_power || equity) / equity;
  const reservePct = Number(portfolioPolicy.portfolioCashReservePct || 0);
  const maxNew = Number(portfolioPolicy.portfolioMaxNewPositionsPerCycle || 0);
  const maxPositions = Number(portfolioPolicy.portfolioMaxPositions || 0);
  const maxGross = Number(portfolioPolicy.portfolioMaxGrossExposurePct || config.riskMaxGrossExposurePct || 0.35);
  const maxSector = Number(portfolioPolicy.portfolioMaxSectorExposurePct || 0.18);
  let remainingNew = Math.max(0, maxNew);
  let remainingSlots = Math.max(0, maxPositions - positionCount - openOrderCount);
  let projectedGrossPct = Number(riskSnapshot?.gross_exposure_pct || 0);
  const sectorProjectedPct = new Map();

  return [...candidates]
    .sort((a, b) => {
      const executableDelta = Number(b.execution_allowed) - Number(a.execution_allowed);
      if (executableDelta !== 0) {
        return executableDelta;
      }
      return b.final_conviction - a.final_conviction;
    })
    .map((candidate) => {
      const next = { ...candidate, policy_gates: [...candidate.policy_gates], reason_codes: [...candidate.reason_codes] };
      const isNewPosition = !existingSymbols.has(next.ticker);
      const sectorKey = next.sector || "Unknown";
      const projectedSector = Number(sectorProjectedPct.get(sectorKey) || 0) + Number(next.position_size_pct || 0);

      if (next.execution_allowed && isNewPosition && remainingSlots <= 0) {
        next.execution_allowed = false;
        next.final_action = "review";
        next.reason_codes.push("portfolio_position_capacity_full");
        next.policy_gates.push(policyGate("position_capacity", false, "the portfolio has no open position slots.", positionCount, maxPositions));
      }

      if (next.execution_allowed && isNewPosition && remainingNew <= 0) {
        next.execution_allowed = false;
        next.final_action = "review";
        next.reason_codes.push("max_new_positions_per_cycle_reached");
        next.policy_gates.push(policyGate("new_positions_per_cycle", false, "the cycle already used its new-position allowance.", maxNew, maxNew));
      }

      if (next.execution_allowed && existingSymbols.has(next.ticker) && !portfolioPolicy.portfolioAllowAdds) {
        next.execution_allowed = false;
        next.final_action = "review";
        next.reason_codes.push("adds_disabled_by_policy");
        next.policy_gates.push(policyGate("allow_adds", false, "policy does not allow adding to existing positions.", false, true));
      }

      if (next.execution_allowed && next.final_action === "long" && buyingPowerPct - Number(next.position_size_pct || 0) < reservePct) {
        next.execution_allowed = false;
        next.final_action = "review";
        next.reason_codes.push("cash_reserve_policy");
        next.policy_gates.push(policyGate("cash_reserve", false, "the long trade would push cash reserve below policy.", round(buyingPowerPct, 4), reservePct));
      }

      if (next.execution_allowed && projectedGrossPct + Number(next.position_size_pct || 0) > maxGross) {
        next.execution_allowed = false;
        next.final_action = "review";
        next.reason_codes.push("gross_exposure_policy");
        next.policy_gates.push(policyGate("gross_exposure", false, "the trade would exceed max gross exposure.", round(projectedGrossPct + Number(next.position_size_pct || 0), 4), maxGross));
      }

      if (next.execution_allowed && projectedSector > maxSector) {
        next.execution_allowed = false;
        next.final_action = "review";
        next.reason_codes.push("sector_exposure_policy");
        next.policy_gates.push(policyGate("sector_exposure", false, `${sectorKey} would exceed max sector exposure for this cycle.`, round(projectedSector, 4), maxSector));
      }

      if (next.execution_allowed) {
        if (isNewPosition) {
          remainingNew -= 1;
          remainingSlots -= 1;
        }
        projectedGrossPct += Number(next.position_size_pct || 0);
        sectorProjectedPct.set(sectorKey, projectedSector);
        next.policy_gates.push(policyGate("final_capacity", true, "portfolio capacity is available for this selection."));
      }

      next.reason_codes = [...new Set(next.reason_codes)];
      next.final_reason = policyReason(next);
      next.setup_for_execution = next.execution_allowed
        ? buildPolicyAdjustedSetup(next.setup, portfolioPolicy, {
            finalAction: next.final_action,
            finalConviction: next.final_conviction
          })
        : null;
      next.selection_report = buildSelectionReport(next, {
        portfolioPolicy,
        riskSnapshot,
        positionMonitor,
        config
      });

      return next;
    });
}

export function buildFinalSelectionSnapshot({
  config,
  tradeSetups,
  llmSelection,
  portfolioPolicy,
  riskSnapshot = null,
  positionMonitor = null,
  window = "1h",
  limit = 12
} = {}) {
  const initialCandidates = buildInitialCandidates({
    tradeSetups,
    llmSelection,
    portfolioPolicy,
    riskSnapshot,
    positionMonitor,
    config
  });
  const candidates = applyPortfolioProcedure({
    candidates: initialCandidates,
    portfolioPolicy,
    riskSnapshot,
    positionMonitor,
    config
  }).slice(0, limit);

  return {
    as_of: new Date().toISOString(),
    window,
    algorithm: {
      name: "dual_selector_policy_arbitration",
      steps: [
        "Allowed universe and freshness gates must already be satisfied by upstream agents.",
        "Deterministic Selection remains the primary scoring and safety engine.",
        "LLM Selection reviews the same evidence pack in parallel and must explain support, concerns, and disagreements.",
        "Final Selection promotes only candidates where deterministic and LLM lanes agree, then applies portfolio policy caps.",
        "LLM-only promotions become watch/review items; they cannot go to execution without deterministic agreement.",
        "Risk Manager and Alpaca Execution still run after Final Selection; no order is auto-submitted."
      ],
      score_weights: {
        deterministic: 0.62,
        llm: 0.28,
        agreement_bonus: 0.07,
        setup_quality_adjustment: "up to +/-0.06 from score gap, evidence quality, fundamentals, and directional support",
        disagreement_penalties: "0.09 to 0.18",
        runtime_and_risk_penalties: "dynamic"
      }
    },
    deterministic_agent: {
      as_of: tradeSetups?.as_of || null,
      counts: tradeSetups?.counts || {},
      summary: "Rules-based selector using fundamentals, market regime, signals, money flow, alerts, runtime reliability, and price plan."
    },
    llm_agent: {
      status: llmSelection?.status || "unavailable",
      mode: llmSelection?.mode || "unavailable",
      provider: llmSelection?.provider || null,
      model: llmSelection?.model || null,
      counts: llmSelection?.counts || {}
    },
    portfolio_policy: {
      max_positions: portfolioPolicy.portfolioMaxPositions,
      max_new_positions_per_cycle: portfolioPolicy.portfolioMaxNewPositionsPerCycle,
      max_position_pct: portfolioPolicy.portfolioMaxPositionPct,
      execution_min_conviction: portfolioPolicy.portfolioExecutionMinConviction,
      max_gross_exposure_pct: portfolioPolicy.portfolioMaxGrossExposurePct,
      max_sector_exposure_pct: portfolioPolicy.portfolioMaxSectorExposurePct,
      cash_reserve_pct: portfolioPolicy.portfolioCashReservePct,
      default_stop_loss_pct: portfolioPolicy.portfolioDefaultStopLossPct,
      default_take_profit_pct: portfolioPolicy.portfolioDefaultTakeProfitPct,
      allow_adds: portfolioPolicy.portfolioAllowAdds
    },
    counts: {
      final_buy: candidates.filter((item) => item.execution_allowed && item.final_action === "long").length,
      final_sell: candidates.filter((item) => item.execution_allowed && item.final_action === "short").length,
      review: candidates.filter((item) => item.final_action === "review").length,
      watch: candidates.filter((item) => item.final_action === "watch").length,
      no_trade: candidates.filter((item) => item.final_action === "no_trade").length,
      executable: candidates.filter((item) => item.execution_allowed).length,
      visible: candidates.length
    },
    candidates
  };
}
