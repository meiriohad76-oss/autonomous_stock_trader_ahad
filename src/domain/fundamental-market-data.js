import { clamp, fingerprint, round } from "../utils/helpers.js";

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
      last_batch_size: 0
    };
  }

  return store.health.liveSources.fundamental_market_data;
}

function updateHealthSnapshot(store, config, cacheSize) {
  const health = marketHealth(store, config);
  health.provider = config.fundamentalMarketDataProvider;
  health.enabled = config.fundamentalMarketDataProvider !== "synthetic";
  health.cache_entries = cacheSize;
  health.fallback_mode = config.fundamentalMarketDataProvider === "synthetic" || !config.twelveDataApiKey;
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

function mapLiveReference(ticker, quotePayload, statsPayload, fallbackCompany) {
  const valuations = statsPayload?.statistics?.valuations_metrics || {};
  const financials = statsPayload?.statistics?.financials || {};
  const incomeStatement = statsPayload?.statistics?.income_statement || {};
  const cashFlow = statsPayload?.statistics?.cash_flow || {};
  const stockStats = statsPayload?.statistics?.stock_statistics || {};
  const priceSummary = statsPayload?.statistics?.stock_price_summary || {};
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
    market_cap: marketCap,
    enterprise_value: asNumber(valuations.enterprise_value),
    shares_outstanding: asNumber(stockStats.shares_outstanding),
    beta: asNumber(priceSummary.beta),
    trailing_pe: asNumber(valuations.trailing_pe),
    price_to_sales_ttm: asNumber(valuations.price_to_sales_ttm),
    enterprise_to_ebitda: asNumber(valuations.enterprise_to_ebitda),
    peg: asNumber(valuations.peg_ratio),
    gross_margin: asNumber(financials.gross_margin),
    operating_margin: asNumber(financials.operating_margin),
    net_margin: asNumber(financials.profit_margin),
    return_on_equity_ttm: asNumber(financials.return_on_equity_ttm),
    quarterly_revenue_growth: asNumber(incomeStatement.quarterly_revenue_growth),
    levered_free_cash_flow_ttm: leveredFreeCashFlow,
    fcf_yield: marketCap && leveredFreeCashFlow ? round(leveredFreeCashFlow / marketCap, 6) : null
  };
}

export function createFundamentalMarketDataService({ config, store }) {
  const cache = new Map();
  let timer = null;
  let running = false;
  let getCompanies = () => [];
  let onUpdate = async () => undefined;

  async function getReference(company) {
    const health = updateHealthSnapshot(store, config, cache.size);
    const cached = cache.get(company.ticker);
    const now = Date.now();

    if (cached && now - cached.fetchedAt <= config.fundamentalMarketDataCacheMs) {
      return cached.payload;
    }

    if (config.fundamentalMarketDataProvider !== "twelvedata" || !config.twelveDataApiKey) {
      const synthetic = buildSyntheticReference(company);
      cache.set(company.ticker, { fetchedAt: now, payload: synthetic });
      updateHealthSnapshot(store, config, cache.size);
      return synthetic;
    }

    health.polling = true;
    health.last_poll_at = new Date().toISOString();

    try {
      const [quotePayload, statsPayload] = await Promise.all([fetchQuote(config, company.ticker), fetchStatistics(config, company.ticker)]);
      const payload = mapLiveReference(company.ticker, quotePayload, statsPayload, company);
      cache.set(company.ticker, { fetchedAt: now, payload });
      health.last_success_at = new Date().toISOString();
      health.last_error = null;
      updateHealthSnapshot(store, config, cache.size);
      return payload;
    } catch (error) {
      health.last_error = error.message;
      const fallback = buildSyntheticReference(company);
      cache.set(company.ticker, { fetchedAt: now, payload: fallback });
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

  async function refreshLoop() {
    if (!running) {
      return;
    }

    const companies = getCompanies();
    if (companies.length) {
      try {
        const referenceMap = await getReferenceBatch(companies);
        await onUpdate(referenceMap);
        store.bus.emit("event", {
          type: "fundamental_market_reference_update",
          timestamp: new Date().toISOString(),
          provider: config.fundamentalMarketDataProvider,
          coverage_count: companies.length
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
