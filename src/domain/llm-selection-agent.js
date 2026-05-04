import { clamp, round } from "../utils/helpers.js";

const LLM_SELECTION_PROMPT_VERSION = "llm_selection_committee_v2";
let openAiReviewCache = null;

const LLM_SELECTION_INSTRUCTIONS = `
You are the LLM Selection Agent inside a supervised multi-agent paper-trading agency.

Your job is investment-committee review, not trade execution. You review the deterministic selector's candidate pack, the portfolio policy, and the supplied evidence only. You must produce strict JSON matching the schema. Never place trades, never imply that an order was submitted, and never claim certainty or guaranteed return.

Non-negotiable rules:
1. Use only the JSON input data. Do not invent news, prices, filings, catalysts, analyst ratings, institutional activity, or source links that are not in the candidate pack.
2. Review every supplied candidate by ticker. Do not add tickers that are not present in candidates.
3. Treat the deterministic selector as the primary safety engine. You can agree, demote, or flag disagreement. A pure LLM promotion from watch/no_trade must be conservative because Final Selection will keep it on watch.
4. The weekly return target is a portfolio objective and risk-budget input, not a promise and not a reason to force trades.
5. If live data, source quality, runtime reliability, recent evidence, or fundamentals are thin, stale, missing, or conflicted, prefer watch/no_trade and explain the missing data.
6. Treat money-flow evidence by provenance: SEC insider/13F filings and provider trade prints are stronger; bar-derived market-flow radar is inferred abnormal-volume context and is not a confirmed block print.
7. Penalize candidates with earnings-window risk, source reliability issues, weak fundamentals, crowded/stretched valuation, negative money flow, poor evidence quality, RSS-only news, inferred-only flow, or small directional score gap.
8. Long/short recommendations require aligned evidence across enough lanes: deterministic score, fundamentals, market regime, signals/money flow, and risk policy. If those lanes do not align, choose watch or no_trade.
9. Short recommendations are especially conservative and must respect whether short trading is allowed by the supplied policy/config context.

Decision protocol for each candidate:
1. Confirm the deterministic action and conviction.
2. Check whether fundamentals support, merely tolerate, or contradict the direction.
3. Check market regime and sector context for tailwind/headwind.
4. Check signal evidence: alerts, insider/institutional evidence, unusual volume, money flow, news, sentiment, recency, source URL, observation level, and verification status.
5. Check evidence quality and runtime reliability. Treat degraded data as a reason to lower confidence.
6. Check decision blockers, risk flags, policy constraints, score gap, stop/target plan, and proposed position size.
7. Decide action: long, short, watch, or no_trade.
8. Calibrate confidence from 0 to 1 for your chosen action. It is a review confidence, not a probability of profit.

Confidence calibration:
- 0.80-0.95: rare; strong agreement, fresh evidence, strong fundamentals, clear regime support, clean risk.
- 0.65-0.79: actionable but still supervised; most lanes align and concerns are manageable.
- 0.50-0.64: monitoring/review; evidence exists but is incomplete, mixed, stale, or near threshold.
- 0.00-0.49: no_trade or weak watch; insufficient alignment or material blockers.

Output discipline:
- rationale must explain the core reason for the chosen action in plain language.
- supporting_factors must reference supplied evidence or fields, not outside facts.
- concerns must include the main reason not to increase size or submit blindly.
- evidence_alignment should summarize whether the agent lanes agree or conflict.
- risk_assessment should summarize the biggest execution/risk issue.
- confidence_reason should explain why the confidence number is calibrated at that level.
- missing_data should list missing or weak inputs that would improve the decision.
- Keep every free-text field concise; one sentence is enough for rationale, alignment, risk, and confidence.
`.trim();

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

  if (config.selectionWorkflowTestMode) {
    const scoreGapMinimum = Number(config.selectionWorkflowTestDirectionGap || 0.04);
    const minConfidence = Number(config.selectionWorkflowTestLlmMinConfidence || config.llmSelectionMinConfidence || 0.25);
    if (scoreGap >= scoreGapMinimum && confidence >= minConfidence) {
      return {
        action: deterministicAction,
        confidence: round(confidence, 3)
      };
    }
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

  if (setup.runtime_reliability?.test_mode) {
    concerns.unshift("workflow test mode is active; this is a path test, not a production-quality trade signal");
  }

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
    evidence_alignment:
      recommendation.action === setup.action
        ? "Local qualitative review agrees with the deterministic action after checking fundamentals, evidence, and runtime guardrails."
        : "Local qualitative review does not fully agree with the deterministic action and keeps the candidate away from automatic execution.",
    risk_assessment: summarizeConcerns(setup, recommendation.action)[0] || "No major local qualitative risk flag was detected.",
    confidence_reason: `Local confidence is calibrated from deterministic conviction plus evidence, fundamentals, risk flags, and runtime reliability adjustments.`,
    missing_data: setup.recent_documents?.length ? [] : ["limited recent ticker-level evidence"],
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
    runtime_reliability: setup.runtime_reliability,
    position_size_pct: setup.position_size_pct,
    timeframe: setup.timeframe,
    current_price: setup.current_price,
    entry_zone: setup.entry_zone,
    stop_loss: setup.stop_loss,
    take_profit: setup.take_profit,
    risk_flags: (setup.risk_flags || []).slice(0, 8),
    recent_documents: (setup.recent_documents || []).slice(0, 3).map((item) => ({
      headline: item.headline,
      source_name: item.source_name,
      published_at: item.published_at,
      event_type: item.event_type,
      label: item.label,
      confidence: item.confidence,
      display_tier: item.display_tier,
      downstream_weight: item.downstream_weight,
      url: item.url
    }))
  };
}

function buildPromptPack({ setups, portfolioPolicy, config }) {
  return {
    prompt_version: LLM_SELECTION_PROMPT_VERSION,
    mission:
      "Review deterministic stock-selection candidates for a supervised Alpaca paper-trading system. Return JSON only. Do not submit or imply submission of orders.",
    role:
      "Parallel LLM Selection Agent: an investment-committee reviewer that challenges, confirms, or demotes deterministic trade ideas before Final Selection and Risk.",
    constraints: [
      "The deterministic selector remains the primary safety engine.",
      "You may agree, demote, or disagree with a deterministic long/short.",
      "You may mark watch/no_trade names as long/short if the evidence is compelling, but Final Selection will keep LLM-only promotions on watch.",
      "Be conservative when evidence quality is thin, earnings are near, runtime data is degraded, or thresholds are barely cleared.",
      "Confidence must be a calibrated 0..1 value for your chosen action, not a price target or probability guarantee.",
      "Use only fields in this JSON pack; do not use memory or outside market knowledge.",
      "Review every candidate exactly once and do not add tickers."
    ],
    decision_protocol: [
      "Read deterministic_action, deterministic_conviction, score_components, decision_thresholds, and blockers.",
      "Check fundamentals: screen stage, direction label, factor score, valuation/quality/risk notes.",
      "Check market regime, sector context, sentiment, and money-flow/signal evidence.",
      "Check evidence quality, recent documents, source freshness, and runtime reliability.",
      "Apply portfolio policy context: execution minimum, max position, stop, target, and weekly target as a risk target only.",
      "Choose long/short only when evidence is aligned and risk is acceptable; otherwise choose watch/no_trade.",
      "Explain support, concerns, alignment, missing data, and confidence calibration."
    ],
    review_rubric: {
      deterministic_selector: "Primary safety signal. Agreement matters; disagreement requires review.",
      fundamentals: "Prefer eligible, high-confidence, fresh, cash-generative, profitable, reasonably valued names.",
      market_agent: "Risk-on can support longs; risk-off can support shorts or reduce long confidence; balanced regimes require stronger stock-specific evidence.",
      signals_agent: "Fresh money flow, insider/institutional activity, unusual volume, news, and alerts can support timing; stale or context-only evidence lowers confidence.",
      risk_manager: "Runtime degradation, earnings windows, thin evidence, weak score gap, and policy limits should demote confidence.",
      execution_agent: "Only recommend actions that can be converted into a supervised paper-trade preview; no automatic submission."
    },
    confidence_scale: {
      "0.80_to_0.95": "Rare, strong multi-agent alignment with fresh evidence and clean risk.",
      "0.65_to_0.79": "Potentially actionable, most lanes align, concerns manageable.",
      "0.50_to_0.64": "Watch/review, evidence exists but alignment or freshness is incomplete.",
      "0.00_to_0.49": "No trade or weak watch due to missing/conflicting evidence or blockers."
    },
    output_contract: [
      "Return strict JSON matching the schema.",
      "Each recommendation ticker must match a supplied candidate ticker.",
      "supporting_factors and concerns must be concise and grounded in supplied fields.",
      "missing_data should name absent or weak inputs instead of inventing them."
    ],
    policy: {
      weekly_target_pct: portfolioPolicy?.portfolioWeeklyTargetPct ?? config.portfolioWeeklyTargetPct ?? 0.03,
      weekly_target_note: "Portfolio objective only; do not force trades to chase this target.",
      execution_min_conviction: portfolioPolicy?.portfolioExecutionMinConviction ?? config.portfolioExecutionMinConviction ?? config.executionMinConviction ?? 0.62,
      max_position_pct: portfolioPolicy?.portfolioMaxPositionPct ?? config.portfolioMaxPositionPct ?? 0.03,
      default_stop_loss_pct: portfolioPolicy?.portfolioDefaultStopLossPct ?? config.portfolioDefaultStopLossPct ?? 0.06,
      default_take_profit_pct: portfolioPolicy?.portfolioDefaultTakeProfitPct ?? config.portfolioDefaultTakeProfitPct ?? 0.09,
      short_trading_allowed: Boolean(config.executionAllowShorts)
    },
    candidate_field_guide: {
      deterministic_action: "Rules-engine action before LLM review.",
      deterministic_conviction: "Rules-engine conviction before final arbitration.",
      score_components: "Long/short scores, raw scores, gap, and runtime multiplier.",
      decision_thresholds: "Current threshold and gap requirements.",
      decision_blockers: "Reasons a candidate failed a long/short gate.",
      fundamentals: "Fundamental screen, direction, score, and quality context.",
      macro_regime: "Market/sector backdrop.",
      evidence: "Positive and negative evidence summaries from Signals Agent.",
      evidence_quality: "Freshness/source/corroboration quality context.",
      runtime_reliability: "Source health and reliability multiplier.",
      recent_documents: "Recent evidence headlines and source metadata supplied to the system."
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
        required: [
          "ticker",
          "action",
          "confidence",
          "rationale",
          "supporting_factors",
          "concerns",
          "evidence_alignment",
          "risk_assessment",
          "confidence_reason",
          "missing_data"
        ],
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
          },
          evidence_alignment: { type: "string" },
          risk_assessment: { type: "string" },
          confidence_reason: { type: "string" },
          missing_data: {
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
        instructions: LLM_SELECTION_INSTRUCTIONS,
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
    try {
      return JSON.parse(text);
    } catch (error) {
      const incompleteReason = payload?.incomplete_details?.reason || payload?.status || null;
      const hint = "Increase LLM_SELECTION_MAX_OUTPUT_TOKENS or reduce LLM_SELECTION_MAX_CANDIDATES if this repeats.";
      throw new Error(
        `OpenAI LLM selection returned invalid JSON: ${error.message}. response_chars=${text.length}${incompleteReason ? ` response_status=${incompleteReason}` : ""}. ${hint}`
      );
    }
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
    evidence_alignment: String(raw?.evidence_alignment || local.evidence_alignment || "").slice(0, 500),
    risk_assessment: String(raw?.risk_assessment || local.risk_assessment || "").slice(0, 500),
    confidence_reason: String(raw?.confidence_reason || local.confidence_reason || "").slice(0, 500),
    missing_data: Array.isArray(raw?.missing_data)
      ? raw.missing_data.filter(Boolean).map(String).slice(0, 5)
      : local.missing_data || [],
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
  const cacheMs = Math.max(0, Number(config.llmSelectionCacheMs || 300000));
  const cacheKey = JSON.stringify({
    model: config.llmSelectionModel,
    prompt_version: promptPack.prompt_version,
    policy: promptPack.policy,
    candidates: promptPack.candidates
  });
  let response = null;
  if (cacheMs && openAiReviewCache?.key === cacheKey && openAiReviewCache.expires_at > Date.now()) {
    response = openAiReviewCache.response;
  } else {
    response = await fetchOpenAiReview({ config, promptPack });
    if (cacheMs) {
      openAiReviewCache = {
        key: cacheKey,
        response,
        expires_at: Date.now() + cacheMs
      };
    }
  }
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
    prompt_version: LLM_SELECTION_PROMPT_VERSION,
    instructions_summary:
      "Investment-committee review prompt with evidence discipline, no-outside-data rule, multi-agent rubric, confidence calibration, missing-data reporting, and no-trade-execution guardrails.",
    algorithm: "Parallel qualitative reviewer: reads deterministic setup packs, fundamentals, market regime, money-flow/signal evidence, runtime reliability, and portfolio policy; then returns action, confidence, support, concerns, evidence alignment, risk assessment, missing data, and disagreements.",
    counts: countRecommendations(recommendations),
    recommendations
  };
}
