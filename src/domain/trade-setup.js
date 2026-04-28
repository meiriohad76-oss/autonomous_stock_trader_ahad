import { computeMacroRegime } from "./macro-regime.js";
import { clamp, makeId, round } from "../utils/helpers.js";

// --- Constants ---

const MONEY_FLOW_EVENT_TYPES = new Set([
  "insider_buy", "insider_sell", "activist_stake",
  "institutional_buying", "institutional_selling",
  "block_trade_buying", "block_trade_selling",
  "abnormal_volume_buying", "abnormal_volume_selling"
]);

const INSIDER_TYPES = new Set(["insider_buy", "insider_sell", "activist_stake"]);
const INSTITUTIONAL_TYPES = new Set(["institutional_buying", "institutional_selling"]);
const TAPE_TYPES = new Set([
  "block_trade_buying", "block_trade_selling",
  "abnormal_volume_buying", "abnormal_volume_selling"
]);

const SMART_MONEY_POSITIVE = new Set(["smart_money_accumulation", "smart_money_stacking_positive"]);
const SMART_MONEY_NEGATIVE = new Set(["smart_money_distribution", "smart_money_stacking_negative"]);

const SOURCE_WEIGHTS = { insider: 1.0, institutional: 0.9, tape: 0.6 };

const DIRECTION_LABELS = { bullish_supportive: 0.8, neutral: 0, bearish_headwind: -0.8 };

const THRESHOLDS = {
  risk_on:  { long: 0.25, short: -0.35 },
  risk_off: { long: 0.40, short: -0.25 },
  neutral:  { long: 0.30, short: -0.30 },
  mixed:    { long: 0.30, short: -0.30 }
};

// --- Helpers ---

function moneyFlowBucket(eventType) {
  if (INSIDER_TYPES.has(eventType)) return "insider";
  if (INSTITUTIONAL_TYPES.has(eventType)) return "institutional";
  if (TAPE_TYPES.has(eventType)) return "tape";
  return null;
}

function notionalFromMeta(meta = {}) {
  return Math.abs(
    Number(meta.latest_dollar_volume_usd ?? meta.transaction_value_usd ?? meta.position_delta_value_usd ?? 0) || 0
  );
}

// --- Signal assembly ---

function assembleSentimentSignal(store, ticker) {
  const WINDOW_WEIGHTS = { "1h": 0.5, "4h": 0.3, "1d": 0.2 };
  const windows = Object.keys(WINDOW_WEIGHTS);

  const states = Object.fromEntries(
    windows.map((w) => [
      w,
      store.sentimentStates.find(
        (s) => s.entity_type === "ticker" && s.entity_key === ticker && s.window === w
      ) || null
    ])
  );

  if (!windows.some((w) => states[w])) return null;

  const signal = windows.reduce((sum, w) => {
    const s = states[w];
    return sum + (s ? s.weighted_sentiment * WINDOW_WEIGHTS[w] : 0);
  }, 0);

  const confidence = windows.reduce((sum, w) => {
    const s = states[w];
    return sum + (s ? s.weighted_confidence * WINDOW_WEIGHTS[w] : 0);
  }, 0);

  const primary = states["1h"] || states["4h"] || states["1d"];

  return {
    signal: round(clamp(signal, -1, 1), 4),
    confidence: round(clamp(confidence, 0, 1), 3),
    windows: Object.fromEntries(windows.map((w) => [w, states[w]?.weighted_sentiment ?? null])),
    momentum_delta: round(primary?.momentum_delta ?? 0, 4),
    doc_count: primary?.doc_count ?? 0,
    event_concentration: primary?.event_concentration ?? 0,
    source_diversity: primary?.source_diversity ?? 0
  };
}

function assembleMoneyFlowSignal(store, ticker) {
  const cutoff = Date.now() - 48 * 3_600_000;

  const items = store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((d) => d.doc_id === score.doc_id);
      return normalized?.primary_ticker === ticker ? { score, normalized } : null;
    })
    .filter(Boolean)
    .filter((item) => MONEY_FLOW_EVENT_TYPES.has(item.score.event_type))
    .filter((item) => new Date(item.score.scored_at).getTime() >= cutoff);

  const empty = { signal: 0, confidence: 0, event_count: 0, dominant_bucket: "none", net_notional_usd: 0, alert_bonus: 0, tape_only: false };
  if (!items.length) return empty;

  let weightedSum = 0;
  let confidenceSum = 0;
  let notionalSum = 0;
  const bucketCounts = { insider: 0, institutional: 0, tape: 0 };

  for (const { score, normalized } of items) {
    const bucket = moneyFlowBucket(score.event_type);
    if (!bucket) continue;
    const w = SOURCE_WEIGHTS[bucket];
    weightedSum += score.sentiment_score * score.impact_score * score.final_confidence * w;
    confidenceSum += score.final_confidence;
    bucketCounts[bucket]++;
    notionalSum += notionalFromMeta(normalized.source_metadata);
  }

  const alerts = (store.alertHistory || []).filter((a) => a.entity_key === ticker);
  let alertBonus = 0;
  for (const alert of alerts) {
    if (SMART_MONEY_POSITIVE.has(alert.alert_type)) alertBonus += 0.15;
    if (SMART_MONEY_NEGATIVE.has(alert.alert_type)) alertBonus -= 0.15;
  }
  alertBonus = round(clamp(alertBonus, -0.3, 0.3), 3);

  const count = items.length;
  const rawSignal = clamp(weightedSum / count + alertBonus, -1, 1);
  const dominantBucket = Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0][0];
  const tapeOnly = bucketCounts.insider === 0 && bucketCounts.institutional === 0 && bucketCounts.tape > 0;

  return {
    signal: round(rawSignal, 4),
    confidence: round(confidenceSum / count, 3),
    event_count: count,
    dominant_bucket: dominantBucket,
    net_notional_usd: round(notionalSum, 2),
    alert_bonus: alertBonus,
    tape_only: tapeOnly
  };
}

function assembleFundamentalSignal(store, ticker) {
  const fund = store.fundamentals?.byTicker?.get(ticker);
  if (!fund) return null;

  const directionNumeric = DIRECTION_LABELS[fund.direction_label] ?? 0;

  return {
    signal: round(clamp(directionNumeric * fund.final_confidence, -1, 1), 4),
    confidence: round(fund.final_confidence, 3),
    direction_label: fund.direction_label,
    regime_label: fund.regime_label,
    composite_score: fund.composite_fundamental_score,
    valuation_label: fund.valuation_label,
    data_freshness_score: fund.data_freshness_score ?? 0,
    is_live: fund.market_reference?.live === true
  };
}

// --- Evidence gates ---

function hasMinimumEvidence(store, ticker) {
  const hasSentiment = store.sentimentStates.some(
    (s) => s.entity_type === "ticker" && s.entity_key === ticker && (s.doc_count ?? 0) >= 2
  );
  if (!hasSentiment) return false;

  const cutoff = Date.now() - 48 * 3_600_000;
  return store.documentScores.some((score) => {
    const normalized = store.normalizedDocuments.find((d) => d.doc_id === score.doc_id);
    return normalized?.primary_ticker === ticker && new Date(score.scored_at).getTime() >= cutoff;
  });
}

function isProvisional(fundamentalSignal) {
  if (!fundamentalSignal) return true;
  if ((fundamentalSignal.data_freshness_score ?? 0) < 0.8) return true;
  if (!fundamentalSignal.is_live) return true;
  return false;
}

// --- Scoring ---

function computeDirectionScore(sentiment, moneyFlow, fundamental) {
  const s = sentiment?.signal ?? 0;
  const m = moneyFlow?.signal ?? 0;
  const f = fundamental?.signal ?? 0;
  return round(clamp(s * 0.45 + m * 0.30 + f * 0.25, -1, 1), 4);
}

function computeConviction(sentiment, moneyFlow, fundamental, macroRegime, provisional) {
  const sc = sentiment?.confidence ?? 0;
  const mc = moneyFlow?.confidence ?? 0;
  const fc = fundamental?.confidence ?? 0;
  const rc = macroRegime?.confidence ?? 0;
  const raw = sc * 0.35 + mc * 0.25 + fc * 0.25 + rc * 0.15;
  const momentumAdj = (sentiment?.momentum_delta ?? 0) > 0 ? 0.08 : ((sentiment?.momentum_delta ?? 0) < 0 ? -0.08 : 0);
  const clamped = round(clamp(raw + momentumAdj, 0, 1), 3);
  return provisional ? Math.min(clamped, 0.55) : clamped;
}

function classifyAction(directionScore, conviction, macroRegime, tapeOnly) {
  const thresholds = THRESHOLDS[macroRegime?.regime] || THRESHOLDS.neutral;
  if (!tapeOnly) {
    if (directionScore >= thresholds.long && conviction >= 0.45) return "long";
    if (directionScore <= thresholds.short && conviction >= 0.45) return "short";
  }
  if (Math.abs(directionScore) >= 0.15 || conviction >= 0.35) return "watch";
  return "no_trade";
}

function positionSize(conviction) {
  if (conviction >= 0.70) return "full";
  if (conviction >= 0.55) return "half";
  if (conviction >= 0.40) return "quarter";
  return "starter";
}

function deriveTimeframe(sentimentSignal) {
  if (!sentimentSignal) return "1d-4d swing";
  const w = sentimentSignal.windows;
  const val1h = Math.abs(w["1h"] ?? 0);
  const val4h = Math.abs(w["4h"] ?? 0);
  if (val1h >= 0.35 && (w["4h"] === null || val4h < val1h * 0.6)) return "intraday";
  return "1d-4d swing";
}

function buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action) {
  const flags = [];
  if (provisional) flags.push("provisional_fundamentals");
  if ((macroRegime?.confidence ?? 0) < 0.4) flags.push("low_macro_confidence");
  if (action === "long" && macroRegime?.bias === "bearish") flags.push("macro_headwind");
  if (action === "short" && macroRegime?.bias === "bullish") flags.push("macro_headwind");
  if (moneyFlow?.tape_only) flags.push("tape_only_flow");
  if ((sentiment?.event_concentration ?? 0) > 0.6) flags.push("high_event_concentration");
  if ((sentiment?.source_diversity ?? 1) < 0.3) flags.push("low_story_diversity");
  if ((sentiment?.momentum_delta ?? 0) < -0.15) flags.push("deteriorating_sentiment");
  if (fundamental?.direction_label === "bearish_headwind") flags.push("weak_fundamentals");
  return flags;
}

function buildThesis(action, sentiment, moneyFlow, fundamental, macroRegime) {
  const parts = [];

  if (Math.abs(sentiment?.signal ?? 0) >= 0.2) {
    const dir = (sentiment.signal ?? 0) > 0 ? "Bullish" : "Bearish";
    const windows = ["1h", "4h"].filter((w) => (sentiment.windows?.[w] ?? null) !== null).join("/");
    parts.push(`${dir} ${windows} sentiment`);
  }

  if ((moneyFlow?.event_count ?? 0) > 0) {
    const bucket = moneyFlow.dominant_bucket;
    const dir = (moneyFlow.signal ?? 0) >= 0 ? "buying" : "selling";
    const usd = moneyFlow.net_notional_usd > 0 ? ` ($${(moneyFlow.net_notional_usd / 1e6).toFixed(1)}M)` : "";
    parts.push(`${bucket} ${dir}${usd}`);
  }

  if (fundamental) {
    const regime = fundamental.regime_label?.replace(/_/g, " ") || "";
    const val = fundamental.valuation_label || "";
    if (regime) parts.push(`${regime}${val ? ` / ${val}` : ""} fundamentals`);
  }

  if (macroRegime?.regime && macroRegime.regime !== "neutral") {
    parts.push(`${macroRegime.regime.replace("_", "-")} macro`);
  }

  if (!parts.length) return `${action.replace("_", " ")} — insufficient strong evidence`;
  const joined = parts.join("; ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

function buildGuidance(action, sentiment, fundamental) {
  const fundamentalCtx = fundamental
    ? ` (${fundamental.regime_label?.replace(/_/g, " ") || "fundamentals"})`
    : "";
  const currentSentiment4h = round(sentiment?.windows?.["4h"] ?? 0.2, 2);

  if (action === "long") {
    return {
      entry: "On pullback with volume confirmation; confirm 1h sentiment stays positive",
      stop: `Invalidated if 1h sentiment drops below -0.2 or momentum_delta turns negative${fundamentalCtx}`,
      target: `Continuation toward recent highs if 4h sentiment holds above ${currentSentiment4h}`
    };
  }
  if (action === "short") {
    return {
      entry: "On bounce into resistance with volume confirmation; confirm 1h sentiment stays negative",
      stop: `Invalidated if 1h sentiment recovers above +0.2 or momentum_delta turns positive${fundamentalCtx}`,
      target: "Continuation toward recent lows if 4h sentiment stays negative"
    };
  }
  if (action === "watch") {
    return {
      entry: "Monitor for signal convergence; no entry until direction and conviction thresholds met",
      stop: "N/A - watching only",
      target: "Reassess when sentiment momentum stabilizes"
    };
  }
  return { entry: "N/A", stop: "N/A", target: "N/A" };
}

// --- Core export ---

export function generateTradeSetups(store, macroRegime) {
  const tickers = [...new Set(
    store.sentimentStates
      .filter((s) => s.entity_type === "ticker")
      .map((s) => s.entity_key)
  )];

  const now = new Date().toISOString();
  const ACTION_ORDER = { long: 0, short: 1, watch: 2, no_trade: 3 };

  const setups = tickers
    .filter((ticker) => hasMinimumEvidence(store, ticker))
    .map((ticker) => {
      const sentiment = assembleSentimentSignal(store, ticker);
      if (!sentiment) return null;

      const moneyFlow = assembleMoneyFlowSignal(store, ticker);
      const fundamental = assembleFundamentalSignal(store, ticker);
      const provisional = isProvisional(fundamental);

      const directionScore = computeDirectionScore(sentiment, moneyFlow, fundamental);
      const conviction = computeConviction(sentiment, moneyFlow, fundamental, macroRegime, provisional);
      const action = classifyAction(directionScore, conviction, macroRegime, moneyFlow.tape_only);
      const guidance = buildGuidance(action, sentiment, fundamental);

      return {
        setup_id: makeId(),
        generated_at: now,
        ticker,
        action,
        conviction,
        provisional,
        timeframe: deriveTimeframe(sentiment),
        position_size_guidance: positionSize(conviction),
        entry_guidance: guidance.entry,
        stop_guidance: guidance.stop,
        target_guidance: guidance.target,
        thesis: buildThesis(action, sentiment, moneyFlow, fundamental, macroRegime),
        risk_flags: buildRiskFlags(sentiment, moneyFlow, fundamental, macroRegime, provisional, action),
        evidence: {
          sentiment: {
            signal: sentiment.signal,
            confidence: sentiment.confidence,
            windows: sentiment.windows,
            momentum_delta: sentiment.momentum_delta
          },
          money_flow: {
            signal: moneyFlow.signal,
            confidence: moneyFlow.confidence,
            event_count: moneyFlow.event_count,
            dominant_bucket: moneyFlow.dominant_bucket,
            net_notional_usd: moneyFlow.net_notional_usd,
            alert_bonus: moneyFlow.alert_bonus
          },
          fundamentals: fundamental
            ? {
                signal: fundamental.signal,
                confidence: fundamental.confidence,
                direction_label: fundamental.direction_label,
                regime_label: fundamental.regime_label,
                composite_score: fundamental.composite_score,
                valuation_label: fundamental.valuation_label
              }
            : null
        },
        direction_score: directionScore,
        macro_regime: macroRegime
          ? { regime: macroRegime.regime, bias: macroRegime.bias, confidence: macroRegime.confidence }
          : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const orderDiff = (ACTION_ORDER[a.action] ?? 4) - (ACTION_ORDER[b.action] ?? 4);
      if (orderDiff !== 0) return orderDiff;
      if (a.provisional !== b.provisional) return a.provisional ? 1 : -1;
      return b.conviction - a.conviction;
    });

  return setups;
}

// --- Agent wiring ---

export function createTradeSetupAgent(app) {
  const { store } = app;
  let debounceTimer = null;
  let lastRegime = null;

  function run() {
    const macroRegime = computeMacroRegime(store);
    store.macroRegime = macroRegime;

    if (lastRegime !== macroRegime.regime) {
      lastRegime = macroRegime.regime;
      store.bus.emit("event", { type: "macro_regime_update", ...macroRegime });
    }

    const setups = generateTradeSetups(store, macroRegime);
    store.tradeSetups = setups;

    store.bus.emit("event", {
      type: "trade_setup_refresh",
      count: setups.length,
      long_count: setups.filter((s) => s.action === "long").length,
      short_count: setups.filter((s) => s.action === "short").length,
      watch_count: setups.filter((s) => s.action === "watch").length,
      as_of: new Date().toISOString()
    });
  }

  function onBusEvent() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 500);
  }

  return {
    run,
    start() {
      store.bus.on("event", onBusEvent);
    },
    stop() {
      store.bus.off("event", onBusEvent);
      clearTimeout(debounceTimer);
    }
  };
}
