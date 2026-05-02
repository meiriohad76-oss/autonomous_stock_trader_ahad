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

function policyNotes(config, portfolioPolicy) {
  return [
    `max position ${Math.round(Number(portfolioPolicy?.portfolioMaxPositionPct || config.portfolioMaxPositionPct || 0.03) * 1000) / 10}%`,
    `stop ${Math.round(Number(portfolioPolicy?.portfolioDefaultStopLossPct || config.portfolioDefaultStopLossPct || 0.06) * 1000) / 10}%`,
    `target ${Math.round(Number(portfolioPolicy?.portfolioDefaultTakeProfitPct || config.portfolioDefaultTakeProfitPct || 0.09) * 1000) / 10}%`
  ];
}

function localRecommendation(setup, config, portfolioPolicy = null) {
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
    recommended_policy_notes: policyNotes(config, portfolioPolicy),
    reviewer: "local_shadow"
  };
}

function localRecommendations(setups, config, portfolioPolicy = null) {
  return setups.map((setup) => localRecommendation(setup, config, portfolioPolicy));
}

function compactSetup(setup) {
  return {
    ticker: setup.ticker,
    company_name: setup.company_name,
    sector: setup.sector,
    deterministic_action: setup.action,
    deterministic_conviction: setup.conviction,
    setup_label: setup.setup_label,
    summary: setup.summary,
    score_components: setup.score_components,
    decision_thresholds: setup.decision_thresholds,
    decision_blockers: (setup.decision_blockers || []).slice(0, 4),
    fundamentals: setup.fundamentals,
    macro_regime: setup.macro_regime,
    sentiment: setup.sentiment,
    evidence: setup.evidence,
    evidence_quality: setup.evidence_quality,
    risk_flags: (setup.risk_flags || []).slice(0, 8),
    recent_documents: (setup.recent_documents || []).slice(0, 3).map((item) => ({
      headline: item.headline,
      source_name: item.source_name,
      published_at: item.published_at,
      event_type: item.event_type,
      label: item.label,
      confidence: item.confidence
    }))
  };
}

function buildPromptPack({ setups, portfolioPolicy, config }) {
  return {
    mission:
      "Review deterministic stock-selection candidates for a supervised Alpaca paper-trading system. Return JSON only. Do not submit or imply submission of orders.",
    constraints: [
      "The deterministic selector remains the primary safety engine.",
      "You may agree, demote, or disagree with a deterministic long/short.",
      "You may mark watch/no_trade names as long/short if the evidence is compelling, but Final Selection will keep LLM-only promotions on watch.",
      "Be conservative when evidence quality is thin, earnings are near, runtime data is degraded, or thresholds are barely cleared.",
      "Confidence must be a calibrated 0..1 value for your chosen action, not a price target or probability guarantee."
    ],
    policy: {
      weekly_target_pct: portfolioPolicy?.portfolioWeeklyTargetPct ?? config.portfolioWeeklyTargetPct ?? 0.03,
      execution_min_conviction: portfolioPolicy?.portfolioExecutionMinConviction ?? config.portfolioExecutionMinConviction ?? config.executionMinConviction ?? 0.62,
      max_position_pct: portfolioPolicy?.portfolioMaxPositionPct ?? config.portfolioMaxPositionPct ?? 0.03,
      default_stop_loss_pct: portfolioPolicy?.portfolioDefaultStopLossPct ?? config.portfolioDefaultStopLossPct ?? 0.06,
      default_take_profit_pct: portfolioPolicy?.portfolioDefaultTakeProfitPct ?? config.portfolioDefaultTakeProfitPct ?? 0.09
    },
    candidates: setups.map(compactSetup)
  };
}

const RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendations"],
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ticker", "action", "confidence", "rationale", "supporting_factors", "concerns"],
        properties: {
          ticker: { type: "string" },
          action: { type: "string", enum: ["long", "short", "watch", "no_trade"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
          supporting_factors: {
            type: "array",
            maxItems: 5,
            items: { type: "string" }
          },
          concerns: {
            type: "array",
            maxItems: 5,
            items: { type: "string" }
          }
        }
      }
    }
  }
};

function responseText(payload) {
  if (typeof payload?.output_text === "string") {
    return payload.output_text;
  }

  const parts = [];
  for (const output of payload?.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function fetchOpenAiReview({ config, promptPack }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.llmSelectionRequestTimeoutMs || 30000));

  try {
    const response = await fetch(config.llmSelectionApiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmSelectionApiKey}`
      },
      body: JSON.stringify({
        model: config.llmSelectionModel,
        instructions:
          "You are the LLM Selection Agent. Produce strict JSON matching the supplied schema. Review evidence, thresholds, risk flags, and portfolio policy. Never place trades.",
        input: JSON.stringify(promptPack),
        text: {
          format: {
            type: "json_schema",
            name: "llm_selection_review",
            strict: true,
            schema: RECOMMENDATION_SCHEMA
          }
        },
        max_output_tokens: Number(config.llmSelectionMaxOutputTokens || 2500)
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || `OpenAI LLM selection failed with HTTP ${response.status}`);
    }

    const text = responseText(payload);
    if (!text) {
      throw new Error("OpenAI LLM selection returned no JSON text.");
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeExternalRecommendation(raw, setup, local, config, portfolioPolicy) {
  const action = ["long", "short", "watch", "no_trade"].includes(raw?.action) ? raw.action : local.action;
  const confidence = round(clamp(Number(raw?.confidence ?? local.confidence), 0, 0.96), 3);
  const disagreement =
    action === setup.action
      ? "none"
      : isTradable(setup.action) && isTradable(action)
        ? "direction_conflict"
        : isTradable(action) && !isTradable(setup.action)
          ? "promotion_without_rules"
          : "demotion_or_guardrail";

  return {
    ticker: setup.ticker,
    company_name: setup.company_name,
    sector: setup.sector,
    action,
    confidence,
    selected: isTradable(action),
    deterministic_action: setup.action,
    deterministic_conviction: setup.conviction,
    disagreement_with_deterministic: disagreement,
    rationale: String(raw?.rationale || local.rationale).slice(0, 500),
    supporting_factors: Array.isArray(raw?.supporting_factors)
      ? raw.supporting_factors.filter(Boolean).map(String).slice(0, 5)
      : local.supporting_factors,
    concerns: Array.isArray(raw?.concerns)
      ? raw.concerns.filter(Boolean).map(String).slice(0, 5)
      : local.concerns,
    recommended_policy_notes: policyNotes(config, portfolioPolicy),
    reviewer: "openai"
  };
}

async function openAiRecommendations({ setups, config, portfolioPolicy }) {
  const maxCandidates = Math.max(1, Math.min(Number(config.llmSelectionMaxCandidates || 12), setups.length));
  const reviewedSetups = setups.slice(0, maxCandidates);
  const local = localRecommendations(setups, config, portfolioPolicy);
  const localByTicker = new Map(local.map((item) => [item.ticker, item]));
  const setupByTicker = new Map(setups.map((item) => [item.ticker, item]));
  const promptPack = buildPromptPack({ setups: reviewedSetups, portfolioPolicy, config });
  const response = await fetchOpenAiReview({ config, promptPack });
  const externalByTicker = new Map((response.recommendations || []).map((item) => [String(item.ticker || "").toUpperCase(), item]));

  return setups.map((setup) => {
    const raw = externalByTicker.get(setup.ticker);
    const fallback = localByTicker.get(setup.ticker);
    if (!raw || !setupByTicker.has(setup.ticker)) {
      return fallback;
    }
    return normalizeExternalRecommendation(raw, setup, fallback, config, portfolioPolicy);
  });
}

function countRecommendations(recommendations) {
  return {
    long: recommendations.filter((item) => item.action === "long").length,
    short: recommendations.filter((item) => item.action === "short").length,
    watch: recommendations.filter((item) => item.action === "watch").length,
    no_trade: recommendations.filter((item) => item.action === "no_trade").length
  };
}

function providerConfigured(config) {
  if (!config.llmSelectionEnabled) {
    return false;
  }
  if (config.llmSelectionProvider === "openai") {
    return Boolean(config.llmSelectionApiKey && config.llmSelectionApiUrl);
  }
  return Boolean(config.llmSelectionApiKey && config.llmSelectionApiUrl);
}

export async function buildLlmSelectionSnapshot({ config, tradeSetups, portfolioPolicy = null } = {}) {
  const setups = tradeSetups?.setups || [];
  const enabled = Boolean(config.llmSelectionEnabled);
  const configured = providerConfigured(config);
  let recommendations = localRecommendations(setups, config, portfolioPolicy);
  let status = configured ? "ready" : enabled ? "waiting_for_provider" : "shadow";
  let mode = configured ? `${config.llmSelectionProvider}_json_review` : enabled ? "enabled_without_provider" : "shadow";
  let lastError = null;

  if (configured && config.llmSelectionProvider === "openai" && setups.length) {
    try {
      recommendations = await openAiRecommendations({ setups, config, portfolioPolicy });
    } catch (error) {
      lastError = error.message;
      status = "fallback_shadow";
      mode = "openai_error_shadow_fallback";
      recommendations = localRecommendations(setups, config, portfolioPolicy);
    }
  } else if (configured && config.llmSelectionProvider !== "openai") {
    status = "unsupported_provider_shadow";
    mode = "unsupported_provider_shadow_fallback";
    lastError = `Unsupported LLM_SELECTION_PROVIDER=${config.llmSelectionProvider}.`;
  }

  return {
    as_of: new Date().toISOString(),
    enabled,
    provider: config.llmSelectionProvider,
    model: config.llmSelectionModel,
    configured,
    mode,
    status,
    last_error: lastError,
    summary: configured && !lastError
      ? `LLM selection is using ${config.llmSelectionProvider} ${config.llmSelectionModel} in safe JSON-review mode.`
      : enabled
        ? lastError
          ? `LLM selection fell back to the local shadow reviewer: ${lastError}`
          : "LLM selection is enabled, but no provider/API key is configured; using the local qualitative shadow reviewer."
        : "LLM selection is running in local shadow mode until a provider is configured.",
    algorithm: "Parallel qualitative reviewer: reads deterministic setup packs, fundamentals, market regime, money-flow/signal evidence, runtime reliability, and portfolio policy; then returns action, confidence, support, concerns, and disagreements.",
    counts: countRecommendations(recommendations),
    recommendations
  };
}
