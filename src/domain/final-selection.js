import { clamp, round } from "../utils/helpers.js";
import { buildPolicyAdjustedSetup } from "./portfolio-policy.js";

function isTradable(action) {
  return action === "long" || action === "short";
}

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
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

function baseDecision(setup, llm, config) {
  const deterministicAction = setup.action;
  const llmAction = llm?.action || "watch";
  const agreement = agreementStatus(deterministicAction, llmAction);
  const deterministicConviction = Number(setup.conviction || 0);
  const llmConfidence = Number(llm?.confidence || 0);
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
  const runtimePenalty = clamp(1 - runtimeMultiplier, 0, 0.35);
  const riskFlagPenalty = Math.min(0.12, (setup.risk_flags || []).length * 0.015);
  const score = clamp(
    deterministicConviction * 0.62 + llmConfidence * 0.28 + agreementBonus - runtimePenalty - riskFlagPenalty,
    0,
    0.99
  );

  let finalAction = "watch";
  let executionAllowed = false;
  const reasonCodes = [];

  if (agreement === "agree" && isTradable(deterministicAction)) {
    finalAction = deterministicAction;
    executionAllowed = score >= Number(config.executionMinConviction || 0.62);
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
    agreement,
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

function buildDeterministicExplanation(setup) {
  return {
    action: setup.action,
    conviction: setup.conviction,
    summary: setup.summary,
    thesis: setup.thesis || [],
    positive_evidence: setup.evidence?.positive || [],
    negative_evidence: setup.evidence?.negative || [],
    risk_flags: setup.risk_flags || [],
    score_components: setup.score_components || null
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
    const decision = baseDecision(setup, llm, config);
    const sizePct = round(
      clamp(
        Number(setup.position_size_pct || 0),
        0,
        Math.min(Number(portfolioPolicy.portfolioMaxPositionPct || 0.03), Number(config.executionMaxPositionPct || 0.03))
      ),
      4
    );
    const policyGates = [
      policyGate("risk_manager", !riskBlocked, riskBlocked ? "Risk Manager is blocking new execution." : "Risk Manager is not hard-blocking.", riskSnapshot?.status || "unknown", "not_blocked"),
      policyGate("single_position_size", sizePct <= Number(portfolioPolicy.portfolioMaxPositionPct || 0.03), "Position size is inside the policy cap.", sizePct, portfolioPolicy.portfolioMaxPositionPct)
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
