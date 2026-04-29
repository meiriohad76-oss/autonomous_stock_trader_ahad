import { clamp, makeId, readJson, round } from "../utils/helpers.js";
import { materializeFundamentalPersistence } from "./fundamental-persistence.js";

const SCORE_WEIGHTS = {
  quality: 0.25,
  growth: 0.2,
  valuation: 0.15,
  balanceSheet: 0.15,
  efficiency: 0.1,
  stability: 0.1,
  sector: 0.05
};

const FACTOR_LABELS = {
  quality: "Quality",
  growth: "Growth",
  valuation: "Valuation",
  balance_sheet: "Balance Sheet",
  efficiency: "Efficiency",
  earnings_stability: "Stability",
  sector: "Sector"
};

const FACTOR_SUMMARY = {
  quality: "Capital efficiency, profitability, and cash quality",
  growth: "Revenue, EPS, and free-cash-flow expansion",
  valuation: "Current price versus business performance",
  balance_sheet: "Leverage, liquidity, and coverage durability",
  efficiency: "Cash generation and asset productivity",
  earnings_stability: "Consistency and anomaly resistance",
  sector: "Top-down sector attractiveness"
};

const DERIVED_SECTOR_INPUTS = {
  "Information Technology": {
    growth_breadth: 0.78,
    profitability_strength: 0.74,
    revision_breadth: 0.72,
    relative_valuation: 0.44,
    macro_fit: 0.68,
    sector_price_momentum_3m: 0.11
  },
  "Communication Services": {
    growth_breadth: 0.69,
    profitability_strength: 0.67,
    revision_breadth: 0.64,
    relative_valuation: 0.53,
    macro_fit: 0.61,
    sector_price_momentum_3m: 0.08
  },
  "Consumer Discretionary": {
    growth_breadth: 0.6,
    profitability_strength: 0.55,
    revision_breadth: 0.53,
    relative_valuation: 0.51,
    macro_fit: 0.56,
    sector_price_momentum_3m: 0.05
  },
  "Consumer Staples": {
    growth_breadth: 0.49,
    profitability_strength: 0.63,
    revision_breadth: 0.5,
    relative_valuation: 0.5,
    macro_fit: 0.57,
    sector_price_momentum_3m: 0.03
  },
  "Health Care": {
    growth_breadth: 0.58,
    profitability_strength: 0.66,
    revision_breadth: 0.57,
    relative_valuation: 0.49,
    macro_fit: 0.59,
    sector_price_momentum_3m: 0.04
  },
  Industrials: {
    growth_breadth: 0.54,
    profitability_strength: 0.58,
    revision_breadth: 0.55,
    relative_valuation: 0.52,
    macro_fit: 0.58,
    sector_price_momentum_3m: 0.04
  },
  Financials: {
    growth_breadth: 0.52,
    profitability_strength: 0.62,
    revision_breadth: 0.54,
    relative_valuation: 0.56,
    macro_fit: 0.55,
    sector_price_momentum_3m: 0.03
  },
  Energy: {
    growth_breadth: 0.46,
    profitability_strength: 0.57,
    revision_breadth: 0.48,
    relative_valuation: 0.62,
    macro_fit: 0.51,
    sector_price_momentum_3m: 0.02
  },
  Materials: {
    growth_breadth: 0.48,
    profitability_strength: 0.54,
    revision_breadth: 0.49,
    relative_valuation: 0.55,
    macro_fit: 0.51,
    sector_price_momentum_3m: 0.02
  },
  Utilities: {
    growth_breadth: 0.41,
    profitability_strength: 0.52,
    revision_breadth: 0.43,
    relative_valuation: 0.51,
    macro_fit: 0.49,
    sector_price_momentum_3m: 0.01
  },
  "Real Estate": {
    growth_breadth: 0.43,
    profitability_strength: 0.51,
    revision_breadth: 0.44,
    relative_valuation: 0.48,
    macro_fit: 0.47,
    sector_price_momentum_3m: 0.01
  },
  Unknown: {
    growth_breadth: 0.5,
    profitability_strength: 0.5,
    revision_breadth: 0.5,
    relative_valuation: 0.5,
    macro_fit: 0.5,
    sector_price_momentum_3m: 0.02
  }
};

const INITIAL_SCREENER_CRITERIA = [
  { key: "scale", label: "Large-cap scale" },
  { key: "filing_quality", label: "High filing quality" },
  { key: "growth", label: "Growth clears baseline" },
  { key: "profitability", label: "Profitability clears baseline" },
  { key: "balance_sheet", label: "Balance sheet is healthy" },
  { key: "cash_efficiency", label: "Cash conversion is acceptable" },
  { key: "valuation_sanity", label: "Valuation is still tradable" }
];

function screenerSettingsFromConfig(config = {}) {
  return {
    requireLiveSecForEligible: Boolean(config.screenerRequireLiveSecForEligible),
    minReportingConfidence: Number(config.screenerMinReportingConfidence ?? 0.85),
    minDataFreshness: Number(config.screenerMinDataFreshness ?? 0.85),
    maxMissingFields: Number(config.screenerMaxMissingFields ?? 2),
    minRevenueGrowth: Number(config.screenerMinRevenueGrowth ?? 0.08),
    minEpsGrowth: Number(config.screenerMinEpsGrowth ?? 0.1),
    minOperatingMargin: Number(config.screenerMinOperatingMargin ?? 0.12),
    minGrossMargin: Number(config.screenerMinGrossMargin ?? 0.35),
    minCurrentRatio: Number(config.screenerMinCurrentRatio ?? 1),
    maxNetDebtToEbitda: Number(config.screenerMaxNetDebtToEbitda ?? 3),
    minFcfConversion: Number(config.screenerMinFcfConversion ?? 0.75),
    minFcfMargin: Number(config.screenerMinFcfMargin ?? 0.08),
    maxPeTtm: Number(config.screenerMaxPeTtm ?? 45),
    maxPeg: Number(config.screenerMaxPeg ?? 2.5),
    minFcfYield: Number(config.screenerMinFcfYield ?? 0.02),
    eligibleScore: Number(config.screenerEligibleScore ?? 0.71),
    watchScore: Number(config.screenerWatchScore ?? 0.43)
  };
}

function buildScreenerCriteria(settings = screenerSettingsFromConfig()) {
  return [
    {
      key: "scale",
      label: "Large-cap scale",
      summary: "The name must already be trading at meaningful institutional scale.",
      why: "This keeps the first-pass screen focused on names with deeper liquidity and broader institutional sponsorship.",
      rule: "Market-cap bucket must be large_cap or mega_cap."
    },
    {
      key: "filing_quality",
      label: "High filing quality",
      summary: "The filing data needs to be recent, complete, and internally reliable.",
      why: "A strong fundamental call is less trustworthy if the latest filing snapshot is stale or incomplete.",
      rule: `Reporting >= ${round(settings.minReportingConfidence, 2)}, freshness >= ${round(settings.minDataFreshness, 2)}, missing fields <= ${settings.maxMissingFields}.`
    },
    {
      key: "growth",
      label: "Growth clears baseline",
      summary: "At least one core growth signal should already be above the baseline hurdle.",
      why: "The screener wants evidence that the business is still expanding rather than merely looking optically cheap.",
      rule: `Revenue growth >= ${round(settings.minRevenueGrowth * 100, 1)}% OR EPS growth >= ${round(settings.minEpsGrowth * 100, 1)}%.`
    },
    {
      key: "profitability",
      label: "Profitability clears baseline",
      summary: "The company needs either healthy operating leverage or strong gross economics.",
      why: "A business can grow quickly and still be low quality if margins are too thin or deteriorating.",
      rule: `Operating margin >= ${round(settings.minOperatingMargin * 100, 1)}% OR gross margin >= ${round(settings.minGrossMargin * 100, 1)}%.`
    },
    {
      key: "balance_sheet",
      label: "Balance sheet is healthy",
      summary: "Near-term liquidity or leverage must stay inside acceptable bounds.",
      why: "Even attractive growth stories can fail a first-pass screen if the balance sheet creates financing risk.",
      rule: `Current ratio >= ${round(settings.minCurrentRatio, 2)} OR net debt / EBITDA <= ${round(settings.maxNetDebtToEbitda, 2)}.`
    },
    {
      key: "cash_efficiency",
      label: "Cash conversion is acceptable",
      summary: "Reported earnings or growth should translate into real cash generation.",
      why: "This helps filter out names where accounting strength is not yet showing up in free cash flow.",
      rule: `FCF conversion >= ${round(settings.minFcfConversion, 2)} OR FCF margin >= ${round(settings.minFcfMargin * 100, 1)}%.`
    },
    {
      key: "valuation_sanity",
      label: "Valuation is still tradable",
      summary: "The valuation cannot already be so stretched that the setup becomes hard to underwrite.",
      why: "The screen is trying to keep names investable, not just fundamentally interesting at any price.",
      rule: `P/E <= ${round(settings.maxPeTtm, 1)} OR PEG <= ${round(settings.maxPeg, 2)} OR FCF yield >= ${round(settings.minFcfYield * 100, 1)}%.`
    }
  ];
}

function buildScreenerView(leaderboard, baseScreener = {}, screenerSettings = screenerSettingsFromConfig()) {
  const eligible = leaderboard.filter((item) => item.initial_screen?.stage === "eligible");
  const watch = leaderboard.filter((item) => item.initial_screen?.stage === "watch");
  const rejected = leaderboard.filter((item) => item.initial_screen?.stage === "reject");
  const bootstrapPlaceholders = leaderboard.filter((item) => item.data_source === "bootstrap_placeholder");
  const liveSecBacked = leaderboard.filter((item) => item.data_source === "live_sec_filing");

  return {
    criteria: baseScreener.criteria || buildScreenerCriteria(screenerSettings),
    explanation:
      baseScreener.explanation || {
        headline: "Stage one is a first-pass gate, not the final ranking model.",
        eligible: "Eligible names pass most checks, avoid hard failures, and are backed by live SEC filing data.",
        watch: "Watch names either miss several checks or are still waiting for live SEC refresh to replace bootstrap placeholders.",
        reject: "Rejected names fail too many checks or trip a hard failure."
      },
    tracked_count: leaderboard.length,
    eligible_count: eligible.length,
    watch_count: watch.length,
    rejected_count: rejected.length,
    live_sec_backed_count: liveSecBacked.length,
    bootstrap_placeholder_count: bootstrapPlaceholders.length,
    pass_rate: leaderboard.length ? round(eligible.length / leaderboard.length, 3) : 0,
    candidates: eligible.map((item) => ({
      ticker: item.ticker,
      company_name: item.company_name,
      sector: item.sector,
      data_source: item.data_source,
      screen_score: item.initial_screen.score,
      passed_count: item.initial_screen.passed_count,
      total_checks: item.initial_screen.total_checks,
      composite_fundamental_score: item.composite_fundamental_score,
      final_confidence: item.final_confidence
    })),
    watchlist: watch.map((item) => ({
      ticker: item.ticker,
      company_name: item.company_name,
      sector: item.sector,
      data_source: item.data_source,
      screen_score: item.initial_screen.score,
      passed_count: item.initial_screen.passed_count,
      total_checks: item.initial_screen.total_checks,
      failed_checks: item.initial_screen.failed_checks
    }))
  };
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function median(values) {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!usable.length) {
    return 0;
  }
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? (usable[middle - 1] + usable[middle]) / 2 : usable[middle];
}

function percentileRank(value, population, { higherIsBetter = true } = {}) {
  const usable = population.filter((item) => Number.isFinite(item));
  if (!usable.length) {
    return 0.5;
  }

  const lessThan = usable.filter((item) => item < value).length;
  const equalTo = usable.filter((item) => item === value).length;
  const rank = (lessThan + Math.max(0, equalTo - 1) * 0.5) / Math.max(1, usable.length - 1);
  return higherIsBetter ? clamp(rank, 0, 1) : clamp(1 - rank, 0, 1);
}

function blendedPercentile(company, companies, metricName, { higherIsBetter = true } = {}) {
  const sectorPeers = companies.filter((item) => item.sector === company.sector).map((item) => item.metrics[metricName]);
  const globalPeers = companies.map((item) => item.metrics[metricName]);
  const sectorWeight = sectorPeers.length >= 3 ? 0.7 : 0.5;
  const sectorPercentile = percentileRank(company.metrics[metricName], sectorPeers, { higherIsBetter });
  const globalPercentile = percentileRank(company.metrics[metricName], globalPeers, { higherIsBetter });
  return round(sectorPercentile * sectorWeight + globalPercentile * (1 - sectorWeight), 3);
}

function overrideMetric(metrics, key, nextValue) {
  return isFiniteNumber(nextValue) ? { ...metrics, [key]: Number(nextValue) } : metrics;
}

function anomalyPenalty(company) {
  const flags = company.quality_flags;
  return clamp(
    round(flags.anomaly_flags.length * 0.1 + flags.missing_fields_count * 0.04 + (flags.restatement_flag ? 0.16 : 0), 3),
    0,
    0.45
  );
}

function buildSectorScores(sample, companies) {
  const explicitInputs = new Map((sample.sector_inputs || []).map((input) => [input.sector, input]));

  for (const sector of [...new Set(companies.map((company) => company.sector || "Unknown"))]) {
    if (explicitInputs.has(sector)) {
      continue;
    }

    explicitInputs.set(sector, {
      sector,
      ...(DERIVED_SECTOR_INPUTS[sector] || DERIVED_SECTOR_INPUTS.Unknown)
    });
  }

  return [...explicitInputs.values()]
    .map((input) => {
      const constituents = companies.filter((company) => company.sector === input.sector);
      const sectorScore = round(
        input.growth_breadth * 0.3 +
          input.profitability_strength * 0.2 +
          input.revision_breadth * 0.2 +
          input.relative_valuation * 0.15 +
          input.macro_fit * 0.15,
        3
      );

      return {
        sector: input.sector,
        as_of: sample.as_of,
        growth_breadth: input.growth_breadth,
        profitability_strength: input.profitability_strength,
        revision_breadth: input.revision_breadth,
        relative_valuation: input.relative_valuation,
        macro_fit: input.macro_fit,
        sector_price_momentum_3m: input.sector_price_momentum_3m,
        median_revenue_growth: round(median(constituents.map((item) => item.metrics.revenue_growth_yoy)), 3),
        median_operating_margin: round(median(constituents.map((item) => item.metrics.operating_margin)), 3),
        median_roic: round(median(constituents.map((item) => item.metrics.roic)), 3),
        median_pe_ttm: round(median(constituents.map((item) => item.metrics.pe_ttm)), 2),
        data_completeness: round(
          1 - average(constituents.map((item) => Math.min(0.4, item.quality_flags.missing_fields_count * 0.05))),
          3
        ),
        sector_attractiveness_score: sectorScore
      };
    })
    .sort((a, b) => b.sector_attractiveness_score - a.sector_attractiveness_score)
    .map((sector, index) => ({ ...sector, rank: index + 1 }));
}

function ratingLabel(score, delta) {
  if (score >= 0.74) {
    return "fundamentally_strong";
  }
  if (score >= 0.56) {
    return "balanced";
  }
  if (delta <= -0.05 || score < 0.4) {
    return "deteriorating";
  }
  return "weak";
}

function valuationLabel(score) {
  if (score >= 0.72) {
    return "cheap";
  }
  if (score >= 0.48) {
    return "fair";
  }
  if (score >= 0.24) {
    return "expensive";
  }
  return "extremely_expensive";
}

function directionLabel(composite, confidence, sectorScore) {
  if (composite >= 0.68 && confidence >= 0.72 && sectorScore >= 0.55) {
    return "bullish_supportive";
  }
  if (composite <= 0.44 || confidence <= 0.58 || sectorScore <= 0.42) {
    return "bearish_headwind";
  }
  return "neutral";
}

function regimeLabel(scorePack, valuation, delta, anomalies) {
  if (scorePack.quality >= 0.76 && valuation <= 0.4) {
    return "quality_at_premium";
  }
  if (scorePack.quality >= 0.72 && scorePack.growth >= 0.68 && valuation >= 0.48) {
    return "compounder";
  }
  if (scorePack.growth >= 0.6 && delta >= 0.05) {
    return "cyclical_recovery";
  }
  if (valuation >= 0.62 && scorePack.quality <= 0.44) {
    return "value_trap_risk";
  }
  if (anomalies > 0.22 || scorePack.balanceSheet <= 0.35) {
    return "distressed";
  }
  return "mixed";
}

function buildReasonCodes(company, factorScores, anomalyScore) {
  const reasons = [];
  if (company.metrics.roic >= 0.2) {
    reasons.push("high_roic");
  }
  if (company.metrics.operating_margin >= 0.25) {
    reasons.push("strong_margin_profile");
  }
  if (company.metrics.fcf_conversion >= 0.95 && company.metrics.fcf_margin >= 0.12) {
    reasons.push("solid_fcf");
  }
  if (factorScores.valuation <= 0.35) {
    reasons.push("premium_valuation");
  }
  if (factorScores.growth <= 0.35) {
    reasons.push("weak_growth");
  }
  if (factorScores.balanceSheet <= 0.35) {
    reasons.push("balance_sheet_pressure");
  }
  if (anomalyScore >= 0.18) {
    reasons.push("comparability_risk");
  }
  if (company.market_reference?.live) {
    reasons.push("live_market_reference");
  }
  return reasons.slice(0, 5);
}

function buildStrengthWeaknesses(factorScores) {
  const ordered = Object.entries(factorScores).sort((a, b) => b[1] - a[1]);
  return {
    strengths: ordered.slice(0, 3).map(([key]) => FACTOR_LABELS[key]),
    weaknesses: ordered.slice(-2).map(([key]) => FACTOR_LABELS[key])
  };
}

function buildScoreHistory(previous, current, asOf) {
  const steps = [-120, -90, -60, -30, -7, 0];
  return steps.map((days, index) => {
    const progress = index / Math.max(1, steps.length - 1);
    return {
      label: days === 0 ? "Now" : `${Math.abs(days)}d`,
      timestamp: new Date(new Date(asOf).getTime() + days * 86400000).toISOString(),
      score: round(previous + (current - previous) * progress, 3)
    };
  });
}

function buildFilingTimeline(company) {
  const filingDate = new Date(company.filing_date);
  return [
    {
      form_type: company.form_type,
      filing_date: company.filing_date,
      period_end: company.period_end,
      note: company.summary,
      url: company.filing_url
    },
    {
      form_type: "8-K",
      filing_date: new Date(filingDate.getTime() - 14 * 86400000).toISOString().slice(0, 10),
      period_end: company.period_end,
      note: company.notes[0],
      url: company.filing_url
    },
    {
      form_type: "10-K",
      filing_date: new Date(filingDate.getTime() - 92 * 86400000).toISOString().slice(0, 10),
      period_end: new Date(new Date(company.period_end).getTime() - 365 * 86400000).toISOString().slice(0, 10),
      note: company.notes[1] || company.summary,
      url: company.filing_url
    }
  ];
}

function buildFactorCards(factorScores) {
  return Object.entries(factorScores).map(([key, value]) => ({
    key,
    label: FACTOR_LABELS[key],
    summary: FACTOR_SUMMARY[key],
    value: round(value, 3)
  }));
}

function evaluateInitialScreener(company, settings) {
  const metrics = company.metrics || {};
  const qualityFlags = company.quality_flags || {};
  const awaitingSecRefresh = (qualityFlags.anomaly_flags || []).includes("awaiting_sec_refresh");

  const checks = [
    {
      key: "scale",
      label: "Large-cap scale",
      passed: ["mega_cap", "large_cap"].includes(company.market_cap_bucket)
    },
    {
      key: "filing_quality",
      label: "High filing quality",
      passed:
        qualityFlags.reporting_confidence_score >= settings.minReportingConfidence &&
        qualityFlags.data_freshness_score >= settings.minDataFreshness &&
        Number(qualityFlags.missing_fields_count || 0) <= settings.maxMissingFields
    },
    {
      key: "growth",
      label: "Growth clears baseline",
      passed:
        Number(metrics.revenue_growth_yoy || 0) >= settings.minRevenueGrowth ||
        Number(metrics.eps_growth_yoy || 0) >= settings.minEpsGrowth
    },
    {
      key: "profitability",
      label: "Profitability clears baseline",
      passed:
        Number(metrics.operating_margin || 0) >= settings.minOperatingMargin ||
        Number(metrics.gross_margin || 0) >= settings.minGrossMargin
    },
    {
      key: "balance_sheet",
      label: "Balance sheet is healthy",
      passed:
        Number(metrics.current_ratio || 0) >= settings.minCurrentRatio ||
        Number(metrics.net_debt_to_ebitda || 0) <= settings.maxNetDebtToEbitda
    },
    {
      key: "cash_efficiency",
      label: "Cash conversion is acceptable",
      passed:
        Number(metrics.fcf_conversion || 0) >= settings.minFcfConversion ||
        Number(metrics.fcf_margin || 0) >= settings.minFcfMargin
    },
    {
      key: "valuation_sanity",
      label: "Valuation is still tradable",
      passed:
        Number(metrics.pe_ttm || Number.POSITIVE_INFINITY) <= settings.maxPeTtm ||
        Number(metrics.peg || Number.POSITIVE_INFINITY) <= settings.maxPeg ||
        Number(metrics.fcf_yield || 0) >= settings.minFcfYield
    }
  ];

  const hardFailures = [];
  if (qualityFlags.restatement_flag) {
    hardFailures.push("recent restatement risk");
  }
  if (Number(qualityFlags.reporting_confidence_score || 0) < 0.75) {
    hardFailures.push("low reporting confidence");
  }
  if (Number(qualityFlags.data_freshness_score || 0) < 0.75) {
    hardFailures.push("stale filing data");
  }
  if (Number(qualityFlags.missing_fields_count || 0) > 4) {
    hardFailures.push("too many missing fields");
  }

  const passedChecks = checks.filter((item) => item.passed).map((item) => item.label);
  const failedChecks = checks.filter((item) => !item.passed).map((item) => item.label);
  const passedCount = passedChecks.length;
  const screenScore = round(passedCount / checks.length, 3);

  let stage = "reject";
  if (!hardFailures.length && screenScore >= settings.eligibleScore) {
    stage = "eligible";
  } else if (!hardFailures.length && screenScore >= settings.watchScore) {
    stage = "watch";
  }

  if (settings.requireLiveSecForEligible && awaitingSecRefresh && stage === "eligible") {
    stage = "watch";
    failedChecks.unshift("Live SEC filing refresh still pending");
  }

  return {
    stage,
    passed: stage === "eligible",
    score: screenScore,
    passed_count: passedCount,
    total_checks: checks.length,
    provisional: awaitingSecRefresh,
    passed_checks: passedChecks,
    failed_checks: failedChecks,
    hard_failures: hardFailures,
    summary:
      stage === "eligible"
        ? "Passes the initial liquidity, quality, growth, and tradability gate with live filing-backed support."
        : awaitingSecRefresh
          ? "Looks broadly investable, but stays in watch until a live SEC filing refresh replaces the bootstrap placeholder metrics."
        : stage === "watch"
          ? "Shows some strong traits but misses enough baseline checks to stay on watch rather than pass."
          : "Fails the current first-pass screen and should not enter the ranked candidate set yet."
  };
}

function mergeCompanyWithMarketReference(company, reference) {
  let metrics = { ...company.metrics };
  metrics = overrideMetric(metrics, "pe_ttm", reference?.trailing_pe);
  metrics = overrideMetric(metrics, "price_to_sales_ttm", reference?.price_to_sales_ttm);
  metrics = overrideMetric(metrics, "ev_to_ebitda_ttm", reference?.enterprise_to_ebitda);
  metrics = overrideMetric(metrics, "peg", reference?.peg);
  metrics = overrideMetric(metrics, "gross_margin", reference?.gross_margin);
  metrics = overrideMetric(metrics, "operating_margin", reference?.operating_margin);
  metrics = overrideMetric(metrics, "net_margin", reference?.net_margin);
  metrics = overrideMetric(metrics, "roe", reference?.return_on_equity_ttm);
  metrics = overrideMetric(metrics, "revenue_growth_yoy", reference?.quarterly_revenue_growth);
  metrics = overrideMetric(metrics, "fcf_yield", reference?.fcf_yield);

  return {
    ...company,
    metrics,
    quality_flags: {
      ...company.quality_flags,
      data_freshness_score: reference?.live
        ? Math.max(company.quality_flags.data_freshness_score, 0.99)
        : company.quality_flags.data_freshness_score
    },
    market_reference: reference || company.market_reference || null
  };
}

function scoreCompany(company, companies, sectorScores, screenerSettings) {
  const initialScreen = evaluateInitialScreener(company, screenerSettings);
  const sector = sectorScores.find((item) => item.sector === company.sector);
  const scores = {
    quality: round(
      average([
        blendedPercentile(company, companies, "gross_margin"),
        blendedPercentile(company, companies, "operating_margin"),
        blendedPercentile(company, companies, "net_margin"),
        blendedPercentile(company, companies, "roe"),
        blendedPercentile(company, companies, "roic"),
        blendedPercentile(company, companies, "fcf_conversion")
      ]),
      3
    ),
    growth: round(
      average([
        blendedPercentile(company, companies, "revenue_growth_yoy"),
        blendedPercentile(company, companies, "eps_growth_yoy"),
        blendedPercentile(company, companies, "fcf_growth_yoy")
      ]),
      3
    ),
    valuation: round(
      average([
        blendedPercentile(company, companies, "pe_ttm", { higherIsBetter: false }),
        blendedPercentile(company, companies, "ev_to_ebitda_ttm", { higherIsBetter: false }),
        blendedPercentile(company, companies, "price_to_sales_ttm", { higherIsBetter: false }),
        blendedPercentile(company, companies, "peg", { higherIsBetter: false }),
        blendedPercentile(company, companies, "fcf_yield")
      ]),
      3
    ),
    balanceSheet: round(
      average([
        blendedPercentile(company, companies, "debt_to_equity", { higherIsBetter: false }),
        blendedPercentile(company, companies, "net_debt_to_ebitda", { higherIsBetter: false }),
        blendedPercentile(company, companies, "current_ratio"),
        blendedPercentile(company, companies, "interest_coverage")
      ]),
      3
    ),
    efficiency: round(
      average([
        blendedPercentile(company, companies, "asset_turnover"),
        blendedPercentile(company, companies, "fcf_margin"),
        blendedPercentile(company, companies, "fcf_conversion")
      ]),
      3
    ),
    stability: round(average([company.metrics.margin_stability, company.metrics.revenue_consistency, 1 - anomalyPenalty(company)]), 3),
    sector: sector?.sector_attractiveness_score || 0.5
  };

  const composite = round(
    scores.quality * SCORE_WEIGHTS.quality +
      scores.growth * SCORE_WEIGHTS.growth +
      scores.valuation * SCORE_WEIGHTS.valuation +
      scores.balanceSheet * SCORE_WEIGHTS.balanceSheet +
      scores.efficiency * SCORE_WEIGHTS.efficiency +
      scores.stability * SCORE_WEIGHTS.stability +
      scores.sector * SCORE_WEIGHTS.sector,
    3
  );
  const anomaly = anomalyPenalty(company);
  const confidence = round(
    clamp(
      company.quality_flags.rule_confidence * 0.3 +
        company.quality_flags.reporting_confidence_score * 0.2 +
        company.quality_flags.data_freshness_score * 0.15 +
        company.quality_flags.peer_comparability_score * 0.15 +
        company.quality_flags.llm_confidence * 0.1 +
        (1 - anomaly) * 0.1,
      0,
      1
    ),
    3
  );
  const delta = round(composite - company.previous_composite_score, 3);
  const labels = {
    rating_label: ratingLabel(composite, delta),
    valuation_label: valuationLabel(scores.valuation),
    direction_label: directionLabel(composite, confidence, scores.sector),
    regime_label: regimeLabel(scores, scores.valuation, delta, anomaly)
  };
  const factorScores = {
    quality: scores.quality,
    growth: scores.growth,
    valuation: scores.valuation,
    balance_sheet: scores.balanceSheet,
    efficiency: scores.efficiency,
    earnings_stability: scores.stability,
    sector: scores.sector
  };
  const strengths = buildStrengthWeaknesses(factorScores);

  return {
    ticker: company.ticker,
    company_name: company.company_name,
    data_source: company.data_source || "replayed_sample",
    sector: company.sector,
    industry: company.industry,
    exchange: company.exchange,
    market_cap_bucket: company.market_cap_bucket,
    cik: company.cik,
    as_of: company.as_of,
    filing_date: company.filing_date,
    period_end: company.period_end,
    form_type: company.form_type,
    filing_url: company.filing_url,
    score_delta_30d: delta,
    composite_fundamental_score: composite,
    quality_score: scores.quality,
    growth_score: scores.growth,
    valuation_score: scores.valuation,
    balance_sheet_score: scores.balanceSheet,
    efficiency_score: scores.efficiency,
    earnings_stability_score: scores.stability,
    sector_score: scores.sector,
    reporting_confidence_score: company.quality_flags.reporting_confidence_score,
    data_freshness_score: company.quality_flags.data_freshness_score,
    peer_comparability_score: company.quality_flags.peer_comparability_score,
    rule_confidence: company.quality_flags.rule_confidence,
    llm_confidence: company.quality_flags.llm_confidence,
    final_confidence: confidence,
    anomaly_penalty: anomaly,
    initial_screen: initialScreen,
    rating_label: labels.rating_label,
    valuation_label: labels.valuation_label,
    direction_label: labels.direction_label,
    regime_label: labels.regime_label,
    reason_codes: buildReasonCodes(company, scores, anomaly),
    top_strengths: strengths.strengths,
    top_weaknesses: strengths.weaknesses,
    explanation_short: company.summary,
    factor_cards: buildFactorCards(factorScores),
    peer_percentiles: {
      revenue_growth_pctile: blendedPercentile(company, companies, "revenue_growth_yoy"),
      operating_margin_pctile: blendedPercentile(company, companies, "operating_margin"),
      roic_pctile: blendedPercentile(company, companies, "roic"),
      valuation_pctile: blendedPercentile(company, companies, "pe_ttm", { higherIsBetter: false }),
      balance_sheet_pctile: scores.balanceSheet
    },
    metric_snapshot: company.metrics,
    confidence_breakdown: {
      rule_confidence: company.quality_flags.rule_confidence,
      reporting_confidence_score: company.quality_flags.reporting_confidence_score,
      data_freshness_score: company.quality_flags.data_freshness_score,
      peer_comparability_score: company.quality_flags.peer_comparability_score,
      llm_confidence: company.quality_flags.llm_confidence,
      anomaly_penalty: anomaly
    },
    quality_flags: company.quality_flags,
    notes: company.notes,
    score_history: buildScoreHistory(company.previous_composite_score, composite, company.as_of),
    filing_timeline: buildFilingTimeline(company),
    market_reference: company.market_reference || null
  };
}

function buildSectorDetail(sector, leaderboard) {
  const constituents = leaderboard.filter((item) => item.sector === sector.sector);
  return {
    ...sector,
    leaders: constituents.slice(0, 3).map((item) => ({
      ticker: item.ticker,
      company_name: item.company_name,
      composite_fundamental_score: item.composite_fundamental_score,
      final_confidence: item.final_confidence,
      direction_label: item.direction_label
    })),
    average_company_score: round(average(constituents.map((item) => item.composite_fundamental_score)), 3),
    average_company_confidence: round(average(constituents.map((item) => item.final_confidence)), 3)
  };
}

function buildChangeEvent(companyScore, index, totalCompanies) {
  const type =
    companyScore.anomaly_penalty >= 0.18
      ? "anomaly_flag"
      : companyScore.score_delta_30d >= 0.05
        ? "company_rank_jump"
        : companyScore.final_confidence <= 0.66
          ? "confidence_drop"
          : "filing_processed";

  const changes = [];
  if (companyScore.growth_score >= 0.68) {
    changes.push("growth bucket improved");
  }
  if (companyScore.valuation_score <= 0.34) {
    changes.push("valuation remains stretched");
  }
  if (companyScore.balance_sheet_score <= 0.4) {
    changes.push("balance sheet needs monitoring");
  }
  if (companyScore.anomaly_penalty >= 0.18) {
    changes.push("comparability penalty is elevated");
  }
  if (companyScore.market_reference?.live) {
    changes.push("live market reference refreshed");
  }
  if (!changes.length) {
    changes.push("factor pack refreshed");
  }

  return {
    event_id: makeId(),
    type,
    ticker: companyScore.ticker,
    sector: companyScore.sector,
    as_of: new Date(Date.now() - (totalCompanies - index) * 240000).toISOString(),
    form_type: companyScore.form_type,
    filing_date: companyScore.filing_date,
    changes,
    confidence: companyScore.final_confidence,
    composite_fundamental_score: companyScore.composite_fundamental_score,
    score_delta_30d: companyScore.score_delta_30d,
    rating_label: companyScore.rating_label
  };
}

function buildInitialScreener(leaderboard, screenerSettings) {
  return buildScreenerView(leaderboard, {}, screenerSettings);
}

export function buildInitialScreenerSnapshot(leaderboard = [], screenerSettings = screenerSettingsFromConfig()) {
  return buildInitialScreener(leaderboard, screenerSettings);
}

function buildSnapshot(sample, companies, screenerSettings) {
  const sectorScores = buildSectorScores(sample, companies);
  const leaderboard = companies
    .map((company) => scoreCompany(company, companies, sectorScores, screenerSettings))
    .sort((a, b) => b.composite_fundamental_score - a.composite_fundamental_score)
    .map((item, index) => ({ ...item, rank_global: index + 1 }));

  const sectorRankLookup = new Map();
  for (const sector of sectorScores) {
    const sectorCompanies = leaderboard.filter((item) => item.sector === sector.sector);
    sectorRankLookup.set(sector.sector, new Map(sectorCompanies.map((item, index) => [item.ticker, index + 1])));
  }

  const withRanks = leaderboard.map((item) => ({
    ...item,
    rank_in_sector: sectorRankLookup.get(item.sector)?.get(item.ticker) || 1
  }));
  const sectors = sectorScores.map((sector) => buildSectorDetail(sector, withRanks));
  const screener = buildInitialScreener(withRanks, screenerSettings);
  const changes = withRanks
    .map((item, index) => buildChangeEvent(item, index, withRanks.length))
    .sort((a, b) => new Date(b.as_of) - new Date(a.as_of));
  const completeness = companies.map((company) => clamp(1 - company.quality_flags.missing_fields_count * 0.05, 0.7, 1));

  return {
    asOf: sample.as_of,
    summary: {
      coverage_count: withRanks.length,
      sectors_covered: sectors.length,
      new_filings_today: companies.filter((company) => company.filing_date === sample.as_of.slice(0, 10)).length,
      average_confidence: round(average(withRanks.map((item) => item.final_confidence)), 3),
      average_composite_score: round(average(withRanks.map((item) => item.composite_fundamental_score)), 3),
      data_completeness: round(average(completeness), 3)
    },
    screener,
    leaderboard: withRanks,
    sectors,
    changes
  };
}

function filteredSnapshot(snapshot, filters = {}) {
  const sector = filters.sector || null;
  const minConfidence = Number.isFinite(filters.minConfidence) ? filters.minConfidence : null;
  const search = String(filters.search || "").trim().toLowerCase();
  const onlyChanged = Boolean(filters.onlyChanged);
  const screenStage = filters.screenStage || null;

  const leaderboard = snapshot.leaderboard.filter((item) => {
    if (sector && item.sector !== sector) {
      return false;
    }
    if (minConfidence && item.final_confidence < minConfidence) {
      return false;
    }
    if (search && !`${item.ticker} ${item.company_name}`.toLowerCase().includes(search)) {
      return false;
    }
    if (onlyChanged && Math.abs(item.score_delta_30d) < 0.03) {
      return false;
    }
    if (screenStage && item.initial_screen?.stage !== screenStage) {
      return false;
    }
    return true;
  });

  const visibleTickers = new Set(leaderboard.map((item) => item.ticker));
  const sectors = snapshot.sectors
    .filter((item) => {
      if (sector && item.sector !== sector) {
        return false;
      }
      return leaderboard.some((row) => row.sector === item.sector);
    })
    .map((item) => buildSectorDetail(item, leaderboard))
    .sort((a, b) => b.sector_attractiveness_score - a.sector_attractiveness_score)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const changes = snapshot.changes
    .filter((item) => visibleTickers.has(item.ticker))
    .slice(0, 12);

  const completeness = leaderboard.length
    ? leaderboard.map((item) => clamp(1 - Number(item.quality_flags?.missing_fields_count || 0) * 0.05, 0.7, 1))
    : [];

  const summary = {
    coverage_count: leaderboard.length,
    sectors_covered: sectors.length,
    new_filings_today: leaderboard.filter((item) => item.filing_date === String(snapshot.asOf || "").slice(0, 10)).length,
    average_confidence: round(average(leaderboard.map((item) => item.final_confidence)), 3),
    average_composite_score: round(average(leaderboard.map((item) => item.composite_fundamental_score)), 3),
    data_completeness: round(average(completeness), 3)
  };

  const screener = buildScreenerView(leaderboard, snapshot.screener);

  return {
    as_of: snapshot.asOf,
    summary,
    screener,
    leaderboard,
    sectors,
    changes
  };
}

export function createEmptyFundamentalsState() {
  const screenerSettings = screenerSettingsFromConfig();
  return {
    asOf: null,
    summary: {
      coverage_count: 0,
      sectors_covered: 0,
      new_filings_today: 0,
      average_confidence: 0,
      average_composite_score: 0,
      data_completeness: 0
    },
    screener: {
      criteria: buildScreenerCriteria(screenerSettings),
      explanation: {
        headline: "Stage one is a first-pass gate, not the final ranking model.",
        eligible: "Eligible names pass most checks, avoid hard failures, and are backed by live SEC filing data.",
        watch: "Watch names either miss several checks or are still waiting for live SEC refresh to replace bootstrap placeholders.",
        reject: "Rejected names fail too many checks or trip a hard failure."
      },
      tracked_count: 0,
      eligible_count: 0,
      watch_count: 0,
      rejected_count: 0,
      live_sec_backed_count: 0,
      bootstrap_placeholder_count: 0,
      pass_rate: 0,
      candidates: [],
      watchlist: []
    },
    leaderboard: [],
    sectors: [],
    changes: [],
    byTicker: new Map(),
    bySector: new Map()
  };
}

function snapshotToStoreShape(snapshot) {
  return {
    ...snapshot,
    byTicker: new Map(snapshot.leaderboard.map((item) => [item.ticker, item])),
    bySector: new Map(snapshot.sectors.map((item) => [item.sector, item]))
  };
}

function emitSnapshotDiff(store, previousSnapshot, nextSnapshot) {
  const previousByTicker = previousSnapshot?.byTicker || new Map();

  for (const current of nextSnapshot.leaderboard) {
    const previous = previousByTicker.get(current.ticker);
    const changed =
      !previous ||
      Math.abs(previous.composite_fundamental_score - current.composite_fundamental_score) >= 0.001 ||
      Math.abs(previous.final_confidence - current.final_confidence) >= 0.001 ||
      previous.rating_label !== current.rating_label ||
      previous.market_reference?.provider !== current.market_reference?.provider ||
      Math.abs((previous.market_reference?.current_price || 0) - (current.market_reference?.current_price || 0)) >= 0.01;

    if (!changed) {
      continue;
    }

    store.bus.emit("event", {
      type: "fundamental_score_update",
      ticker: current.ticker,
      as_of: current.as_of,
      composite_fundamental_score: current.composite_fundamental_score,
      final_confidence: current.final_confidence,
      score_delta_30d: current.score_delta_30d,
      rating_label: current.rating_label,
      provider: current.market_reference?.provider || "synthetic",
      current_price: current.market_reference?.current_price || null
    });
  }

  for (const changeEvent of nextSnapshot.changes.slice(0, 10)) {
    const previousChange = previousSnapshot?.changes?.find((item) => item.ticker === changeEvent.ticker);
    if (!previousChange || previousChange.composite_fundamental_score !== changeEvent.composite_fundamental_score) {
      store.bus.emit("event", { type: "fundamental_change", ...changeEvent });
    }
  }
}

export function createFundamentalsEngine({ store, config, marketReferenceService }) {
  let samplePayload = null;
  let baseCompanies = [];
  let marketReferenceMap = new Map();
  let persistenceArtifactsByTicker = new Map();

  function getTrackedCompanies() {
    return baseCompanies;
  }

  function buildCompaniesForSnapshot(count = baseCompanies.length) {
    return baseCompanies.slice(0, count).map((company) => mergeCompanyWithMarketReference(company, marketReferenceMap.get(company.ticker)));
  }

  function materializeWarehouse(snapshot, companyCount = baseCompanies.length) {
    return materializeFundamentalPersistence({
      store,
      companies: buildCompaniesForSnapshot(companyCount),
      snapshot,
      artifactsByTicker: persistenceArtifactsByTicker
    });
  }

  async function commitSnapshot(snapshot, emitDiff = true) {
    const previous = store.fundamentals;
    const next = snapshotToStoreShape(snapshot);
    store.fundamentals = next;
    materializeWarehouse(snapshot);
    store.health.lastUpdate = new Date().toISOString();
    store.health.fundamentalCompaniesScored = next.leaderboard.length;
    store.health.fundamentalSectorsCovered = next.sectors.length;
    if (emitDiff) {
      emitSnapshotDiff(store, previous, next);
    }
    await store.persistence?.saveStoreSnapshot(store);
  }

  async function replaySample({ intervalMs = 120 } = {}) {
    samplePayload = await readJson(config.sampleFundamentalsPath);
    baseCompanies = samplePayload.companies.map((company) => ({ ...company, as_of: samplePayload.as_of }));
    persistenceArtifactsByTicker = new Map();
    marketReferenceMap = marketReferenceService
      ? await marketReferenceService.getReferenceBatch(baseCompanies)
      : new Map();
    store.fundamentals = createEmptyFundamentalsState();

    for (let index = 0; index < baseCompanies.length; index += 1) {
      const snapshot = buildSnapshot(samplePayload, buildCompaniesForSnapshot(index + 1), screenerSettingsFromConfig(config));
      const previous = store.fundamentals;
      const next = snapshotToStoreShape(snapshot);
      store.fundamentals = next;
      materializeWarehouse(snapshot, index + 1);
      store.health.lastUpdate = new Date().toISOString();
      store.health.fundamentalCompaniesScored = index + 1;
      store.health.fundamentalSectorsCovered = next.sectors.length;
      emitSnapshotDiff(store, previous, next);
      await store.persistence?.saveStoreSnapshot(store);

      if (intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    return baseCompanies.length;
  }

  async function replaceCompanies(nextCompanies, { asOf = new Date().toISOString(), emitDiff = true, persistenceArtifactsByTicker: nextArtifactsByTicker } = {}) {
    if (!samplePayload) {
      samplePayload = {
        as_of: asOf,
        sector_inputs: []
      };
    }

    samplePayload = {
      ...samplePayload,
      as_of: asOf
    };
    baseCompanies = nextCompanies.map((company) => ({
      ...company,
      as_of: company.as_of || asOf
    }));
    persistenceArtifactsByTicker =
      nextArtifactsByTicker instanceof Map
        ? new Map([...persistenceArtifactsByTicker, ...nextArtifactsByTicker])
        : new Map();

    if (marketReferenceService && baseCompanies.length) {
      marketReferenceMap = await marketReferenceService.getReferenceBatch(baseCompanies);
    }

    const snapshot = buildSnapshot(samplePayload, buildCompaniesForSnapshot(), screenerSettingsFromConfig(config));
    await commitSnapshot(snapshot, emitDiff);
    return snapshot.leaderboard.length;
  }

  async function refreshMarketReference(nextReferenceMap) {
    marketReferenceMap = nextReferenceMap;
    if (!samplePayload || !baseCompanies.length) {
      return 0;
    }

    const snapshot = buildSnapshot(samplePayload, buildCompaniesForSnapshot(), screenerSettingsFromConfig(config));
    await commitSnapshot(snapshot, true);
    return snapshot.leaderboard.length;
  }

  return {
    replaySample,
    async replaceCompanies(nextCompanies, options = {}) {
      return replaceCompanies(nextCompanies, options);
    },
    async refreshMarketReference(nextReferenceMap) {
      return refreshMarketReference(nextReferenceMap);
    },
    getTrackedCompanies() {
      return getTrackedCompanies();
    },
    getSnapshot(filters = {}) {
      return store.fundamentals.asOf ? filteredSnapshot(store.fundamentals, filters) : filteredSnapshot(createEmptyFundamentalsState(), filters);
    },
    getTickerDetail(ticker) {
      return store.fundamentals.byTicker.get(ticker) || null;
    },
    getSectorDetail(sector) {
      return store.fundamentals.bySector.get(sector) || null;
    },
    getChanges(limit = 12) {
      return store.fundamentals.changes.slice(0, limit);
    }
  };
}
