import { clamp, round } from "../utils/helpers.js";

function isTradable(action) {
  return action === "long" || action === "short";
}

function runtimeStatusNeedsConcern(status) {
  return Boolean(status && !["healthy", "optimal"].includes(status));
}

function confidenceDeltaFromSetup(setup) {
  let delta = 0;
  const fundamentals = setup.fundamentals || {};
  const evidence = setup.evidence || {};
  const runtime = setup.runtime_reliability || {};

  if (fundamentals.screen_stage === "eligible") {
    delta += 0.035;
  }
  if (fundamentals.direction_label === "bullish_supportive" && setup.action === "long") {
    delta += 0.025;
  }
  if (fundamentals.direction_label === "bearish_headwind" && setup.action === "short") {
    delta += 0.025;
  }
  if ((evidence.positive || []).some((item) => /flow|accumulation|insider|institutional/i.test(item))) {
    delta += setup.action === "long" ? 0.025 : -0.015;
  }
  if ((evidence.negative || []).some((item) => /flow|distribution|selling/i.test(item))) {
    delta += setup.action === "short" ? 0.025 : -0.02;
  }
  if ((setup.risk_flags || []).length >= 3) {
    delta -= 0.04;
  }
  if ((setup.risk_flags || []).some((item) => /earnings|runtime|quality|stretched/i.test(item))) {
    delta -= 0.03;
  }
  if (runtime.constrained || Number(runtime.penalty || 0) >= 0.15) {
    delta -= 0.035;
  }

  return delta;
}

function qualitativeAction(setup, config) {
  const deterministicAction = setup.action;
  const confidence = clamp(Number(setup.conviction || 0) + confidenceDeltaFromSetup(setup), 0, 0.96);
  const fundamentals = setup.fundamentals || {};
  const riskFlags = setup.risk_flags || [];
  const scoreGap = Number(setup.score_components?.gap || 0);

  if (!isTradable(deterministicAction)) {
    return {
      action: deterministicAction === "watch" ? "watch" : "no_trade",
      confidence: round(Math.min(confidence, 0.64), 3)
    };
  }

  if (deterministicAction === "long" && fundamentals.screen_stage === "reject") {
    return { action: "watch", confidence: round(Math.min(confidence, 0.58), 3) };
  }

  if (riskFlags.some((item) => /earnings_in_window|source health|runtime reliability|quality is thin/i.test(item))) {
    return { action: "watch", confidence: round(Math.min(confidence, 0.61), 3) };
  }

  if (scoreGap < 0.08 || confidence < Number(config.llmSelectionMinConfidence || 0.58)) {
    return { action: "watch", confidence: round(confidence, 3) };
  }

  return {
    action: deterministicAction,
    confidence: round(confidence, 3)
  };
}

function summarizeSupport(setup) {
  const support = [
    ...(setup.thesis || []),
    ...(setup.evidence?.positive || []),
    ...(setup.evidence?.negative || [])
  ].filter(Boolean);

  if (setup.fundamentals?.screen_stage) {
    support.unshift(`fundamentals screen is ${setup.fundamentals.screen_stage}`);
  }
  if (setup.macro_regime?.regime_label) {
    support.unshift(`market regime is ${setup.macro_regime.regime_label}`);
  }

  return [...new Set(support)].slice(0, 5);
}

function summarizeConcerns(setup, llmAction) {
  const concerns = [...(setup.risk_flags || [])];

  if (setup.action !== llmAction) {
    concerns.unshift(`qualitative review demoted deterministic ${setup.action} to ${llmAction}`);
  }
  if (!setup.recent_documents?.length) {
    concerns.push("limited recent ticker-level evidence");
  }
  if (runtimeStatusNeedsConcern(setup.runtime_reliability?.status)) {
    concerns.push(`runtime status is ${setup.runtime_reliability.status}`);
  }

  return [...new Set(concerns)].slice(0, 5);
}

function rationaleFor(setup, recommendation) {
  if (recommendation.action === setup.action && isTradable(recommendation.action)) {
    return `${setup.ticker} remains a ${recommendation.action} candidate because the qualitative review agrees with the deterministic setup and confidence is ${Math.round(recommendation.confidence * 100)}%.`;
  }
  if (isTradable(setup.action) && recommendation.action === "watch") {
    return `${setup.ticker} is demoted to watch because the qualitative review found timing or evidence concerns that need human review before execution.`;
  }
  if (recommendation.action === "watch") {
    return `${setup.ticker} is useful for monitoring, but it does not have enough aligned evidence for a trade.`;
  }
  return `${setup.ticker} does not justify a trade in the qualitative review.`;
}

export function buildLlmSelectionSnapshot({ config, tradeSetups, portfolioPolicy = null } = {}) {
  const setups = tradeSetups?.setups || [];
  const enabled = Boolean(config.llmSelectionEnabled);
  const configured = enabled && Boolean(config.llmSelectionApiUrl && config.llmSelectionApiKey);
  const mode = configured ? "configured_shadow_safe" : enabled ? "enabled_without_provider" : "shadow";
  const recommendations = setups.map((setup) => {
    const recommendation = qualitativeAction(setup, config);
    const disagreement =
      recommendation.action === setup.action
        ? "none"
        : isTradable(setup.action) && isTradable(recommendation.action)
          ? "direction_conflict"
          : "demotion_or_guardrail";

    return {
      ticker: setup.ticker,
      company_name: setup.company_name,
      sector: setup.sector,
      action: recommendation.action,
      confidence: recommendation.confidence,
      selected: isTradable(recommendation.action),
      deterministic_action: setup.action,
      deterministic_conviction: setup.conviction,
      disagreement_with_deterministic: disagreement,
      rationale: rationaleFor(setup, recommendation),
      supporting_factors: summarizeSupport(setup),
      concerns: summarizeConcerns(setup, recommendation.action),
      recommended_policy_notes: [
        `max position ${Math.round(Number(portfolioPolicy?.portfolioMaxPositionPct || config.portfolioMaxPositionPct || 0.03) * 1000) / 10}%`,
        `stop ${Math.round(Number(portfolioPolicy?.portfolioDefaultStopLossPct || config.portfolioDefaultStopLossPct || 0.06) * 1000) / 10}%`,
        `target ${Math.round(Number(portfolioPolicy?.portfolioDefaultTakeProfitPct || config.portfolioDefaultTakeProfitPct || 0.09) * 1000) / 10}%`
      ]
    };
  });

  return {
    as_of: new Date().toISOString(),
    enabled,
    provider: config.llmSelectionProvider,
    model: config.llmSelectionModel,
    mode,
    status: configured ? "ready_shadow" : enabled ? "waiting_for_provider" : "shadow",
    summary: configured
      ? "LLM selection is configured but kept in safe JSON-review mode for final arbitration."
      : enabled
        ? "LLM selection is enabled, but no provider URL/API key is configured; using the local qualitative shadow reviewer."
        : "LLM selection is running in local shadow mode until a provider is configured.",
    algorithm: "Parallel qualitative reviewer: reads deterministic setup packs, fundamentals, market regime, money-flow/signal evidence, runtime reliability, and portfolio policy; then returns action, confidence, support, concerns, and disagreements.",
    counts: {
      long: recommendations.filter((item) => item.action === "long").length,
      short: recommendations.filter((item) => item.action === "short").length,
      watch: recommendations.filter((item) => item.action === "watch").length,
      no_trade: recommendations.filter((item) => item.action === "no_trade").length
    },
    recommendations
  };
}
