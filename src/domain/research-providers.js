import { fetchJsonWithRetry } from "../utils/http.js";
import { round } from "../utils/helpers.js";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function activeFlag(config, key, fallback = true) {
  return String(config?.[key] ?? (fallback ? "true" : "false")).toLowerCase() !== "false";
}

export function hasFinnhubAccess(config) {
  return Boolean(activeFlag(config, "finnhubEnabled") && config?.finnhubApiKey);
}

export function hasFmpAccess(config) {
  return Boolean(activeFlag(config, "fmpEnabled") && config?.fmpApiKey);
}

export function hasAlphaVantageAccess(config) {
  return Boolean(activeFlag(config, "alphaVantageEnabled") && config?.alphaVantageApiKey);
}

export function isResearchProviderConfigured(config, provider) {
  if (provider === "finnhub") {
    return hasFinnhubAccess(config);
  }
  if (provider === "fmp") {
    return hasFmpAccess(config);
  }
  if (provider === "alphavantage") {
    return hasAlphaVantageAccess(config);
  }
  return false;
}

export function researchProviderMissingConfigReason(provider, purpose = "research API data") {
  if (provider === "finnhub") {
    return `${purpose} needs FINNHUB_API_KEY.`;
  }
  if (provider === "fmp") {
    return `${purpose} needs FMP_API_KEY.`;
  }
  if (provider === "alphavantage") {
    return `${purpose} needs ALPHA_VANTAGE_API_KEY.`;
  }
  return null;
}

function isoDate(value = Date.now()) {
  return new Date(value).toISOString().slice(0, 10);
}

function daysAgo(days) {
  return Date.now() - Math.max(1, Number(days || 1)) * 24 * 60 * 60 * 1000;
}

function withApiKey(url, key, value) {
  const next = new URL(url);
  next.searchParams.set(key, value);
  return next.toString();
}

async function fetchProviderJson(provider, url, config, quotaManager, { timeoutMs, label } = {}) {
  const request = () => fetchJsonWithRetry(url, {
    timeoutMs: timeoutMs || config?.providerRequestTimeoutMs || 12000,
    retries: 0,
    label: label || `${provider} request`,
    headers: {
      Accept: "application/json",
      "User-Agent": "SentimentAnalyst/1.0 (+provider rotation)"
    }
  });
  return quotaManager ? quotaManager.run(provider, request) : request();
}

function providerBase(config, provider) {
  if (provider === "fmp") {
    return trimTrailingSlash(config?.fmpBaseUrl || "https://financialmodelingprep.com/stable");
  }
  if (provider === "finnhub") {
    return trimTrailingSlash(config?.finnhubBaseUrl || "https://finnhub.io/api/v1");
  }
  return "";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scaleFinnhubMillions(value) {
  const parsed = numberOrNull(value);
  if (parsed === null) {
    return null;
  }
  return Math.abs(parsed) < 100_000_000 ? Math.round(parsed * 1_000_000) : Math.round(parsed);
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function normalizeRatio(value, options = {}) {
  const parsed = numberOrNull(value);
  if (parsed === null) {
    return null;
  }
  if (options.percent && Math.abs(parsed) > 1) {
    return parsed / 100;
  }
  return parsed;
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "number") {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function finnhubResolution(interval = "15min") {
  const normalized = String(interval || "15min").toLowerCase();
  const match = normalized.match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/);
  if (!match) {
    return "15";
  }
  const value = Math.max(1, Number(match[1] || 1));
  const unit = match[2];
  if (["h", "hr", "hour", "hours"].includes(unit)) {
    return String(value * 60);
  }
  if (["d", "day", "days"].includes(unit)) {
    return "D";
  }
  return String(value);
}

function alphaInterval(interval = "15min") {
  const normalized = String(interval || "15min").toLowerCase();
  if (/^1\s*(m|min|minute)/.test(normalized)) {
    return "1min";
  }
  if (/^5\s*(m|min|minute)/.test(normalized)) {
    return "5min";
  }
  if (/^30\s*(m|min|minute)/.test(normalized)) {
    return "30min";
  }
  if (/^60\s*(m|min|minute)|1\s*(h|hr|hour)/.test(normalized)) {
    return "60min";
  }
  return "15min";
}

function barLookbackDays(interval, points) {
  const normalized = String(interval || "15min").toLowerCase();
  const count = Math.max(1, Number(points || 18));
  if (/d|day/.test(normalized)) {
    return Math.max(20, count * 2);
  }
  if (/h|hour/.test(normalized)) {
    return Math.max(7, Math.ceil(count / 4) + 3);
  }
  return Math.max(5, Math.ceil(count / 8) + 3);
}

async function fetchFinnhubBars(config, ticker, quotaManager, options = {}) {
  const to = Math.floor(Date.now() / 1000);
  const from = Math.floor(daysAgo(barLookbackDays(options.interval, options.points)) / 1000);
  const params = new URLSearchParams({
    symbol: ticker,
    resolution: finnhubResolution(options.interval),
    from: String(from),
    to: String(to),
    token: config.finnhubApiKey
  });
  const payload = await fetchProviderJson(
    "finnhub",
    `${providerBase(config, "finnhub")}/stock/candle?${params.toString()}`,
    config,
    quotaManager,
    { timeoutMs: options.timeoutMs, label: `Finnhub candles ${ticker}` }
  );
  if (payload?.s !== "ok" || !Array.isArray(payload?.t) || !payload.t.length) {
    throw new Error(payload?.s === "no_data" ? "Finnhub returned no candle data" : "Finnhub candles returned an invalid payload");
  }
  return payload.t.map((timestamp, index) => ({
    timestamp: normalizeTimestamp(timestamp),
    open: numberOrNull(payload.o?.[index]),
    high: numberOrNull(payload.h?.[index]),
    low: numberOrNull(payload.l?.[index]),
    close: numberOrNull(payload.c?.[index]),
    volume: numberOrNull(payload.v?.[index]) || 0
  })).filter((bar) => bar.timestamp && bar.close !== null);
}

async function fetchAlphaVantageBars(config, ticker, quotaManager, options = {}) {
  const interval = alphaInterval(options.interval);
  const functionName = /d|day/i.test(String(options.interval || "")) ? "TIME_SERIES_DAILY" : "TIME_SERIES_INTRADAY";
  const params = new URLSearchParams({
    function: functionName,
    symbol: ticker,
    outputsize: "compact",
    apikey: config.alphaVantageApiKey
  });
  if (functionName === "TIME_SERIES_INTRADAY") {
    params.set("interval", interval);
  }
  const payload = await fetchProviderJson(
    "alphavantage",
    `https://www.alphavantage.co/query?${params.toString()}`,
    config,
    quotaManager,
    { timeoutMs: options.timeoutMs, label: `Alpha Vantage time series ${ticker}` }
  );
  if (payload?.Note || payload?.Information) {
    throw new Error(payload.Note || payload.Information);
  }
  const key = functionName === "TIME_SERIES_INTRADAY" ? `Time Series (${interval})` : "Time Series (Daily)";
  const rows = payload?.[key];
  if (!rows || typeof rows !== "object") {
    throw new Error("Alpha Vantage returned no time-series rows");
  }
  return Object.entries(rows)
    .slice(0, Math.max(1, Number(options.points || 18)))
    .map(([timestamp, point]) => ({
      timestamp: normalizeTimestamp(timestamp),
      open: numberOrNull(point["1. open"]),
      high: numberOrNull(point["2. high"]),
      low: numberOrNull(point["3. low"]),
      close: numberOrNull(point["4. close"]),
      volume: numberOrNull(point["5. volume"]) || 0
    }))
    .filter((bar) => bar.timestamp && bar.close !== null)
    .reverse();
}

async function fetchFmpBars(config, ticker, quotaManager, options = {}) {
  const to = isoDate();
  const from = isoDate(daysAgo(barLookbackDays(options.interval, options.points)));
  const rows = await fetchFmpArray(config, "/historical-price-eod/light", {
    symbol: ticker,
    from,
    to
  }, quotaManager, `FMP historical prices ${ticker}`);
  const bars = rows
    .slice(0, Math.max(1, Number(options.points || 18)))
    .map((point) => ({
      timestamp: normalizeTimestamp(point.date || point.label),
      open: numberOrNull(point.open ?? point.price ?? point.close),
      high: numberOrNull(point.high ?? point.price ?? point.close),
      low: numberOrNull(point.low ?? point.price ?? point.close),
      close: numberOrNull(point.close ?? point.price),
      volume: numberOrNull(point.volume) || 0
    }))
    .filter((bar) => bar.timestamp && bar.close !== null)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (!bars.length) {
    throw new Error("FMP returned no historical bars");
  }
  return bars;
}

export async function fetchResearchProviderBars(provider, config, ticker, quotaManager, options = {}) {
  if (provider === "finnhub") {
    return fetchFinnhubBars(config, ticker, quotaManager, options);
  }
  if (provider === "fmp") {
    return fetchFmpBars(config, ticker, quotaManager, options);
  }
  if (provider === "alphavantage") {
    return fetchAlphaVantageBars(config, ticker, quotaManager, options);
  }
  throw new Error(`${provider} does not provide configured market bars`);
}

async function fetchFinnhubQuote(config, ticker, quotaManager, options = {}) {
  const params = new URLSearchParams({ symbol: ticker, token: config.finnhubApiKey });
  return fetchProviderJson(
    "finnhub",
    `${providerBase(config, "finnhub")}/quote?${params.toString()}`,
    config,
    quotaManager,
    { timeoutMs: options.timeoutMs, label: `Finnhub quote ${ticker}` }
  );
}

async function fetchFinnhubMetrics(config, ticker, quotaManager, options = {}) {
  const params = new URLSearchParams({ symbol: ticker, metric: "all", token: config.finnhubApiKey });
  const payload = await fetchProviderJson(
    "finnhub",
    `${providerBase(config, "finnhub")}/stock/metric?${params.toString()}`,
    config,
    quotaManager,
    { timeoutMs: options.timeoutMs, label: `Finnhub metrics ${ticker}` }
  );
  return payload?.metric || {};
}

async function fetchFmpArray(config, path, params, quotaManager, label) {
  const url = new URL(`${providerBase(config, "fmp")}${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  url.searchParams.set("apikey", config.fmpApiKey);
  const payload = await fetchProviderJson("fmp", url.toString(), config, quotaManager, {
    timeoutMs: config.fundamentalMarketDataRequestTimeoutMs,
    label
  });
  return Array.isArray(payload) ? payload : payload ? [payload] : [];
}

async function fetchAlphaOverview(config, ticker, quotaManager, options = {}) {
  const params = new URLSearchParams({
    function: "OVERVIEW",
    symbol: ticker,
    apikey: config.alphaVantageApiKey
  });
  const payload = await fetchProviderJson(
    "alphavantage",
    `https://www.alphavantage.co/query?${params.toString()}`,
    config,
    quotaManager,
    { timeoutMs: options.timeoutMs, label: `Alpha Vantage overview ${ticker}` }
  );
  if (payload?.Note || payload?.Information) {
    throw new Error(payload.Note || payload.Information);
  }
  return payload || {};
}

async function fetchAlphaQuote(config, ticker, quotaManager, options = {}) {
  const params = new URLSearchParams({
    function: "GLOBAL_QUOTE",
    symbol: ticker,
    apikey: config.alphaVantageApiKey
  });
  const payload = await fetchProviderJson(
    "alphavantage",
    `https://www.alphavantage.co/query?${params.toString()}`,
    config,
    quotaManager,
    { timeoutMs: options.timeoutMs, label: `Alpha Vantage quote ${ticker}` }
  );
  if (payload?.Note || payload?.Information) {
    throw new Error(payload.Note || payload.Information);
  }
  return payload?.["Global Quote"] || {};
}

export async function fetchResearchProviderReference(provider, config, company, quotaManager) {
  const ticker = company.ticker;
  const fallbackMetrics = company.metrics || {};
  const fallbackReference = company.market_reference || {};

  if (provider === "finnhub") {
    const [quote, metric] = await Promise.all([
      fetchFinnhubQuote(config, ticker, quotaManager, { timeoutMs: config.fundamentalMarketDataRequestTimeoutMs }),
      fetchFinnhubMetrics(config, ticker, quotaManager, { timeoutMs: config.fundamentalMarketDataRequestTimeoutMs })
    ]);
    const currentPrice = firstNumber(quote.c, fallbackReference.current_price);
    const previousClose = firstNumber(quote.pc);
    const marketCap = scaleFinnhubMillions(metric.marketCapitalization ?? metric.marketCap);
    const fcfTtm = scaleFinnhubMillions(metric.freeCashFlowTTM ?? metric.fcfTTM);
    return {
      ticker,
      provider: "finnhub",
      live: true,
      as_of: quote.t ? normalizeTimestamp(quote.t) : new Date().toISOString(),
      current_price: currentPrice,
      absolute_change: firstNumber(quote.d, currentPrice && previousClose ? currentPrice - previousClose : null),
      percent_change: firstNumber(quote.dp !== undefined ? Number(quote.dp) / 100 : null),
      market_cap: marketCap ?? fallbackReference.market_cap ?? null,
      enterprise_value: scaleFinnhubMillions(metric.enterpriseValue) ?? fallbackReference.enterprise_value ?? null,
      shares_outstanding: scaleFinnhubMillions(metric.shareOutstanding) ?? fallbackReference.shares_outstanding ?? null,
      beta: firstNumber(metric.beta, fallbackReference.beta),
      trailing_pe: firstNumber(metric.peBasicExclExtraTTM, metric.peNormalizedAnnual, fallbackMetrics.pe_ttm),
      price_to_sales_ttm: firstNumber(metric.psTTM, metric.priceToSalesTTM, fallbackMetrics.price_to_sales_ttm),
      enterprise_to_ebitda: firstNumber(metric.evToEbitdaTTM, metric.enterpriseValueOverEBITDATTM, fallbackMetrics.ev_to_ebitda_ttm),
      peg: firstNumber(metric.pegRatio, fallbackMetrics.peg),
      gross_margin: normalizeRatio(firstNumber(metric.grossMarginTTM, metric.grossMarginAnnual, fallbackMetrics.gross_margin), { percent: true }),
      operating_margin: normalizeRatio(firstNumber(metric.operatingMarginTTM, metric.operatingMarginAnnual, fallbackMetrics.operating_margin), { percent: true }),
      net_margin: normalizeRatio(firstNumber(metric.netProfitMarginTTM, metric.netProfitMarginAnnual, fallbackMetrics.net_margin), { percent: true }),
      return_on_equity_ttm: normalizeRatio(firstNumber(metric.roeTTM, metric.roeAnnual, fallbackMetrics.roe), { percent: true }),
      quarterly_revenue_growth: normalizeRatio(firstNumber(metric.revenueGrowthQuarterlyYoy, metric.revenueGrowthTTMYoy, fallbackMetrics.revenue_growth_yoy), { percent: true }),
      levered_free_cash_flow_ttm: fcfTtm,
      fcf_yield: marketCap && fcfTtm ? round(fcfTtm / marketCap, 6) : fallbackMetrics.fcf_yield ?? null
    };
  }

  if (provider === "fmp") {
    const [quoteRows, profileRows, metricsRows, ratiosRows] = await Promise.all([
      fetchFmpArray(config, "/quote", { symbol: ticker }, quotaManager, `FMP quote ${ticker}`),
      fetchFmpArray(config, "/profile", { symbol: ticker }, quotaManager, `FMP profile ${ticker}`),
      fetchFmpArray(config, "/key-metrics-ttm", { symbol: ticker }, quotaManager, `FMP key metrics ${ticker}`),
      fetchFmpArray(config, "/ratios-ttm", { symbol: ticker }, quotaManager, `FMP ratios ${ticker}`)
    ]);
    const quote = quoteRows[0] || {};
    const profile = profileRows[0] || {};
    const metrics = metricsRows[0] || {};
    const ratios = ratiosRows[0] || {};
    const currentPrice = firstNumber(quote.price, profile.price, fallbackReference.current_price);
    const marketCap = firstNumber(quote.marketCap, profile.mktCap, metrics.marketCapTTM, fallbackReference.market_cap);
    const fcfTtm = firstNumber(metrics.freeCashFlowPerShareTTM && metrics.weightedAverageShsOutTTM
      ? Number(metrics.freeCashFlowPerShareTTM) * Number(metrics.weightedAverageShsOutTTM)
      : null);
    return {
      ticker,
      provider: "fmp",
      live: true,
      as_of: new Date().toISOString(),
      current_price: currentPrice,
      absolute_change: firstNumber(quote.change, currentPrice && quote.previousClose ? currentPrice - Number(quote.previousClose) : null),
      percent_change: firstNumber(quote.changesPercentage !== undefined ? Number(quote.changesPercentage) / 100 : null),
      market_cap: marketCap ?? null,
      enterprise_value: firstNumber(metrics.enterpriseValueTTM, fallbackReference.enterprise_value),
      shares_outstanding: firstNumber(metrics.weightedAverageShsOutTTM, profile.sharesOutstanding, fallbackReference.shares_outstanding),
      beta: firstNumber(profile.beta, fallbackReference.beta),
      trailing_pe: firstNumber(ratios.priceEarningsRatioTTM, metrics.peRatioTTM, fallbackMetrics.pe_ttm),
      price_to_sales_ttm: firstNumber(ratios.priceToSalesRatioTTM, metrics.priceToSalesRatioTTM, fallbackMetrics.price_to_sales_ttm),
      enterprise_to_ebitda: firstNumber(metrics.enterpriseValueOverEBITDATTM, fallbackMetrics.ev_to_ebitda_ttm),
      peg: firstNumber(ratios.priceEarningsToGrowthRatioTTM, fallbackMetrics.peg),
      gross_margin: firstNumber(ratios.grossProfitMarginTTM, fallbackMetrics.gross_margin),
      operating_margin: firstNumber(ratios.operatingProfitMarginTTM, fallbackMetrics.operating_margin),
      net_margin: firstNumber(ratios.netProfitMarginTTM, fallbackMetrics.net_margin),
      return_on_equity_ttm: firstNumber(ratios.returnOnEquityTTM, fallbackMetrics.roe),
      quarterly_revenue_growth: fallbackMetrics.revenue_growth_yoy ?? null,
      levered_free_cash_flow_ttm: fcfTtm,
      fcf_yield: marketCap && fcfTtm ? round(fcfTtm / marketCap, 6) : fallbackMetrics.fcf_yield ?? null
    };
  }

  if (provider === "alphavantage") {
    const [overview, quote] = await Promise.all([
      fetchAlphaOverview(config, ticker, quotaManager, { timeoutMs: config.fundamentalMarketDataRequestTimeoutMs }),
      fetchAlphaQuote(config, ticker, quotaManager, { timeoutMs: config.fundamentalMarketDataRequestTimeoutMs })
    ]);
    const currentPrice = firstNumber(quote["05. price"], fallbackReference.current_price);
    const marketCap = firstNumber(overview.MarketCapitalization, fallbackReference.market_cap);
    const percentChange = firstNumber(String(quote["10. change percent"] || "").replace("%", ""));
    return {
      ticker,
      provider: "alphavantage",
      live: true,
      as_of: quote["07. latest trading day"] ? normalizeTimestamp(quote["07. latest trading day"]) : new Date().toISOString(),
      current_price: currentPrice,
      absolute_change: firstNumber(quote["09. change"]),
      percent_change: percentChange === null ? null : percentChange / 100,
      market_cap: marketCap,
      enterprise_value: fallbackReference.enterprise_value ?? null,
      shares_outstanding: firstNumber(overview.SharesOutstanding, fallbackReference.shares_outstanding),
      beta: firstNumber(overview.Beta, fallbackReference.beta),
      trailing_pe: firstNumber(overview.PERatio, fallbackMetrics.pe_ttm),
      price_to_sales_ttm: firstNumber(overview.PriceToSalesRatioTTM, fallbackMetrics.price_to_sales_ttm),
      enterprise_to_ebitda: firstNumber(overview.EVToEBITDA, fallbackMetrics.ev_to_ebitda_ttm),
      peg: firstNumber(overview.PEGRatio, fallbackMetrics.peg),
      gross_margin: fallbackMetrics.gross_margin ?? null,
      operating_margin: normalizeRatio(firstNumber(overview.OperatingMarginTTM, fallbackMetrics.operating_margin), { percent: true }),
      net_margin: normalizeRatio(firstNumber(overview.ProfitMargin, fallbackMetrics.net_margin), { percent: true }),
      return_on_equity_ttm: normalizeRatio(firstNumber(overview.ReturnOnEquityTTM, fallbackMetrics.roe), { percent: true }),
      quarterly_revenue_growth: normalizeRatio(firstNumber(overview.QuarterlyRevenueGrowthYOY, fallbackMetrics.revenue_growth_yoy), { percent: true }),
      levered_free_cash_flow_ttm: fallbackReference.levered_free_cash_flow_ttm ?? null,
      fcf_yield: fallbackMetrics.fcf_yield ?? null
    };
  }

  throw new Error(`${provider} does not provide a normalized fundamental reference`);
}

export async function fetchProviderCompanyNews(provider, config, entry, quotaManager, options = {}) {
  const from = options.from || isoDate(daysAgo(config.liveNewsLookbackHours ? Number(config.liveNewsLookbackHours) / 24 : 3));
  const to = options.to || isoDate();
  const limit = Math.max(1, Number(options.limit || config.liveNewsMaxItemsPerTicker || 3));

  if (provider === "finnhub") {
    const params = new URLSearchParams({
      symbol: entry.ticker,
      from,
      to,
      token: config.finnhubApiKey
    });
    const payload = await fetchProviderJson(
      "finnhub",
      `${providerBase(config, "finnhub")}/company-news?${params.toString()}`,
      config,
      quotaManager,
      { timeoutMs: config.liveNewsRequestTimeoutMs, label: `Finnhub news ${entry.ticker}` }
    );
    return (Array.isArray(payload) ? payload : []).slice(0, limit).map((item) => ({
      title: item.headline || item.title || "",
      link: item.url || "",
      guid: item.id || item.url || `${entry.ticker}:${item.datetime}:${item.headline}`,
      description: item.summary || item.headline || "",
      pubDate: normalizeTimestamp(item.datetime) || new Date().toISOString(),
      source: item.source || "Finnhub",
      raw: item
    }));
  }

  if (provider === "fmp") {
    const rows = await fetchFmpArray(config, "/news/stock", {
      symbols: entry.ticker,
      from,
      to,
      limit
    }, quotaManager, `FMP stock news ${entry.ticker}`);
    return rows.slice(0, limit).map((item) => ({
      title: item.title || "",
      link: item.url || "",
      guid: item.url || `${entry.ticker}:${item.publishedDate || item.date}:${item.title}`,
      description: item.text || item.content || item.summary || item.title || "",
      pubDate: normalizeTimestamp(item.publishedDate || item.date) || new Date().toISOString(),
      source: item.site || item.publisher || "FMP",
      raw: item
    }));
  }

  return [];
}

export async function fetchProviderEarningsDates(provider, config, entry, quotaManager, options = {}) {
  const from = options.from || isoDate();
  const to = options.to || isoDate(Date.now() + Math.max(1, Number(config.earningsLookAheadDays || 14)) * 24 * 60 * 60 * 1000);

  if (provider === "finnhub") {
    const params = new URLSearchParams({
      from,
      to,
      symbol: entry.ticker,
      token: config.finnhubApiKey
    });
    const payload = await fetchProviderJson(
      "finnhub",
      `${providerBase(config, "finnhub")}/calendar/earnings?${params.toString()}`,
      config,
      quotaManager,
      { timeoutMs: config.earningsRequestTimeoutMs, label: `Finnhub earnings ${entry.ticker}` }
    );
    return (payload?.earningsCalendar || [])
      .map((item) => normalizeTimestamp(item.date || item.period))
      .filter(Boolean)
      .map((date) => new Date(date).getTime());
  }

  if (provider === "fmp") {
    const rows = await fetchFmpArray(config, "/earnings-calendar", {
      symbol: entry.ticker,
      from,
      to
    }, quotaManager, `FMP earnings ${entry.ticker}`);
    return rows
      .map((item) => normalizeTimestamp(item.date || item.fiscalDateEnding))
      .filter(Boolean)
      .map((date) => new Date(date).getTime());
  }

  if (provider === "alphavantage") {
    const params = new URLSearchParams({
      function: "EARNINGS",
      symbol: entry.ticker,
      apikey: config.alphaVantageApiKey
    });
    const payload = await fetchProviderJson(
      "alphavantage",
      `https://www.alphavantage.co/query?${params.toString()}`,
      config,
      quotaManager,
      { timeoutMs: config.earningsRequestTimeoutMs, label: `Alpha Vantage earnings ${entry.ticker}` }
    );
    if (payload?.Note || payload?.Information) {
      throw new Error(payload.Note || payload.Information);
    }
    return (payload?.quarterlyEarnings || [])
      .map((item) => normalizeTimestamp(item.reportedDate))
      .filter(Boolean)
      .map((date) => new Date(date).getTime());
  }

  return [];
}
