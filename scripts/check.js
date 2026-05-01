import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSentimentApp } from "../src/app.js";
import { config } from "../src/config.js";
import { createCorporateEventsCollector } from "../src/domain/corporate-events.js";
import { createSocialSentimentCollector } from "../src/domain/social-sentiment.js";
import { createTradePrintsCollector } from "../src/domain/trade-prints.js";
import { parseGoogleNewsRss } from "../src/domain/live-news.js";
import { detectMarketFlowSignal } from "../src/domain/market-flow.js";
import { computeLiveMetricsFromCompanyFacts } from "../src/domain/sec-fundamentals.js";
import { parseInfoTable } from "../src/domain/sec-institutional.js";
import { parseOwnershipXml } from "../src/domain/sec-insider.js";

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
    marketFlowVolumeZScoreThreshold: 2.2,
    marketFlowDollarVolumeZScoreThreshold: 2.2,
    marketFlowMinPriceMoveThreshold: 0.01,
    marketFlowBlockTradeSpikeThreshold: 3.8,
    marketFlowBlockTradeShockThreshold: 2.2,
    marketFlowPersistenceBars: 2,
    marketFlowCloseLocationThreshold: 0.65
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

const app = createSentimentApp();
await app.replay({ reset: true, intervalMs: 0 });
const snapshot = app.getWatchlistSnapshot("1h");
const moneyFlowSnapshot = app.getMoneyFlowSnapshot({ hours: 168, limit: 60 });
const topTicker = snapshot.leaderboard[0]?.entity_key;
const tickerDetail = topTicker ? await app.getTickerDetail(topTicker) : null;
const topMoneyFlowTicker = moneyFlowSnapshot.top_tickers[0]?.ticker;
const moneyFlowTickerDetail = topMoneyFlowTicker ? app.getMoneyFlowTickerDetail(topMoneyFlowTicker) : null;
const fundamentals = app.getFundamentalsSnapshot();
const topFundamental = fundamentals.leaderboard[0]?.ticker;
const fundamentalDetail = topFundamental ? app.getFundamentalsTickerDetail(topFundamental) : null;

if (!snapshot.leaderboard.length) {
  throw new Error("Leaderboard is empty after replay.");
}

if (!moneyFlowSnapshot.summary || !Array.isArray(moneyFlowSnapshot.timeline)) {
  throw new Error("Money flow snapshot is missing summary or timeline data.");
}

if (topMoneyFlowTicker && !moneyFlowTickerDetail?.recent_signals?.length) {
  throw new Error("Money flow ticker detail is missing recent signals.");
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

app.runTradeSetups();

if (typeof app.getMacroRegime !== "function")
  throw new Error("app.getMacroRegime is not a function — method missing from app.");
if (typeof app.getTradeSetups !== "function")
  throw new Error("app.getTradeSetups is not a function — method missing from app.");

const macroRegime = app.getMacroRegime();
const tradeSetups = app.getTradeSetups();
const longSetups = app.getTradeSetups({ action: "long" });
const provisionalSetups = app.getTradeSetups({ provisional: true });

if (macroRegime === null)
  throw new Error("macroRegime is null after 1500ms — trade setup agent did not fire.");
if (typeof macroRegime.regime !== "string")
  throw new Error("macroRegime is missing .regime string field.");

if (!Array.isArray(tradeSetups))
  throw new Error("getTradeSetups() did not return an array.");

// Validate shape of first setup if any exist
const firstSetup = tradeSetups[0];
if (firstSetup) {
  for (const key of ["setup_id", "ticker", "action", "conviction", "provisional",
    "thesis", "risk_flags", "evidence", "direction_score"]) {
    if (!(key in firstSetup)) throw new Error(`Trade setup missing field: ${key}`);
  }
  if (!["long", "short", "watch", "no_trade"].includes(firstSetup.action)) {
    throw new Error(`Invalid action: ${firstSetup.action}`);
  }
  if (firstSetup.conviction < 0 || firstSetup.conviction > 1) {
    throw new Error(`Conviction out of range: ${firstSetup.conviction}`);
  }
}

// Provisional setups must have conviction <= 0.55
for (const s of provisionalSetups) {
  if (s.conviction > 0.55) {
    throw new Error(`Provisional setup ${s.ticker} has conviction ${s.conviction} > 0.55`);
  }
}

// Long setups must have positive direction score
for (const s of longSetups) {
  if (s.direction_score <= 0) {
    throw new Error(`Long setup ${s.ticker} has non-positive direction_score ${s.direction_score}`);
  }
}

// --- New collector interface checks ---
const mockApp = { config: app.config, store: app.store, pipeline: app.pipeline };

const corpEvents = createCorporateEventsCollector(mockApp);
if (typeof corpEvents.start !== "function") throw new Error("createCorporateEventsCollector missing start()");
if (typeof corpEvents.stop !== "function") throw new Error("createCorporateEventsCollector missing stop()");
if (typeof corpEvents.pollOnce !== "function") throw new Error("createCorporateEventsCollector missing pollOnce()");

const socialSent = createSocialSentimentCollector(mockApp);
if (typeof socialSent.start !== "function") throw new Error("createSocialSentimentCollector missing start()");
if (typeof socialSent.stop !== "function") throw new Error("createSocialSentimentCollector missing stop()");

const tradePrints = createTradePrintsCollector(mockApp);
if (typeof tradePrints.start !== "function") throw new Error("createTradePrintsCollector missing start()");
if (typeof tradePrints.stop !== "function") throw new Error("createTradePrintsCollector missing stop()");

if (!(app.store.earningsCalendar instanceof Map))
  throw new Error("store.earningsCalendar is not a Map");

if (typeof app.getEarningsCalendar !== "function")
  throw new Error("app.getEarningsCalendar is not a function");

const calendarSnapshot = app.getEarningsCalendar();
if (typeof calendarSnapshot !== "object" || calendarSnapshot === null)
  throw new Error("getEarningsCalendar() did not return an object");

if (!(app.store.pendingApprovals instanceof Map))
  throw new Error("store.pendingApprovals is not a Map");
if (!(app.store.positions instanceof Map))
  throw new Error("store.positions is not a Map");
if (!(app.store.orders instanceof Map))
  throw new Error("store.orders is not a Map");
if (typeof app.store.executionState !== "object" || app.store.executionState === null)
  throw new Error("store.executionState is not an object");
if (!Array.isArray(app.store.executionLog))
  throw new Error("store.executionLog is not an array");
if (typeof app.getExecutionState !== "function")
  throw new Error("app.getExecutionState is not a function");
if (typeof app.setKillSwitch !== "function")
  throw new Error("app.setKillSwitch is not a function");

console.log(
  JSON.stringify(
    {
      parsed_files: filesToParse.length,
      rss_items_parsed: rssItems.length,
      insider_transactions_parsed: insiderForm.transactions.length,
      institutional_rows_parsed: institutionalTable.length,
      market_flow_signal: flowSignal.eventType,
      sec_live_metric_keys: Object.keys(liveMetrics).length,
      leaderboard_count: snapshot.leaderboard.length,
      recent_documents: app.getRecentDocuments({ limit: 5 }).length,
      money_flow_signals: moneyFlowSnapshot.summary.total,
      money_flow_focus_ticker: topMoneyFlowTicker || null,
      money_flow_focus_alerts: moneyFlowTickerDetail?.recent_alerts?.length || 0,
      alerts: app.store.alertHistory.length,
      ticker_history_points: tickerDetail.price_history.length,
      fundamentals_count: fundamentals.leaderboard.length,
      sectors_count: fundamentals.sectors.length,
      fundamental_change_events: app.getFundamentalsChanges(20).length,
      macro_regime: macroRegime?.regime,
      trade_setups_total: tradeSetups.length,
      trade_setups_long: longSetups.length,
      trade_setups_provisional: provisionalSetups.length,
      earnings_calendar_tickers: app.store.earningsCalendar.size,
      execution_enabled: app.store.executionState.enabled,
      execution_kill_switch: app.store.executionState.killSwitch,
      open_positions: app.store.positions.size,
    },
    null,
    2
  )
);
