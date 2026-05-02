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

export const FUNDAMENTAL_RESEARCH_REFERENCES = {
  piotroski_2000: {
    key: "piotroski_2000",
    label: "Piotroski 2000",
    title: "Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers",
    source: "Journal of Accounting Research",
    takeaway: "Accounting-based signals can help distinguish stronger and weaker companies inside a broad candidate set."
  },
  fama_french_2015: {
    key: "fama_french_2015",
    label: "Fama-French 2015",
    title: "A Five-Factor Asset Pricing Model",
    source: "Journal of Financial Economics",
    takeaway: "Profitability and investment/quality-style factors help explain cross-sectional return patterns."
  },
  sloan_1996: {
    key: "sloan_1996",
    label: "Sloan 1996",
    title: "Do Stock Prices Fully Reflect Information in Accruals and Cash Flows about Future Earnings?",
    source: "The Accounting Review",
    takeaway: "Cash-flow quality matters because accrual-heavy earnings can be less persistent."
  },
  novy_marx_2013: {
    key: "novy_marx_2013",
    label: "Novy-Marx 2013",
    title: "The Other Side of Value: The Gross Profitability Premium",
    source: "Journal of Financial Economics",
    takeaway: "Gross profitability is a useful quality signal and can complement valuation."
  },
  factor_zoo_caution: {
    key: "factor_zoo_caution",
    label: "Factor validation caution",
    title: "Multiple-testing and factor-zoo caution",
    source: "Empirical asset-pricing literature",
    takeaway: "Research-aligned factors still need local, out-of-sample validation before thresholds are treated as proven."
  }
};

export const FUNDAMENTAL_SCREENER_PROFILES = {
  balanced: {
    key: "balanced",
    label: "Balanced",
    description: "Default blend of quality, growth, cash efficiency, valuation sanity, and reporting confidence.",
    settings: {
      screenerMinReportingConfidence: 0.85,
      screenerMinDataFreshness: 0.85,
      screenerMaxMissingFields: 2,
      screenerMinRevenueGrowth: 0.08,
      screenerMinEpsGrowth: 0.1,
      screenerMinOperatingMargin: 0.12,
      screenerMinGrossMargin: 0.35,
      screenerMinCurrentRatio: 1,
      screenerMaxNetDebtToEbitda: 3,
      screenerMinFcfConversion: 0.75,
      screenerMinFcfMargin: 0.08,
      screenerMaxPeTtm: 45,
      screenerMaxPeg: 2.5,
      screenerMinFcfYield: 0.02,
      screenerEligibleScore: 0.71,
      screenerWatchScore: 0.43
    }
  },
  conservative_quality: {
    key: "conservative_quality",
    label: "Conservative Quality",
    description: "Tighter reporting, profitability, balance-sheet, and cash-conversion gates for lower false-positive risk.",
    settings: {
      screenerMinReportingConfidence: 0.9,
      screenerMinDataFreshness: 0.9,
      screenerMaxMissingFields: 1,
      screenerMinRevenueGrowth: 0.05,
      screenerMinEpsGrowth: 0.08,
      screenerMinOperatingMargin: 0.18,
      screenerMinGrossMargin: 0.45,
      screenerMinCurrentRatio: 1.2,
      screenerMaxNetDebtToEbitda: 2.2,
      screenerMinFcfConversion: 0.9,
      screenerMinFcfMargin: 0.1,
      screenerMaxPeTtm: 38,
      screenerMaxPeg: 2,
      screenerMinFcfYield: 0.025,
      screenerEligibleScore: 0.86,
      screenerWatchScore: 0.57
    }
  },
  growth_compounder: {
    key: "growth_compounder",
    label: "Growth Compounder",
    description: "Higher growth and margin hurdles while allowing richer valuation when business quality is strong.",
    settings: {
      screenerMinReportingConfidence: 0.85,
      screenerMinDataFreshness: 0.85,
      screenerMaxMissingFields: 2,
      screenerMinRevenueGrowth: 0.12,
      screenerMinEpsGrowth: 0.15,
      screenerMinOperatingMargin: 0.15,
      screenerMinGrossMargin: 0.4,
      screenerMinCurrentRatio: 1,
      screenerMaxNetDebtToEbitda: 3.2,
      screenerMinFcfConversion: 0.7,
      screenerMinFcfMargin: 0.07,
      screenerMaxPeTtm: 60,
      screenerMaxPeg: 3,
      screenerMinFcfYield: 0.012,
      screenerEligibleScore: 0.71,
      screenerWatchScore: 0.43
    }
  },
  value_quality: {
    key: "value_quality",
    label: "Value Quality",
    description: "Sharper valuation and free-cash-flow yield requirements while preserving basic quality and balance-sheet gates.",
    settings: {
      screenerMinReportingConfidence: 0.85,
      screenerMinDataFreshness: 0.85,
      screenerMaxMissingFields: 2,
      screenerMinRevenueGrowth: 0.03,
      screenerMinEpsGrowth: 0.05,
      screenerMinOperatingMargin: 0.1,
      screenerMinGrossMargin: 0.3,
      screenerMinCurrentRatio: 1,
      screenerMaxNetDebtToEbitda: 3,
      screenerMinFcfConversion: 0.8,
      screenerMinFcfMargin: 0.08,
      screenerMaxPeTtm: 28,
      screenerMaxPeg: 1.8,
      screenerMinFcfYield: 0.04,
      screenerEligibleScore: 0.71,
      screenerWatchScore: 0.43
    }
  }
};

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

function screenerConfigFromSettings(settings = {}) {
  return {
    screenerRequireLiveSecForEligible: Boolean(settings.requireLiveSecForEligible),
    screenerMinReportingConfidence: Number(settings.minReportingConfidence ?? 0.85),
    screenerMinDataFreshness: Number(settings.minDataFreshness ?? 0.85),
    screenerMaxMissingFields: Number(settings.maxMissingFields ?? 2),
    screenerMinRevenueGrowth: Number(settings.minRevenueGrowth ?? 0.08),
    screenerMinEpsGrowth: Number(settings.minEpsGrowth ?? 0.1),
    screenerMinOperatingMargin: Number(settings.minOperatingMargin ?? 0.12),
    screenerMinGrossMargin: Number(settings.minGrossMargin ?? 0.35),
    screenerMinCurrentRatio: Number(settings.minCurrentRatio ?? 1),
    screenerMaxNetDebtToEbitda: Number(settings.maxNetDebtToEbitda ?? 3),
    screenerMinFcfConversion: Number(settings.minFcfConversion ?? 0.75),
    screenerMinFcfMargin: Number(settings.minFcfMargin ?? 0.08),
    screenerMaxPeTtm: Number(settings.maxPeTtm ?? 45),
    screenerMaxPeg: Number(settings.maxPeg ?? 2.5),
    screenerMinFcfYield: Number(settings.minFcfYield ?? 0.02),
    screenerEligibleScore: Number(settings.eligibleScore ?? 0.71),
    screenerWatchScore: Number(settings.watchScore ?? 0.43)
  };
}

function normalizeScreenerGovernanceInput(settings = {}) {
  const hasConfigShape = Object.keys(settings).some((key) => key.startsWith("screener"));
  if (hasConfigShape) {
    return {
      profileSettings: { ...FUNDAMENTAL_SCREENER_PROFILES.balanced.settings, ...settings },
      criteriaSettings: screenerSettingsFromConfig(settings)
    };
  }

  const criteriaSettings = { ...screenerSettingsFromConfig(), ...settings };
  return {
    profileSettings: screenerConfigFromSettings(criteriaSettings),
    criteriaSettings
  };
}

export function settingsForFundamentalProfile(profileKey) {
  const profile = FUNDAMENTAL_SCREENER_PROFILES[profileKey];
  return profile ? { ...profile.settings } : null;
}

function settingValue(settings, key, formatter = (value) => value) {
  return formatter(settings[key]);
}

function percentValue(value, digits = 1) {
  return `${round(Number(value || 0) * 100, digits)}%`;
}

function backtestPlaceholder(criteriaKey) {
  return {
    status: "pending_validation",
    last_backtest_at: null,
    hit_rate: null,
    average_forward_return: null,
    max_drawdown: null,
    false_positive_rate: null,
    sector_sensitivity: null,
    sample_size: 0,
    notes:
      `Criterion ${criteriaKey} is research-aligned, but this repo does not yet have point-in-time fundamentals plus forward-return history for S&P 100 + QQQ threshold validation.`
  };
}

function criterionResearchBasis(keys) {
  return keys.map((key) => FUNDAMENTAL_RESEARCH_REFERENCES[key]).filter(Boolean);
}

function profileDiff(settings, profile) {
  return Object.entries(profile.settings).map(([key, desired]) => ({
    key,
    current: settings[key],
    desired,
    matches: String(settings[key]) === String(desired)
  }));
}

function detectCurrentFundamentalProfile(settings) {
  return Object.values(FUNDAMENTAL_SCREENER_PROFILES).find((profile) =>
    profileDiff(settings, profile).every((item) => item.matches)
  )?.key || "custom";
}

function buildScoreFactorRegistry() {
  return [
    {
      key: "quality",
      label: FACTOR_LABELS.quality,
      weight: SCORE_WEIGHTS.quality,
      factor_family: "profitability_quality",
      inputs: ["gross_margin", "operating_margin", "net_margin", "roe", "roic", "fcf_conversion"],
      research_basis: criterionResearchBasis(["fama_french_2015", "novy_marx_2013", "piotroski_2000"]),
      why_it_matters: FACTOR_SUMMARY.quality,
      backtest_status: backtestPlaceholder("quality_score")
    },
    {
      key: "growth",
      label: FACTOR_LABELS.growth,
      weight: SCORE_WEIGHTS.growth,
      factor_family: "fundamental_growth",
      inputs: ["revenue_growth_yoy", "eps_growth_yoy", "fcf_growth_yoy"],
      research_basis: criterionResearchBasis(["piotroski_2000", "factor_zoo_caution"]),
      why_it_matters: FACTOR_SUMMARY.growth,
      backtest_status: backtestPlaceholder("growth_score")
    },
    {
      key: "valuation",
      label: FACTOR_LABELS.valuation,
      weight: SCORE_WEIGHTS.valuation,
      factor_family: "valuation",
      inputs: ["pe_ttm", "ev_to_ebitda_ttm", "price_to_sales_ttm", "peg", "fcf_yield"],
      research_basis: criterionResearchBasis(["piotroski_2000", "factor_zoo_caution"]),
      why_it_matters: FACTOR_SUMMARY.valuation,
      backtest_status: backtestPlaceholder("valuation_score")
    },
    {
      key: "balance_sheet",
      label: FACTOR_LABELS.balance_sheet,
      weight: SCORE_WEIGHTS.balanceSheet,
      factor_family: "financial_strength",
      inputs: ["debt_to_equity", "net_debt_to_ebitda", "current_ratio", "interest_coverage"],
      research_basis: criterionResearchBasis(["piotroski_2000"]),
      why_it_matters: FACTOR_SUMMARY.balance_sheet,
      backtest_status: backtestPlaceholder("balance_sheet_score")
    },
    {
      key: "efficiency",
      label: FACTOR_LABELS.efficiency,
      weight: SCORE_WEIGHTS.efficiency,
      factor_family: "cash_efficiency",
      inputs: ["asset_turnover", "fcf_margin", "fcf_conversion"],
      research_basis: criterionResearchBasis(["sloan_1996", "piotroski_2000"]),
      why_it_matters: FACTOR_SUMMARY.efficiency,
      backtest_status: backtestPlaceholder("efficiency_score")
    },
    {
      key: "earnings_stability",
      label: FACTOR_LABELS.earnings_stability,
      weight: SCORE_WEIGHTS.stability,
      factor_family: "stability_quality",
      inputs: ["margin_stability", "revenue_consistency", "anomaly_penalty"],
      research_basis: criterionResearchBasis(["sloan_1996", "factor_zoo_caution"]),
      why_it_matters: FACTOR_SUMMARY.earnings_stability,
      backtest_status: backtestPlaceholder("earnings_stability_score")
    },
    {
      key: "sector",
      label: FACTOR_LABELS.sector,
      weight: SCORE_WEIGHTS.sector,
      factor_family: "sector_context",
      inputs: ["growth_breadth", "profitability_strength", "revision_breadth", "macro_fit"],
      research_basis: criterionResearchBasis(["factor_zoo_caution"]),
      why_it_matters: FACTOR_SUMMARY.sector,
      backtest_status: backtestPlaceholder("sector_score")
    }
  ];
}

export function buildFundamentalResearchGovernance(settings = screenerSettingsFromConfig()) {
  const { profileSettings, criteriaSettings } = normalizeScreenerGovernanceInput(settings);
  const profiles = Object.values(FUNDAMENTAL_SCREENER_PROFILES).map((profile) => {
    const changes = profileDiff(profileSettings, profile).filter((item) => !item.matches);
    return {
      ...profile,
      matches_current: changes.length === 0,
      change_count: changes.length,
      changes
    };
  });

  return {
    version: "research_governed_v1",
    current_profile: detectCurrentFundamentalProfile(profileSettings),
    validation_status: "research_aligned_thresholds_pending_local_backtest",
    explanation:
      "The factor families are grounded in published empirical finance and accounting research, but exact thresholds remain defaults until validated on point-in-time S&P 100 + QQQ history.",
    references: Object.values(FUNDAMENTAL_RESEARCH_REFERENCES),
    profiles,
    criteria: buildScreenerCriteria(criteriaSettings),
    score_factors: buildScoreFactorRegistry(),
    backtest_policy: {
      required_before_proven: true,
      minimum_sample: "At least 3-5 years of point-in-time fundamentals, daily prices, sector labels, and simulated execution costs.",
      target_outputs: ["hit_rate", "average_forward_return", "max_drawdown", "false_positive_rate", "sector_sensitivity"],
      current_status: "not_yet_available_in_local_store"
    }
  };
}

function buildScreenerCriteria(settings = screenerSettingsFromConfig()) {
  return [
    {
      key: "scale",
      label: "Large-cap scale",
      factor_family: "liquidity_and_size",
      default_value: "large_cap or mega_cap",
      current_value: "large_cap or mega_cap",
      summary: "The name must already be trading at meaningful institutional scale.",
      why: "This keeps the first-pass screen focused on names with deeper liquidity and broader institutional sponsorship.",
      why_it_matters: "A large, liquid universe lowers execution and data-quality risk before the ranking model starts.",
      research_basis: criterionResearchBasis(["factor_zoo_caution"]),
      backtest_status: backtestPlaceholder("scale"),
      rule: "Market-cap bucket must be large_cap or mega_cap."
    },
    {
      key: "filing_quality",
      label: "High filing quality",
      factor_family: "data_quality",
      default_value: "reporting >= 0.85, freshness >= 0.85, missing fields <= 2",
      current_value: `reporting >= ${round(settings.minReportingConfidence, 2)}, freshness >= ${round(settings.minDataFreshness, 2)}, missing fields <= ${settings.maxMissingFields}`,
      summary: "The filing data needs to be recent, complete, and internally reliable.",
      why: "A strong fundamental call is less trustworthy if the latest filing snapshot is stale or incomplete.",
      why_it_matters: "The ranking should not promote a stock when the underlying financial statement snapshot is thin or stale.",
      research_basis: criterionResearchBasis(["piotroski_2000", "sloan_1996"]),
      backtest_status: backtestPlaceholder("filing_quality"),
      rule: `Reporting >= ${round(settings.minReportingConfidence, 2)}, freshness >= ${round(settings.minDataFreshness, 2)}, missing fields <= ${settings.maxMissingFields}.`
    },
    {
      key: "growth",
      label: "Growth clears baseline",
      factor_family: "fundamental_growth",
      default_value: "revenue growth >= 8% OR EPS growth >= 10%",
      current_value: `revenue growth >= ${percentValue(settings.minRevenueGrowth)} OR EPS growth >= ${percentValue(settings.minEpsGrowth)}`,
      summary: "At least one core growth signal should already be above the baseline hurdle.",
      why: "The screener wants evidence that the business is still expanding rather than merely looking optically cheap.",
      why_it_matters: "Growth is a candidate-quality input, but it must later be checked against valuation and cash conversion.",
      research_basis: criterionResearchBasis(["piotroski_2000", "factor_zoo_caution"]),
      backtest_status: backtestPlaceholder("growth"),
      rule: `Revenue growth >= ${round(settings.minRevenueGrowth * 100, 1)}% OR EPS growth >= ${round(settings.minEpsGrowth * 100, 1)}%.`
    },
    {
      key: "profitability",
      label: "Profitability clears baseline",
      factor_family: "profitability_quality",
      default_value: "operating margin >= 12% OR gross margin >= 35%",
      current_value: `operating margin >= ${percentValue(settings.minOperatingMargin)} OR gross margin >= ${percentValue(settings.minGrossMargin)}`,
      summary: "The company needs either healthy operating leverage or strong gross economics.",
      why: "A business can grow quickly and still be low quality if margins are too thin or deteriorating.",
      why_it_matters: "Profitability helps distinguish durable businesses from revenue growth that requires weak economics.",
      research_basis: criterionResearchBasis(["fama_french_2015", "novy_marx_2013"]),
      backtest_status: backtestPlaceholder("profitability"),
      rule: `Operating margin >= ${round(settings.minOperatingMargin * 100, 1)}% OR gross margin >= ${round(settings.minGrossMargin * 100, 1)}%.`
    },
    {
      key: "balance_sheet",
      label: "Balance sheet is healthy",
      factor_family: "financial_strength",
      default_value: "current ratio >= 1 OR net debt / EBITDA <= 3",
      current_value: `current ratio >= ${settingValue(settings, "minCurrentRatio", (value) => round(value, 2))} OR net debt / EBITDA <= ${round(settings.maxNetDebtToEbitda, 2)}`,
      summary: "Near-term liquidity or leverage must stay inside acceptable bounds.",
      why: "Even attractive growth stories can fail a first-pass screen if the balance sheet creates financing risk.",
      why_it_matters: "Balance-sheet strength reduces the chance that a promising setup is overwhelmed by financing pressure.",
      research_basis: criterionResearchBasis(["piotroski_2000"]),
      backtest_status: backtestPlaceholder("balance_sheet"),
      rule: `Current ratio >= ${round(settings.minCurrentRatio, 2)} OR net debt / EBITDA <= ${round(settings.maxNetDebtToEbitda, 2)}.`
    },
    {
      key: "cash_efficiency",
      label: "Cash conversion is acceptable",
      factor_family: "cash_quality",
      default_value: "FCF conversion >= 75% OR FCF margin >= 8%",
      current_value: `FCF conversion >= ${percentValue(settings.minFcfConversion, 0)} OR FCF margin >= ${percentValue(settings.minFcfMargin)}`,
      summary: "Reported earnings or growth should translate into real cash generation.",
      why: "This helps filter out names where accounting strength is not yet showing up in free cash flow.",
      why_it_matters: "Cash conversion is the first defense against accounting profits that do not become owner cash flow.",
      research_basis: criterionResearchBasis(["sloan_1996", "piotroski_2000"]),
      backtest_status: backtestPlaceholder("cash_efficiency"),
      rule: `FCF conversion >= ${round(settings.minFcfConversion, 2)} OR FCF margin >= ${round(settings.minFcfMargin * 100, 1)}%.`
    },
    {
      key: "valuation_sanity",
      label: "Valuation is still tradable",
      factor_family: "valuation",
      default_value: "P/E <= 45 OR PEG <= 2.5 OR FCF yield >= 2%",
      current_value: `P/E <= ${round(settings.maxPeTtm, 1)} OR PEG <= ${round(settings.maxPeg, 2)} OR FCF yield >= ${percentValue(settings.minFcfYield)}`,
      summary: "The valuation cannot already be so stretched that the setup becomes hard to underwrite.",
      why: "The screen is trying to keep names investable, not just fundamentally interesting at any price.",
      why_it_matters: "Valuation sanity keeps high-quality companies from being treated as attractive at any price.",
      research_basis: criterionResearchBasis(["piotroski_2000", "factor_zoo_caution"]),
      backtest_status: backtestPlaceholder("valuation_sanity"),
      rule: `P/E <= ${round(settings.maxPeTtm, 1)} OR PEG <= ${round(settings.maxPeg, 2)} OR FCF yield >= ${round(settings.minFcfYield * 100, 1)}%.`
    }
  ];
}

function buildCriterionDiagnostics(leaderboard, criteria) {
  return criteria.map((criterion) => {
    const rowsWithCheck = leaderboard
      .map((row) => (row.initial_screen?.checks || []).find((check) => check.key === criterion.key))
      .filter(Boolean);
    const passCount = rowsWithCheck.filter((check) => check.passed).length;
    const failCount = rowsWithCheck.length - passCount;
    return {
      key: criterion.key,
      label: criterion.label,
      evaluated_count: rowsWithCheck.length,
      pass_count: passCount,
      fail_count: failCount,
      pass_rate: rowsWithCheck.length ? round(passCount / rowsWithCheck.length, 3) : null
    };
  });
}

function buildScreenerView(leaderboard, baseScreener = {}, screenerSettings = screenerSettingsFromConfig()) {
  const eligible = leaderboard.filter((item) => item.initial_screen?.stage === "eligible");
  const watch = leaderboard.filter((item) => item.initial_screen?.stage === "watch");
  const rejected = leaderboard.filter((item) => item.initial_screen?.stage === "reject");
  const bootstrapPlaceholders = leaderboard.filter((item) => item.data_source === "bootstrap_placeholder");
  const liveSecBacked = leaderboard.filter((item) => item.data_source === "live_sec_filing");
  const criteria = baseScreener.criteria || buildScreenerCriteria(screenerSettings);

  return {
    criteria,
    governance: buildFundamentalResearchGovernance(screenerSettings),
    criterion_diagnostics: buildCriterionDiagnostics(leaderboard, criteria),
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

  const checkResults = checks.map((item) => ({
    key: item.key,
    label: item.label,
    passed: Boolean(item.passed)
  }));
  const passedChecks = checkResults.filter((item) => item.passed).map((item) => item.label);
  const failedChecks = checkResults.filter((item) => !item.passed).map((item) => item.label);
  const passedCount = passedChecks.length;
  const screenScore = round(passedCount / checkResults.length, 3);

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
    total_checks: checkResults.length,
    checks: checkResults,
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

  function sectorInputsFromSnapshot() {
    return (store.fundamentals?.sectors || []).map((sector) => ({
      sector: sector.sector,
      growth_breadth: sector.growth_breadth ?? 0.5,
      profitability_strength: sector.profitability_strength ?? 0.5,
      revision_breadth: sector.revision_breadth ?? 0.5,
      relative_valuation: sector.relative_valuation ?? 0.5,
      macro_fit: sector.macro_fit ?? 0.5,
      sector_price_momentum_3m: sector.sector_price_momentum_3m ?? 0
    }));
  }

  function companyFromSnapshotRow(row) {
    const confidenceBreakdown = row.confidence_breakdown || {};
    const qualityFlags = row.quality_flags || {
      restatement_flag: false,
      missing_fields_count: 0,
      anomaly_flags: [],
      reporting_confidence_score: confidenceBreakdown.reporting_confidence_score ?? row.reporting_confidence_score ?? 0.7,
      data_freshness_score: confidenceBreakdown.data_freshness_score ?? row.data_freshness_score ?? 0.7,
      peer_comparability_score: confidenceBreakdown.peer_comparability_score ?? row.peer_comparability_score ?? 0.7,
      rule_confidence: confidenceBreakdown.rule_confidence ?? row.rule_confidence ?? 0.7,
      llm_confidence: confidenceBreakdown.llm_confidence ?? row.llm_confidence ?? 0.65
    };

    return {
      ticker: row.ticker,
      company_name: row.company_name,
      data_source: row.data_source,
      sector: row.sector,
      industry: row.industry,
      exchange: row.exchange,
      market_cap_bucket: row.market_cap_bucket,
      cik: row.cik,
      as_of: row.as_of || store.fundamentals.asOf,
      filing_date: row.filing_date || String(store.fundamentals.asOf || new Date().toISOString()).slice(0, 10),
      period_end: row.period_end || String(store.fundamentals.asOf || new Date().toISOString()).slice(0, 10),
      form_type: row.form_type || "RESTORED",
      filing_url: row.filing_url || "",
      summary: row.explanation_short || `${row.company_name || row.ticker} restored from the lightweight runtime snapshot.`,
      notes: row.notes?.length ? row.notes : ["Restored from the lightweight runtime snapshot."],
      metrics: row.metric_snapshot || {},
      quality_flags: qualityFlags,
      previous_composite_score: round(
        Number(row.composite_fundamental_score || 0) - Number(row.score_delta_30d || 0),
        3
      ),
      market_reference: row.market_reference || null
    };
  }

  function restoreBaseCompaniesFromStore() {
    if (baseCompanies.length || !store.fundamentals?.leaderboard?.length) {
      return;
    }

    samplePayload = {
      as_of: store.fundamentals.asOf || new Date().toISOString(),
      sector_inputs: sectorInputsFromSnapshot()
    };
    baseCompanies = store.fundamentals.leaderboard.map(companyFromSnapshotRow);
    marketReferenceMap = new Map(
      baseCompanies
        .filter((company) => company.market_reference)
        .map((company) => [company.ticker, company.market_reference])
    );
  }

  function getTrackedCompanies() {
    restoreBaseCompaniesFromStore();
    return baseCompanies;
  }

  function buildCompaniesForSnapshot(count = baseCompanies.length) {
    restoreBaseCompaniesFromStore();
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

  async function replaceCompanies(nextCompanies, {
    asOf = new Date().toISOString(),
    emitDiff = true,
    persistenceArtifactsByTicker: nextArtifactsByTicker,
    refreshMarketReference = true
  } = {}) {
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

    if (refreshMarketReference && marketReferenceService && baseCompanies.length) {
      marketReferenceMap = await marketReferenceService.getReferenceBatch(baseCompanies);
    }

    const snapshot = buildSnapshot(samplePayload, buildCompaniesForSnapshot(), screenerSettingsFromConfig(config));
    await commitSnapshot(snapshot, emitDiff);
    return snapshot.leaderboard.length;
  }

  async function refreshMarketReference(nextReferenceMap) {
    restoreBaseCompaniesFromStore();
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
