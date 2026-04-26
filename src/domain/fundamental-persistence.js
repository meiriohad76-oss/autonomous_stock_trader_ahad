import { createHash } from "node:crypto";
import { round } from "../utils/helpers.js";

const CANONICAL_FACTS = [
  {
    canonical_field: "revenue",
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
      "Revenues"
    ]
  },
  {
    canonical_field: "gross_profit",
    concepts: ["GrossProfit"]
  },
  {
    canonical_field: "operating_income",
    concepts: ["OperatingIncomeLoss"]
  },
  {
    canonical_field: "net_income",
    concepts: ["NetIncomeLoss", "ProfitLoss"]
  },
  {
    canonical_field: "assets",
    concepts: ["Assets"]
  },
  {
    canonical_field: "equity",
    concepts: [
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      "StockholdersEquity"
    ]
  },
  {
    canonical_field: "current_assets",
    concepts: ["AssetsCurrent"]
  },
  {
    canonical_field: "current_liabilities",
    concepts: ["LiabilitiesCurrent"]
  },
  {
    canonical_field: "cash",
    concepts: ["CashAndCashEquivalentsAtCarryingValue"]
  },
  {
    canonical_field: "long_term_debt",
    concepts: ["LongTermDebtAndCapitalLeaseObligations", "LongTermDebtNoncurrent", "LongTermDebt"]
  },
  {
    canonical_field: "current_debt",
    concepts: ["LongTermDebtCurrent", "DebtCurrent"]
  },
  {
    canonical_field: "cash_from_operations",
    concepts: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
    ]
  },
  {
    canonical_field: "capex",
    concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PropertyPlantAndEquipmentAdditions"]
  },
  {
    canonical_field: "interest_expense",
    concepts: ["InterestExpenseAndDebtExpense", "InterestExpense"]
  },
  {
    canonical_field: "diluted_eps",
    concepts: ["EarningsPerShareDiluted"]
  }
];

function emptyMapSet() {
  return {
    coverageUniverse: new Map(),
    filingEvents: new Map(),
    financialPeriods: new Map(),
    financialFacts: new Map(),
    marketReference: new Map(),
    fundamentalFeatures: new Map(),
    fundamentalScores: new Map(),
    fundamentalStates: new Map(),
    lastMaterializedAt: null
  };
}

function serialize(map) {
  return [...map.values()];
}

function compareDateDesc(left, right) {
  return new Date(right || 0) - new Date(left || 0);
}

function stableUuid(...parts) {
  const hash = createHash("sha1")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex");
  const bytes = hash.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ["8", "9", "a", "b"][Number.parseInt(bytes[16], 16) % 4];
  const compact = bytes.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
}

function durationDays(start, end) {
  if (!start || !end) {
    return null;
  }
  return Math.abs((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
}

function inferPeriodType(item, filingForm = "") {
  const duration = durationDays(item.start, item.end);
  if (Number.isFinite(duration)) {
    if (duration >= 300) {
      return "annual";
    }
    if (duration >= 60) {
      return "quarterly";
    }
  }

  if (String(item.fp || "").toUpperCase() === "FY") {
    return "annual";
  }
  if (/^Q/i.test(String(item.fp || ""))) {
    return "quarterly";
  }
  if (/(10-K|20-F|40-F)/i.test(filingForm)) {
    return "annual";
  }
  return "quarterly";
}

function normalizeFactSeries(companyFacts, conceptName) {
  const facts = companyFacts?.facts || {};
  const rows = [];

  for (const [taxonomy, taxonomyFacts] of Object.entries(facts)) {
    const concept = taxonomyFacts?.[conceptName];
    if (!concept?.units) {
      continue;
    }

    for (const [unit, values] of Object.entries(concept.units)) {
      for (const value of values || []) {
        const parsed = Number(value.val);
        if (!Number.isFinite(parsed) || !value.end) {
          continue;
        }

        rows.push({
          taxonomy,
          concept: conceptName,
          canonical_field: null,
          value: parsed,
          unit,
          source_form: value.form || "",
          as_reported_label: concept.label || conceptName,
          start: value.start || null,
          end: value.end,
          fy: value.fy || null,
          fp: value.fp || null,
          filed: value.filed || null
        });
      }
    }
  }

  return rows;
}

function materializeArtifactsForTicker(ticker, artifact, warehouse) {
  if (!artifact?.filing || !artifact?.companyFacts) {
    return;
  }

  const filing = artifact.filing;
  const filingId = stableUuid("filing", ticker, artifact.cik || "", filing.accession_no || filing.source_url || "");
  warehouse.filingEvents.set(`${ticker}:${filing.accession_no}`, {
    filing_id: filingId,
    ticker,
    cik: artifact.cik || null,
    form_type: filing.form_type,
    filing_date: filing.filing_date,
    accepted_at: filing.accepted_at,
    accession_no: filing.accession_no,
    period_end: filing.period_end,
    source_url: filing.source_url,
    is_restated: false,
    contains_xbrl: true,
    filing_metadata: {
      source: "sec_companyfacts",
      primary_document: filing.primary_document || null
    }
  });

  const periodMap = new Map();
  for (const field of CANONICAL_FACTS) {
    for (const conceptName of field.concepts) {
      const series = normalizeFactSeries(artifact.companyFacts, conceptName);
      for (const item of series) {
        const periodEnd = item.end.slice(0, 10);
        const periodType = inferPeriodType(item, item.source_form);
        const periodKey = `${ticker}:${periodType}:${periodEnd}:${item.start || "instant"}`;

        if (!periodMap.has(periodKey)) {
          const periodId = stableUuid("period", ticker, periodType, periodEnd, item.start || "instant", item.fy || "", item.fp || "");
          const fiscalQuarter =
            /^Q(\d)$/i.test(String(item.fp || "")) ? Number(String(item.fp).match(/^Q(\d)$/i)[1]) : null;
          periodMap.set(periodKey, {
            period_id: periodId,
            ticker,
            fiscal_year: item.fy || new Date(periodEnd).getUTCFullYear(),
            fiscal_quarter: fiscalQuarter,
            period_type: periodType,
            period_start: item.start ? item.start.slice(0, 10) : null,
            period_end: periodEnd,
            filing_id: filingId,
            currency: item.unit.includes("USD") ? "USD" : item.unit,
            is_latest: periodEnd === (filing.period_end || periodEnd)
          });
        }

        const period = periodMap.get(periodKey);
        warehouse.financialFacts.set(
          `${ticker}:${period.period_id}:${field.canonical_field}:${item.concept}:${item.unit}`,
          {
            fact_id: stableUuid("fact", ticker, period.period_id, field.canonical_field, item.concept, item.unit),
            period_id: period.period_id,
            ticker,
            taxonomy: item.taxonomy,
            concept: item.concept,
            canonical_field: field.canonical_field,
            value: round(item.value, 6),
            unit: item.unit,
            source_form: item.source_form || filing.form_type,
            as_reported_label: item.as_reported_label,
            normalization_notes: {
              filed: item.filed,
              fp: item.fp,
              fy: item.fy
            }
          }
        );
      }
    }
  }

  for (const [key, value] of periodMap.entries()) {
    warehouse.financialPeriods.set(key, value);
  }
}

function materializeCoverage(companies, warehouse) {
  for (const company of companies) {
    warehouse.coverageUniverse.set(company.ticker, {
      ticker: company.ticker,
      company_name: company.company_name,
      cik: company.cik || null,
      exchange: company.exchange || null,
      country: "US",
      sector: company.sector,
      industry: company.industry,
      market_cap_bucket: company.market_cap_bucket || null,
      benchmark_group: `${company.market_cap_bucket || "unknown"}_us`,
      is_active: true,
      metadata: {
        as_of: company.as_of
      }
    });

    if (company.market_reference) {
      warehouse.marketReference.set(`${company.ticker}:${company.as_of}`, {
        reference_id: stableUuid("reference", company.ticker, company.as_of),
        ticker: company.ticker,
        as_of: company.as_of,
        close_price: company.market_reference.current_price ?? null,
        market_cap: company.market_reference.market_cap ?? null,
        enterprise_value: company.market_reference.enterprise_value ?? null,
        shares_outstanding: company.market_reference.shares_outstanding ?? null,
        beta: company.market_reference.beta ?? null,
        market_reference_metadata: {
          provider: company.market_reference.provider,
          live: company.market_reference.live
        }
      });
    }
  }
}

function materializeFeatures(snapshot, warehouse) {
  for (const item of snapshot.leaderboard) {
    warehouse.fundamentalFeatures.set(`${item.ticker}:${item.as_of}`, {
      feature_id: stableUuid("feature", item.ticker, item.as_of, "latest_quarter"),
      ticker: item.ticker,
      as_of: item.as_of,
      window_basis: "latest_quarter",
      revenue_growth_yoy: item.metric_snapshot.revenue_growth_yoy ?? null,
      eps_growth_yoy: item.metric_snapshot.eps_growth_yoy ?? null,
      fcf_growth_yoy: item.metric_snapshot.fcf_growth_yoy ?? null,
      gross_margin: item.metric_snapshot.gross_margin ?? null,
      operating_margin: item.metric_snapshot.operating_margin ?? null,
      net_margin: item.metric_snapshot.net_margin ?? null,
      roe: item.metric_snapshot.roe ?? null,
      roic: item.metric_snapshot.roic ?? null,
      debt_to_equity: item.metric_snapshot.debt_to_equity ?? null,
      net_debt_to_ebitda: item.metric_snapshot.net_debt_to_ebitda ?? null,
      current_ratio: item.metric_snapshot.current_ratio ?? null,
      interest_coverage: item.metric_snapshot.interest_coverage ?? null,
      fcf_margin: item.metric_snapshot.fcf_margin ?? null,
      fcf_conversion: item.metric_snapshot.fcf_conversion ?? null,
      asset_turnover: item.metric_snapshot.asset_turnover ?? null,
      margin_stability: item.metric_snapshot.margin_stability ?? null,
      revenue_consistency: item.metric_snapshot.revenue_consistency ?? null,
      pe_ttm: item.metric_snapshot.pe_ttm ?? null,
      ev_to_ebitda_ttm: item.metric_snapshot.ev_to_ebitda_ttm ?? null,
      price_to_sales_ttm: item.metric_snapshot.price_to_sales_ttm ?? null,
      peg: item.metric_snapshot.peg ?? null,
      fcf_yield: item.metric_snapshot.fcf_yield ?? null,
      feature_metadata: {
        provider: item.market_reference?.provider || "synthetic"
      }
    });

    warehouse.fundamentalScores.set(`${item.ticker}:${item.as_of}`, {
      score_id: stableUuid("score", item.ticker, item.as_of),
      ticker: item.ticker,
      as_of: item.as_of,
      sector: item.sector,
      quality_score: item.quality_score,
      growth_score: item.growth_score,
      valuation_score: item.valuation_score,
      balance_sheet_score: item.balance_sheet_score,
      efficiency_score: item.efficiency_score,
      earnings_stability_score: item.earnings_stability_score,
      sector_score: item.sector_score,
      reporting_confidence_score: item.reporting_confidence_score,
      data_freshness_score: item.data_freshness_score,
      peer_comparability_score: item.peer_comparability_score,
      rule_confidence: item.rule_confidence,
      llm_confidence: item.llm_confidence,
      anomaly_penalty: item.anomaly_penalty,
      final_confidence: item.final_confidence,
      composite_fundamental_score: item.composite_fundamental_score,
      rating_label: item.rating_label,
      valuation_label: item.valuation_label,
      direction_label: item.direction_label,
      regime_label: item.regime_label,
      reason_codes: item.reason_codes,
      score_metadata: {
        provider: item.market_reference?.provider || "synthetic"
      }
    });

    warehouse.fundamentalStates.set(`${item.ticker}:${item.as_of}`, {
      state_id: stableUuid("state", item.ticker, item.as_of),
      ticker: item.ticker,
      as_of: item.as_of,
      sector: item.sector,
      rank_in_sector: item.rank_in_sector,
      rank_global: item.rank_global,
      composite_fundamental_score: item.composite_fundamental_score,
      confidence: item.final_confidence,
      score_delta_30d: item.score_delta_30d,
      rating_label: item.rating_label,
      valuation_label: item.valuation_label,
      direction_label: item.direction_label,
      regime_label: item.regime_label,
      top_strengths: item.top_strengths,
      top_weaknesses: item.top_weaknesses,
      state_metadata: {
        filing_date: item.filing_date,
        form_type: item.form_type
      }
    });
  }
}

export function createEmptyFundamentalPersistence() {
  return emptyMapSet();
}

export function materializeFundamentalPersistence({ store, companies, snapshot, artifactsByTicker = new Map() }) {
  const warehouse = emptyMapSet();
  materializeCoverage(companies, warehouse);
  for (const company of companies) {
    materializeArtifactsForTicker(company.ticker, artifactsByTicker.get(company.ticker), warehouse);
  }
  materializeFeatures(snapshot, warehouse);
  warehouse.lastMaterializedAt = new Date().toISOString();
  store.fundamentalWarehouse = warehouse;
  return warehouse;
}

export function serializeFundamentalPersistence(warehouse) {
  return {
    coverageUniverse: serialize(warehouse.coverageUniverse),
    filingEvents: serialize(warehouse.filingEvents),
    financialPeriods: serialize(warehouse.financialPeriods),
    financialFacts: serialize(warehouse.financialFacts),
    marketReference: serialize(warehouse.marketReference),
    fundamentalFeatures: serialize(warehouse.fundamentalFeatures),
    fundamentalScores: serialize(warehouse.fundamentalScores),
    fundamentalStates: serialize(warehouse.fundamentalStates),
    lastMaterializedAt: warehouse.lastMaterializedAt
  };
}

export function reviveFundamentalPersistence(snapshot) {
  if (!snapshot) {
    return emptyMapSet();
  }

  const warehouse = emptyMapSet();
  for (const row of snapshot.coverageUniverse || []) {
    warehouse.coverageUniverse.set(row.ticker, row);
  }
  for (const row of snapshot.filingEvents || []) {
    warehouse.filingEvents.set(`${row.ticker}:${row.accession_no}`, row);
  }
  for (const row of snapshot.financialPeriods || []) {
    warehouse.financialPeriods.set(row.period_id, row);
  }
  for (const row of snapshot.financialFacts || []) {
    warehouse.financialFacts.set(row.fact_id, row);
  }
  for (const row of snapshot.marketReference || []) {
    warehouse.marketReference.set(row.reference_id, row);
  }
  for (const row of snapshot.fundamentalFeatures || []) {
    warehouse.fundamentalFeatures.set(row.feature_id, row);
  }
  for (const row of snapshot.fundamentalScores || []) {
    warehouse.fundamentalScores.set(row.score_id, row);
  }
  for (const row of snapshot.fundamentalStates || []) {
    warehouse.fundamentalStates.set(row.state_id, row);
  }
  warehouse.lastMaterializedAt = snapshot.lastMaterializedAt || null;
  return warehouse;
}

export function summarizeFundamentalPersistence(warehouse) {
  return {
    coverage_universe: warehouse.coverageUniverse.size,
    filing_events: warehouse.filingEvents.size,
    financial_periods: warehouse.financialPeriods.size,
    financial_facts: warehouse.financialFacts.size,
    market_reference: warehouse.marketReference.size,
    fundamental_features: warehouse.fundamentalFeatures.size,
    fundamental_scores: warehouse.fundamentalScores.size,
    fundamental_states: warehouse.fundamentalStates.size,
    last_materialized_at: warehouse.lastMaterializedAt
  };
}

export function getFundamentalPersistenceTicker(warehouse, ticker) {
  return {
    coverage_universe: serialize(new Map([...warehouse.coverageUniverse].filter(([key]) => key === ticker))),
    filing_events: serialize(new Map([...warehouse.filingEvents].filter(([, row]) => row.ticker === ticker))),
    financial_periods: serialize(new Map([...warehouse.financialPeriods].filter(([, row]) => row.ticker === ticker))),
    financial_facts: serialize(new Map([...warehouse.financialFacts].filter(([, row]) => row.ticker === ticker))),
    market_reference: serialize(new Map([...warehouse.marketReference].filter(([, row]) => row.ticker === ticker))),
    fundamental_features: serialize(new Map([...warehouse.fundamentalFeatures].filter(([, row]) => row.ticker === ticker))),
    fundamental_scores: serialize(new Map([...warehouse.fundamentalScores].filter(([, row]) => row.ticker === ticker))),
    fundamental_states: serialize(new Map([...warehouse.fundamentalStates].filter(([, row]) => row.ticker === ticker)))
  };
}

export function getFundamentalPersistenceFilings(warehouse, ticker, limit = 10) {
  const periods = [...warehouse.financialPeriods.values()].filter((row) => row.ticker === ticker);
  const periodIdsByFiling = periods.reduce((acc, row) => {
    if (!row.filing_id) {
      return acc;
    }
    if (!acc.has(row.filing_id)) {
      acc.set(row.filing_id, new Set());
    }
    acc.get(row.filing_id).add(row.period_id);
    return acc;
  }, new Map());

  return [...warehouse.filingEvents.values()]
    .filter((row) => row.ticker === ticker)
    .sort((a, b) => compareDateDesc(a.accepted_at || a.filing_date, b.accepted_at || b.filing_date))
    .slice(0, limit)
    .map((row) => {
      const periodIds = periodIdsByFiling.get(row.filing_id) || new Set();
      const factCount = [...warehouse.financialFacts.values()].filter((fact) => periodIds.has(fact.period_id)).length;
      return {
        ...row,
        periods_count: periodIds.size,
        facts_count: factCount
      };
    });
}

export function getFundamentalPersistenceFactSeries(
  warehouse,
  ticker,
  canonicalField,
  { periodType = null, limit = 12 } = {}
) {
  const periodsById = new Map(
    [...warehouse.financialPeriods.values()]
      .filter((row) => row.ticker === ticker && (!periodType || row.period_type === periodType))
      .map((row) => [row.period_id, row])
  );
  const filingsById = new Map([...warehouse.filingEvents.values()].map((row) => [row.filing_id, row]));
  const grouped = new Map();

  for (const fact of warehouse.financialFacts.values()) {
    if (fact.ticker !== ticker || fact.canonical_field !== canonicalField) {
      continue;
    }

    const period = periodsById.get(fact.period_id);
    if (!period) {
      continue;
    }

    const current = grouped.get(fact.period_id);
    const candidateFiledAt = fact.normalization_notes?.filed || "";
    const currentFiledAt = current?.fact?.normalization_notes?.filed || "";
    if (!current || compareDateDesc(currentFiledAt, candidateFiledAt) > 0) {
      grouped.set(fact.period_id, { fact, period });
    }
  }

  return [...grouped.values()]
    .sort((a, b) => compareDateDesc(a.period.period_end, b.period.period_end))
    .slice(0, limit)
    .map(({ fact, period }) => ({
      ticker,
      canonical_field: canonicalField,
      period_id: period.period_id,
      period_type: period.period_type,
      fiscal_year: period.fiscal_year,
      fiscal_quarter: period.fiscal_quarter,
      period_start: period.period_start,
      period_end: period.period_end,
      filing_id: period.filing_id,
      filing_date: filingsById.get(period.filing_id)?.filing_date || null,
      form_type: filingsById.get(period.filing_id)?.form_type || fact.source_form || null,
      value: fact.value,
      unit: fact.unit,
      taxonomy: fact.taxonomy,
      concept: fact.concept,
      as_reported_label: fact.as_reported_label,
      normalization_notes: fact.normalization_notes
    }));
}
