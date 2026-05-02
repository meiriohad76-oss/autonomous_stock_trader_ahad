import { FUNDAMENTAL_SCREENER_PROFILES } from "./fundamentals.js";
import { round } from "../utils/helpers.js";

const DEFAULT_HORIZON_DAYS = 5;
const DEFAULT_MIN_SAMPLE = 30;
const MS_PER_DAY = 86_400_000;

const FACTOR_TESTS = [
  { key: "quality_score", label: "Quality Score", field: "quality_score", threshold: 0.6, family: "profitability_quality" },
  { key: "growth_score", label: "Growth Score", field: "growth_score", threshold: 0.6, family: "fundamental_growth" },
  { key: "valuation_score", label: "Valuation Score", field: "valuation_score", threshold: 0.6, family: "valuation" },
  { key: "balance_sheet_score", label: "Balance Sheet Score", field: "balance_sheet_score", threshold: 0.6, family: "financial_strength" },
  { key: "efficiency_score", label: "Efficiency Score", field: "efficiency_score", threshold: 0.6, family: "cash_efficiency" },
  { key: "earnings_stability_score", label: "Earnings Stability", field: "earnings_stability_score", threshold: 0.6, family: "stability_quality" },
  { key: "composite_fundamental_score", label: "Composite Fundamental Score", field: "composite_fundamental_score", threshold: 0.71, family: "combined_score" }
];

function asNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asDate(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function avg(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length : null;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function maxDrawdown(returns) {
  if (!returns.length) {
    return null;
  }
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, (equity - peak) / peak);
  }
  return drawdown;
}

function providerIsSynthetic(reference = {}) {
  const metadata = reference.market_reference_metadata || {};
  return (
    String(metadata.provider || reference.provider || "").toLowerCase().includes("synthetic") ||
    metadata.live === false ||
    reference.live === false
  );
}

function groupByTicker(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const ticker = row.ticker;
    if (!ticker) {
      continue;
    }
    if (!grouped.has(ticker)) {
      grouped.set(ticker, []);
    }
    grouped.get(ticker).push(row);
  }
  for (const values of grouped.values()) {
    values.sort((left, right) => new Date(left.as_of || 0) - new Date(right.as_of || 0));
  }
  return grouped;
}

function pairKey(row) {
  return `${row.ticker}|${row.as_of}`;
}

function buildObservationRows({ warehouse, leaderboard = [], horizonDays, allowSyntheticPrices }) {
  const scores = [...(warehouse?.fundamentalScores?.values?.() || [])];
  const featuresByKey = new Map([...(warehouse?.fundamentalFeatures?.values?.() || [])].map((row) => [pairKey(row), row]));
  const statesByKey = new Map([...(warehouse?.fundamentalStates?.values?.() || [])].map((row) => [pairKey(row), row]));
  const coverageByTicker = new Map([...(warehouse?.coverageUniverse?.values?.() || [])].map((row) => [row.ticker, row]));
  const referenceRows = [...(warehouse?.marketReference?.values?.() || [])]
    .filter((row) => row.ticker && row.as_of && Number.isFinite(Number(row.close_price)) && Number(row.close_price) > 0);
  const referencesByTicker = groupByTicker(referenceRows);
  const currentRowsByTicker = new Map((leaderboard || []).map((row) => [row.ticker, row]));
  const targetMs = horizonDays * MS_PER_DAY;

  return scores.map((score) => {
    const at = asDate(score.as_of);
    const references = referencesByTicker.get(score.ticker) || [];
    const entryReference = references
      .filter((reference) => asDate(reference.as_of)?.getTime() <= at?.getTime())
      .at(-1);
    const futureReference = references.find((reference) => {
      const futureAt = asDate(reference.as_of);
      return at && futureAt && futureAt.getTime() - at.getTime() >= targetMs;
    });
    const syntheticPrice = providerIsSynthetic(entryReference) || providerIsSynthetic(futureReference);
    const canUseOutcome =
      Boolean(entryReference && futureReference) &&
      (allowSyntheticPrices || !syntheticPrice);
    const forwardReturn = canUseOutcome
      ? Number(futureReference.close_price) / Number(entryReference.close_price) - 1
      : null;
    const current = currentRowsByTicker.get(score.ticker) || {};

    return {
      ticker: score.ticker,
      as_of: score.as_of,
      sector: score.sector || statesByKey.get(pairKey(score))?.sector || coverageByTicker.get(score.ticker)?.sector || "Unknown",
      score,
      feature: featuresByKey.get(pairKey(score)) || {},
      state: statesByKey.get(pairKey(score)) || {},
      coverage: coverageByTicker.get(score.ticker) || {},
      current,
      entry_price: entryReference?.close_price ?? null,
      exit_price: futureReference?.close_price ?? null,
      entry_provider: entryReference?.market_reference_metadata?.provider || null,
      exit_provider: futureReference?.market_reference_metadata?.provider || null,
      synthetic_price: syntheticPrice,
      has_forward_return: canUseOutcome,
      forward_return: Number.isFinite(forwardReturn) ? round(forwardReturn, 6) : null
    };
  });
}

function currentSettings(config = {}) {
  return {
    screenerMinReportingConfidence: asNumber(config.screenerMinReportingConfidence, 0.85),
    screenerMinDataFreshness: asNumber(config.screenerMinDataFreshness, 0.85),
    screenerMaxMissingFields: asNumber(config.screenerMaxMissingFields, 2),
    screenerMinRevenueGrowth: asNumber(config.screenerMinRevenueGrowth, 0.08),
    screenerMinEpsGrowth: asNumber(config.screenerMinEpsGrowth, 0.1),
    screenerMinOperatingMargin: asNumber(config.screenerMinOperatingMargin, 0.12),
    screenerMinGrossMargin: asNumber(config.screenerMinGrossMargin, 0.35),
    screenerMinCurrentRatio: asNumber(config.screenerMinCurrentRatio, 1),
    screenerMaxNetDebtToEbitda: asNumber(config.screenerMaxNetDebtToEbitda, 3),
    screenerMinFcfConversion: asNumber(config.screenerMinFcfConversion, 0.75),
    screenerMinFcfMargin: asNumber(config.screenerMinFcfMargin, 0.08),
    screenerMaxPeTtm: asNumber(config.screenerMaxPeTtm, 45),
    screenerMaxPeg: asNumber(config.screenerMaxPeg, 2.5),
    screenerMinFcfYield: asNumber(config.screenerMinFcfYield, 0.02),
    screenerEligibleScore: asNumber(config.screenerEligibleScore, 0.71)
  };
}

function evaluateScreenerCriterion(row, key, settings) {
  const feature = row.feature || {};
  const score = row.score || {};
  const coverage = row.coverage || {};

  if (key === "scale") {
    return ["large_cap", "mega_cap"].includes(coverage.market_cap_bucket || row.current?.market_cap_bucket);
  }
  if (key === "filing_quality") {
    return (
      asNumber(score.reporting_confidence_score, 0) >= settings.screenerMinReportingConfidence &&
      asNumber(score.data_freshness_score, 0) >= settings.screenerMinDataFreshness
    );
  }
  if (key === "growth") {
    return (
      asNumber(feature.revenue_growth_yoy, -Infinity) >= settings.screenerMinRevenueGrowth ||
      asNumber(feature.eps_growth_yoy, -Infinity) >= settings.screenerMinEpsGrowth
    );
  }
  if (key === "profitability") {
    return (
      asNumber(feature.operating_margin, -Infinity) >= settings.screenerMinOperatingMargin ||
      asNumber(feature.gross_margin, -Infinity) >= settings.screenerMinGrossMargin
    );
  }
  if (key === "balance_sheet") {
    return (
      asNumber(feature.current_ratio, -Infinity) >= settings.screenerMinCurrentRatio ||
      asNumber(feature.net_debt_to_ebitda, Infinity) <= settings.screenerMaxNetDebtToEbitda
    );
  }
  if (key === "cash_efficiency") {
    return (
      asNumber(feature.fcf_conversion, -Infinity) >= settings.screenerMinFcfConversion ||
      asNumber(feature.fcf_margin, -Infinity) >= settings.screenerMinFcfMargin
    );
  }
  if (key === "valuation_sanity") {
    return (
      asNumber(feature.pe_ttm, Infinity) <= settings.screenerMaxPeTtm ||
      asNumber(feature.peg, Infinity) <= settings.screenerMaxPeg ||
      asNumber(feature.fcf_yield, -Infinity) >= settings.screenerMinFcfYield
    );
  }
  return null;
}

function profilePass(row, settings) {
  const checks = ["scale", "filing_quality", "growth", "profitability", "balance_sheet", "cash_efficiency", "valuation_sanity"]
    .map((key) => evaluateScreenerCriterion(row, key, settings));
  const passCount = checks.filter(Boolean).length;
  const hardFailure = checks[0] === false || checks[1] === false;
  return !hardFailure && passCount >= 5 && asNumber(row.score?.composite_fundamental_score, 0) >= settings.screenerEligibleScore;
}

function sectorSensitivity(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.sector)) {
      grouped.set(row.sector, []);
    }
    grouped.get(row.sector).push(row.forward_return);
  }
  const sectors = [...grouped.entries()]
    .map(([sector, returns]) => ({
      sector,
      sample_size: returns.length,
      average_forward_return: avg(returns)
    }))
    .filter((item) => item.sample_size > 0)
    .sort((left, right) => (right.average_forward_return ?? -Infinity) - (left.average_forward_return ?? -Infinity));
  const averages = sectors.map((item) => item.average_forward_return).filter((value) => Number.isFinite(value));

  return {
    sector_count: sectors.length,
    spread: averages.length ? round(Math.max(...averages) - Math.min(...averages), 6) : null,
    strongest: sectors[0] || null,
    weakest: sectors.at(-1) || null
  };
}

function evaluateTest({ key, label, family, rows, passFn, horizonDays, minSample }) {
  const evaluated = rows
    .map((row) => ({ ...row, passed: passFn(row) }))
    .filter((row) => row.passed !== null && row.passed !== undefined);
  const matured = evaluated.filter((row) => row.has_forward_return);
  const passed = matured.filter((row) => row.passed);
  const failed = matured.filter((row) => !row.passed);
  const passReturns = passed.map((row) => row.forward_return);
  const failReturns = failed.map((row) => row.forward_return);
  const allSyntheticBlocked = evaluated.length > 0 && matured.length === 0 && evaluated.some((row) => row.synthetic_price);
  const status =
    matured.length >= minSample
      ? "validated_sample"
      : allSyntheticBlocked
        ? "blocked_synthetic_prices"
        : "insufficient_forward_returns";

  return {
    key,
    label,
    factor_family: family,
    horizon_days: horizonDays,
    status,
    sample_size: matured.length,
    evaluated_count: evaluated.length,
    pass_count: passed.length,
    fail_count: failed.length,
    hit_rate: passReturns.length ? round(passReturns.filter((value) => value > 0).length / passReturns.length, 4) : null,
    average_forward_return: avg(passReturns) === null ? null : round(avg(passReturns), 6),
    median_forward_return: median(passReturns) === null ? null : round(median(passReturns), 6),
    benchmark_average_forward_return: avg(failReturns) === null ? null : round(avg(failReturns), 6),
    excess_return_vs_failed: avg(passReturns) === null || avg(failReturns) === null ? null : round(avg(passReturns) - avg(failReturns), 6),
    max_drawdown: maxDrawdown(passReturns) === null ? null : round(maxDrawdown(passReturns), 6),
    false_positive_rate: passReturns.length ? round(passReturns.filter((value) => value <= 0).length / passReturns.length, 4) : null,
    sector_sensitivity: sectorSensitivity(passed),
    limitations:
      status === "validated_sample"
        ? []
        : allSyntheticBlocked
          ? ["Forward returns are present only through synthetic/fallback prices; they are excluded from validation."]
          : ["Not enough matured forward-return observations for this horizon yet."]
  };
}

function providerSummary(rows) {
  const counts = rows.reduce((acc, row) => {
    const key = row.entry_provider || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([provider, count]) => ({ provider, count }))
    .sort((left, right) => right.count - left.count);
}

export function buildFundamentalBacktestSnapshot({
  config,
  store,
  horizonDays = DEFAULT_HORIZON_DAYS,
  minSample = DEFAULT_MIN_SAMPLE,
  allowSyntheticPrices = false
} = {}) {
  const warehouse = store?.fundamentalWarehouse;
  const leaderboard = store?.fundamentals?.leaderboard || [];
  const settings = currentSettings(config);
  const observations = buildObservationRows({
    warehouse,
    leaderboard,
    horizonDays: Number(horizonDays || DEFAULT_HORIZON_DAYS),
    allowSyntheticPrices: Boolean(allowSyntheticPrices)
  });
  const scoreTests = FACTOR_TESTS.map((test) =>
    evaluateTest({
      key: test.key,
      label: test.label,
      family: test.family,
      rows: observations,
      horizonDays: Number(horizonDays || DEFAULT_HORIZON_DAYS),
      minSample: Number(minSample || DEFAULT_MIN_SAMPLE),
      passFn: (row) => asNumber(row.score?.[test.field], -Infinity) >= (test.field === "composite_fundamental_score" ? settings.screenerEligibleScore : test.threshold)
    })
  );
  const screenerTests = ["scale", "filing_quality", "growth", "profitability", "balance_sheet", "cash_efficiency", "valuation_sanity"].map((key) =>
    evaluateTest({
      key,
      label: key.replace(/_/g, " "),
      family: "stage_one_screener",
      rows: observations,
      horizonDays: Number(horizonDays || DEFAULT_HORIZON_DAYS),
      minSample: Number(minSample || DEFAULT_MIN_SAMPLE),
      passFn: (row) => evaluateScreenerCriterion(row, key, settings)
    })
  );
  const profileTests = Object.values(FUNDAMENTAL_SCREENER_PROFILES).map((profile) =>
    evaluateTest({
      key: `profile_${profile.key}`,
      label: profile.label,
      family: "screener_profile",
      rows: observations,
      horizonDays: Number(horizonDays || DEFAULT_HORIZON_DAYS),
      minSample: Number(minSample || DEFAULT_MIN_SAMPLE),
      passFn: (row) => profilePass(row, profile.settings)
    })
  );
  const matured = observations.filter((row) => row.has_forward_return);
  const syntheticBlocked = observations.filter((row) => row.synthetic_price && !row.has_forward_return).length;
  const statuses = [...scoreTests, ...screenerTests, ...profileTests].reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return {
    as_of: new Date().toISOString(),
    engine: "fundamental_threshold_backtest_v1",
    horizon_days: Number(horizonDays || DEFAULT_HORIZON_DAYS),
    min_sample: Number(minSample || DEFAULT_MIN_SAMPLE),
    allow_synthetic_prices: Boolean(allowSyntheticPrices),
    status: statuses.validated_sample ? "partially_validated" : "pending_validation",
    summary: {
      observations: observations.length,
      matured_forward_returns: matured.length,
      synthetic_outcomes_excluded: syntheticBlocked,
      ticker_count: new Set(observations.map((row) => row.ticker)).size,
      provider_counts: providerSummary(observations),
      test_status_counts: statuses
    },
    criteria: [...screenerTests, ...scoreTests],
    profiles: profileTests,
    data_requirements: {
      point_in_time_fundamentals: Boolean(observations.length),
      forward_price_history: matured.length >= Number(minSample || DEFAULT_MIN_SAMPLE),
      live_or_vendor_prices_required: !allowSyntheticPrices,
      minimum_observations_per_rule: Number(minSample || DEFAULT_MIN_SAMPLE),
      recommended_history: "3-5 years of point-in-time fundamentals, daily adjusted prices, sector labels, and simulated execution costs."
    },
    recommendations: [
      matured.length < Number(minSample || DEFAULT_MIN_SAMPLE)
        ? "Collect live/vendor daily adjusted prices so forward-return observations can mature."
        : "Review rules with weak excess return or high false-positive rates before increasing paper size.",
      syntheticBlocked
        ? "Synthetic/fallback prices were excluded; do not treat them as research proof."
        : "Keep synthetic-price exclusion enabled for production threshold validation.",
      "Run the backtest after each SEC catch-up and market-data batch so threshold evidence improves over time."
    ]
  };
}
