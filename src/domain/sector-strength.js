import { clamp, round } from "../utils/helpers.js";

export const SECTOR_ETF_PROXIES = Object.freeze({
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Energy: "XLE",
  Financials: "XLF",
  "Health Care": "XLV",
  Industrials: "XLI",
  "Information Technology": "XLK",
  Materials: "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU"
});

const MAX_PLAUSIBLE_DAILY_RETURN = 0.2;
const FULL_STRENGTH_DAILY_RETURN = 0.05;

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshIso(value, maxAgeHours) {
  if (!value) {
    return true;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Date.now() - timestamp <= Math.max(1, Number(maxAgeHours || 72)) * 3_600_000;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function weightedAverage(items, valueKey, weightKey) {
  let total = 0;
  let weight = 0;
  for (const item of items) {
    const value = asNumber(item[valueKey]);
    const rawWeight = asNumber(item[weightKey]);
    const safeWeight = rawWeight && rawWeight > 0 ? Math.sqrt(rawWeight) : 1;
    if (value === null) {
      continue;
    }
    total += value * safeWeight;
    weight += safeWeight;
  }
  return weight ? total / weight : null;
}

function reasonLabel(reason) {
  return String(reason || "unavailable").replace(/_/g, " ");
}

export function normalizeReferenceReturn(reference = {}, options = {}) {
  const maxAbsoluteReturn = Number(options.maxAbsoluteReturn || MAX_PLAUSIBLE_DAILY_RETURN);
  const rawPercentChange = asNumber(reference.percent_change);
  const currentPrice = asNumber(reference.current_price);
  const absoluteChange = asNumber(reference.absolute_change);
  const previousPrice = currentPrice !== null && absoluteChange !== null ? currentPrice - absoluteChange : null;
  const recomputed =
    currentPrice !== null && currentPrice > 0 && previousPrice !== null && previousPrice > 0
      ? absoluteChange / previousPrice
      : null;

  if (recomputed !== null && Math.abs(recomputed) <= maxAbsoluteReturn) {
    if (rawPercentChange === null || Math.abs(rawPercentChange) > maxAbsoluteReturn || Math.abs(rawPercentChange - recomputed) > 0.05) {
      return {
        value: round(recomputed, 6),
        basis: "price_change_recomputed",
        warning: rawPercentChange !== null ? "provider_percent_change_normalized" : null
      };
    }
  }

  if (rawPercentChange !== null && Math.abs(rawPercentChange) <= maxAbsoluteReturn) {
    return {
      value: round(rawPercentChange, 6),
      basis: "provider_percent_change",
      warning: null
    };
  }

  if (rawPercentChange !== null && Math.abs(rawPercentChange) <= 20) {
    const normalizedPercentUnit = rawPercentChange / 100;
    if (Math.abs(normalizedPercentUnit) <= maxAbsoluteReturn) {
      return {
        value: round(normalizedPercentUnit, 6),
        basis: "provider_percent_unit_normalized",
        warning: "provider_percent_change_normalized"
      };
    }
  }

  return {
    value: null,
    basis: rawPercentChange === null ? "missing_percent_change" : "return_outlier",
    warning: rawPercentChange === null ? null : "return_rejected_as_outlier"
  };
}

function validateMarketReference(row, options = {}) {
  const reference = row?.market_reference || null;
  if (!reference) {
    return { ok: false, reason: "missing_market_reference" };
  }

  if (reference.live !== true || String(reference.provider || "").toLowerCase() === "synthetic") {
    return { ok: false, reason: "non_live_market_reference" };
  }

  if (!isFreshIso(reference.as_of, options.maxAgeHours)) {
    return { ok: false, reason: "stale_market_reference" };
  }

  const normalizedReturn = normalizeReferenceReturn(reference, options);
  if (normalizedReturn.value === null) {
    return { ok: false, reason: normalizedReturn.basis, warning: normalizedReturn.warning };
  }

  return {
    ok: true,
    returnValue: normalizedReturn.value,
    returnBasis: normalizedReturn.basis,
    warning: normalizedReturn.warning,
    provider: reference.provider || "unknown",
    asOf: reference.as_of || null,
    marketCap: asNumber(reference.market_cap)
  };
}

function usableSectorSentiment(state) {
  if (!state) {
    return null;
  }
  const eventTypes = state.top_event_types || [];
  const reasons = state.top_reasons || [];
  const lowSignalOnly =
    eventTypes.length > 0 &&
    eventTypes.every((eventType) => eventType === "monitor_item") &&
    reasons.includes("no_strong_rule_match");
  if (!Number(state.doc_count || 0) || lowSignalOnly) {
    return null;
  }
  return {
    score: clamp(Number(state.weighted_sentiment || 0), -1, 1),
    confidence: clamp(Number(state.weighted_confidence || 0), 0, 1),
    doc_count: Number(state.doc_count || 0),
    active_names: Number(state.active_names || 0)
  };
}

function sectorStateLabel(score) {
  if (score >= 0.12) {
    return "bullish";
  }
  if (score <= -0.12) {
    return "bearish";
  }
  return "neutral";
}

function componentScore(returnValue) {
  return returnValue === null ? null : clamp(returnValue / FULL_STRENGTH_DAILY_RETURN, -1, 1);
}

function buildSectorItem(sector, rows, allRows, sectorState, options = {}) {
  const proxyTicker = SECTOR_ETF_PROXIES[sector] || null;
  const maxAgeHours = Number(options.maxAgeHours || 72);
  const rejected = [];
  const usable = [];
  let normalizedWarningCount = 0;

  for (const row of rows) {
    const validation = validateMarketReference(row, { maxAgeHours });
    if (!validation.ok) {
      rejected.push({
        ticker: row.ticker || row.entity_key,
        reason: validation.reason
      });
      continue;
    }
    if (validation.warning) {
      normalizedWarningCount += 1;
    }
    usable.push({
      ticker: row.ticker || row.entity_key,
      company_name: row.company_name || row.company || row.entity_name || row.ticker,
      return_value: validation.returnValue,
      return_basis: validation.returnBasis,
      provider: validation.provider,
      market_cap: validation.marketCap || 0,
      as_of: validation.asOf
    });
  }

  const proxyRow = proxyTicker ? allRows.find((row) => row.ticker === proxyTicker || row.entity_key === proxyTicker) : null;
  const proxyValidation = proxyRow ? validateMarketReference(proxyRow, { maxAgeHours }) : null;
  const etfReturn = proxyValidation?.ok ? proxyValidation.returnValue : null;
  const topConstituents = usable
    .slice()
    .sort((a, b) => Number(b.market_cap || 0) - Number(a.market_cap || 0) || Math.abs(b.return_value) - Math.abs(a.return_value))
    .slice(0, 10);
  const topConstituentReturn = weightedAverage(topConstituents, "return_value", "market_cap");
  const equalWeightTopReturn = average(topConstituents.map((item) => item.return_value));
  const stockScore = componentScore(topConstituentReturn);
  const etfScore = componentScore(etfReturn);
  const sentiment = usableSectorSentiment(sectorState);

  const components = [];
  if (etfScore !== null) {
    components.push({ key: "sector_etf", label: `${proxyTicker} ETF`, score: etfScore, weight: 0.45, value: etfReturn });
  }
  if (stockScore !== null) {
    components.push({ key: "top_stocks", label: "Top sector stocks", score: stockScore, weight: etfScore !== null ? 0.35 : 0.7, value: topConstituentReturn });
  }
  if (sentiment) {
    components.push({ key: "sentiment_flow", label: "Sentiment/flow", score: sentiment.score, weight: etfScore !== null || stockScore !== null ? 0.2 : 1, value: sentiment.score });
  }

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const finalScore = totalWeight
    ? components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : null;
  const providerCount = new Set(usable.map((item) => item.provider).filter(Boolean)).size;
  const coverageRatio = rows.length ? usable.length / rows.length : 0;
  const outlierCount = rejected.filter((item) => item.reason === "return_outlier").length;
  const confidence =
    finalScore === null
      ? 0
      : clamp(
          0.18 +
            Math.min(1, usable.length / 10) * 0.26 +
            coverageRatio * 0.3 +
            Math.min(1, providerCount / 2) * 0.08 +
            (etfScore !== null ? 0.08 : 0) +
            (sentiment?.confidence || 0) * 0.1 -
            Math.min(0.2, outlierCount * 0.025),
          0,
          0.98
        );
  const scoreAvailable = finalScore !== null && confidence >= 0.25;
  const label = scoreAvailable ? sectorStateLabel(finalScore) : "neutral";
  const componentLabels = components.map((item) => item.label);

  return {
    entity_type: "sector",
    entity_key: sector,
    window: options.window || "1h",
    as_of: options.asOf || new Date().toISOString(),
    sentiment_regime: label,
    weighted_sentiment: scoreAvailable ? round(finalScore, 3) : 0,
    weighted_confidence: round(confidence, 3),
    doc_count: sectorState?.doc_count || 0,
    active_names: sentiment?.active_names || 0,
    tracked_names: rows.length,
    top_event_types: sectorState?.top_event_types || [],
    top_reasons: sectorState?.top_reasons || [],
    score_available: scoreAvailable,
    score_source: "sector_tape",
    source_label: componentLabels.length ? componentLabels.join(" + ") : "no usable sector tape",
    sector_strength: {
      score: scoreAvailable ? round(finalScore, 3) : null,
      label,
      confidence: round(confidence, 3),
      etf_proxy: proxyTicker,
      etf_return: etfReturn === null ? null : round(etfReturn, 6),
      etf_status: etfReturn === null ? (proxyTicker ? "not_available" : "not_configured") : "available",
      top_constituent_return: topConstituentReturn === null ? null : round(topConstituentReturn, 6),
      equal_weight_top_return: equalWeightTopReturn === null ? null : round(equalWeightTopReturn, 6),
      top_constituent_count: topConstituents.length,
      usable_constituent_count: usable.length,
      tracked_constituent_count: rows.length,
      coverage_ratio: round(coverageRatio, 3),
      provider_count: providerCount,
      normalized_warning_count: normalizedWarningCount,
      rejected_count: rejected.length,
      outlier_count: outlierCount,
      components: components.map((item) => ({
        key: item.key,
        label: item.label,
        score: round(item.score, 3),
        weight: item.weight,
        value: item.value === null ? null : round(item.value, 6)
      })),
      top_constituents: topConstituents.slice(0, 10).map((item) => ({
        ticker: item.ticker,
        company_name: item.company_name,
        return_value: round(item.return_value, 6),
        provider: item.provider,
        market_cap: item.market_cap || null,
        return_basis: item.return_basis
      })),
      rejected_samples: rejected.slice(0, 6).map((item) => ({
        ticker: item.ticker,
        reason: reasonLabel(item.reason)
      })),
      data_quality:
        scoreAvailable && topConstituents.length >= 5 && coverageRatio >= 0.35
          ? "usable"
          : scoreAvailable
            ? "thin_but_usable"
            : "unavailable",
      summary: scoreAvailable
        ? `${sector} is ${label}: top-stock tape ${round((topConstituentReturn || 0) * 100, 2)}%, ETF ${
            etfReturn === null ? "n/a" : `${round(etfReturn * 100, 2)}%`
          }, confidence ${round(confidence * 100, 0)}%.`
        : `${sector} has no usable fresh sector tape; ${rejected.length} rows were unavailable, stale, fallback, or outlier-filtered.`
    }
  };
}

export function buildSectorStrengthSnapshot(rows = [], options = {}) {
  const maxAgeHours = Number(options.maxAgeHours || options.config?.signalFreshnessMaxHours || 72);
  const sectorStates = options.sectorStates || [];
  const sectorStateByKey = new Map(sectorStates.map((state) => [state.entity_key, state]));
  const grouped = new Map();

  for (const row of rows) {
    const sector = row?.sector || "Unknown";
    if (!sector || sector === "Unknown") {
      continue;
    }
    if (!grouped.has(sector)) {
      grouped.set(sector, []);
    }
    grouped.get(sector).push(row);
  }

  const sectors = [...grouped.entries()]
    .map(([sector, sectorRows]) =>
      buildSectorItem(sector, sectorRows, rows, sectorStateByKey.get(sector) || null, {
        ...options,
        maxAgeHours
      })
    )
    .sort((a, b) => {
      const availableDiff = Number(b.score_available) - Number(a.score_available);
      if (availableDiff) {
        return availableDiff;
      }
      return Math.abs(b.weighted_sentiment || 0) - Math.abs(a.weighted_sentiment || 0) || b.tracked_names - a.tracked_names;
    });

  const scored = sectors.filter((sector) => sector.score_available);
  const bullish = scored.filter((sector) => sector.sentiment_regime === "bullish").length;
  const bearish = scored.filter((sector) => sector.sentiment_regime === "bearish").length;
  const strongest = scored
    .slice()
    .sort((a, b) => Number(b.weighted_sentiment || 0) - Number(a.weighted_sentiment || 0))[0] || null;
  const weakest = scored
    .slice()
    .sort((a, b) => Number(a.weighted_sentiment || 0) - Number(b.weighted_sentiment || 0))[0] || null;

  return {
    as_of: options.asOf || new Date().toISOString(),
    source: "sector_tape",
    sectors,
    summary: {
      sector_count: sectors.length,
      scored_sector_count: scored.length,
      bullish_sector_count: bullish,
      bearish_sector_count: bearish,
      neutral_sector_count: scored.length - bullish - bearish,
      score_available: scored.length > 0,
      source_label: "top-stock tape, optional sector ETF proxy, and usable sentiment/flow context",
      strongest: strongest?.entity_key || null,
      weakest: weakest?.entity_key || null
    }
  };
}
