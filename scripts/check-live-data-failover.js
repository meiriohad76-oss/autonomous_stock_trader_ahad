import { createFundamentalMarketDataService } from "../src/domain/fundamental-market-data.js";
import { createLiveNewsCollector } from "../src/domain/live-news.js";
import { createMarketDataService } from "../src/domain/market-data.js";
import { liveMarketProviderChain } from "../src/domain/market-providers.js";

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

function makeStore() {
  return {
    health: { liveSources: {} },
    bus: { emit() {} },
    seenExternalDocuments: new Set(),
    fundamentals: {
      leaderboard: [
        { ticker: "AAPL", company: "Apple", sector: "Technology", market_reference: { current_price: 180 } },
        { ticker: "MSFT", company: "Microsoft", sector: "Technology", market_reference: { current_price: 420 } }
      ]
    }
  };
}

const baseMarketConfig = {
  marketDataProvider: "twelvedata",
  marketDataInterval: "15min",
  marketDataHistoryPoints: 8,
  marketDataCacheMs: 0,
  marketDataRefreshMs: 60000,
  marketDataRequestTimeoutMs: 1000,
  twelveDataApiKey: "twelve-key",
  alpacaMarketDataEnabled: true,
  alpacaMarketDataApiKeyId: "alpaca-key",
  alpacaMarketDataApiSecretKey: "alpaca-secret",
  alpacaMarketDataBaseUrl: "https://data.alpaca.markets",
  alpacaMarketDataFeed: "iex"
};

const originalFetch = globalThis.fetch;

try {
  const providerChain = liveMarketProviderChain(baseMarketConfig, "twelvedata");
  assert(providerChain[0] === "twelvedata" && providerChain[1] === "alpaca", "Provider chain should prefer Twelve Data then fall back to Alpaca.");

  const marketStore = makeStore();
  let twelveMarketRequests = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("twelvedata.com")) {
      twelveMarketRequests += 1;
      return mockJsonResponse({ message: "quota" }, 429);
    }
    if (String(url).includes("data.alpaca.markets")) {
      return mockJsonResponse({
        bars: Array.from({ length: 8 }, (_, index) => ({
          t: new Date(Date.UTC(2026, 4, 1, 14, index * 15)).toISOString(),
          o: 100 + index,
          h: 102 + index,
          l: 99 + index,
          c: 101 + index,
          v: 1_000_000 + index * 50_000
        }))
      });
    }
    throw new Error(`Unexpected market-data URL ${url}`);
  };

  const marketData = createMarketDataService({ config: baseMarketConfig, store: marketStore });
  const series = await marketData.getTickerSeries("AAPL", [], new Date().toISOString());
  assert(series.market_snapshot.provider === "alpaca", "Market data should fail over to Alpaca.");
  assert(series.market_snapshot.live === true, "Market data failover should remain live.");
  assert(marketStore.health.liveSources.market_data.active_provider === "alpaca", "Market data health should expose the active provider.");
  assert(marketStore.health.liveSources.market_data.fallback_mode === false, "Market data should not mark synthetic fallback when Alpaca succeeds.");
  assert(/Provider failover used alpaca/.test(marketStore.health.liveSources.market_data.last_error), "Market data health should retain the provider failover warning.");
  assert(marketStore.health.liveSources.market_data.provider_cooldowns.some((item) => item.provider === "twelvedata"), "Twelve Data quota errors should activate provider cooldown.");
  await marketData.getTickerSeries("MSFT", [], new Date().toISOString());
  assert(twelveMarketRequests === 1, "Provider cooldown should prevent repeated Twelve Data calls after quota failure.");
  const twelveRequestsAfterMarketCooldown = twelveMarketRequests;

  const fundamentalStore = makeStore();
  const fundamentalConfig = {
    ...baseMarketConfig,
    fundamentalMarketDataProvider: "twelvedata",
    fundamentalMarketDataCacheMs: 0,
    fundamentalMarketDataRequestTimeoutMs: 1000,
    fundamentalMarketDataRefreshMs: 60000,
    fundamentalMarketDataMaxCompaniesPerPoll: 2
  };
  const fundamentalData = createFundamentalMarketDataService({ config: fundamentalConfig, store: fundamentalStore });
  const referenceMap = await fundamentalData.getReferenceBatch([
    {
      ticker: "AAPL",
      company_name: "Apple",
      sector: "Technology",
      metrics: { pe_ttm: 25, fcf_yield: 0.03 },
      market_reference: { current_price: 180, market_cap: 2_000_000_000_000 }
    }
  ]);
  const reference = referenceMap.get("AAPL");
  assert(reference.provider === "alpaca" && reference.live, "Fundamental market reference should fail over to Alpaca live bars.");
  assert(fundamentalStore.health.liveSources.fundamental_market_data.active_provider === "alpaca", "Fundamental reference health should expose active provider.");
  assert(fundamentalStore.health.liveSources.fundamental_market_data.fallback_mode === false, "Fundamental reference should not mark fallback when Alpaca succeeds.");

  const newsDocuments = [];
  const requestUrls = [];
  globalThis.fetch = async (url) => {
    const urlString = String(url);
    requestUrls.push(urlString);
    if (urlString.includes("marketaux")) {
      const symbols = new URL(urlString).searchParams.get("symbols") || "";
      if (symbols.includes(",")) {
        return mockJsonResponse({ error: "invalid batch" }, 400);
      }
      const symbol = symbols || "AAPL";
      return mockJsonResponse({
        data: symbol === "AAPL"
          ? [
              {
                uuid: "marketaux-aapl",
                title: "Apple linked market news",
                description: "Apple linked market news.",
                url: "https://example.com/aapl",
                published_at: new Date().toISOString(),
                source: "Marketaux",
                entities: [{ symbol: "AAPL", sentiment_score: 0.2, match_score: 0.9 }]
              }
            ]
          : []
      });
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return "<rss><channel></channel></rss>";
      }
    };
  };

  const newsStore = {
    health: { liveSources: {} },
    seenExternalDocuments: new Set()
  };
  const liveNews = createLiveNewsCollector({
    config: {
      liveNewsEnabled: true,
      liveNewsRequestTimeoutMs: 1000,
      liveNewsRequestRetries: 0,
      liveNewsMaxItemsPerTicker: 1,
      liveNewsLookbackHours: 24,
      liveNewsPollMs: 60000,
      liveNewsUniverseMode: "full",
      liveNewsRssFallbackMaxTickers: 2,
      marketauxEnabled: true,
      marketauxApiKey: "marketaux-key",
      marketauxBaseUrl: "https://api.marketaux.com/v1/news/all",
      marketauxMaxItemsPerTicker: 1,
      marketauxSymbolsPerRequest: 2,
      marketauxMaxRequestsPerPoll: 1,
      marketauxLimitPerRequest: 3,
      marketauxRequestTimeoutMs: 1000,
      marketauxRequestRetries: 0
    },
    store: newsStore,
    pipeline: {
      async processRawDocument(raw) {
        newsDocuments.push(raw);
      }
    },
    getTrackedFundamentalCompanies() {
      return [
        { ticker: "AAPL", company: "Apple", sector: "Technology" },
        { ticker: "MSFT", company: "Microsoft", sector: "Technology" }
      ];
    }
  });
  const newsResult = await liveNews.pollOnce();
  assert(newsResult.ingested === 1, "Marketaux individual retry should ingest the valid symbol.");
  assert(newsDocuments.some((item) => item.source_name === "marketaux" && item.source_metadata.ticker_hint === "AAPL"), "Marketaux retry should preserve linked source metadata.");
  assert(requestUrls.some((url) => new URL(url).searchParams.get("symbols") === "AAPL"), "Marketaux retry should issue a single-symbol request.");
  assert(newsStore.health.liveSources.marketaux_news.single_symbol_retries >= 2, "Marketaux health should count single-symbol retries.");

  console.log(JSON.stringify({
    status: "ok",
    provider_chain: providerChain,
    market_data_active_provider: marketStore.health.liveSources.market_data.active_provider,
    twelve_market_requests_after_market_cooldown: twelveRequestsAfterMarketCooldown,
    fundamental_reference_active_provider: fundamentalStore.health.liveSources.fundamental_market_data.active_provider,
    marketaux_single_symbol_retries: newsStore.health.liveSources.marketaux_news.single_symbol_retries,
    marketaux_ingested: newsResult.ingested
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
