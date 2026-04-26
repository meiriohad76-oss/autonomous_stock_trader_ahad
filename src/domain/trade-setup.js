import { clamp, round } from "../utils/helpers.js";
import { buildMacroRegimeSnapshot } from "./macro-regime.js";

const BULLISH_FLOW_EVENT_TYPES = new Set([
  "insider_buy",
  "activist_stake",
  "institutional_buying",
  "abnormal_volume_buying",
  "block_trade_buying",
  "smart_money_accumulation",
  "smart_money_stacking_positive"
]);

const BEARISH_FLOW_EVENT_TYPES = new Set([
  "insider_sell",
  "institutional_selling",
  "abnormal_volume_selling",
  "block_trade_selling",
  "smart_money_distribution",
  "smart_money_stacking_negative"
]);

function buildDocumentLookup(store) {
  return new Map(store.normalizedDocuments.map((doc) => [doc.doc_id, doc]));
}

function buildSentimentByTicker(store, window) {
  return new Map(
    store.sentimentStates
      .filter((state) => state.entity_type === "ticker" && state.window === window)
      .map((state) => [state.entity_key, state])
  );
}

function buildFundamentalsByTicker(store) {
  return new Map((store.fundamentals?.leaderboard || []).map((row) => [row.ticker, row]));
}

function buildRecentTickerDocuments(store, documentLookup, ticker, limit = 8) {
  return store.documentScores
    .map((score) => {
      const normalized = documentLookup.get(score.doc_id);
      if (!normalized || normalized.primary_ticker !== ticker) {
        return null;
      }

      return {
        event_type: score.event_type,
        label: score.bullish_bearish_label,
        confidence: score.final_confidence,
        impact_score: score.impact_score,
        sentiment_score: score.sentiment_score,
        headline: normalized.headline,
        source_name: normalized.source_name,
        published_at: normalized.published_at,
        explanation_short: score.explanation_short,
        source_metadata: normalized.source_metadata || null,
        url: normalized.canonical_url
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, limit);
}

function latestAlertTimestamp(alert) {
  return alert.created_at || alert.detected_at || null;
}

function pricePlan(action, currentPrice, conviction, beta = 1) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      current_price: null,
      entry_zone: null,
      stop_loss: null,
      take_profit: null
    };
  }

  const normalizedBeta = clamp(Number(beta) || 1, 0.7, 2.2);
  const riskPct = clamp(0.025 + (1 - conviction) * 0.055 + (normalizedBeta - 1) * 0.015, 0.025, 0.1);
  const entryDriftPct = clamp(riskPct * 0.3, 0.008, 0.025);
  const rewardPct = riskPct * (action === "watch" ? 1.2 : 2.1);

  if (action === "short") {
    return {
      current_price: round(currentPrice, 2),
      entry_zone: {
        low: round(currentPrice, 2),
        high: round(currentPrice * (1 + entryDriftPct), 2),
        bias: "sell_strength"
      },
      stop_loss: round(currentPrice * (1 + riskPct), 2),
      take_profit: round(currentPrice * (1 - rewardPct), 2)
    };
  }

  return {
    current_price: round(currentPrice, 2),
    entry_zone: {
      low: round(currentPrice * (1 - entryDriftPct), 2),
      high: round(currentPrice, 2),
      bias: action === "watch" ? "wait_for_pullback" : "buy_pullback"
    },
    stop_loss: round(currentPrice * (1 - riskPct), 2),
    take_profit: round(currentPrice * (1 + rewardPct), 2)
  };
}

function positionSizePct(action, conviction, hasFundamentalSupport, macroRegimeSnapshot) {
  if (action === "watch" || action === "no_trade") {
    return 0;
  }

  const base = hasFundamentalSupport ? 0.01 : 0.005;
  const size = base + clamp(conviction - 0.5, 0, 0.45) * 0.08;
  const exposureMultiplier = Number(macroRegimeSnapshot?.exposure_multiplier || 1);
  return round(clamp(size * exposureMultiplier, 0.003, 0.06), 4);
}

function timeframeLabel(sentimentRow, flowBalance, action, macroRegimeSnapshot) {
  if (macroRegimeSnapshot?.regime_label === "high_dispersion") {
    return action === "watch" ? "monitor_intraday_to_3d" : "tactical_1d_to_5d";
  }
  if (Math.abs(flowBalance) >= 2 || Math.abs(sentimentRow?.momentum_delta || 0) >= 0.3) {
    return action === "watch" ? "monitor_intraday_to_3d" : "tactical_1d_to_5d";
  }

  if (Math.abs(sentimentRow?.weighted_sentiment || 0) >= 0.35) {
    return action === "watch" ? "monitor_3d_to_2w" : "swing_3d_to_2w";
  }

  return action === "watch" ? "monitor_multiweek" : "position_1w_to_4w";
}

function setupLabel(action, longScore, shortScore, screenStage) {
  if (action === "long") {
    return screenStage === "eligible" ? "confirmed_long" : "tactical_long";
  }
  if (action === "short") {
    return shortScore >= 0.72 ? "high_conviction_short" : "tactical_short";
  }
  if (action === "watch") {
    return longScore >= shortScore ? "bullish_watch" : "bearish_watch";
  }
  return "no_trade";
}

function summarizeSetup(action, setupLabelValue, ticker, conviction) {
  if (action === "long") {
    return `${ticker} is a ${setupLabelValue.replace(/_/g, " ")} with ${Math.round(conviction * 100)}% conviction.`;
  }
  if (action === "short") {
    return `${ticker} sets up as a ${setupLabelValue.replace(/_/g, " ")} with ${Math.round(conviction * 100)}% conviction.`;
  }
  if (action === "watch") {
    return `${ticker} is worth monitoring, but it does not clear the final trade threshold yet.`;
  }
  return `${ticker} does not currently justify a trade.`;
}

function computeSetup({
  ticker,
  sentimentRow,
  fundamentalRow,
  docs,
  alerts,
  macroRegimeSnapshot
}) {
  const companyName = fundamentalRow?.company_name || sentimentRow?.entity_name || ticker;
  const sector = fundamentalRow?.sector || "Unknown";
  const currentPrice = Number(fundamentalRow?.market_reference?.current_price) || null;
  const beta = Number(fundamentalRow?.market_reference?.beta) || 1;
  const screenStage = fundamentalRow?.initial_screen?.stage || "unknown";
  const directionLabel = fundamentalRow?.direction_label || "neutral";
  const ratingLabel = fundamentalRow?.rating_label || "unknown";
  const finalConfidence = Number(fundamentalRow?.final_confidence ?? sentimentRow?.weighted_confidence ?? 0);
  const weightedSentiment = Number(sentimentRow?.weighted_sentiment || 0);
  const momentumDelta = Number(sentimentRow?.momentum_delta || 0);
  const storyVelocity = Number(sentimentRow?.story_velocity || 0);
  const sentimentConfidence = Number(sentimentRow?.weighted_confidence || 0);
  const fundamentalScore = Number(fundamentalRow?.composite_fundamental_score || 0);
  const anomalyPenalty = Number(fundamentalRow?.anomaly_penalty || 0);
  const bullishFlowCount = docs.filter((item) => BULLISH_FLOW_EVENT_TYPES.has(item.event_type)).length;
  const bearishFlowCount = docs.filter((item) => BEARISH_FLOW_EVENT_TYPES.has(item.event_type)).length;
  const flowBalance = bullishFlowCount - bearishFlowCount;

  let longScore = 0;
  let shortScore = 0;
  const thesis = [];
  const riskFlags = [];
  const positiveEvidence = [];
  const negativeEvidence = [];

  longScore += clamp(weightedSentiment, 0, 1) * 0.32;
  shortScore += clamp(-weightedSentiment, 0, 1) * 0.32;
  longScore += clamp(momentumDelta, 0, 0.4) * 0.35;
  shortScore += clamp(-momentumDelta, 0, 0.4) * 0.35;
  longScore += sentimentConfidence * 0.16;
  shortScore += sentimentConfidence * 0.16;
  longScore += clamp(storyVelocity / 6, 0, 1) * 0.05;
  shortScore += clamp(storyVelocity / 6, 0, 1) * 0.05;

  if (flowBalance > 0) {
    longScore += clamp(flowBalance / 4, 0, 0.18);
    positiveEvidence.push(`${bullishFlowCount} supportive money-flow signal${bullishFlowCount === 1 ? "" : "s"}`);
  }
  if (flowBalance < 0) {
    shortScore += clamp(Math.abs(flowBalance) / 4, 0, 0.18);
    negativeEvidence.push(`${bearishFlowCount} adverse money-flow signal${bearishFlowCount === 1 ? "" : "s"}`);
  }

  if (fundamentalRow) {
    if (screenStage === "eligible") {
      longScore += 0.18;
      positiveEvidence.push("passes the stage-one screener");
    } else if (screenStage === "watch") {
      longScore += 0.06;
      riskFlags.push("only clears watch-stage fundamentals");
    } else if (screenStage === "reject") {
      shortScore += 0.12;
      riskFlags.push("fails the stage-one screener");
    }

    if (directionLabel === "bullish_supportive") {
      longScore += 0.14;
      positiveEvidence.push("fundamental direction is supportive");
    }
    if (directionLabel === "bearish_headwind") {
      shortScore += 0.14;
      negativeEvidence.push("fundamental direction is a headwind");
    }

    if (ratingLabel === "fundamentally_strong") {
      longScore += 0.12;
    }
    if (ratingLabel === "deteriorating" || ratingLabel === "weak") {
      shortScore += 0.1;
      negativeEvidence.push(`fundamental rating is ${ratingLabel.replace(/_/g, " ")}`);
    }

    longScore += clamp(fundamentalScore - 0.5, 0, 0.3) * 0.28;
    shortScore += clamp(0.45 - fundamentalScore, 0, 0.3) * 0.34;

    if (anomalyPenalty >= 0.15) {
      shortScore += 0.08;
      riskFlags.push("anomaly penalty is elevated");
    }

    if (Array.isArray(fundamentalRow.reason_codes)) {
      if (fundamentalRow.reason_codes.includes("premium_valuation")) {
        shortScore += 0.07;
        riskFlags.push("valuation is stretched");
      }
      if (fundamentalRow.reason_codes.includes("comparability_risk")) {
        riskFlags.push("comparability risk is elevated");
      }
      if (fundamentalRow.reason_codes.includes("balance_sheet_pressure")) {
        riskFlags.push("balance sheet needs monitoring");
      }
    }
  }

  if (alerts.some((item) => item.alert_type === "high_confidence_positive")) {
    longScore += 0.08;
    positiveEvidence.push("recent positive high-confidence alert");
  }
  if (alerts.some((item) => item.alert_type === "high_confidence_negative")) {
    shortScore += 0.08;
    negativeEvidence.push("recent negative high-confidence alert");
  }
  if (alerts.some((item) => item.alert_type === "polarity_reversal")) {
    riskFlags.push("recent polarity reversal raises timing risk");
  }

  if (macroRegimeSnapshot) {
    if (macroRegimeSnapshot.regime_label === "risk_on") {
      longScore += 0.08;
      shortScore -= 0.03;
      positiveEvidence.push("macro regime is risk on");
    } else if (macroRegimeSnapshot.regime_label === "risk_off") {
      shortScore += 0.08;
      longScore -= 0.03;
      negativeEvidence.push("macro regime is risk off");
    } else if (macroRegimeSnapshot.regime_label === "high_dispersion") {
      riskFlags.push("macro regime is highly selective");
    }
  }

  longScore = clamp(longScore, 0, 1);
  shortScore = clamp(shortScore, 0, 1);

  if (weightedSentiment >= 0.25) {
    thesis.push("short-term sentiment is supportive");
  } else if (weightedSentiment <= -0.25) {
    thesis.push("short-term sentiment is decisively negative");
  }

  if (flowBalance > 0) {
    thesis.push("money-flow evidence is skewed to accumulation");
  } else if (flowBalance < 0) {
    thesis.push("money-flow evidence is skewed to distribution");
  }

  if (fundamentalRow?.initial_screen?.summary) {
    thesis.push(fundamentalRow.initial_screen.summary);
  }
  if (macroRegimeSnapshot?.summary) {
    thesis.push(macroRegimeSnapshot.summary);
  }

  const bestScore = round(Math.max(longScore, shortScore), 3);
  const scoreGap = round(Math.abs(longScore - shortScore), 3);
  const longThreshold = Number(macroRegimeSnapshot?.long_threshold || 0.56);
  const shortThreshold = Number(macroRegimeSnapshot?.short_threshold || 0.56);
  let action = "no_trade";

  if (longScore >= longThreshold && longScore >= shortScore + 0.08) {
    action = "long";
  } else if (shortScore >= shortThreshold && shortScore >= longScore + 0.08) {
    action = "short";
  } else if (bestScore >= 0.38) {
    action = "watch";
  }

  const conviction = action === "watch" ? clamp(bestScore * 0.88, 0, 0.74) : clamp(bestScore, 0, 0.95);
  const hasFundamentalSupport = screenStage === "eligible" && directionLabel !== "bearish_headwind";
  const tradePlan = pricePlan(action, currentPrice, conviction, beta);
  const setupLabelValue = setupLabel(action, longScore, shortScore, screenStage);

  return {
    ticker,
    company_name: companyName,
    sector,
    action,
    setup_label: setupLabelValue,
    conviction: round(conviction, 3),
    position_size_pct: positionSizePct(action, conviction, hasFundamentalSupport, macroRegimeSnapshot),
    timeframe: timeframeLabel(sentimentRow, flowBalance, action, macroRegimeSnapshot),
    current_price: tradePlan.current_price,
    entry_zone: tradePlan.entry_zone,
    stop_loss: tradePlan.stop_loss,
    take_profit: tradePlan.take_profit,
    summary: summarizeSetup(action, setupLabelValue, ticker, conviction),
    thesis: [...new Set(thesis)].slice(0, 5),
    risk_flags: [...new Set(riskFlags)].slice(0, 6),
    evidence: {
      positive: [...new Set(positiveEvidence)].slice(0, 5),
      negative: [...new Set(negativeEvidence)].slice(0, 5)
    },
    score_components: {
      long: round(longScore, 3),
      short: round(shortScore, 3),
      gap: scoreGap
    },
    macro_regime: macroRegimeSnapshot
      ? {
          regime_label: macroRegimeSnapshot.regime_label,
          bias_label: macroRegimeSnapshot.bias_label,
          exposure_multiplier: macroRegimeSnapshot.exposure_multiplier,
          long_threshold: macroRegimeSnapshot.long_threshold,
          short_threshold: macroRegimeSnapshot.short_threshold
        }
      : null,
    sentiment: sentimentRow
      ? {
          window: sentimentRow.window,
          weighted_sentiment: round(weightedSentiment, 4),
          confidence: round(sentimentConfidence, 3),
          momentum_delta: round(momentumDelta, 4),
          story_velocity: round(storyVelocity, 3),
          top_event_types: sentimentRow.top_event_types || [],
          top_reasons: sentimentRow.top_reasons || []
        }
      : null,
    fundamentals: fundamentalRow
      ? {
          composite_fundamental_score: round(fundamentalScore, 3),
          final_confidence: round(finalConfidence, 3),
          screen_stage: screenStage,
          direction_label: directionLabel,
          rating_label: ratingLabel
        }
      : null,
    recent_documents: docs.slice(0, 4),
    recent_alerts: alerts.slice(0, 3).map((item) => ({
      alert_type: item.alert_type,
      headline: item.headline,
      confidence: item.confidence,
      created_at: latestAlertTimestamp(item)
    }))
  };
}

function actionRank(action) {
  if (action === "long") {
    return 0;
  }
  if (action === "short") {
    return 1;
  }
  if (action === "watch") {
    return 2;
  }
  return 3;
}

export function buildTradeSetupsSnapshot(store, { window = "1h", limit = 12, minConviction = 0.35, action = null, macroRegimeSnapshot = null } = {}) {
  const sentimentByTicker = buildSentimentByTicker(store, window);
  const fundamentalsByTicker = buildFundamentalsByTicker(store);
  const allTickers = [...new Set([...sentimentByTicker.keys(), ...fundamentalsByTicker.keys()])];
  const documentLookup = buildDocumentLookup(store);
  const regimeSnapshot = macroRegimeSnapshot || buildMacroRegimeSnapshot(store, { window });

  const setups = allTickers
    .map((ticker) =>
      computeSetup({
        ticker,
        sentimentRow: sentimentByTicker.get(ticker) || null,
        fundamentalRow: fundamentalsByTicker.get(ticker) || null,
        docs: buildRecentTickerDocuments(store, documentLookup, ticker),
        alerts: store.alertHistory
          .filter((item) => item.entity_key === ticker)
          .sort((a, b) => new Date(latestAlertTimestamp(b) || 0) - new Date(latestAlertTimestamp(a) || 0)),
        macroRegimeSnapshot: regimeSnapshot
      })
    )
    .filter((setup) => setup.conviction >= minConviction)
    .filter((setup) => (action ? setup.action === action : true))
    .sort((a, b) => {
      const rankDelta = actionRank(a.action) - actionRank(b.action);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return b.conviction - a.conviction;
    });

  return {
    as_of: store.health.lastUpdate || new Date().toISOString(),
    window,
    macro_regime: {
      regime_label: regimeSnapshot.regime_label,
      bias_label: regimeSnapshot.bias_label,
      exposure_multiplier: regimeSnapshot.exposure_multiplier
    },
    counts: {
      tracked_tickers: allTickers.length,
      sentiment_tickers: sentimentByTicker.size,
      fundamental_tickers: fundamentalsByTicker.size,
      long: setups.filter((item) => item.action === "long").length,
      short: setups.filter((item) => item.action === "short").length,
      watch: setups.filter((item) => item.action === "watch").length,
      no_trade: setups.filter((item) => item.action === "no_trade").length
    },
    setups: setups.slice(0, limit)
  };
}

export function createTradeSetupAgent({ store, getMacroRegime }) {
  function getTradeSetups(options = {}) {
    return buildTradeSetupsSnapshot(store, {
      ...options,
      macroRegimeSnapshot: getMacroRegime ? getMacroRegime({ window: options.window || "1h" }) : null
    });
  }

  function getTickerSetup(ticker, options = {}) {
    const response = getTradeSetups({
      ...options,
      limit: Math.max(250, options.limit || 250),
      minConviction: 0
    });
    return response.setups.find((item) => item.ticker === ticker) || null;
  }

  return {
    getTradeSetups,
    getTickerSetup
  };
}
