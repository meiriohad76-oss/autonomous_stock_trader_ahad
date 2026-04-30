process.env.DATABASE_ENABLED = process.env.DATABASE_ENABLED || "false";

import { readFile } from "node:fs/promises";
import path from "node:path";

const { createSentimentApp } = await import("../src/app.js");
const { config } = await import("../src/config.js");
const {
  getFundamentalPersistenceFactSeries,
  getFundamentalPersistenceFilings,
  materializeFundamentalPersistence
} = await import("../src/domain/fundamental-persistence.js");
const { createLiveNewsCollector, parseGoogleNewsRss } = await import("../src/domain/live-news.js");
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
    }
  });
  const fallbackResult = await fallbackCollector.pollOnce();
  if (!fallbackResult.ingested || !fallbackDocuments.every((item) => item.source_name === "yahoo_finance")) {
    throw new Error("Live news fallback failed to ingest Yahoo Finance RSS items when Google News failed.");
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
    { ticker: "BOOT1", data_source: "bootstrap_placeholder" },
    { ticker: "BOOT2", data_source: "bootstrap_placeholder" },
    { ticker: "BOOT3", data_source: "bootstrap_placeholder" }
  ],
  { fundamentalSecMaxCompaniesPerPoll: 2 },
  0
);
const secBatchTwo = selectSecFundamentalsRefreshBatch(
  [
    { ticker: "LIVE1", data_source: "live_sec_filing" },
    { ticker: "BOOT1", data_source: "bootstrap_placeholder" },
    { ticker: "BOOT2", data_source: "bootstrap_placeholder" },
    { ticker: "BOOT3", data_source: "bootstrap_placeholder" }
  ],
  { fundamentalSecMaxCompaniesPerPoll: 2 },
  2
);

if (secBatchOne.map((item) => item.ticker).join(",") !== "BOOT1,BOOT2") {
  throw new Error("SEC fundamentals batch selector should prioritize bootstrap placeholders.");
}

if (secBatchTwo.length !== 2 || secBatchTwo[0].ticker === secBatchOne[0].ticker) {
  throw new Error("SEC fundamentals batch selector should rotate bounded refresh batches.");
}

const app = createSentimentApp();
await app.replay({ reset: true, intervalMs: 0 });
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
        leaderboard: [fundamentalDetail]
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

console.log(
  JSON.stringify(
    {
      parsed_files: filesToParse.length,
      rss_items_parsed: rssItems.length,
      yahoo_rss_items_parsed: yahooRssItems.length,
      yahoo_fallback_documents: fallbackDocuments.length,
      insider_transactions_parsed: insiderForm.transactions.length,
      institutional_rows_parsed: institutionalTable.length,
      market_flow_signal: flowSignal.eventType,
      sec_live_metric_keys: Object.keys(liveMetrics).length,
      sec_fundamentals_batch_size: secBatchOne.length,
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
