import { createLiveNewsCollector } from "../src/domain/live-news.js";
import { createMarketDataService } from "../src/domain/market-data.js";
import { createProviderQuotaManager } from "../src/domain/provider-quota.js";
import { fetchResearchProviderReference } from "../src/domain/research-providers.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function mockJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
    async json() {
      return payload;
    }
  };
}

function makeBars(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    t: new Date(Date.UTC(2026, 4, 1, 14, index * 15)).toISOString(),
    o: 100 + index,
    h: 102 + index,
    l: 99 + index,
    c: 101 + index,
    v: 1_000_000 + index * 1000
  }));
}

function makeMarketStore() {
  return {
    health: { liveSources: {} },
    bus: { emit() {} },
    fundamentals: {
      leaderboard: [
        { ticker: "AAPL", company: "Apple", sector: "Information Technology", market_reference: { current_price: 180 } },
        { ticker: "MSFT", company: "Microsoft", sector: "Information Technology", market_reference: { current_price: 420 } }
      ]
    }
  };
}

const requiredReferenceKeys = [
  "ticker",
  "provider",
  "live",
  "as_of",
  "current_price",
  "absolute_change",
  "percent_change",
  "market_cap",
  "enterprise_value",
  "shares_outstanding",
  "beta",
  "trailing_pe",
  "price_to_sales_ttm",
  "enterprise_to_ebitda",
  "peg",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "return_on_equity_ttm",
  "quarterly_revenue_growth",
  "levered_free_cash_flow_ttm",
  "fcf_yield"
];

const originalFetch = globalThis.fetch;

try {
  let finnhubCandleRequests = 0;
  let alpacaBarRequests = 0;
  globalThis.fetch = async (url) => {
    const urlString = String(url);
    if (urlString.includes("finnhub.io") && urlString.includes("/stock/candle")) {
      finnhubCandleRequests += 1;
      return mockJsonResponse({
        s: "ok",
        t: makeBars().map((bar) => Math.floor(new Date(bar.t).getTime() / 1000)),
        o: makeBars().map((bar) => bar.o),
        h: makeBars().map((bar) => bar.h),
        l: makeBars().map((bar) => bar.l),
        c: makeBars().map((bar) => bar.c),
        v: makeBars().map((bar) => bar.v)
      });
    }
    if (urlString.includes("data.alpaca.markets")) {
      alpacaBarRequests += 1;
      return mockJsonResponse({ bars: makeBars() });
    }
    throw new Error(`Unexpected market rotation URL ${urlString}`);
  };

  const marketConfig = {
    providerQuotaStrict: true,
    marketDataProvider: "finnhub",
    marketDataInterval: "15min",
    marketDataHistoryPoints: 8,
    marketDataCacheMs: 0,
    marketDataRefreshMs: 60000,
    marketDataRequestTimeoutMs: 1000,
    finnhubEnabled: true,
    finnhubApiKey: "finnhub-key",
    finnhubMaxRequestsPerMinute: 1,
    finnhubReserveRequestsPerMinute: 0,
    finnhubMaxRequestsPerDay: 0,
    alpacaMarketDataEnabled: true,
    alpacaMarketDataApiKeyId: "alpaca-key",
    alpacaMarketDataApiSecretKey: "alpaca-secret",
    alpacaMarketDataBaseUrl: "https://data.alpaca.markets",
    alpacaMarketDataFeed: "iex"
  };
  const marketStore = makeMarketStore();
  const marketQuota = createProviderQuotaManager({ config: marketConfig, store: marketStore });
  const marketService = createMarketDataService({ config: marketConfig, store: marketStore, providerQuota: marketQuota });
  const firstSeries = await marketService.getTickerSeries("AAPL", [], new Date().toISOString());
  const secondSeries = await marketService.getTickerSeries("MSFT", [], new Date().toISOString());
  assert(firstSeries.market_snapshot.provider === "finnhub", "First market request should use Finnhub while quota is available.");
  assert(secondSeries.market_snapshot.provider === "alpaca", "Second market request should move to Alpaca before Finnhub quota is exceeded.");
  assert(finnhubCandleRequests === 1, "Finnhub should not be called after its configured minute budget is consumed.");
  assert(alpacaBarRequests === 1, "Alpaca should receive the failover market-data request.");
  assert(marketStore.health.providerQuota.providers.find((item) => item.provider === "finnhub")?.skips >= 1, "Provider quota health should record a Finnhub skip.");

  let marketauxRequests = 0;
  let finnhubNewsRequests = 0;
  const newsDocuments = [];
  globalThis.fetch = async (url) => {
    const urlString = String(url);
    if (urlString.includes("marketaux.com") || urlString.includes("marketaux")) {
      marketauxRequests += 1;
      return mockJsonResponse({ data: [] });
    }
    if (urlString.includes("finnhub.io") && urlString.includes("/company-news")) {
      finnhubNewsRequests += 1;
      return mockJsonResponse([
        {
          id: `finnhub-news-${finnhubNewsRequests}`,
          headline: "Apple supplier news lifts sentiment",
          summary: "Apple supplier news lifts sentiment.",
          url: `https://example.com/aapl-${finnhubNewsRequests}`,
          datetime: Math.floor(Date.now() / 1000),
          source: "Example News"
        }
      ]);
    }
    throw new Error(`Unexpected news URL ${urlString}`);
  };

  const newsConfig = {
    providerQuotaStrict: true,
    liveNewsEnabled: true,
    liveNewsRequestTimeoutMs: 1000,
    liveNewsRequestRetries: 0,
    liveNewsMaxItemsPerTicker: 1,
    liveNewsLookbackHours: 24,
    liveNewsPollMs: 60000,
    liveNewsUniverseMode: "full",
    liveNewsRssFallbackMaxTickers: 1,
    liveNewsApiFallbackMaxTickers: 1,
    marketauxEnabled: true,
    marketauxApiKey: "marketaux-key",
    marketauxBaseUrl: "https://api.marketaux.com/v1/news/all",
    marketauxMaxItemsPerTicker: 1,
    marketauxSymbolsPerRequest: 1,
    marketauxMaxRequestsPerPoll: 1,
    marketauxLimitPerRequest: 3,
    marketauxRequestTimeoutMs: 1000,
    marketauxRequestRetries: 0,
    marketauxMaxRequestsPerDay: 1,
    marketauxReserveRequestsPerDay: 0,
    finnhubEnabled: true,
    finnhubApiKey: "finnhub-key",
    finnhubMaxRequestsPerMinute: 10,
    finnhubReserveRequestsPerMinute: 0
  };
  const newsStore = { health: { liveSources: {} }, seenExternalDocuments: new Set() };
  const newsQuota = createProviderQuotaManager({ config: newsConfig, store: newsStore });
  const liveNews = createLiveNewsCollector({
    config: newsConfig,
    store: newsStore,
    providerQuota: newsQuota,
    pipeline: {
      async processRawDocument(raw) {
        newsDocuments.push(raw);
      }
    },
    getTrackedFundamentalCompanies() {
      return [{ ticker: "AAPL", company: "Apple", sector: "Information Technology" }];
    }
  });
  await liveNews.pollOnce();
  await liveNews.pollOnce();
  assert(marketauxRequests === 1, "Marketaux should be skipped before crossing the configured daily budget.");
  assert(finnhubNewsRequests >= 2, "Finnhub news should take over when Marketaux is budget-reserved.");
  assert(newsDocuments.some((doc) => doc.source_name === "finnhub_news" && doc.source_type === "api"), "Finnhub news should normalize into raw-document shape.");

  globalThis.fetch = async (url) => {
    const urlString = String(url);
    const parsed = new URL(urlString);
    if (urlString.includes("finnhub.io") && urlString.includes("/quote")) {
      return mockJsonResponse({ c: 190, d: 5, dp: 2.7027, h: 191, l: 184, o: 185, pc: 185, t: Math.floor(Date.now() / 1000) });
    }
    if (urlString.includes("finnhub.io") && urlString.includes("/stock/metric")) {
      return mockJsonResponse({
        metric: {
          marketCapitalization: 3000000,
          enterpriseValue: 3100000,
          shareOutstanding: 15800,
          beta: 1.2,
          peBasicExclExtraTTM: 28,
          psTTM: 7,
          evToEbitdaTTM: 20,
          pegRatio: 2.1,
          grossMarginTTM: 45,
          operatingMarginTTM: 30,
          netProfitMarginTTM: 25,
          roeTTM: 80,
          revenueGrowthQuarterlyYoy: 5,
          freeCashFlowTTM: 110000
        }
      });
    }
    if (urlString.includes("financialmodelingprep.com") && parsed.pathname.endsWith("/quote")) {
      return mockJsonResponse([{ price: 190, change: 5, changesPercentage: 2.7, marketCap: 3_000_000_000_000 }]);
    }
    if (urlString.includes("financialmodelingprep.com") && parsed.pathname.endsWith("/profile")) {
      return mockJsonResponse([{ beta: 1.2, mktCap: 3_000_000_000_000, sharesOutstanding: 15_800_000_000 }]);
    }
    if (urlString.includes("financialmodelingprep.com") && parsed.pathname.endsWith("/key-metrics-ttm")) {
      return mockJsonResponse([{ enterpriseValueTTM: 3_100_000_000_000, weightedAverageShsOutTTM: 15_800_000_000, freeCashFlowPerShareTTM: 6.96, peRatioTTM: 28 }]);
    }
    if (urlString.includes("financialmodelingprep.com") && parsed.pathname.endsWith("/ratios-ttm")) {
      return mockJsonResponse([{ priceToSalesRatioTTM: 7, enterpriseValueOverEBITDATTM: 20, priceEarningsToGrowthRatioTTM: 2.1, grossProfitMarginTTM: 0.45, operatingProfitMarginTTM: 0.3, netProfitMarginTTM: 0.25, returnOnEquityTTM: 0.8 }]);
    }
    if (urlString.includes("alphavantage.co") && parsed.searchParams.get("function") === "OVERVIEW") {
      return mockJsonResponse({ MarketCapitalization: "3000000000000", SharesOutstanding: "15800000000", Beta: "1.2", PERatio: "28", PriceToSalesRatioTTM: "7", EVToEBITDA: "20", PEGRatio: "2.1", OperatingMarginTTM: "0.3", ProfitMargin: "0.25", ReturnOnEquityTTM: "0.8", QuarterlyRevenueGrowthYOY: "0.05" });
    }
    if (urlString.includes("alphavantage.co") && parsed.searchParams.get("function") === "GLOBAL_QUOTE") {
      return mockJsonResponse({ "Global Quote": { "05. price": "190", "07. latest trading day": "2026-05-01", "09. change": "5", "10. change percent": "2.7%" } });
    }
    throw new Error(`Unexpected reference URL ${urlString}`);
  };

  const referenceCompany = {
    ticker: "AAPL",
    company_name: "Apple",
    metrics: { pe_ttm: 28, fcf_yield: 0.03 },
    market_reference: { current_price: 180, market_cap: 2_900_000_000_000 }
  };
  const references = [];
  for (const provider of ["finnhub", "fmp", "alphavantage"]) {
    const referenceConfig = {
      providerQuotaStrict: false,
      finnhubEnabled: true,
      finnhubApiKey: "finnhub-key",
      fmpEnabled: true,
      fmpApiKey: "fmp-key",
      alphaVantageEnabled: true,
      alphaVantageApiKey: "alpha-key",
      fundamentalMarketDataRequestTimeoutMs: 1000
    };
    const reference = await fetchResearchProviderReference(provider, referenceConfig, referenceCompany, null);
    for (const key of requiredReferenceKeys) {
      assert(Object.prototype.hasOwnProperty.call(reference, key), `${provider} reference missing normalized key ${key}`);
    }
    assert(reference.ticker === "AAPL", `${provider} reference should preserve ticker.`);
    assert(reference.provider === provider, `${provider} reference should expose provider.`);
    assert(reference.live === true, `${provider} reference should be marked live.`);
    assert(Number(reference.current_price) > 0, `${provider} reference should expose current_price.`);
    references.push(reference);
  }

  console.log(JSON.stringify({
    status: "ok",
    market_rotation: {
      first_provider: firstSeries.market_snapshot.provider,
      second_provider: secondSeries.market_snapshot.provider,
      finnhub_candle_requests: finnhubCandleRequests,
      alpaca_bar_requests: alpacaBarRequests
    },
    news_rotation: {
      marketaux_requests: marketauxRequests,
      finnhub_news_requests: finnhubNewsRequests,
      normalized_news_documents: newsDocuments.length
    },
    normalized_reference_providers: references.map((reference) => reference.provider),
    normalized_reference_keys: requiredReferenceKeys
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
