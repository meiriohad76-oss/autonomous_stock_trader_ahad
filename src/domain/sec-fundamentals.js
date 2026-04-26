import { round } from "../utils/helpers.js";

const FUNDAMENTAL_FORMS = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A"]);
const TAXONOMY_ORDER = ["us-gaap", "ifrs-full", "dei"];
const DURATION_QUARTER_MIN = 60;
const DURATION_QUARTER_MAX = 130;
const DURATION_ANNUAL_MIN = 300;
const DURATION_ANNUAL_MAX = 380;

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function secHeaders(config) {
  return {
    "User-Agent": config.secUserAgent,
    Accept: "application/json, text/plain;q=0.9"
  };
}

function cikToPaddedString(value) {
  return String(value || "").replace(/\D/g, "").padStart(10, "0");
}

function cikToArchiveString(value) {
  return String(Number(String(value || "").replace(/\D/g, "")));
}

function archiveUrl(cik, accessionNumber, primaryDocument) {
  return `https://www.sec.gov/Archives/edgar/data/${cikToArchiveString(cik)}/${String(accessionNumber).replace(/-/g, "")}/${primaryDocument}`;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function differenceInDays(start, end) {
  return Math.abs((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
}

function buildEmptyResult() {
  return {
    ingested: 0,
    liveCompanies: 0,
    errors: 0
  };
}

async function fetchJson(url, config) {
  const request = withTimeout(config.secRequestTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: request.signal,
      headers: secHeaders(config)
    });

    if (!response.ok) {
      throw new Error(`SEC request failed with ${response.status}`);
    }

    return response.json();
  } finally {
    request.clear();
  }
}

async function loadTickerCikMap(config, store) {
  const cache = store.externalLookups.secTickerMap;
  if (cache.data && Date.now() - cache.fetchedAt <= config.secTickerMapCacheMs) {
    return cache.data;
  }

  const payload = await fetchJson("https://www.sec.gov/files/company_tickers.json", config);
  const map = new Map();
  for (const record of Object.values(payload || {})) {
    if (record?.ticker && record?.cik_str) {
      map.set(String(record.ticker).toUpperCase(), cikToPaddedString(record.cik_str));
    }
  }

  cache.data = map;
  cache.fetchedAt = Date.now();
  return map;
}

function pickLatestFiling(submissions, lookbackHours) {
  const recent = submissions?.filings?.recent;
  if (!recent?.form?.length) {
    return null;
  }

  for (let index = 0; index < recent.form.length; index += 1) {
    const form = String(recent.form[index] || "");
    if (!FUNDAMENTAL_FORMS.has(form)) {
      continue;
    }

    const filingDate = recent.filingDate[index];
    const filedAt = filingDate ? new Date(`${filingDate}T00:00:00Z`) : new Date();
    const ageHours = Math.max(0, (Date.now() - filedAt.getTime()) / 3600000);
    if (ageHours > lookbackHours) {
      continue;
    }

    return {
      form_type: form,
      filing_date: filingDate,
      accepted_at: recent.acceptedDate?.[index] || null,
      accession_no: recent.accessionNumber[index],
      period_end: recent.reportDate?.[index] || recent.filingDate[index],
      primary_document: recent.primaryDocument[index],
      source_url: archiveUrl(submissions.cik, recent.accessionNumber[index], recent.primaryDocument[index])
    };
  }

  return null;
}

function chooseConcept(companyFacts, conceptNames, unitPreference = []) {
  const facts = companyFacts?.facts || {};
  const taxonomies = [
    ...TAXONOMY_ORDER.filter((name) => facts[name]),
    ...Object.keys(facts).filter((name) => !TAXONOMY_ORDER.includes(name))
  ];

  for (const taxonomyName of taxonomies) {
    const taxonomyFacts = facts[taxonomyName];
    for (const conceptName of conceptNames) {
      const concept = taxonomyFacts?.[conceptName];
      if (!concept?.units) {
        continue;
      }

      for (const unit of unitPreference) {
        if (Array.isArray(concept.units[unit]) && concept.units[unit].length) {
          return concept.units[unit];
        }
      }

      const firstUnit = Object.keys(concept.units)[0];
      if (firstUnit && Array.isArray(concept.units[firstUnit]) && concept.units[firstUnit].length) {
        return concept.units[firstUnit];
      }
    }
  }

  return [];
}

function normalizeSeries(series) {
  const normalized = series
    .map((item) => ({
      value: parseNumber(item.val),
      filed: item.filed ? new Date(item.filed).toISOString() : null,
      end: item.end ? new Date(item.end).toISOString().slice(0, 10) : null,
      start: item.start ? new Date(item.start).toISOString().slice(0, 10) : null,
      form: item.form || "",
      fy: item.fy || null,
      fp: item.fp || "",
      frame: item.frame || null,
      fiscalKey: `${item.fy || "na"}:${item.fp || "na"}`
    }))
    .filter((item) => item.end && Number.isFinite(item.value) && (!item.form || FUNDAMENTAL_FORMS.has(item.form)))
    .sort((a, b) => new Date(b.end) - new Date(a.end) || new Date(b.filed || 0) - new Date(a.filed || 0));

  const byEnd = new Map();
  for (const item of normalized) {
    const key = `${item.end}:${item.start || "instant"}`;
    if (!byEnd.has(key)) {
      byEnd.set(key, item);
    }
  }

  return [...byEnd.values()];
}

function isQuarterObservation(item) {
  if (!item.start) {
    return false;
  }
  const durationDays = differenceInDays(item.start, item.end);
  return durationDays >= DURATION_QUARTER_MIN && durationDays <= DURATION_QUARTER_MAX;
}

function isAnnualObservation(item) {
  if (!item.start) {
    return false;
  }
  const durationDays = differenceInDays(item.start, item.end);
  return durationDays >= DURATION_ANNUAL_MIN && durationDays <= DURATION_ANNUAL_MAX;
}

function latestQuarter(series) {
  return normalizeSeries(series).find(isQuarterObservation) || null;
}

function latestAnnual(series) {
  return normalizeSeries(series).find(isAnnualObservation) || null;
}

function latestInstant(series) {
  return normalizeSeries(series)[0] || null;
}

function trailingTwelveMonths(series) {
  const quarters = normalizeSeries(series).filter(isQuarterObservation).slice(0, 4);
  if (quarters.length === 4) {
    return round(quarters.reduce((sum, item) => sum + item.value, 0), 6);
  }
  const annual = latestAnnual(series);
  return annual?.value ?? null;
}

function yearAgoQuarter(series, currentQuarter) {
  const endTime = new Date(currentQuarter.end).getTime();
  const targetTime = endTime - 365 * 86400000;
  return normalizeSeries(series)
    .filter(isQuarterObservation)
    .find((item) => Math.abs(new Date(item.end).getTime() - targetTime) <= 45 * 86400000) || null;
}

function growthYoY(series) {
  const current = latestQuarter(series);
  if (!current) {
    return null;
  }
  const prior = yearAgoQuarter(series, current);
  if (!prior || !prior.value) {
    return null;
  }
  return round((current.value - prior.value) / Math.abs(prior.value), 6);
}

function latestQuarterValue(series) {
  return latestQuarter(series)?.value ?? null;
}

function quarterlyValues(series, limit = 4) {
  return normalizeSeries(series)
    .filter(isQuarterObservation)
    .slice(0, limit)
    .map((item) => item.value);
}

function quarterMetricGrowth(seriesBuilder) {
  const current = seriesBuilder(0);
  const prior = seriesBuilder(1);
  if (!Number.isFinite(current) || !Number.isFinite(prior) || !prior) {
    return null;
  }
  return round((current - prior) / Math.abs(prior), 6);
}

function averageAbsoluteSequentialChange(values) {
  if (values.length < 2) {
    return null;
  }
  const deltas = [];
  for (let index = 0; index < values.length - 1; index += 1) {
    const current = values[index];
    const next = values[index + 1];
    if (!Number.isFinite(current) || !Number.isFinite(next) || !next) {
      continue;
    }
    deltas.push(Math.abs((current - next) / Math.abs(next)));
  }
  return deltas.length ? deltas.reduce((sum, item) => sum + item, 0) / deltas.length : null;
}

function consistencyScore(values, { tolerance = 0.35 } = {}) {
  const avgChange = averageAbsoluteSequentialChange(values);
  if (!Number.isFinite(avgChange)) {
    return null;
  }
  return round(clamp(1 - avgChange / tolerance, 0, 1), 6);
}

function buildQuarterMargins(numeratorSeries, denominatorSeries, limit = 4) {
  const numerators = normalizeSeries(numeratorSeries).filter(isQuarterObservation).slice(0, limit);
  const denominators = normalizeSeries(denominatorSeries).filter(isQuarterObservation).slice(0, limit);
  const byEnd = new Map(denominators.map((item) => [item.end, item.value]));

  return numerators
    .map((item) => {
      const denominator = byEnd.get(item.end);
      return safeRatio(item.value, denominator);
    })
    .filter(Number.isFinite);
}

function scoreFromVariance(values, { tolerance = 0.2 } = {}) {
  if (values.length < 2) {
    return null;
  }
  const avg = values.reduce((sum, item) => sum + item, 0) / values.length;
  if (!avg) {
    return null;
  }
  const variance =
    values.reduce((sum, item) => sum + (item - avg) ** 2, 0) / Math.max(1, values.length);
  const deviation = Math.sqrt(variance);
  return round(clamp(1 - deviation / tolerance, 0, 1), 6);
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) {
    return null;
  }
  return round(numerator / denominator, 6);
}

function safeDifference(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return round(a - b, 6);
}

function safeSum(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? round(usable.reduce((sum, item) => sum + item, 0), 6) : null;
}

function buildNotes(formType, filingDate, computed) {
  const notes = [`${formType} filed on ${filingDate} was used to refresh live SEC fundamentals.`];
  if (Number.isFinite(computed.revenue_growth_yoy)) {
    notes.push(`Revenue growth is currently ${round(computed.revenue_growth_yoy * 100, 1)}% year over year.`);
  }
  if (Number.isFinite(computed.operating_margin)) {
    notes.push(`Operating margin is running near ${round(computed.operating_margin * 100, 1)}%.`);
  }
  if (Number.isFinite(computed.current_ratio)) {
    notes.push(`Current ratio is approximately ${round(computed.current_ratio, 2)}.`);
  }
  return notes.slice(0, 3);
}

function buildSummary(companyName, computed, filing) {
  const growth = computed.revenue_growth_yoy;
  const margin = computed.operating_margin;
  if (Number.isFinite(growth) && Number.isFinite(margin)) {
    if (growth > 0.1 && margin > 0.2) {
      return `${companyName} is showing strong live filing-backed growth with healthy operating profitability in the latest ${filing.form_type}.`;
    }
    if (growth < 0.03 || margin < 0.1) {
      return `${companyName} shows a more mixed live filing profile, with growth or profitability softer in the latest ${filing.form_type}.`;
    }
  }
  return `${companyName} was refreshed from the latest SEC filing and Company Facts dataset for the Fundamental Analyst.`;
}

export function computeLiveMetricsFromCompanyFacts(companyFacts, fallbackMetrics) {
  const revenueSeries = chooseConcept(companyFacts, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "Revenues"
  ], ["USD"]);
  const cogsSeries = chooseConcept(companyFacts, [
    "CostOfGoodsSold",
    "CostOfRevenue",
    "CostOfSales"
  ], ["USD"]);
  const ebitdaSeries = chooseConcept(companyFacts, ["OperatingIncomeLoss"], ["USD"]);
  const grossProfitSeries = chooseConcept(companyFacts, ["GrossProfit"], ["USD"]);
  const operatingIncomeSeries = chooseConcept(companyFacts, ["OperatingIncomeLoss"], ["USD"]);
  const netIncomeSeries = chooseConcept(companyFacts, ["NetIncomeLoss", "ProfitLoss"], ["USD"]);
  const assetsSeries = chooseConcept(companyFacts, ["Assets"], ["USD"]);
  const equitySeries = chooseConcept(companyFacts, [
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "StockholdersEquity"
  ], ["USD"]);
  const currentAssetsSeries = chooseConcept(companyFacts, ["AssetsCurrent"], ["USD"]);
  const currentLiabilitiesSeries = chooseConcept(companyFacts, ["LiabilitiesCurrent"], ["USD"]);
  const cashSeries = chooseConcept(companyFacts, ["CashAndCashEquivalentsAtCarryingValue"], ["USD"]);
  const longTermDebtSeries = chooseConcept(companyFacts, [
    "LongTermDebtAndCapitalLeaseObligations",
    "LongTermDebtNoncurrent",
    "LongTermDebt"
  ], ["USD"]);
  const debtCurrentSeries = chooseConcept(companyFacts, ["LongTermDebtCurrent", "DebtCurrent"], ["USD"]);
  const cfoSeries = chooseConcept(companyFacts, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
  ], ["USD"]);
  const capexSeries = chooseConcept(companyFacts, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PropertyPlantAndEquipmentAdditions"
  ], ["USD"]);
  const interestExpenseSeries = chooseConcept(companyFacts, ["InterestExpenseAndDebtExpense", "InterestExpense"], ["USD"]);
  const epsSeries = chooseConcept(companyFacts, ["EarningsPerShareDiluted"], ["USD/shares", "USD-per-shares"]);

  const latestRevenueQuarter = latestQuarterValue(revenueSeries);
  const latestGrossProfitQuarter = latestQuarterValue(grossProfitSeries);
  const latestOperatingQuarter = latestQuarterValue(operatingIncomeSeries);
  const latestNetQuarter = latestQuarterValue(netIncomeSeries);
  const revenueTtm = trailingTwelveMonths(revenueSeries);
  const operatingTtm = trailingTwelveMonths(operatingIncomeSeries);
  const netIncomeTtm = trailingTwelveMonths(netIncomeSeries);
  const cfoTtm = trailingTwelveMonths(cfoSeries);
  const capexTtm = trailingTwelveMonths(capexSeries);
  const fcfTtm = Number.isFinite(cfoTtm) && Number.isFinite(capexTtm) ? cfoTtm - Math.abs(capexTtm) : null;
  const totalAssets = latestInstant(assetsSeries)?.value;
  const totalEquity = latestInstant(equitySeries)?.value;
  const currentAssets = latestInstant(currentAssetsSeries)?.value;
  const currentLiabilities = latestInstant(currentLiabilitiesSeries)?.value;
  const cash = latestInstant(cashSeries)?.value;
  const debt = [latestInstant(longTermDebtSeries)?.value, latestInstant(debtCurrentSeries)?.value]
    .filter(Number.isFinite)
    .reduce((sum, item) => sum + item, 0);
  const interestExpense = trailingTwelveMonths(interestExpenseSeries);
  const epsGrowth = growthYoY(epsSeries);
  const revenueGrowth = growthYoY(revenueSeries);
  const quarterlyRevenueValues = quarterlyValues(revenueSeries, 4);
  const quarterlyOperatingMargins = buildQuarterMargins(operatingIncomeSeries, revenueSeries, 4);
  const quarterlyCfoValues = quarterlyValues(cfoSeries, 4);
  const quarterlyCapexValues = quarterlyValues(capexSeries, 4).map((value) => (Number.isFinite(value) ? Math.abs(value) : value));
  const quarterlyFcfValues = quarterlyCfoValues
    .map((value, index) => safeDifference(value, quarterlyCapexValues[index]))
    .filter(Number.isFinite);
  const quarterAgoFcf = quarterlyFcfValues[1];
  const latestQuarterFcf = quarterlyFcfValues[0];
  const grossMarginFromCost = !Number.isFinite(latestGrossProfitQuarter) && Number.isFinite(latestRevenueQuarter)
    ? safeRatio(safeDifference(latestRevenueQuarter, latestQuarterValue(cogsSeries)), latestRevenueQuarter)
    : null;

  const computed = {
    revenue_growth_yoy: revenueGrowth,
    eps_growth_yoy: epsGrowth,
    fcf_growth_yoy:
      Number.isFinite(latestQuarterFcf) && Number.isFinite(quarterAgoFcf) && quarterAgoFcf
        ? round((latestQuarterFcf - quarterAgoFcf) / Math.abs(quarterAgoFcf), 6)
        : Number.isFinite(fcfTtm) && Number.isFinite(fallbackMetrics.fcf_growth_yoy)
          ? fallbackMetrics.fcf_growth_yoy
          : null,
    gross_margin: safeRatio(latestGrossProfitQuarter, latestRevenueQuarter) ?? grossMarginFromCost,
    operating_margin: safeRatio(latestOperatingQuarter, latestRevenueQuarter),
    net_margin: safeRatio(latestNetQuarter, latestRevenueQuarter),
    roe: safeRatio(netIncomeTtm, totalEquity),
    roic: Number.isFinite(operatingTtm) && Number.isFinite(totalEquity) ? safeRatio(operatingTtm * 0.79, totalEquity + Math.max(0, debt - (cash || 0))) : null,
    debt_to_equity: safeRatio(debt, totalEquity),
    net_debt_to_ebitda: Number.isFinite(debt) && Number.isFinite(cash) && Number.isFinite(operatingTtm)
      ? safeRatio(debt - cash, Math.max(operatingTtm, 1))
      : null,
    current_ratio: safeRatio(currentAssets, currentLiabilities),
    interest_coverage: safeRatio(operatingTtm, interestExpense),
    fcf_margin: safeRatio(fcfTtm, revenueTtm),
    fcf_conversion: safeRatio(fcfTtm, netIncomeTtm),
    asset_turnover: safeRatio(revenueTtm, totalAssets),
    margin_stability: scoreFromVariance(quarterlyOperatingMargins, { tolerance: 0.14 }) ?? fallbackMetrics.margin_stability,
    revenue_consistency: consistencyScore(quarterlyRevenueValues, { tolerance: 0.4 }) ?? fallbackMetrics.revenue_consistency
  };

  return Object.fromEntries(
    Object.entries(computed).filter(([, value]) => Number.isFinite(value))
  );
}

function mergeLiveCompany(baseCompany, submissions, companyFacts, lookbackHours) {
  const filing = pickLatestFiling(submissions, lookbackHours);
  if (!filing) {
    return null;
  }

  const liveMetrics = computeLiveMetricsFromCompanyFacts(companyFacts, baseCompany.metrics);
  const criticalFields = [
    "revenue_growth_yoy",
    "gross_margin",
    "operating_margin",
    "net_margin",
    "roe",
    "current_ratio"
  ];
  const missingLiveFields = criticalFields.filter((field) => !Number.isFinite(liveMetrics[field]));
  const filingAgeDays = Math.max(0, Math.round((Date.now() - new Date(`${filing.filing_date}T00:00:00Z`).getTime()) / 86400000));
  const freshnessPenalty = Math.min(0.25, filingAgeDays / 540);
  const comparabilityPenalty = filing.form_type.startsWith("6-K") ? 0.16 : filing.form_type.startsWith("20-F") || filing.form_type.startsWith("40-F") ? 0.08 : 0;
  const notes = buildNotes(filing.form_type, filing.filing_date, { ...baseCompany.metrics, ...liveMetrics });

  return {
    ...baseCompany,
    as_of: new Date().toISOString(),
    cik: submissions.cik || baseCompany.cik,
    filing_date: filing.filing_date,
    period_end: filing.period_end || baseCompany.period_end,
    form_type: filing.form_type,
    filing_url: filing.source_url,
    summary: buildSummary(baseCompany.company_name, { ...baseCompany.metrics, ...liveMetrics }, filing),
    notes,
    metrics: {
      ...baseCompany.metrics,
      ...liveMetrics
    },
    quality_flags: {
      ...baseCompany.quality_flags,
      missing_fields_count: missingLiveFields.length,
      anomaly_flags: [
        ...baseCompany.quality_flags.anomaly_flags.filter((item) => item !== "sec_data_gap" && item !== "stale_filing"),
        ...(missingLiveFields.length ? ["sec_data_gap"] : []),
        ...(filingAgeDays > 180 ? ["stale_filing"] : [])
      ],
      reporting_confidence_score: round(Math.max(0.6, 1 - missingLiveFields.length * 0.06), 3),
      data_freshness_score: round(Math.max(0.55, 1 - freshnessPenalty), 3),
      peer_comparability_score: round(Math.max(0.55, 1 - missingLiveFields.length * 0.04 - comparabilityPenalty), 3),
      rule_confidence: round(Math.max(0.7, 1 - missingLiveFields.length * 0.04), 3)
    }
  };
}

export function createSecFundamentalsCollector(app) {
  const { config, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;

  function ensureHealthEntry() {
    if (!store.health.liveSources.sec_fundamentals) {
      store.health.liveSources.sec_fundamentals = {
        enabled: config.fundamentalSecEnabled,
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        tracked_companies: 0,
        live_companies: 0
      };
    }
    return store.health.liveSources.sec_fundamentals;
  }

  async function pollOnce() {
    if (!config.fundamentalSecEnabled || inFlight) {
      return buildEmptyResult();
    }

    const health = ensureHealthEntry();
    inFlight = true;
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    const result = buildEmptyResult();

    try {
      const trackedCompanies = app.getTrackedFundamentalCompanies ? app.getTrackedFundamentalCompanies() : [];
      health.tracked_companies = trackedCompanies.length;
      if (!trackedCompanies.length) {
        health.last_error = null;
        return result;
      }

      const tickerMap = await loadTickerCikMap(config, store);
      const nextCompanies = [];
      let liveCompanyCount = 0;

      for (const company of trackedCompanies) {
        const cik = company.cik ? cikToPaddedString(company.cik) : tickerMap.get(company.ticker);
        if (!cik) {
          result.errors += 1;
          nextCompanies.push(company);
          continue;
        }

        try {
          const [submissions, companyFacts] = await Promise.all([
            fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, config),
            fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, config)
          ]);

          const filing = pickLatestFiling(submissions, config.fundamentalSecLookbackHours);
          if (!filing) {
            nextCompanies.push(company);
            continue;
          }

          const liveCompany = mergeLiveCompany(
            { ...company, cik },
            submissions,
            companyFacts,
            config.fundamentalSecLookbackHours
          );
          if (liveCompany) {
            nextCompanies.push(liveCompany);
            liveCompanyCount += 1;
          } else {
            nextCompanies.push(company);
          }
        } catch (error) {
          result.errors += 1;
          health.last_error = error.message;
          nextCompanies.push(company);
        }
      }

      if (nextCompanies.length && app.replaceFundamentalCompanies) {
        await app.replaceFundamentalCompanies(nextCompanies);
      }

      result.ingested = liveCompanyCount;
      result.liveCompanies = liveCompanyCount;
      health.live_companies = liveCompanyCount;
      health.last_success_at = new Date().toISOString();
      if (liveCompanyCount || !result.errors) {
        health.last_error = null;
      }
      return result;
    } catch (error) {
      health.last_error = error.message;
      result.errors += 1;
      return result;
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.fundamentalSecEnabled) {
      return;
    }

    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.fundamentalSecPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !config.fundamentalSecEnabled) {
        return;
      }
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
