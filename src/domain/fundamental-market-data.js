import { clamp, fingerprint, round } from "../utils/helpers.js";
import {
  alpacaHeaders,
  isLiveMarketProviderConfigured,
  liveMarketDataStatus,
  trimTrailingSlash
} from "./market-providers.js";

function deterministicUnit(value) {
  const hex = fingerprint(value).slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

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

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function marketHealth(store, config) {
  if (!store.health.liveSources.fundamental_market_data) {
    store.health.liveSources.fundamental_market_data = {
      provider: config.fundamentalMarketDataProvider,
      enabled: config.fundamentalMarketDataProvider !== "synthetic",
      polling: false,
      last_poll_at: null,
      last_success_at: null,
      last_error: null,
      cache_entries: 0,
      fallback_mode: config.fundamentalMarketDataProvider === "synthetic",
      configured: isLiveMarketProviderConfigured(config, config.fundamentalMarketDataProvider),
      feed: null,
      missing_config_reason: null,
      last_batch_size: 0
    };
  }

  return store.health.liveSources.fundamental_market_data;
}

function updateHealthSnapshot(store, config, cacheSize) {
  const health = marketHealth(store, config);
  const providerStatus = liveMarketDataStatus(config, config.fundamentalMarketDataProvider);
  health.provider = config.fundamentalMarketDataProvider;
  health.enabled = config.fundamentalMarketDataProvider !== "synthetic";
  health.cache_entries = cacheSize;
  health.configured = providerStatus.configured;
  health.feed = providerStatus.feed;
  health.fallback_mode = providerStatus.fallback_mode;
  health.missing_config_reason = providerStatus.configured ? null : providerStatus.missing_config_reason;
  health.decision_status = providerStatus.fallback_mode ? "fallback" : "partial_live";
  return health;
}

function buildSyntheticReference(company) {
  const unit = deterministicUnit(`${company.ticker}:${company.company_name}`);
  const basePrice = round(45 + unit * 420, 2);
  const percentChange = round((unit - 0.5) * 0.06, 4);
  const marketCapBase = company.market_cap_bucket === "mega_cap" ? 400_000_000_000 : 45_000_000_000;
  const marketCapRange = company.market_cap_bucket === "mega_cap" ? 2_300_000_000_000 : 280_000_000_000;
  const marketCap = Math.round(marketCapBase + unit * marketCapRange);
  const sharesOutstanding = Math.round(marketCap / Math.max(5, basePrice));
  const enterpriseValue = Math.round(marketCap * (1 + Math.max(0, company.metrics.debt_to_equity || 0) * 0.08));
  const leveredFreeCashFlow = Math.round((company.metrics.fcf_yield || 0.03) * marketCap);

  return {
    ticker: company.ticker,
    provider: "synthetic",
    live: false,
    as_of: new Date().toISOString(),
    current_price: basePrice,
    absolute_change: round(basePrice * percentChange, 2),
    percent_change: percentChange,
    market_cap: marketCap,
    enterprise_value: enterpriseValue,
    shares_outstanding: sharesOutstanding,
    beta: round(0.85 + unit * 0.9, 3),
    trailing_pe: company.metrics.pe_ttm,
    price_to_sales_ttm: company.metrics.price_to_sales_ttm,
    enterprise_to_ebitda: company.metrics.ev_to_ebitda_ttm,
    peg: company.metrics.peg,
    gross_margin: company.metrics.gross_margin,
    operating_margin: company.metrics.operating_margin,
    net_margin: company.metrics.net_margin,
    return_on_equity_ttm: company.metrics.roe,
    quarterly_revenue_growth: company.metrics.revenue_growth_yoy,
    levered_free_cash_flow_ttm: leveredFreeCashFlow,
    fcf_yield: company.metrics.fcf_yield
  };
}

async function fetchQuote(config, ticker) {
  const params = new URLSearchParams({
    symbol: ticker,
    apikey: config.twelveDataApiKey
  });
  const request = withTimeout(config.fundamentalMarketDataRequestTimeoutMs);

  try {
    const response = await fetch(`https://api.twelvedata.com/quote?${params.toString()}`, {
      signal: request.signal,
      headers: {
        "User-Agent": "SentimentAnalyst/1.0 (+fundamental reference)"
      }
    });

    if (!response.ok) {
      throw new Error(`Quote request failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.status === "error") {
      throw new Error(payload.message || "Quote endpoint returned an error");
    }

    return payload;
  } finally {
    request.clear();
  }
}

async function fetchStatistics(config, ticker) {
  const params = new URLSearchParams({
    symbol: ticker,
    apikey: config.twelveDataApiKey
  });
  const request = withTimeout(config.fundamentalMarketDataRequestTimeoutMs);

  try {
    const response = await fetch(`https://api.twelvedata.com/statistics?${params.toString()}`, {
      signal: request.signal,
      headers: {
        "User-Agent": "SentimentAnalyst/1.0 (+fundamental reference)"
      }
    });

    if (!response.ok) {
      throw new Error(`Statistics request failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.status === "error") {
      throw new Error(payload.message || "Statistics endpoint returned an error");
    }

    return payload;
  } finally {
    request.clear();
  }
}

async function fetchAlpacaDailyBars(config, ticker) {
  const params = new URLSearchParams({
    timeframe: "1Day",
    limit: "2",
    adjustment: "raw",
    sort: "asc",
    feed: config.alpacaMarketDataFeed || "iex"
  });
  const request = withTimeout(config.fundamentalMarketDataRequestTimeoutMs);
  const base = trimTrailingSlash(config.alpacaMarketDataBaseUrl || "https://data.alpaca.markets");

  try {
    const response = await fetch(`${base}/v2/stocks/${encodeURIComponent(ticker)}/bars?${params.toString()}`, {
      signal: request.signal,
      headers: alpacaHeaders(config)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Alpaca daily bars request failed with ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload.bars) || !payload.bars.length) {
      throw new Error("Alpaca returned no daily bars");
    }

    return payload;
  } finally {
    request.clear();
  }
}

function mapLiveReference(ticker, quotePayload, statsPayload, fallbackCompany) {
  const valuations = statsPayload?.statistics?.valuations_metrics || {};
  const financials = statsPayload?.statistics?.financials || {};
  const incomeStatement = statsPayload?.statistics?.income_statement || {};
  const cashFlow = statsPayload?.statistics?.cash_flow || {};
  const stockStats = statsPayload?.statistics?.stock_statistics || {};
  const priceSummary = statsPayload?.statistics?.stock_price_summary || {};
  const fallbackMetrics = fallbackCompany?.metrics || {};
  const currentPrice = asNumber(quotePayload?.close) ?? asNumber(quotePayload?.price) ?? asNumber(quotePayload?.previous_close);
  const previousClose = asNumber(quotePayload?.previous_close);
  const absoluteChange = asNumber(quotePayload?.change) ?? (currentPrice && previousClose ? currentPrice - previousClose : null);
  const percentChange =
    asNumber(quotePayload?.percent_change) ??
    (currentPrice && previousClose ? (currentPrice - previousClose) / Math.max(1, previousClose) : null);
  const marketCap = asNumber(valuations.market_capitalization);
  const leveredFreeCashFlow = asNumber(cashFlow.levered_free_cash_flow_ttm);

  return {
    ticker,
    provider: "twelvedata",
    live: true,
    as_of: new Date().toISOString(),
    current_price: currentPrice ?? fallbackCompany?.market_reference?.current_price ?? null,
    absolute_change: absoluteChange,
    percent_change: percentChange,
    market_cap: marketCap ?? fallbackCompany?.market_reference?.market_cap ?? null,
    enterprise_value: asNumber(valuations.enterprise_value) ?? fallbackCompany?.market_reference?.enterprise_value ?? null,
    shares_outstanding: asNumber(stockStats.shares_outstanding) ?? fallbackCompany?.market_reference?.shares_outstanding ?? null,
    beta: asNumber(priceSummary.beta) ?? fallbackCompany?.market_reference?.beta ?? null,
    trailing_pe: asNumber(valuations.trailing_pe) ?? fallbackMetrics.pe_ttm ?? null,
    price_to_sales_ttm: asNumber(valuations.price_to_sales_ttm) ?? fallbackMetrics.price_to_sales_ttm ?? null,
    enterprise_to_ebitda: asNumber(valuations.enterprise_to_ebitda) ?? fallbackMetrics.ev_to_ebitda_ttm ?? null,
    peg: asNumber(valuations.peg_ratio) ?? fallbackMetrics.peg ?? null,
    gross_margin: asNumber(financials.gross_margin) ?? fallbackMetrics.gross_margin ?? null,
    operating_margin: asNumber(financials.operating_margin) ?? fallbackMetrics.operating_margin ?? null,
    net_margin: asNumber(financials.profit_margin) ?? fallbackMetrics.net_margin ?? null,
    return_on_equity_ttm: asNumber(financials.return_on_equity_ttm) ?? fallbackMetrics.roe ?? null,
    quarterly_revenue_growth: asNumber(incomeStatement.quarterly_revenue_growth) ?? fallbackMetrics.revenue_growth_yoy ?? null,
    levered_free_cash_flow_ttm: leveredFreeCashFlow,
    fcf_yield: marketCap && leveredFreeCashFlow ? round(leveredFreeCashFlow / marketCap, 6) : fallbackMetrics.fcf_yield ?? null
  };
}

function mapAlpacaReference(ticker, barsPayload, fallbackCompany) {
  const bars = Array.isArray(barsPayload?.bars) ? barsPayload.bars : [];
  const latest = bars.at(-1) || {};
  const previous = bars.at(-2) || {};
  const fallbackMetrics = fallbackCompany?.metrics || {};
  const currentPrice = asNumber(latest.c) ?? fallbackCompany?.market_reference?.current_price ?? null;
  const previousClose = asNumber(previous.c) ?? asNumber(latest.o);
  const absoluteChange = currentPrice !== null && previousClose !== null ? currentPrice - previousClose : null;
  const percentChange =
    currentPrice !== null && previousClose !== null
      ? (currentPrice - previousClose) / Math.max(1, previousClose)
      : null;

  return {
    ticker,
    provider: "alpaca",
    live: true,
    partial_live: true,
    as_of: latest.t ? new Date(latest.t).toISOString() : new Date().toISOString(),
    current_price: currentPrice,
    absolute_change: absoluteChange === null ? null : round(absoluteChange, 2),
    percent_change: percentChange === null ? null : round(percentChange, 4),
    market_cap: fallbackCompany?.market_reference?.market_cap ?? null,
    enterprise_value: fallbackCompany?.market_reference?.enterprise_value ?? null,
    shares_outstanding: fallbackCompany?.market_reference?.shares_outstanding ?? null,
    beta: fallbackCompany?.market_reference?.beta ?? null,
    trailing_pe: fallbackMetrics.pe_ttm ?? fallbackCompany?.market_reference?.trailing_pe ?? null,
    price_to_sales_ttm: fallbackMetrics.price_to_sales_ttm ?? fallbackCompany?.market_reference?.price_to_sales_ttm ?? null,
    enterprise_to_ebitda: fallbackMetrics.ev_to_ebitda_ttm ?? fallbackCompany?.market_reference?.enterprise_to_ebitda ?? null,
    peg: fallbackMetrics.peg ?? fallbackCompany?.market_reference?.peg ?? null,
    gross_margin: fallbackMetrics.gross_margin ?? fallbackCompany?.market_reference?.gross_margin ?? null,
    operating_margin: fallbackMetrics.operating_margin ?? fallbackCompany?.market_reference?.operating_margin ?? null,
    net_margin: fallbackMetrics.net_margin ?? fallbackCompany?.market_reference?.net_margin ?? null,
    return_on_equity_ttm: fallbackMetrics.roe ?? fallbackCompany?.market_reference?.return_on_equity_ttm ?? null,
    quarterly_revenue_growth: fallbackMetrics.revenue_growth_yoy ?? fallbackCompany?.market_reference?.quarterly_revenue_growth ?? null,
    levered_free_cash_flow_ttm: fallbackCompany?.market_reference?.levered_free_cash_flow_ttm ?? null,
    fcf_yield: fallbackMetrics.fcf_yield ?? fallbackCompany?.market_reference?.fcf_yield ?? null
  };
}

export function createFundamentalMarketDataService({ config, store }) {
  const cache = new Map();
  let timer = null;
  let running = false;
  let getCompanies = () => [];
  let onUpdate = async () => undefined;
  let refreshCursor = 0;

  function cacheKey(company) {
    return `${config.fundamentalMarketDataProvider}:${company.ticker}`;
  }

  async function getReference(company) {
    const health = updateHealthSnapshot(store, config, cache.size);
    const key = cacheKey(company);
    const cached = cache.get(key);
    const now = Date.now();

    if (cached && now - cached.fetchedAt <= config.fundamentalMarketDataCacheMs) {
      return cached.payload;
    }

    if (!isLiveMarketProviderConfigured(config, config.fundamentalMarketDataProvider)) {
      const synthetic = buildSyntheticReference(company);
      cache.set(key, { fetchedAt: now, payload: synthetic });
      updateHealthSnapshot(store, config, cache.size);
      return synthetic;
    }

    health.polling = true;
    health.last_poll_at = new Date().toISOString();

    try {
      if (config.fundamentalMarketDataProvider === "alpaca") {
        const barsPayload = await fetchAlpacaDailyBars(config, company.ticker);
        const payload = mapAlpacaReference(company.ticker, barsPayload, company);
        cache.set(key, { fetchedAt: now, payload });
        health.last_success_at = new Date().toISOString();
        health.last_error = null;
        health.partial_error = "Alpaca market data updates price/change only; SEC and bootstrap metrics still provide fundamentals.";
        updateHealthSnapshot(store, config, cache.size);
        return payload;
      }

      const quotePayload = await fetchQuote(config, company.ticker);
      let statsPayload = null;
      let partialError = null;
      try {
        statsPayload = await fetchStatistics(config, company.ticker);
      } catch (error) {
        partialError = error.message;
      }
      const payload = mapLiveReference(company.ticker, quotePayload, statsPayload, company);
      cache.set(key, { fetchedAt: now, payload });
      health.last_success_at = new Date().toISOString();
      health.last_error = null;
      health.partial_error = partialError;
      updateHealthSnapshot(store, config, cache.size);
      return payload;
    } catch (error) {
      health.last_error = error.message;
      const fallback = buildSyntheticReference(company);
      cache.set(key, { fetchedAt: now, payload: fallback });
      updateHealthSnapshot(store, config, cache.size);
      return fallback;
    } finally {
      health.polling = false;
    }
  }

  async function getReferenceBatch(companies) {
    const entries = await Promise.all(
      companies.map(async (company) => [company.ticker, await getReference(company)])
    );
    const map = new Map(entries);
    updateHealthSnapshot(store, config, cache.size).last_batch_size = entries.length;
    return map;
  }

  function selectRefreshBatch(companies) {
    const limit = Math.max(0, Math.floor(Number(config.fundamentalMarketDataMaxCompaniesPerPoll || 0)));
    if (!limit || limit >= companies.length) {
      return companies;
    }
    const offset = refreshCursor % companies.length;
    const rotated = [...companies.slice(offset), ...companies.slice(0, offset)];
    refreshCursor = (refreshCursor + limit) % companies.length;
    return rotated.slice(0, limit);
  }

  async function refreshLoop() {
    if (!running) {
      return;
    }

    const companies = getCompanies();
    if (companies.length) {
      try {
        const batch = selectRefreshBatch(companies);
        const referenceMap = await getReferenceBatch(batch);
        await onUpdate(referenceMap);
        store.bus.emit("event", {
          type: "fundamental_market_reference_update",
          timestamp: new Date().toISOString(),
          provider: config.fundamentalMarketDataProvider,
          coverage_count: batch.length,
          total_companies: companies.length
        });
      } catch (error) {
        marketHealth(store, config).last_error = error.message;
      }
    }

    timer = setTimeout(() => {
      refreshLoop().catch(() => undefined);
    }, config.fundamentalMarketDataRefreshMs);
  }

  return {
    async getReferenceBatch(companies) {
      return getReferenceBatch(companies);
    },
    async start(options = {}) {
      running = true;
      getCompanies = options.getCompanies || getCompanies;
      onUpdate = options.onUpdate || onUpdate;
      updateHealthSnapshot(store, config, cache.size);
      await refreshLoop();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      marketHealth(store, config).polling = false;
      updateHealthSnapshot(store, config, cache.size);
    }
  };
}
