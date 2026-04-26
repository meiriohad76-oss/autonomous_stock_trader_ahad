import { clamp, makeId, readJson, round } from "../utils/helpers.js";

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
  return sample.sector_inputs
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

function scoreCompany(company, companies, sectorScores) {
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

function buildSnapshot(sample, companies) {
  const sectorScores = buildSectorScores(sample, companies);
  const leaderboard = companies
    .map((company) => scoreCompany(company, companies, sectorScores))
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
    return true;
  });

  return {
    as_of: snapshot.asOf,
    summary: snapshot.summary,
    leaderboard,
    sectors: sector ? snapshot.sectors.filter((item) => item.sector === sector) : snapshot.sectors,
    changes: snapshot.changes.filter((item) => (sector ? item.sector === sector : true)).slice(0, 12)
  };
}

export function createEmptyFundamentalsState() {
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

  function getTrackedCompanies() {
    return baseCompanies;
  }

  function buildCompaniesForSnapshot(count = baseCompanies.length) {
    return baseCompanies.slice(0, count).map((company) => mergeCompanyWithMarketReference(company, marketReferenceMap.get(company.ticker)));
  }

  async function commitSnapshot(snapshot, emitDiff = true) {
    const previous = store.fundamentals;
    const next = snapshotToStoreShape(snapshot);
    store.fundamentals = next;
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
    marketReferenceMap = marketReferenceService
      ? await marketReferenceService.getReferenceBatch(baseCompanies)
      : new Map();
    store.fundamentals = createEmptyFundamentalsState();

    for (let index = 0; index < baseCompanies.length; index += 1) {
      const snapshot = buildSnapshot(samplePayload, buildCompaniesForSnapshot(index + 1));
      const previous = store.fundamentals;
      const next = snapshotToStoreShape(snapshot);
      store.fundamentals = next;
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

  async function replaceCompanies(nextCompanies, { asOf = new Date().toISOString(), emitDiff = true } = {}) {
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

    if (marketReferenceService && baseCompanies.length) {
      marketReferenceMap = await marketReferenceService.getReferenceBatch(baseCompanies);
    }

    const snapshot = buildSnapshot(samplePayload, buildCompaniesForSnapshot());
    await commitSnapshot(snapshot, emitDiff);
    return snapshot.leaderboard.length;
  }

  async function refreshMarketReference(nextReferenceMap) {
    marketReferenceMap = nextReferenceMap;
    if (!samplePayload || !baseCompanies.length) {
      return 0;
    }

    const snapshot = buildSnapshot(samplePayload, buildCompaniesForSnapshot());
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
