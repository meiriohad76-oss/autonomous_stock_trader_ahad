process.env.DATABASE_ENABLED = process.env.DATABASE_ENABLED || "false";
process.env.SEED_DATA_IN_DECISIONS = "true";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const { createSentimentApp } = await import("../src/app.js");
const { config } = await import("../src/config.js");
const {
  getFundamentalPersistenceFactSeries,
  getFundamentalPersistenceFilings,
  materializeFundamentalPersistence
} = await import("../src/domain/fundamental-persistence.js");
const { buildMarketauxUrl, createLiveNewsCollector, mapMarketauxArticles, parseGoogleNewsRss } = await import("../src/domain/live-news.js");
const { normalizeRawDocument } = await import("../src/domain/normalize.js");
const { createMarketDataService } = await import("../src/domain/market-data.js");
const { detectMarketFlowSignal } = await import("../src/domain/market-flow.js");
const {
  computeLiveMetricsFromCompanyFacts,
  selectSecFundamentalsRefreshBatch
} = await import("../src/domain/sec-fundamentals.js");
const { parseInfoTable } = await import("../src/domain/sec-institutional.js");
const { parseOwnershipXml } = await import("../src/domain/sec-insider.js");

const filesToParse = [
  path.join(config.rootDir, "schemas", "raw-document.schema.json"),
  path.join(config.rootDir, "schemas", "normalized-document.schema.json"),
  path.join(config.rootDir, "schemas", "document-score.schema.json"),
  path.join(config.rootDir, "schemas", "sentiment-state.schema.json"),
  path.join(config.rootDir, "schemas", "ticker-response.schema.json"),
  path.join(config.rootDir, "schemas", "fundamental-change.schema.json"),
  path.join(config.rootDir, "schemas", "fundamental-score.schema.json"),
  path.join(config.rootDir, "schemas", "fundamental-sector.schema.json"),
  path.join(config.rootDir, "schemas", "fundamental-ticker-response.schema.json"),
  path.join(config.rootDir, "schemas", "fundamentals-dashboard.schema.json"),
  path.join(config.rootDir, "data", "sample-events.json"),
  path.join(config.rootDir, "data", "sample-fundamentals.json")
];

for (const file of filesToParse) {
  JSON.parse(await readFile(file, "utf8"));
}

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(js|html|css)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const forbiddenSampleUniverseReferences = [];
const retiredSampleUniverseTokens = [
  "WATCH" + "LIST",
  "TICKER_" + "LOOKUP",
  "US Mega Cap " + "Watchlist"
];
for (const file of await collectSourceFiles(path.join(config.rootDir, "src"))) {
  const text = await readFile(file, "utf8");
  if (retiredSampleUniverseTokens.some((token) => text.includes(token))) {
    forbiddenSampleUniverseReferences.push(path.relative(config.rootDir, file));
  }
}

if (forbiddenSampleUniverseReferences.length) {
  throw new Error(`Source still references the retired sample stock list: ${forbiddenSampleUniverseReferences.join(", ")}`);
}

const rssItems = parseGoogleNewsRss(`
  <rss>
    <channel>
      <item>
        <title>Apple raises outlook after stronger quarter</title>
        <link>https://news.google.com/articles/example-aapl</link>
        <guid>example-aapl</guid>
        <description><![CDATA[Apple services growth beat expectations.]]></description>
        <pubDate>Sat, 25 Apr 2026 12:00:00 GMT</pubDate>
        <source url="https://example.com">Example Wire</source>
      </item>
    </channel>
  </rss>
`);

if (rssItems.length !== 1 || !rssItems[0].title || !rssItems[0].link) {
  throw new Error("RSS parser failed to extract a valid Google News item.");
}

const rssBoilerplateDocument = normalizeRawDocument(
  {
    source_name: "google_news",
    source_type: "rss",
    title: "Europe wants to go to Mars but needs SpaceX to help",
    body: "Should you invest in Nvidia right now? Stock Advisor promotional boilerplate.",
    url: "https://www.fool.com/investing/example-space-europe",
    published_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: "NVDA",
      ticker_hint_match_scope: "headline"
    }
  },
  {
    universeEntries: [
      { ticker: "NVDA", company_name: "NVIDIA Corp", company: "NVIDIA Corp", sector: "Information Technology" }
    ]
  }
);

if (rssBoilerplateDocument.primary_ticker || !rssBoilerplateDocument.processing_notes.ticker_hint_rejected) {
  throw new Error("Google News RSS ticker hints must be rejected when the headline does not mention the ticker/company.");
}

const yahooBoilerplateDocument = normalizeRawDocument(
  {
    source_name: "yahoo_finance",
    source_type: "rss",
    title: "Europe wants to go to Mars but needs SpaceX to help",
    body: "Should you invest in Nvidia right now? Stock Advisor promotional boilerplate.",
    url: "https://www.fool.com/investing/example-space-europe",
    published_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: "NVDA",
      ticker_hint_match_scope: "headline"
    }
  },
  {
    universeEntries: [
      { ticker: "NVDA", company_name: "NVIDIA Corp", company: "NVIDIA Corp", sector: "Information Technology" }
    ]
  }
);

if (yahooBoilerplateDocument.primary_ticker || !yahooBoilerplateDocument.processing_notes.ticker_hint_rejected) {
  throw new Error("Yahoo/RSS ticker hints must be rejected when only promotional boilerplate mentions the company.");
}

const marketauxWeakEntityDocument = normalizeRawDocument(
  {
    source_name: "marketaux",
    source_type: "rss",
    title: "Europe wants to go to Mars but needs SpaceX to help",
    body: "European space policy story without chipmaker operating context.",
    url: "https://www.fool.com/investing/example-space-europe",
    published_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: "NVDA",
      ticker_hint_match_scope: "provider_entity",
      collector: "marketaux_news",
      marketaux_entity_match_score: 0.12
    }
  },
  {
    universeEntries: [
      { ticker: "NVDA", company_name: "NVIDIA Corp", company: "NVIDIA Corp", sector: "Information Technology" }
    ]
  }
);

if (marketauxWeakEntityDocument.primary_ticker || !marketauxWeakEntityDocument.processing_notes.ticker_hint_rejected) {
  throw new Error("Weak Marketaux entity hints must be rejected when the source text does not support the ticker.");
}

const yahooRssItems = parseGoogleNewsRss(`
  <rss>
    <channel>
      <item>
        <title>Apple shares rise after services revenue improves</title>
        <link>https://finance.yahoo.com/news/example-aapl</link>
        <guid>example-yahoo-aapl</guid>
        <description>Yahoo Finance market coverage for Apple.</description>
        <pubDate>Sat, 25 Apr 2026 13:00:00 GMT</pubDate>
      </item>
    </channel>
  </rss>
`);

if (yahooRssItems.length !== 1 || !yahooRssItems[0].title || !yahooRssItems[0].link) {
  throw new Error("RSS parser failed to extract a valid Yahoo Finance fallback item.");
}

const marketauxMapped = mapMarketauxArticles(
  {
    data: [
      {
        uuid: "marketaux-aapl-1",
        title: "Apple supplier checks improve",
        description: "Apple supplier checks improved into the quarter.",
        url: "https://example.com/marketaux-aapl",
        published_at: "2026-04-25T14:00:00Z",
        source: "Example Market Wire",
        sentiment_score: 0.42,
        entities: [{ symbol: "AAPL", name: "Apple Inc.", sentiment_score: 0.44, match_score: 0.96 }]
      }
    ]
  },
  [{ ticker: "AAPL", company: "Apple", sector: "Technology" }]
);

if (marketauxMapped.length !== 1 || marketauxMapped[0].items[0].link !== "https://example.com/marketaux-aapl") {
  throw new Error("Marketaux mapper failed to preserve linked article evidence.");
}

const marketauxUrl = new URL(
  buildMarketauxUrl(
    {
      marketauxApiKey: "test",
      marketauxBaseUrl: "https://api.marketaux.com/v1/news/all",
      marketauxMaxItemsPerTicker: 2,
      marketauxLimitPerRequest: 3,
      liveNewsLookbackHours: 24
    },
    [
      { ticker: "AAPL" },
      { ticker: "MSFT" },
      { ticker: "NVDA" }
    ]
  )
);

if (marketauxUrl.searchParams.get("limit") !== "3") {
  throw new Error("Marketaux URL builder should respect the configured provider request limit.");
}

if (/[.Z]/.test(marketauxUrl.searchParams.get("published_after"))) {
  throw new Error("Marketaux published_after should avoid milliseconds and trailing Z.");
}

const originalFetch = globalThis.fetch;
const fallbackDocuments = [];
globalThis.fetch = async (url) => {
  if (String(url).includes("news.google.com")) {
    throw new Error("mock Google News outage");
  }

  return {
    ok: true,
    status: 200,
    async text() {
      return `
        <rss>
          <channel>
            <item>
              <title>Fallback finance headline for AAPL</title>
              <link>https://finance.yahoo.com/news/fallback-aapl</link>
              <guid>${url}</guid>
              <description>Fallback item from Yahoo Finance.</description>
              <pubDate>Sat, 25 Apr 2026 13:00:00 GMT</pubDate>
            </item>
          </channel>
        </rss>
      `;
    }
  };
};

try {
  const fallbackCollector = createLiveNewsCollector({
    config: {
      liveNewsEnabled: true,
      liveNewsRequestTimeoutMs: 100,
      liveNewsRequestRetries: 0,
      liveNewsMaxItemsPerTicker: 1,
      liveNewsLookbackHours: 100000,
      liveNewsPollMs: 60000
    },
    store: {
      health: { liveSources: {} },
      seenExternalDocuments: new Set()
    },
    pipeline: {
      async processRawDocument(raw) {
        fallbackDocuments.push(raw);
      }
    },
    getTrackedFundamentalCompanies() {
      return [
        { ticker: "AAPL", company_name: "Apple Inc.", sector: "Information Technology" },
        { ticker: "ADBE", company_name: "Adobe Inc.", sector: "Information Technology" },
        { ticker: "CRM", company_name: "Salesforce, Inc.", sector: "Information Technology" }
      ];
    }
  });
  const fallbackResult = await fallbackCollector.pollOnce();
  if (!fallbackResult.ingested || !fallbackDocuments.every((item) => item.source_name === "yahoo_finance")) {
    throw new Error("Live news fallback failed to ingest Yahoo Finance RSS items when Google News failed.");
  }
} finally {
  globalThis.fetch = originalFetch;
}

const marketauxDocuments = [];
const marketauxRequestUrls = [];
globalThis.fetch = async (url) => {
  if (String(url).includes("marketaux")) {
    marketauxRequestUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [
            {
              uuid: "marketaux-live-adbe",
              title: "Marketaux live headline for ADBE",
              description: "Linked Marketaux test headline.",
              url: "https://example.com/marketaux-live-adbe",
              published_at: new Date().toISOString(),
              source: "Marketaux Test",
              sentiment_score: 0.31,
              entities: [{ symbol: "ADBE", sentiment_score: 0.33, match_score: 0.91 }]
            }
          ]
        });
      }
    };
  }

  return {
    ok: true,
    status: 200,
    async text() {
      return `
        <rss>
          <channel>
            <item>
              <title>RSS fallback headline</title>
              <link>https://finance.yahoo.com/news/rss-fallback</link>
              <guid>${url}</guid>
              <description>Fallback item from RSS.</description>
              <pubDate>${new Date().toUTCString()}</pubDate>
            </item>
          </channel>
        </rss>
      `;
    }
  };
};

try {
  const marketauxCollector = createLiveNewsCollector({
    config: {
      liveNewsEnabled: true,
      liveNewsRequestTimeoutMs: 100,
      liveNewsRequestRetries: 0,
      liveNewsMaxItemsPerTicker: 1,
      liveNewsLookbackHours: 24,
      liveNewsPollMs: 60000,
      marketauxEnabled: true,
      marketauxApiKey: "test",
      marketauxBaseUrl: "https://api.marketaux.com/v1/news/all",
      marketauxMaxItemsPerTicker: 1,
      marketauxSymbolsPerRequest: 20,
      marketauxMaxRequestsPerPoll: 1,
      marketauxLimitPerRequest: 3,
      liveNewsRssFallbackMaxTickers: 2,
      marketauxRequestTimeoutMs: 100,
      marketauxRequestRetries: 0
    },
    store: {
      health: { liveSources: {} },
      seenExternalDocuments: new Set()
    },
    pipeline: {
      async processRawDocument(raw) {
        marketauxDocuments.push(raw);
      }
    },
    getTrackedFundamentalCompanies() {
      return [
        { ticker: "AAPL", company: "Apple", sector: "Information Technology" },
        { ticker: "ADBE", company: "Adobe", sector: "Information Technology" },
        { ticker: "CRM", company: "Salesforce", sector: "Information Technology" }
      ];
    }
  });
  const marketauxResult = await marketauxCollector.pollOnce();
  const requestSymbols = new URL(marketauxRequestUrls[0]).searchParams.get("symbols");
  if (
    !marketauxResult.ingested ||
    !marketauxDocuments.some((item) => item.source_name === "marketaux" && item.source_metadata?.ticker_hint === "ADBE") ||
    !requestSymbols.includes("ADBE")
  ) {
    throw new Error("Live news collector failed to use the tracked full universe for Marketaux items.");
  }
} finally {
  globalThis.fetch = originalFetch;
}

const alpacaMarketStore = { health: { liveSources: {} }, bus: { emit() {} } };
globalThis.fetch = async (url) => {
  if (!String(url).includes("data.alpaca.markets")) {
    throw new Error(`Unexpected mock market data URL: ${url}`);
  }

  return {
    ok: true,
    status: 200,
    async json() {
      return {
        bars: Array.from({ length: 8 }, (_, index) => ({
          t: new Date(Date.UTC(2026, 3, 25, 14, index * 15)).toISOString(),
          o: 100 + index,
          h: 101 + index,
          l: 99 + index,
          c: 100.5 + index,
          v: 1_000_000 + index * 100_000
        }))
      };
    }
  };
};

try {
  const marketDataService = createMarketDataService({
    config: {
      marketDataProvider: "alpaca",
      marketDataInterval: "15min",
      marketDataHistoryPoints: 8,
      marketDataCacheMs: 0,
      marketDataRefreshMs: 60000,
      marketDataRequestTimeoutMs: 100,
      alpacaMarketDataEnabled: true,
      alpacaMarketDataApiKeyId: "test",
      alpacaMarketDataApiSecretKey: "test",
      alpacaMarketDataBaseUrl: "https://data.alpaca.markets",
      alpacaMarketDataFeed: "iex"
    },
    store: alpacaMarketStore
  });
  const alpacaSeries = await marketDataService.getTickerSeries("AAPL", [], new Date().toISOString());
  if (
    alpacaSeries.bar_history.length !== 8 ||
    alpacaMarketStore.health.liveSources.market_data.provider !== "alpaca" ||
    alpacaMarketStore.health.liveSources.market_data.fallback_mode
  ) {
    throw new Error("Alpaca market-data adapter did not produce live bar history.");
  }
} finally {
  globalThis.fetch = originalFetch;
}

const insiderForm = parseOwnershipXml(`
  <ownershipDocument>
    <reportingOwner>
      <reportingOwnerId>
        <rptOwnerName>Jane Doe</rptOwnerName>
      </reportingOwnerId>
      <reportingOwnerRelationship>
        <isDirector>1</isDirector>
        <isOfficer>0</isOfficer>
        <isTenPercentOwner>0</isTenPercentOwner>
      </reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-04-24</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>12500</value></transactionShares>
        <transactionPricePerShare><value>184.22</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </ownershipDocument>
`);

if (insiderForm.dominantDirection !== "buy" || insiderForm.totals.buyShares !== 12500) {
  throw new Error("SEC Form 4 parser failed to extract insider transaction data.");
}

const institutionalTable = parseInfoTable(`
  <informationTable>
    <infoTable>
      <nameOfIssuer>APPLE INC</nameOfIssuer>
      <titleOfClass>COM</titleOfClass>
      <cusip>037833100</cusip>
      <value>125000000</value>
      <shrsOrPrnAmt>
        <sshPrnamt>456789123</sshPrnamt>
        <sshPrnamtType>SH</sshPrnamtType>
      </shrsOrPrnAmt>
      <investmentDiscretion>SOLE</investmentDiscretion>
    </infoTable>
  </informationTable>
`);

if (institutionalTable.length !== 1 || institutionalTable[0].shares !== 456789123) {
  throw new Error("SEC 13F parser failed to extract institutional holdings data.");
}

const flowSignal = detectMarketFlowSignal(
  [
    { timestamp: "2026-04-25T09:00:00.000Z", close: 100, volume: 1000000 },
    { timestamp: "2026-04-25T09:15:00.000Z", close: 100.4, volume: 1100000 },
    { timestamp: "2026-04-25T09:30:00.000Z", close: 100.1, volume: 980000 },
    { timestamp: "2026-04-25T09:45:00.000Z", close: 100.2, volume: 1020000 },
    { timestamp: "2026-04-25T10:00:00.000Z", close: 100.3, volume: 1080000 },
    { timestamp: "2026-04-25T10:15:00.000Z", close: 100.5, volume: 1150000 },
    { timestamp: "2026-04-25T10:30:00.000Z", close: 100.6, volume: 1090000 },
    { timestamp: "2026-04-25T10:45:00.000Z", close: 106.8, volume: 6200000 }
  ],
  {
    marketFlowVolumeSpikeThreshold: 2.2,
    marketFlowMinPriceMoveThreshold: 0.01,
    marketFlowBlockTradeSpikeThreshold: 3.8,
    marketFlowBlockTradeShockThreshold: 2.2
  }
);

if (!flowSignal || flowSignal.direction !== "buy") {
  throw new Error("Market flow detector failed to identify an abnormal bullish flow signal.");
}

const mockedCompanyFacts = {
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            { start: "2025-01-01", end: "2025-03-31", val: 100, form: "10-Q", filed: "2025-04-20" },
            { start: "2025-04-01", end: "2025-06-30", val: 110, form: "10-Q", filed: "2025-07-20" },
            { start: "2025-07-01", end: "2025-09-30", val: 120, form: "10-Q", filed: "2025-10-20" },
            { start: "2025-10-01", end: "2025-12-31", val: 130, form: "10-Q", filed: "2026-01-25" },
            { start: "2026-01-01", end: "2026-03-31", val: 145, form: "10-Q", filed: "2026-04-20" },
            { start: "2025-01-01", end: "2025-12-31", val: 460, form: "10-K", filed: "2026-02-01" }
          ]
        }
      },
      GrossProfit: {
        units: {
          USD: [
            { start: "2026-01-01", end: "2026-03-31", val: 70, form: "10-Q", filed: "2026-04-20" }
          ]
        }
      },
      OperatingIncomeLoss: {
        units: {
          USD: [
            { start: "2025-04-01", end: "2025-06-30", val: 21, form: "10-Q", filed: "2025-07-20" },
            { start: "2025-07-01", end: "2025-09-30", val: 23, form: "10-Q", filed: "2025-10-20" },
            { start: "2025-10-01", end: "2025-12-31", val: 25, form: "10-Q", filed: "2026-01-25" },
            { start: "2026-01-01", end: "2026-03-31", val: 31, form: "10-Q", filed: "2026-04-20" }
          ]
        }
      },
      NetIncomeLoss: {
        units: {
          USD: [
            { start: "2025-04-01", end: "2025-06-30", val: 16, form: "10-Q", filed: "2025-07-20" },
            { start: "2025-07-01", end: "2025-09-30", val: 18, form: "10-Q", filed: "2025-10-20" },
            { start: "2025-10-01", end: "2025-12-31", val: 19, form: "10-Q", filed: "2026-01-25" },
            { start: "2026-01-01", end: "2026-03-31", val: 24, form: "10-Q", filed: "2026-04-20" }
          ]
        }
      },
      Assets: {
        units: {
          USD: [{ end: "2026-03-31", val: 520, form: "10-Q", filed: "2026-04-20" }]
        }
      },
      StockholdersEquity: {
        units: {
          USD: [{ end: "2026-03-31", val: 210, form: "10-Q", filed: "2026-04-20" }]
        }
      },
      AssetsCurrent: {
        units: {
          USD: [{ end: "2026-03-31", val: 180, form: "10-Q", filed: "2026-04-20" }]
        }
      },
      LiabilitiesCurrent: {
        units: {
          USD: [{ end: "2026-03-31", val: 120, form: "10-Q", filed: "2026-04-20" }]
        }
      },
      CashAndCashEquivalentsAtCarryingValue: {
        units: {
          USD: [{ end: "2026-03-31", val: 75, form: "10-Q", filed: "2026-04-20" }]
        }
      },
      LongTermDebt: {
        units: {
          USD: [{ end: "2026-03-31", val: 55, form: "10-Q", filed: "2026-04-20" }]
        }
      },
      LongTermDebtCurrent: {
        units: {
          USD: [{ end: "2026-03-31", val: 10, form: "10-Q", filed: "2026-04-20" }]
        }
      },
      NetCashProvidedByUsedInOperatingActivities: {
        units: {
          USD: [
            { start: "2025-04-01", end: "2025-06-30", val: 18, form: "10-Q", filed: "2025-07-20" },
            { start: "2025-07-01", end: "2025-09-30", val: 19, form: "10-Q", filed: "2025-10-20" },
            { start: "2025-10-01", end: "2025-12-31", val: 21, form: "10-Q", filed: "2026-01-25" },
            { start: "2026-01-01", end: "2026-03-31", val: 24, form: "10-Q", filed: "2026-04-20" }
          ]
        }
      },
      PaymentsToAcquirePropertyPlantAndEquipment: {
        units: {
          USD: [
            { start: "2025-04-01", end: "2025-06-30", val: -5, form: "10-Q", filed: "2025-07-20" },
            { start: "2025-07-01", end: "2025-09-30", val: -5, form: "10-Q", filed: "2025-10-20" },
            { start: "2025-10-01", end: "2025-12-31", val: -6, form: "10-Q", filed: "2026-01-25" },
            { start: "2026-01-01", end: "2026-03-31", val: -7, form: "10-Q", filed: "2026-04-20" }
          ]
        }
      },
      InterestExpense: {
        units: {
          USD: [
            { start: "2025-04-01", end: "2025-06-30", val: 1.1, form: "10-Q", filed: "2025-07-20" },
            { start: "2025-07-01", end: "2025-09-30", val: 1.0, form: "10-Q", filed: "2025-10-20" },
            { start: "2025-10-01", end: "2025-12-31", val: 1.0, form: "10-Q", filed: "2026-01-25" },
            { start: "2026-01-01", end: "2026-03-31", val: 0.9, form: "10-Q", filed: "2026-04-20" }
          ]
        }
      },
      EarningsPerShareDiluted: {
        units: {
          "USD/shares": [
            { start: "2025-01-01", end: "2025-03-31", val: 1.2, form: "10-Q", filed: "2025-04-20" },
            { start: "2026-01-01", end: "2026-03-31", val: 1.85, form: "10-Q", filed: "2026-04-20" }
          ]
        }
      }
    }
  }
};

const liveMetrics = computeLiveMetricsFromCompanyFacts(mockedCompanyFacts, {
  fcf_growth_yoy: 0.1,
  margin_stability: 0.7,
  revenue_consistency: 0.7
});

if (
  !Number.isFinite(liveMetrics.revenue_growth_yoy) ||
  !Number.isFinite(liveMetrics.fcf_growth_yoy) ||
  !Number.isFinite(liveMetrics.margin_stability) ||
  !Number.isFinite(liveMetrics.revenue_consistency) ||
  !Number.isFinite(liveMetrics.current_ratio)
) {
  throw new Error("SEC fundamentals mapper failed to derive the expected live metric set.");
}

const secBatchOne = selectSecFundamentalsRefreshBatch(
  [
    { ticker: "LIVE1", data_source: "live_sec_filing" },
    { ticker: "PEND1", data_source: "universe_membership" },
    { ticker: "PEND2", data_source: "universe_membership" },
    { ticker: "PEND3", data_source: "universe_membership" }
  ],
  { fundamentalSecMaxCompaniesPerPoll: 2 },
  0
);
const secBatchTwo = selectSecFundamentalsRefreshBatch(
  [
    { ticker: "LIVE1", data_source: "live_sec_filing" },
    { ticker: "PEND1", data_source: "universe_membership" },
    { ticker: "PEND2", data_source: "universe_membership" },
    { ticker: "PEND3", data_source: "universe_membership" }
  ],
  { fundamentalSecMaxCompaniesPerPoll: 2 },
  2
);

if (secBatchOne.map((item) => item.ticker).join(",") !== "PEND1,PEND2") {
  throw new Error("SEC fundamentals batch selector should prioritize names awaiting live SEC data.");
}

if (secBatchTwo.length !== 2 || secBatchTwo[0].ticker === secBatchOne[0].ticker) {
  throw new Error("SEC fundamentals batch selector should rotate bounded refresh batches.");
}

const app = createSentimentApp();
await app.initialize();
const bootSnapshot = app.getWatchlistSnapshot("1h");
const bootFirstTicker = bootSnapshot.leaderboard[0]?.entity_key;
const bootTickerDetail = bootFirstTicker ? await app.getTickerDetail(bootFirstTicker) : null;

if (!bootSnapshot.leaderboard.length || !bootTickerDetail) {
  throw new Error("Dashboard should render an allowed-universe ticker detail before sentiment replay.");
}

await app.replay({ reset: true, intervalMs: 0 });
const scoreCountBeforeStale = app.store.documentScores.length;
const staleResult = await app.pipeline.processRawDocument({
  source_name: "google_news",
  source_type: "rss",
  source_priority: 0.62,
  url: "https://news.google.com/articles/stale-check",
  title: "Apple stale check event should not affect current decisions",
  body: "Apple old news item that must be ignored by the decision pipeline.",
  language: "en",
  published_at: new Date(Date.now() - 96 * 3_600_000).toISOString(),
  source_metadata: {
    ticker_hint: "AAPL",
    sector_hint: "Technology"
  },
  raw_payload: {}
});
if (!staleResult.skipped || app.store.documentScores.length !== scoreCountBeforeStale) {
  throw new Error("Stale non-filing evidence should be skipped before scoring.");
}
const snapshot = app.getWatchlistSnapshot("1h");
const topTicker = snapshot.leaderboard[0]?.entity_key;
const tickerDetail = topTicker ? await app.getTickerDetail(topTicker) : null;
const fundamentals = app.getFundamentalsSnapshot();
const topFundamental = fundamentals.leaderboard[0]?.ticker;
const fundamentalDetail = topFundamental ? app.getFundamentalsTickerDetail(topFundamental) : null;
const tradeSetups = app.getTradeSetups({ limit: 8, minConviction: 0 });
const executionStatus = app.getExecutionStatus();
const executionPreview = await app.previewExecutionOrder({
  ticker: tradeSetups.setups[0]?.ticker,
  setup: {
    ticker: "AAPL",
    action: "long",
    setup_label: "check_long",
    conviction: 0.72,
    position_size_pct: 0.01,
    current_price: 195,
    timeframe: "swing_3d_to_2w",
    stop_loss: 188,
    take_profit: 214,
    summary: "Check-only execution preview.",
    thesis: [],
    risk_flags: []
  }
});
const warehouseSummary = app.getFundamentalPersistenceSummary();
const warehouseTicker = topFundamental ? app.getFundamentalPersistenceTicker(topFundamental) : null;
const baseFundamentalCompany = topFundamental ? app.getTrackedFundamentalCompanies().find((item) => item.ticker === topFundamental) : null;

const mockWarehouseStore = { fundamentalWarehouse: null };
const mockWarehouse = baseFundamentalCompany && fundamentalDetail
  ? materializeFundamentalPersistence({
      store: mockWarehouseStore,
      companies: [{ ...baseFundamentalCompany, cik: "0000320193" }],
      snapshot: {
        leaderboard: [{ ...fundamentalDetail, score_delta_30d: undefined }]
      },
      artifactsByTicker: new Map([
        [
          topFundamental,
          {
            cik: "0000320193",
            filing: {
              form_type: "10-Q",
              filing_date: "2026-04-20",
              accepted_at: "2026-04-20T20:15:00Z",
              accession_no: "0000320193-26-000001",
              period_end: "2026-03-31",
              source_url: "https://www.sec.gov/Archives/mock/000032019326000001/mock-10q.htm",
              primary_document: "mock-10q.htm"
            },
            companyFacts: mockedCompanyFacts
          }
        ]
      ])
    })
  : null;
const mockWarehouseFilings = mockWarehouse && topFundamental ? getFundamentalPersistenceFilings(mockWarehouse, topFundamental, 5) : [];
const mockRevenueSeries = mockWarehouse && topFundamental
  ? getFundamentalPersistenceFactSeries(mockWarehouse, topFundamental, "revenue", { periodType: "quarterly", limit: 8 })
  : [];

if (!snapshot.leaderboard.length) {
  throw new Error("Leaderboard is empty after replay.");
}

if (!tickerDetail?.price_history?.length || !tickerDetail?.sentiment_history?.length) {
  throw new Error("Ticker detail is missing market or sentiment history.");
}

if (!fundamentals.leaderboard.length || !fundamentals.sectors.length) {
  throw new Error("Fundamental snapshot is empty after replay.");
}

if (!fundamentalDetail?.factor_cards?.length || !fundamentalDetail?.score_history?.length) {
  throw new Error("Fundamental detail is missing factor cards or score history.");
}

if (!tradeSetups.setups.length || !tradeSetups.setups[0].runtime_reliability) {
  throw new Error("Trade setup engine is missing runtime reliability adjustment metadata.");
}

if (!Number.isFinite(tradeSetups.setups[0].score_components?.runtime_multiplier)) {
  throw new Error("Trade setup engine did not expose a runtime adjustment multiplier.");
}

if (!executionStatus.broker || !executionPreview.dry_run || !executionPreview.intent?.allowed || !executionPreview.risk?.allowed) {
  throw new Error("Execution agent did not produce a guarded dry-run order preview.");
}

if (!warehouseSummary.coverage_universe || !warehouseSummary.fundamental_scores || !warehouseSummary.fundamental_states) {
  throw new Error("Fundamental warehouse summary is missing expected materialized rows.");
}

if (!warehouseTicker?.coverage_universe?.length || !warehouseTicker?.fundamental_features?.length || !warehouseTicker?.fundamental_scores?.length) {
  throw new Error("Fundamental warehouse ticker view is missing expected materialized rows.");
}

if (!mockWarehouseFilings.length || mockWarehouseFilings[0].facts_count <= 0) {
  throw new Error("Fundamental filing history query did not return the expected SEC-backed filing rows.");
}

if (!mockRevenueSeries.length || mockRevenueSeries[0].canonical_field !== "revenue") {
  throw new Error("Fundamental fact-series query did not return the expected canonical fact history.");
}

if (
  mockWarehouse &&
  ![...mockWarehouse.fundamentalStates.values()].every((item) => Number.isFinite(Number(item.score_delta_30d)))
) {
  throw new Error("Fundamental warehouse states must default missing score deltas to a finite value.");
}

console.log(
  JSON.stringify(
    {
      parsed_files: filesToParse.length,
      sample_universe_references: forbiddenSampleUniverseReferences.length,
      rss_items_parsed: rssItems.length,
      yahoo_rss_items_parsed: yahooRssItems.length,
      marketaux_items_mapped: marketauxMapped.length,
      yahoo_fallback_documents: fallbackDocuments.length,
      marketaux_documents: marketauxDocuments.filter((item) => item.source_name === "marketaux").length,
      alpaca_bar_history: alpacaMarketStore.health.liveSources.market_data.cache_entries ? 8 : 0,
      insider_transactions_parsed: insiderForm.transactions.length,
      institutional_rows_parsed: institutionalTable.length,
      market_flow_signal: flowSignal.eventType,
      sec_live_metric_keys: Object.keys(liveMetrics).length,
      sec_fundamentals_batch_size: secBatchOne.length,
      allowed_universe_dashboard_rows: bootSnapshot.leaderboard.length,
      allowed_universe_ticker_detail_mode: bootTickerDetail.data_mode,
      leaderboard_count: snapshot.leaderboard.length,
      recent_documents: app.getRecentDocuments({ limit: 5 }).length,
      alerts: app.store.alertHistory.length,
      ticker_history_points: tickerDetail.price_history.length,
      fundamentals_count: fundamentals.leaderboard.length,
      sectors_count: fundamentals.sectors.length,
      trade_setups: tradeSetups.setups.length,
      trade_setup_runtime_multiplier: tradeSetups.setups[0].score_components.runtime_multiplier,
      execution_status: executionStatus.status,
      execution_preview_allowed: executionPreview.intent.allowed,
      risk_preview_allowed: executionPreview.risk.allowed,
      fundamental_change_events: app.getFundamentalsChanges(20).length,
      warehouse_coverage_rows: warehouseSummary.coverage_universe,
      warehouse_fact_rows: warehouseSummary.financial_facts,
      warehouse_score_rows: warehouseSummary.fundamental_scores,
      historical_filings_rows: mockWarehouseFilings.length,
      historical_revenue_points: mockRevenueSeries.length
    },
    null,
    2
  )
);
