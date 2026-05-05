process.env.DATABASE_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";
process.env.SEED_DATA_IN_DECISIONS = "false";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { buildAgencyCycleStatus } = await import("../src/domain/agency-cycle.js");
const { buildExecutionIntent } = await import("../src/domain/execution-agent.js");
const { buildFinalSelectionSnapshot } = await import("../src/domain/final-selection.js");
const {
  buildFundamentalResearchGovernance,
  createFundamentalsEngine
} = await import("../src/domain/fundamentals.js");
const { buildLlmSelectionSnapshot } = await import("../src/domain/llm-selection-agent.js");
const { buildMacroRegimeSnapshot } = await import("../src/domain/macro-regime.js");
const {
  buildPolicyAdjustedSetup,
  buildPortfolioPolicySnapshot,
  readPortfolioPolicy
} = await import("../src/domain/portfolio-policy.js");
const { buildPositionMonitorSnapshot } = await import("../src/domain/position-monitor-agent.js");
const { buildPortfolioRiskSnapshot, evaluateExecutionRisk } = await import("../src/domain/risk-agent.js");
const { createStore } = await import("../src/domain/store.js");
const { buildTradeSetupsSnapshot } = await import("../src/domain/trade-setup.js");
const {
  lookupUniverseEntry,
  rotateUniverseEntries,
  uniqueUniverseEntries
} = await import("../src/domain/tracked-universe.js");
const { normalizeTickerSymbol } = await import("../src/utils/helpers.js");

const fixtureNowMs = Date.parse("2026-05-02T13:30:00.000Z");
const realDateNow = Date.now;
Date.now = () => fixtureNowMs;
process.on("exit", () => {
  Date.now = realDateNow;
});

const now = new Date(fixtureNowMs).toISOString();
const old = new Date(Date.parse(now) - 120 * 3_600_000).toISOString();

const config = {
  defaultWindow: "1h",
  signalFreshnessMaxHours: 72,
  activeAlertFreshnessMaxHours: 24,
  seedDataInDecisions: false,
  seedDataOnEmpty: false,
  screenerRequireLiveSecForEligible: true,
  screenerMinReportingConfidence: 0.85,
  screenerMinDataFreshness: 0.85,
  screenerMaxMissingFields: 2,
  screenerMinRevenueGrowth: 0.08,
  screenerMinEpsGrowth: 0.1,
  screenerMinOperatingMargin: 0.12,
  screenerMinGrossMargin: 0.35,
  screenerMinCurrentRatio: 1,
  screenerMaxNetDebtToEbitda: 3,
  screenerMinFcfConversion: 0.75,
  screenerMinFcfMargin: 0.08,
  screenerMaxPeTtm: 45,
  screenerMaxPeg: 2.5,
  screenerMinFcfYield: 0.02,
  screenerEligibleScore: 0.71,
  screenerWatchScore: 0.43,
  executionMinConviction: 0.62,
  portfolioExecutionMinConviction: 0.62,
  executionMinNotionalUsd: 25,
  executionMaxOrderNotionalUsd: 1000,
  executionMaxPositionPct: 0.03,
  executionDefaultEquityUsd: 100000,
  executionAllowShorts: false,
  executionUseBracketOrders: true,
  executionDefaultOrderType: "market",
  executionDefaultTimeInForce: "day",
  portfolioWeeklyTargetPct: 0.03,
  portfolioMaxWeeklyDrawdownPct: 0.04,
  portfolioMaxPositions: 8,
  portfolioMaxNewPositionsPerCycle: 2,
  portfolioMaxPositionPct: 0.03,
  portfolioMaxGrossExposurePct: 0.35,
  portfolioMaxSectorExposurePct: 0.06,
  portfolioCashReservePct: 0.1,
  portfolioDefaultStopLossPct: 0.05,
  portfolioDefaultTakeProfitPct: 0.08,
  portfolioTrailingStopPct: 0.03,
  portfolioMinHoldHours: 4,
  portfolioAllowAdds: false,
  portfolioAllowReductions: true,
  riskMaxGrossExposurePct: 0.35,
  riskMaxSingleNameExposurePct: 0.08,
  riskMaxOpenOrders: 10,
  riskBlockWhenRuntimeConstrained: true,
  llmSelectionEnabled: false,
  llmSelectionProvider: "shadow",
  llmSelectionModel: "policy-aware-shadow-reviewer",
  llmSelectionApiUrl: "",
  llmSelectionApiKey: "",
  llmSelectionMinConfidence: 0.58,
  llmSelectionMaxCandidates: 12,
  llmSelectionMaxOutputTokens: 2500,
  llmSelectionRequestTimeoutMs: 5000,
  agencyOngoingCycleMs: 900000,
  agencyInitialBaselineCycleMs: 300000,
  agencyBaselineMinSecCoveragePct: 0.99,
  agencyBaselineUniverseMinCount: 160,
  agencyBaselineMinSignalSources: 3,
  liveNewsPollMs: 900000,
  marketFlowPollMs: 60000,
  fundamentalMarketDataRefreshMs: 900000,
  fundamentalSecMaxCompaniesPerPoll: 8,
  fundamentalSecBaselinePollMs: 900000
};

const portfolioPolicy = readPortfolioPolicy(config);
const healthyRuntime = { status: "healthy", pressure: { isConstrained: false }, sources: [] };
const riskOnMacro = {
  regime_label: "risk_on",
  bias_label: "long_bias",
  risk_posture: "constructive",
  exposure_multiplier: 1.1,
  long_threshold: 0.5,
  short_threshold: 0.62,
  summary: "Macro regime is risk on with strong confirmation."
};
const balancedMacro = {
  regime_label: "balanced",
  bias_label: "balanced",
  risk_posture: "neutral",
  exposure_multiplier: 0.9,
  long_threshold: 0.56,
  short_threshold: 0.56,
  summary: "Macro regime is balanced."
};
const riskOffMacro = {
  regime_label: "risk_off",
  bias_label: "short_bias",
  risk_posture: "defensive",
  exposure_multiplier: 0.55,
  long_threshold: 0.66,
  short_threshold: 0.5,
  summary: "Macro regime is risk off with strong confirmation."
};

const results = [];

function record(agent, check, details = {}) {
  results.push({ agent, check, ...details });
}

function assertFinite01(value, message) {
  assert.ok(Number.isFinite(Number(value)), message);
  assert.ok(Number(value) >= 0 && Number(value) <= 1, message);
}

function company(ticker, overrides = {}) {
  return {
    ticker,
    company_name: `${ticker} Corp`,
    data_source: "live_sec_filing",
    sector: "Information Technology",
    industry: "Software",
    exchange: "NASDAQ",
    market_cap_bucket: "mega_cap",
    cik: `000000${ticker.length}`,
    as_of: now,
    filing_date: "2026-04-25",
    period_end: "2026-03-31",
    form_type: "10-Q",
    filing_url: `https://www.sec.gov/Archives/${ticker}.htm`,
    summary: `${ticker} live SEC-backed fixture.`,
    notes: ["Fixture note one.", "Fixture note two."],
    metrics: {
      revenue_growth_yoy: 0.16,
      eps_growth_yoy: 0.18,
      fcf_growth_yoy: 0.15,
      gross_margin: 0.68,
      operating_margin: 0.32,
      net_margin: 0.24,
      roe: 0.29,
      roic: 0.24,
      debt_to_equity: 0.25,
      net_debt_to_ebitda: 0.4,
      current_ratio: 1.7,
      interest_coverage: 35,
      fcf_margin: 0.18,
      fcf_conversion: 1.02,
      asset_turnover: 0.72,
      margin_stability: 0.88,
      revenue_consistency: 0.86,
      pe_ttm: 26,
      ev_to_ebitda_ttm: 17,
      price_to_sales_ttm: 7,
      peg: 1.7,
      fcf_yield: 0.035
    },
    quality_flags: {
      restatement_flag: false,
      missing_fields_count: 0,
      anomaly_flags: [],
      reporting_confidence_score: 0.94,
      data_freshness_score: 0.96,
      peer_comparability_score: 0.9,
      rule_confidence: 0.94,
      llm_confidence: 0.82
    },
    previous_composite_score: 0.58,
    market_reference: { current_price: 100, beta: 1, live: true, provider: "fixture" },
    ...overrides
  };
}

function mergeCompany(ticker, overrides = {}) {
  const base = company(ticker);
  return {
    ...base,
    ...overrides,
    metrics: { ...base.metrics, ...(overrides.metrics || {}) },
    quality_flags: { ...base.quality_flags, ...(overrides.quality_flags || {}) }
  };
}

function fundamentalRow(ticker, overrides = {}) {
  return {
    ticker,
    company_name: `${ticker} Corp`,
    data_source: "live_sec_filing",
    sector: "Information Technology",
    market_reference: { current_price: 100, beta: 1.1, live: true, provider: "fixture" },
    initial_screen: { stage: "eligible", summary: "Passes the live SEC-backed first-pass screen." },
    direction_label: "bullish_supportive",
    rating_label: "fundamentally_strong",
    final_confidence: 0.91,
    composite_fundamental_score: 0.78,
    anomaly_penalty: 0,
    reason_codes: ["high_roic", "solid_fcf"],
    ...overrides
  };
}

function sentimentState(ticker, sentiment, overrides = {}) {
  return {
    entity_type: "ticker",
    entity_key: ticker,
    entity_name: ticker,
    window: "1h",
    as_of: now,
    weighted_sentiment: sentiment,
    weighted_confidence: 0.88,
    momentum_delta: sentiment >= 0 ? 0.3 : -0.3,
    story_velocity: 8,
    top_event_types: [sentiment >= 0 ? "institutional_buying" : "institutional_selling"],
    top_reasons: [sentiment >= 0 ? "institutional_buying" : "institutional_selling"],
    ...overrides
  };
}

function scoredDocument(
  ticker,
  eventType,
  sentiment,
  {
    publishedAt = now,
    quality = 0.9,
    tier = "alert",
    observationLevel = "provider_linked_news",
    verificationStatus = "provider_entity_linked",
    sourceName = "fixture_wire",
    sourceType = "news"
  } = {}
) {
  const docId = `${ticker}-${eventType}-${publishedAt}`;
  return {
    score: {
      score_id: `score-${docId}`,
      doc_id: docId,
      event_type: eventType,
      bullish_bearish_label: sentiment >= 0 ? "bullish" : "bearish",
      sentiment_score: sentiment,
      impact_score: Math.abs(sentiment),
      final_confidence: 0.86,
      downstream_weight: quality,
      display_tier: tier,
      evidence_quality: {
        downstream_weight: quality,
        display_tier: tier,
        observation_level: observationLevel,
        verification_status: verificationStatus,
        reliability_multiplier: quality,
        reliability_warnings: []
      },
      explanation_short: `${ticker} ${eventType} fixture.`
    },
    normalized: {
      doc_id: docId,
      primary_ticker: ticker,
      headline: `${ticker} ${eventType} evidence`,
      source_name: sourceName,
      source_type: sourceType,
      published_at: publishedAt,
      canonical_url: `https://fixture-news.invalid/${ticker}/${eventType}`,
      source_metadata: { ticker_hint: ticker }
    }
  };
}

function makeStore({ fundamentals = [], sentiments = [], docs = [], alerts = [], earningsCalendar = new Map() } = {}) {
  return {
    config,
    health: { lastUpdate: now, liveSources: {} },
    sentimentStates: sentiments,
    documentScores: docs.map((item) => item.score),
    normalizedDocuments: docs.map((item) => item.normalized),
    alertHistory: alerts,
    fundamentals: {
      leaderboard: fundamentals,
      screener: { pass_rate: fundamentals.length ? fundamentals.filter((item) => item.initial_screen?.stage === "eligible").length / fundamentals.length : 0 }
    },
    earningsCalendar
  };
}

function tradeSnapshot(store, macroRegimeSnapshot = riskOnMacro, options = {}) {
  return buildTradeSetupsSnapshot(store, {
    window: "1h",
    limit: 50,
    minConviction: 0,
    macroRegimeSnapshot,
    runtimeReliabilitySnapshot: healthyRuntime,
    ...options
  });
}

function findSetup(snapshot, ticker) {
  const setup = snapshot.setups.find((item) => item.ticker === ticker);
  assert.ok(setup, `Expected ${ticker} setup to exist`);
  return setup;
}

async function testUniverseAgent() {
  const entries = uniqueUniverseEntries([
    { ticker: "aapl", company: "Apple Inc.", sector: "Information Technology" },
    { symbol: "AAPL", company_name: "Apple Duplicate" },
    { entity_key: "MSFT", entity_name: "Microsoft Corporation" },
    { ticker: "AAPL; rm -rf /", company: "Command-shaped symbol" },
    { ticker: "$(touch /tmp/pwned)", company: "Subshell-shaped symbol" },
    { ticker: "BRK.B", company: "Berkshire Hathaway Class B" },
    { ticker: "" },
    null
  ]);
  const rotated = rotateUniverseEntries(entries, 1, 3);

  assert.equal(entries.length, 3, "Universe should normalize, dedupe, and reject unsafe tickers.");
  assert.equal(lookupUniverseEntry(entries, "msft")?.ticker, "MSFT", "Universe lookup should be case-insensitive.");
  assert.equal(lookupUniverseEntry(entries, "AAPL; rm -rf /"), null, "Command-shaped ticker input must not enter the universe.");
  assert.equal(lookupUniverseEntry(entries, "brk.b")?.ticker, "BRK.B", "Normal dotted US tickers should remain valid.");
  assert.deepEqual(rotated.selected.map((item) => item.ticker), ["MSFT", "BRK.B", "AAPL"], "Universe rotation should wrap around without unsafe rows.");
  record("Universe Agent", "dedupe_lookup_rotation", { universe_count: entries.length });
}

async function testFundamentalsAgent() {
  const governance = buildFundamentalResearchGovernance();
  assert.ok(governance.references.length >= 4, "Fundamental governance should expose research references.");
  assert.ok(governance.profiles.some((profile) => profile.key === "balanced"), "Fundamental governance should expose default profiles.");
  assert.ok(governance.criteria.every((criterion) => criterion.backtest_status?.status), "Each criterion should expose backtest status.");

  const store = createStore(config);
  store.persistence = { async saveStoreSnapshot() {} };
  const engine = createFundamentalsEngine({ store, config, marketReferenceService: null });
  await engine.replaceCompanies([
    mergeCompany("LIVEGOOD"),
    mergeCompany("PENDING", {
      data_source: "universe_membership",
      quality_flags: { anomaly_flags: ["awaiting_sec_refresh"] }
    }),
    mergeCompany("SCREENPASSWEAK", {
      metrics: {
        revenue_growth_yoy: 0.081,
        eps_growth_yoy: 0.02,
        operating_margin: 0.121,
        gross_margin: 0.36,
        current_ratio: 1.01,
        net_debt_to_ebitda: 2.9,
        fcf_conversion: 0.76,
        fcf_margin: 0.081,
        pe_ttm: 44,
        peg: 2.4,
        fcf_yield: 0.021,
        roe: 0.06,
        roic: 0.04,
        margin_stability: 0.52,
        revenue_consistency: 0.5
      },
      previous_composite_score: 0.5
    }),
    mergeCompany("LIVEBAD", {
      market_cap_bucket: "mid_cap",
      metrics: {
        revenue_growth_yoy: -0.12,
        eps_growth_yoy: -0.2,
        operating_margin: 0.02,
        gross_margin: 0.18,
        current_ratio: 0.55,
        net_debt_to_ebitda: 8,
        fcf_conversion: 0.12,
        fcf_margin: -0.04,
        pe_ttm: 120,
        peg: 8,
        fcf_yield: -0.01
      },
      quality_flags: {
        missing_fields_count: 5,
        reporting_confidence_score: 0.66,
        data_freshness_score: 0.7,
        anomaly_flags: ["comparability_risk"]
      }
    }),
    {
      ticker: "INCOMPLETE",
      company_name: "Incomplete Live Row",
      data_source: "live_sec_filing",
      sector: "Information Technology",
      market_cap_bucket: "large_cap",
      as_of: now
    }
  ]);

  const snapshot = engine.getSnapshot();
  const liveGood = snapshot.leaderboard.find((row) => row.ticker === "LIVEGOOD");
  const pending = snapshot.leaderboard.find((row) => row.ticker === "PENDING");
  const screenPassWeak = snapshot.leaderboard.find((row) => row.ticker === "SCREENPASSWEAK");
  const bad = snapshot.leaderboard.find((row) => row.ticker === "LIVEBAD");
  const incomplete = snapshot.leaderboard.find((row) => row.ticker === "INCOMPLETE");

  assert.equal(liveGood.initial_screen.stage, "eligible", "Strong live SEC-backed row should be eligible.");
  assert.equal(pending.initial_screen.stage, "watch", "Pending SEC refresh must not become eligible.");
  assert.notEqual(screenPassWeak.initial_screen.stage, "eligible", "A low-composite row must not pass Fundamentals just because checklist items pass.");
  assert.ok(
    screenPassWeak.initial_screen.failed_checks.some((item) => /Composite score/.test(item)),
    "Low-composite demotion should explain the composite floor."
  );
  assert.equal(bad.initial_screen.stage, "reject", "Weak/stale fundamentals should reject.");
  assert.equal(incomplete.initial_screen.stage, "reject", "Incomplete live rows should reject instead of crashing the screener.");
  assert.ok(Number.isFinite(incomplete.composite_fundamental_score), "Incomplete live rows should still receive a bounded score.");
  assert.ok(
    snapshot.leaderboard
      .filter((row) => row.initial_screen?.stage === "eligible")
      .every((row) => !["weak", "deteriorating"].includes(row.rating_label)),
    "Eligible fundamentals should never include weak/deteriorating ratings."
  );
  assert.ok(liveGood.composite_fundamental_score > bad.composite_fundamental_score, "Fundamental score should rank strong row above weak row.");
  assert.ok(snapshot.screener.governance.criteria.length >= 7, "Dashboard fundamentals should include criteria governance.");
  record("Fundamentals Agent", "governance_screener_monotonicity", {
    eligible: snapshot.screener.eligible_count,
    watch: snapshot.screener.watch_count,
    rejected: snapshot.screener.rejected_count
  });
}

async function testMarketAgent() {
  function state(entityType, entityKey, sentiment, momentum = sentiment > 0 ? 0.32 : -0.32) {
    return {
      entity_type: entityType,
      entity_key: entityKey,
      window: "1h",
      as_of: now,
      weighted_sentiment: sentiment,
      weighted_confidence: 0.82,
      momentum_delta: momentum
    };
  }

  function macroFixture({ marketSentiment, marketMomentum = null, sectorSentiments, tickerSentiments, fundamentals, passRate, alerts = [], docs = [] }) {
    return {
      config,
      health: { lastUpdate: now },
      sentimentStates: [
        state("market", "market", marketSentiment, marketMomentum ?? (marketSentiment > 0 ? 0.32 : -0.32)),
        ...Object.entries(sectorSentiments).map(([sector, value]) => state("sector", sector, value)),
        ...Object.entries(tickerSentiments).map(([ticker, value]) => state("ticker", ticker, value))
      ],
      documentScores: docs.map((item) => item.score),
      normalizedDocuments: docs.map((item) => item.normalized),
      alertHistory: alerts,
      fundamentals: { leaderboard: fundamentals, screener: { pass_rate: passRate } }
    };
  }

  const positiveFundamentals = ["AAPL", "MSFT", "NVDA", "AMZN"].map((ticker) => fundamentalRow(ticker));
  const negativeFundamentals = ["AAPL", "MSFT", "NVDA", "AMZN"].map((ticker) =>
    fundamentalRow(ticker, {
      direction_label: "bearish_headwind",
      rating_label: "deteriorating",
      composite_fundamental_score: 0.35
    })
  );
  const sectors = {
    Technology: 0.48,
    Healthcare: 0.36,
    Financials: 0.31,
    Energy: 0.25,
    Materials: 0.22,
    Industrials: 0.35
  };
  const tickers = { AAPL: 0.5, MSFT: 0.44, NVDA: 0.56, AMZN: 0.35 };

  const riskOn = buildMacroRegimeSnapshot(macroFixture({
    marketSentiment: 0.44,
    sectorSentiments: sectors,
    tickerSentiments: tickers,
    fundamentals: positiveFundamentals,
    passRate: 0.88,
    alerts: [{ alert_type: "high_confidence_positive", created_at: now }]
  }));
  const riskOff = buildMacroRegimeSnapshot(macroFixture({
    marketSentiment: -0.44,
    sectorSentiments: Object.fromEntries(Object.entries(sectors).map(([key, value]) => [key, -value])),
    tickerSentiments: Object.fromEntries(Object.entries(tickers).map(([key, value]) => [key, -value])),
    fundamentals: negativeFundamentals,
    passRate: 0.12,
    alerts: [{ alert_type: "high_confidence_negative", created_at: now }]
  }));
  const highDispersion = buildMacroRegimeSnapshot(macroFixture({
    marketSentiment: 0.3,
    marketMomentum: -0.35,
    sectorSentiments: { Technology: 0.5, Energy: 0.35, Healthcare: 0.45, Financials: 0.32 },
    tickerSentiments: { AAPL: -0.55, MSFT: -0.45, NVDA: -0.52, AMZN: -0.35 },
    fundamentals: [...positiveFundamentals, ...negativeFundamentals],
    passRate: 0.5,
    alerts: [
      { alert_type: "high_confidence_negative", created_at: now },
      { alert_type: "polarity_reversal", created_at: now },
      { alert_type: "polarity_reversal", created_at: now },
      { alert_type: "polarity_reversal", created_at: now }
    ],
    docs: [scoredDocument("AAPL", "institutional_buying", 0.8)]
  }));
  const thinMacroBreadth = buildMacroRegimeSnapshot(macroFixture({
    marketSentiment: 0.48,
    sectorSentiments: { Technology: 0.55 },
    tickerSentiments: { AAPL: 0.56 },
    fundamentals: positiveFundamentals.slice(0, 1),
    passRate: 1,
    alerts: [{ alert_type: "high_confidence_positive", created_at: now }]
  }));

  assert.equal(riskOn.regime_label, "risk_on");
  assert.equal(riskOn.long_threshold, 0.5);
  assert.equal(riskOff.regime_label, "risk_off");
  assert.equal(riskOff.short_threshold, 0.5);
  assert.equal(highDispersion.regime_label, "high_dispersion", JSON.stringify(highDispersion.score_components));
  assert.equal(highDispersion.long_threshold, 0.6);
  assert.equal(thinMacroBreadth.regime_label, "balanced", "Macro regime must not promote risk-on from one sector/ticker datapoint.");
  assert.equal(thinMacroBreadth.breadth.breadth_gate_pass, false, "Thin macro breadth should be explicit.");
  record("Market Agent", "regime_thresholds", {
    risk_on: riskOn.score_components,
    risk_off: riskOff.score_components,
    high_dispersion: highDispersion.score_components
  });
}

async function testSignalsAndDeterministicSelection() {
  const bullishDocs = [
    scoredDocument("WIN", "institutional_buying", 0.85, {
      observationLevel: "official_filing",
      verificationStatus: "verified_official_source",
      sourceName: "sec_edgar",
      sourceType: "filing"
    }),
    scoredDocument("WIN", "smart_money_accumulation", 0.8),
    scoredDocument("WIN", "block_trade_buying", 0.75, {
      observationLevel: "delayed_trade_prints",
      verificationStatus: "direct_trade_prints_delayed",
      sourceName: "polygon_trades",
      sourceType: "api"
    }),
    scoredDocument("STALE", "institutional_buying", 0.95, { publishedAt: old }),
    scoredDocument("LOWQ", "institutional_buying", 0.8, { quality: 0.2, tier: "context" })
  ];
  const bearishDocs = [
    scoredDocument("FALL", "institutional_selling", -0.88, {
      observationLevel: "official_filing",
      verificationStatus: "verified_official_source",
      sourceName: "sec_edgar",
      sourceType: "filing"
    }),
    scoredDocument("FALL", "smart_money_distribution", -0.82),
    scoredDocument("FALL", "block_trade_selling", -0.8, {
      observationLevel: "delayed_trade_prints",
      verificationStatus: "direct_trade_prints_delayed",
      sourceName: "polygon_trades",
      sourceType: "api"
    })
  ];
  const inferredOnlyDocs = [
    scoredDocument("INFER", "abnormal_volume_buying", 0.72, {
      quality: 0.46,
      tier: "watch",
      observationLevel: "bar_derived_inferred",
      verificationStatus: "inferred_from_ohlcv",
      sourceName: "market_flow",
      sourceType: "market_flow"
    })
  ];
  const store = makeStore({
    fundamentals: [
      fundamentalRow("WIN"),
      fundamentalRow("STALE"),
      fundamentalRow("LOWQ"),
      fundamentalRow("INFER"),
      fundamentalRow("FALL", {
        initial_screen: { stage: "reject", summary: "Fails first-pass screen." },
        direction_label: "bearish_headwind",
        rating_label: "deteriorating",
        composite_fundamental_score: 0.31,
        anomaly_penalty: 0.18,
        reason_codes: ["balance_sheet_pressure"]
      }),
      fundamentalRow("MISSING", { market_reference: null })
    ],
    sentiments: [
      sentimentState("WIN", 0.72),
      sentimentState("STALE", 0.45, { momentum_delta: 0.12, story_velocity: 4 }),
      sentimentState("LOWQ", 0.5, { momentum_delta: 0.14, story_velocity: 4 }),
      sentimentState("INFER", 0.52, { momentum_delta: 0.16, story_velocity: 4 }),
      sentimentState("FALL", -0.72),
      sentimentState("MISSING", 0.72)
    ],
    docs: [...bullishDocs, ...bearishDocs, ...inferredOnlyDocs],
    alerts: [
      { alert_type: "high_confidence_positive", entity_key: "WIN", created_at: now, headline: "WIN positive", confidence: 0.9 },
      { alert_type: "high_confidence_negative", entity_key: "FALL", created_at: now, headline: "FALL negative", confidence: 0.9 },
      { alert_type: "high_confidence_positive", entity_key: "STALE", created_at: old, headline: "STALE old alert", confidence: 0.99 }
    ],
    earningsCalendar: new Map([["WIN", { days_until: 5 }]])
  });

  const riskOn = tradeSnapshot(store, riskOnMacro);
  const riskOff = tradeSnapshot(store, riskOffMacro);
  const balanced = tradeSnapshot(store, balancedMacro);
  const degraded = buildTradeSetupsSnapshot(store, {
    window: "1h",
    limit: 50,
    minConviction: 0,
    macroRegimeSnapshot: riskOnMacro,
    runtimeReliabilitySnapshot: {
      status: "degraded",
      pressure: { isConstrained: true },
      sources: [{ key: "market_data", label: "Market Data", status: "error", criticality: "high", category: "market" }]
    }
  });

  const win = findSetup(riskOn, "WIN");
  const stale = findSetup(riskOn, "STALE");
  const lowQuality = findSetup(riskOn, "LOWQ");
  const inferredOnly = findSetup(riskOn, "INFER");
  const fall = findSetup(riskOff, "FALL");
  const missing = findSetup(riskOn, "MISSING");
  const winBalanced = findSetup(balanced, "WIN");
  const winDegraded = findSetup(degraded, "WIN");

  assert.equal(win.action, "long", "Fresh aligned evidence should produce a long setup in risk-on regime.");
  assert.equal(fall.action, "short", "Fresh negative evidence plus weak fundamentals should produce a short in risk-off regime.");
  assert.ok(stale.recent_documents.length === 0, "Stale evidence should be excluded from deterministic selection.");
  assert.ok(stale.conviction < win.conviction, "Fresh flow evidence should score above stale-only evidence.");
  assert.ok(lowQuality.evidence_quality.weak_quality_items > 0, "Low-quality signal evidence should be visible to the selector.");
  assert.ok(inferredOnly.evidence_quality.inferred_flow_items > 0, "Inferred-only money flow should be counted separately.");
  assert.notEqual(inferredOnly.action, "long", "A single inferred-flow datapoint must not become a tradable long setup.");
  assert.equal(inferredOnly.evidence_breadth.breadth_gate_pass, false, "Thin signal breadth should be explicit on inferred-only setups.");
  assert.ok(
    inferredOnly.risk_flags.some((item) => /inferred from bars only/i.test(item)),
    "Inferred-only money flow should add a source reliability risk flag."
  );
  assert.ok(
    lowQuality.conviction < win.conviction,
    `Low-quality evidence should not score like high-quality evidence. WIN=${win.conviction} LOWQ=${lowQuality.conviction}`
  );
  assert.ok(missing.current_price === null && missing.entry_zone === null, "Missing price must not produce an executable price plan.");
  assert.ok(win.conviction >= winBalanced.conviction, "Risk-on threshold/posture should not penalize a strong long versus balanced.");
  assert.ok(winDegraded.conviction < win.conviction, "Runtime degradation should reduce deterministic conviction.");
  assert.ok(win.risk_flags.includes("earnings_in_window"), "Upcoming earnings should be surfaced as a deterministic risk flag.");
  for (const setup of riskOn.setups) {
    assertFinite01(setup.conviction, `Conviction must be finite 0..1 for ${setup.ticker}`);
    assertFinite01(setup.score_components.long, `Long score must be finite 0..1 for ${setup.ticker}`);
    assertFinite01(setup.score_components.short, `Short score must be finite 0..1 for ${setup.ticker}`);
  }
  record("Signals Agent", "freshness_quality_money_flow", {
    win_conviction: win.conviction,
    stale_conviction: stale.conviction,
    low_quality_conviction: lowQuality.conviction,
    inferred_only_flags: inferredOnly.risk_flags.length
  });
  record("Deterministic Selection Agent", "thresholds_runtime_edge_cases", {
    long: win.action,
    short: fall.action,
    degraded_delta: Number((win.conviction - winDegraded.conviction).toFixed(3))
  });

  return { tradeSetups: riskOn, win, fall };
}

async function testLlmSelectionAgent(tradeSetups) {
  const shadow = await buildLlmSelectionSnapshot({ config, tradeSetups, portfolioPolicy });
  const win = shadow.recommendations.find((item) => item.ticker === "WIN");
  assert.ok(win, "LLM shadow should review supplied deterministic candidates.");
  assert.ok(win.evidence_alignment && win.confidence_reason && Array.isArray(win.missing_data), "LLM output should include explainability fields.");

  const thinTradeSetups = {
    ...tradeSetups,
    setups: [
      {
        ...tradeSetups.setups.find((item) => item.ticker === "WIN"),
        ticker: "THIN",
        recent_documents: [],
        risk_flags: ["supporting evidence quality is thin", "runtime reliability reduces conviction by 15%", "earnings_in_window"],
        runtime_reliability: { status: "degraded", constrained: true, penalty: 0.18 },
        conviction: 0.66
      }
    ]
  };
  const thin = await buildLlmSelectionSnapshot({ config, tradeSetups: thinTradeSetups, portfolioPolicy });
  assert.equal(thin.recommendations[0].action, "watch", "LLM shadow should demote thin/degraded candidates.");

  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses", "LLM selection should call the configured OpenAI Responses URL.");
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            recommendations: tradeSetups.setups.slice(0, 2).map((setup) => ({
              ticker: setup.ticker,
              action: setup.action,
              confidence: Math.min(0.82, Math.max(0.65, setup.conviction)),
              rationale: `${setup.ticker} mocked external review.`,
              supporting_factors: setup.thesis.slice(0, 2),
              concerns: setup.risk_flags.slice(0, 2),
              evidence_alignment: "Mocked external review aligned with supplied fields.",
              risk_assessment: setup.risk_flags[0] || "No major fixture risk.",
              confidence_reason: "Mocked confidence calibrated from supplied deterministic conviction.",
              missing_data: []
            }))
          })
        };
      }
    };
  };

  try {
    const external = await buildLlmSelectionSnapshot({
      config: {
        ...config,
        llmSelectionEnabled: true,
        llmSelectionProvider: "openai",
        llmSelectionModel: "gpt-5.4-mini",
        llmSelectionApiKey: "test-key",
        llmSelectionApiUrl: "https://api.openai.com/v1/responses"
      },
      tradeSetups,
      portfolioPolicy
    });
    const promptPack = JSON.parse(capturedBody.input);
    assert.equal(capturedBody.model, "gpt-5.4-mini", "LLM selector should use configured model.");
    assert.ok(/Use only the JSON input data/.test(capturedBody.instructions), "LLM prompt must ban invented outside data.");
    assert.equal(promptPack.prompt_version, "llm_selection_committee_v2", "LLM input should carry prompt version.");
    assert.ok(promptPack.candidates[0].score_components && promptPack.candidates[0].evidence_quality, "LLM candidate pack should include scoring and evidence quality data.");
    assert.equal(external.mode, "openai_json_review", "Configured LLM should report OpenAI JSON-review mode.");
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: '{"recommendations":[{"ticker":"WIN","action":"watch","confidence":0.5,"rationale":"truncated'
      };
    }
  });

  try {
    const fallback = await buildLlmSelectionSnapshot({
      config: {
        ...config,
        llmSelectionEnabled: true,
        llmSelectionProvider: "openai",
        llmSelectionModel: "gpt-5.5",
        llmSelectionApiKey: "test-key",
        llmSelectionApiUrl: "https://api.openai.com/v1/responses",
        llmSelectionMaxOutputTokens: 12000
      },
      tradeSetups,
      portfolioPolicy
    });
    assert.equal(fallback.status, "fallback_shadow", "Invalid provider JSON should fall back safely.");
    assert.ok(/LLM_SELECTION_MAX_OUTPUT_TOKENS/.test(fallback.last_error), "Fallback error should give an output-token remediation hint.");
  } finally {
    globalThis.fetch = originalFetch;
  }

  record("LLM Selection Agent", "shadow_demotions_and_openai_prompt_pack", {
    shadow_status: shadow.status,
    prompt_version: shadow.prompt_version
  });
}

async function testFinalSelectionPolicyRiskExecutionPortfolio(tradeSetups) {
  const demotedTradableSetup = {
    ...tradeSetups.setups.find((item) => item.ticker === "WIN"),
    ticker: "DEMOTE",
    company_name: "DEMOTE Corp",
    action: "long",
    conviction: 0.7,
    position_size_pct: 0.02,
    summary: "DEMOTE is a tradable fixture that the LLM lane will demote.",
    evidence_breadth: {
      breadth_gate_pass: true,
      usable_signal_items: 2,
      source_count: 2,
      minimum_items: 2,
      minimum_sources: 2
    }
  };
  const watchOnlySetup = {
    ...tradeSetups.setups.find((item) => item.ticker === "WIN"),
    ticker: "WATCHY",
    company_name: "WATCHY Corp",
    action: "watch",
    conviction: 0.52,
    position_size_pct: 0,
    summary: "WATCHY is monitor-only because the deterministic score gap is too small.",
    score_components: { long: 0.52, short: 0.48, gap: 0.04, raw_long: 0.52, raw_short: 0.48, runtime_multiplier: 1 },
    decision_thresholds: { long_threshold: 0.56, short_threshold: 0.56, direction_gap_minimum: 0.08, watch_threshold: 0.38, best_score: 0.52, score_gap: 0.04 },
    decision_blockers: [{ key: "long_direction_gap_too_small", detail: "Long score does not exceed short score by the required decision gap." }]
  };
  const finalTradeSetups = {
    ...tradeSetups,
    setups: [...tradeSetups.setups, demotedTradableSetup, watchOnlySetup]
  };
  const llmSelection = {
    status: "ready",
    mode: "fixture",
    provider: "fixture",
    model: "fixture",
    counts: { long: 3, watch: 1 },
    recommendations: [
      { ticker: "WIN", action: "long", confidence: 0.78, reviewer: "fixture", evidence_alignment: "aligned", confidence_reason: "strong lanes", supporting_factors: ["aligned"], concerns: [] },
      { ticker: "DEMOTE", action: "watch", confidence: 0.58, reviewer: "fixture", evidence_alignment: "demoted fixture", confidence_reason: "review concern", supporting_factors: [], concerns: ["review concern"] },
      { ticker: "LOWQ", action: "long", confidence: 0.66, reviewer: "fixture", evidence_alignment: "qualified support", confidence_reason: "lower quality", supporting_factors: [], concerns: ["low quality"] },
      { ticker: "WATCHY", action: "long", confidence: 0.7, reviewer: "fixture", evidence_alignment: "promotion attempt", confidence_reason: "fixture", supporting_factors: [], concerns: [] }
    ]
  };
  const riskSnapshot = {
    status: "ok",
    equity: 100000,
    buying_power: 95000,
    gross_exposure_pct: 0.04,
    hard_blocks: [],
    positions: []
  };
  const positionMonitor = { positions: [], position_count: 0, open_order_count: 0, account: { equity: 100000, buying_power: 95000 } };
  const finalSelection = buildFinalSelectionSnapshot({
    config,
    tradeSetups: finalTradeSetups,
    llmSelection,
    portfolioPolicy,
    riskSnapshot,
    positionMonitor,
    window: "1h",
    limit: 12
  });
  const win = finalSelection.candidates.find((item) => item.ticker === "WIN");
  const demote = finalSelection.candidates.find((item) => item.ticker === "DEMOTE");
  const watchy = finalSelection.candidates.find((item) => item.ticker === "WATCHY");

  assert.ok(win.execution_allowed, "Aligned deterministic + LLM candidate should pass final selection.");
  assert.equal(win.setup_for_execution.position_size_pct <= portfolioPolicy.portfolioMaxPositionPct, true, "Final selection should cap position size.");
  assert.equal(demote.final_action, "review", "LLM-demoted candidates should be review, not execution.");
  assert.equal(watchy.final_action, "watch", "LLM-only promotions should stay watch.");
  assert.ok(win.selection_report?.agent_votes?.length >= 8, "Final candidate should expose an expandable selection report.");
  assert.ok(win.final_score_components?.setup_quality_adjustment, "Final candidate should expose score components.");

  const sectorCapped = buildFinalSelectionSnapshot({
    config,
    tradeSetups: {
      ...tradeSetups,
      setups: tradeSetups.setups
        .filter((setup) => ["WIN", "LOWQ"].includes(setup.ticker))
        .map((setup) => ({
          ...setup,
          action: "long",
          conviction: 0.78,
          position_size_pct: 0.04,
          evidence_breadth: {
            breadth_gate_pass: true,
            usable_signal_items: 2,
            source_count: 2,
            minimum_items: 2,
            minimum_sources: 2
          }
        }))
    },
    llmSelection: {
      ...llmSelection,
      recommendations: [
        { ticker: "WIN", action: "long", confidence: 0.82 },
        { ticker: "LOWQ", action: "long", confidence: 0.81 }
      ]
    },
    portfolioPolicy: { ...portfolioPolicy, portfolioMaxSectorExposurePct: 0.03, portfolioMaxNewPositionsPerCycle: 3 },
    riskSnapshot,
    positionMonitor,
    limit: 4
  });
  assert.ok(
    sectorCapped.candidates.some((item) => item.reason_codes.includes("sector_exposure_policy")),
    "Final selection should enforce sector exposure policy."
  );

  const blockedRisk = buildPortfolioRiskSnapshot({
    account: { equity: "100000", buying_power: "50000" },
    positions: [{ symbol: "AAPL", side: "long", qty: "100", market_value: "12000", unrealized_pl: "0", unrealized_plpc: "0" }],
    orders: Array.from({ length: 12 }, (_, index) => ({ id: String(index) })),
    runtimeReliability: { pressure: { isConstrained: true } },
    config
  });
  assert.equal(blockedRisk.status, "blocked", "Risk manager should hard-block over-limit/open-order/runtime constrained portfolios.");

  const intent = buildExecutionIntent(
    {
      ...win.setup_for_execution,
      action: win.final_action,
      conviction: win.final_conviction,
      current_price: 100,
      stop_loss: 95,
      take_profit: 108
    },
    { equity: "100000", buying_power: "50000" },
    config,
    { now: new Date(now) }
  );
  const executionRisk = evaluateExecutionRisk(intent, riskSnapshot, config);
  assert.ok(
    intent.allowed && executionRisk.allowed,
    `Approved final candidate should build a guarded execution preview. intent=${intent.blocked_reason} risk=${executionRisk.blocked_reason}`
  );
  assert.equal(intent.order.order_class, "bracket", "Execution preview should use bracket legs when configured.");
  const blockedIntent = buildExecutionIntent({ ...win.setup_for_execution, conviction: 0.2 }, { equity: "100000", buying_power: "50000" }, config);
  assert.equal(blockedIntent.blocked_reason, "conviction_below_execution_minimum", "Execution should block below-threshold conviction.");
  const maliciousTickerIntent = buildExecutionIntent(
    { ...win.setup_for_execution, ticker: "AAPL; rm -rf /", action: "long", conviction: 0.9, current_price: 100 },
    { equity: "100000", buying_power: "50000" },
    config
  );
  assert.equal(maliciousTickerIntent.blocked_reason, "invalid_ticker", "Execution should reject command-shaped ticker strings.");

  const policySnapshot = buildPortfolioPolicySnapshot({
    config,
    riskSnapshot,
    positionMonitor: {
      account: { equity: 100000, buying_power: 95000 },
      positions: [],
      position_count: 0,
      open_order_count: 0,
      open_orders: []
    }
  });
  const adjusted = buildPolicyAdjustedSetup({ ...win.setup, position_size_pct: 0.99, current_price: 100, stop_loss: 80, take_profit: 140 }, portfolioPolicy);
  assert.equal(adjusted.position_size_pct, portfolioPolicy.portfolioMaxPositionPct, "Portfolio policy should cap oversize setups.");
  assert.equal(policySnapshot.status, "ok", "Clean portfolio policy state should be ok.");

  const monitor = buildPositionMonitorSnapshot({
    brokerStatus: { provider: "alpaca", mode: "paper", configured: true, submit_enabled: false },
    account: { equity: "100000", buying_power: "80000" },
    positions: [
      { symbol: "WIN", qty: "10", side: "long", market_value: "1000", avg_entry_price: "100", current_price: "92", unrealized_pl: "-80", unrealized_plpc: "-0.08" },
      { symbol: "LOWQ", qty: "10", side: "long", market_value: "1100", avg_entry_price: "100", current_price: "111", unrealized_pl: "110", unrealized_plpc: "0.11" }
    ],
    orders: [{ id: "ord-1", symbol: "WIN", side: "buy", type: "market", status: "new", qty: "1" }],
    tradeSetups: [
      { ticker: "WIN", action: "long", conviction: 0.72, summary: "Still supported.", risk_flags: [] },
      { ticker: "LOWQ", action: "long", conviction: 0.65, summary: "Still supported.", risk_flags: [] }
    ],
    riskSnapshot: { status: "ok" },
    portfolioPolicy
  });
  assert.equal(monitor.positions.find((item) => item.symbol === "WIN").monitor_action, "close_candidate", "Portfolio monitor should flag stop-loss breaches.");
  assert.equal(monitor.positions.find((item) => item.symbol === "LOWQ").monitor_action, "reduce_candidate", "Portfolio monitor should flag take-profit reductions.");

  record("Final Selection Agent", "dual_arbitration_policy_report", {
    executable: finalSelection.counts.executable,
    win_final_conviction: win.final_conviction
  });
  record("Risk Manager", "hard_blocks_and_preview_risk", { blocked_reasons: blockedRisk.hard_blocks });
  record("Execution Agent", "preview_bracket_threshold_and_input_blocks", { estimated_notional: intent.estimated_notional_usd });
  record("Portfolio Policy Agent", "user_policy_caps_and_guardrails", { max_position_pct: portfolioPolicy.portfolioMaxPositionPct });
  record("Portfolio Monitor", "stops_targets_and_position_review", {
    close_candidates: monitor.close_candidate_count,
    reduce_candidates: monitor.reduce_candidate_count
  });

  return { finalSelection, riskSnapshot, positionMonitor, policySnapshot };
}

async function testAgencyCycleAndLearning({ tradeSetups, finalSelection, riskSnapshot, positionMonitor, policySnapshot }) {
  const cycle = buildAgencyCycleStatus({
    config,
    readiness: { ready: true },
    runtimeReliability: { status: "healthy" },
    workflowStatus: {
      status: "ready",
      can_use_for_decisions: true,
      can_preview_orders: true,
      can_submit_orders: false,
      live_data: {
        fresh_decision_evidence_count: 8,
        live_pricing_ready: true,
        sources: [
          { key: "market_data", status: "fresh", fallback_mode: false },
          { key: "market_flow", status: "fresh", fallback_mode: false },
          { key: "live_news", status: "fresh", fallback_mode: false }
        ]
      },
      blockers: [],
      warnings: [],
      next_actions: []
    },
    tradeSetups,
    executionStatus: { broker: { configured: true, mode: "paper", submit_enabled: false, ready_for_order_submission: false } },
    riskSnapshot,
    positionMonitor,
    portfolioPolicy: policySnapshot,
    llmSelection: { status: "ready", mode: "fixture", recommendations: [{ ticker: "WIN", action: "long" }] },
    finalSelection,
    secQueue: { tracked_companies: 168, live_sec_companies: 168, pending_live_sec_companies: 0, coverage_ratio: 1 },
    executionLog: Array.from({ length: 9 }, (_, index) => ({ id: index }))
  });
  const learning = cycle.workers.find((worker) => worker.key === "learning");
  const finalWorker = cycle.workers.find((worker) => worker.key === "final_selection");

  assert.equal(cycle.workers.length, 12, "Agency cycle should cover all 12 workers.");
  assert.ok(cycle.baseline_ready, "With full SEC/evidence/pricing fixtures, baseline should be ready.");
  assert.ok(learning.progress_label.includes("/10"), "Learning worker should show outcome sample progress.");
  assert.ok(finalWorker.data_state, "Final worker should expose readiness state.");
  assert.ok(cycle.data_progress.phase === "ongoing_updates", "Completed baseline should move into ongoing refresh mode.");
  record("Learning Agent", "outcome_progress_and_agency_cycle", {
    progress: learning.progress_label,
    cycle_phase: cycle.data_progress.phase
  });
}

async function testSecurityAndUnusualDataHardening() {
  const unusualValues = [
    "",
    "   ",
    "AAPL; rm -rf /",
    "MSFT && curl attacker",
    "$(touch /tmp/pwned)",
    "NVDA\nBROKER_SUBMIT_ENABLED=true",
    "META`whoami`",
    "BRK.B",
    "GOOGL",
    "QQQ"
  ];
  const normalized = unusualValues.map((value) => [value, normalizeTickerSymbol(value)]);
  const allowed = normalized.filter(([, ticker]) => ticker).map(([, ticker]) => ticker);

  assert.deepEqual(allowed, ["BRK.B", "GOOGL", "QQQ"], "Ticker sanitizer should allow normal symbols and reject command-shaped input.");

  const backupScript = await readFile(new URL("./backup.js", import.meta.url), "utf8");
  assert.ok(!/execSync\s*\(/.test(backupScript), "Backup helper should not use shell-interpolated execSync.");
  assert.ok(/execFileSync\s*\(\s*"rclone"/.test(backupScript), "Backup helper should call rclone with argument arrays.");

  const maliciousRuntimeCycle = buildAgencyCycleStatus({
    config,
    readiness: { ready: true },
    runtimeReliability: { status: "healthy" },
    workflowStatus: {
      status: "review_required",
      can_use_for_decisions: true,
      can_preview_orders: false,
      can_submit_orders: false,
      live_data: { fresh_decision_evidence_count: 1, live_pricing_ready: true, sources: [] },
      blockers: [],
      warnings: [],
      next_actions: []
    },
    tradeSetups: { counts: { long: 0, short: 0, watch: 1 }, setups: [{ ticker: "AAPL; rm -rf /", action: "watch" }] },
    executionStatus: { broker: { configured: true, mode: "paper", submit_enabled: false, ready_for_order_submission: false } },
    riskSnapshot: { status: "ok", hard_blocks: [] },
    positionMonitor: { position_count: 0, open_order_count: 0 },
    portfolioPolicy: { status: "ok", summary: "Policy clear.", hard_blocks: [] },
    llmSelection: { status: "shadow", mode: "shadow", recommendations: [] },
    finalSelection: { counts: { visible: 0, executable: 0, final_buy: 0, final_sell: 0, review: 0, watch: 0 }, candidates: [] },
    secQueue: { tracked_companies: 168, live_sec_companies: 168, pending_live_sec_companies: 0, coverage_ratio: 1 },
    executionLog: []
  });
  assert.ok(maliciousRuntimeCycle.workers.length === 12, "Command-shaped display data should not break agency-cycle rendering.");

  record("System", "unusual_data_and_shell_command_hardening", {
    rejected_ticker_inputs: unusualValues.length - allowed.length,
    shell_interpolation_removed: true
  });
}

async function testScoreEdgeCases() {
  let seed = 7;
  function random() {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  }
  const docs = [];
  const fundamentals = [];
  const sentiments = [];
  for (let index = 0; index < 40; index += 1) {
    const ticker = `E${index}`;
    const sentiment = random() * 2 - 1;
    const flow = sentiment >= 0 ? "institutional_buying" : "institutional_selling";
    fundamentals.push(
      fundamentalRow(ticker, {
        initial_screen: { stage: random() > 0.25 ? "eligible" : random() > 0.5 ? "watch" : "reject", summary: "Fuzz screen." },
        direction_label: sentiment >= 0 ? "bullish_supportive" : "bearish_headwind",
        rating_label: random() > 0.2 ? "balanced" : "weak",
        composite_fundamental_score: random(),
        final_confidence: random(),
        anomaly_penalty: random() * 0.25,
        market_reference: random() > 0.1 ? { current_price: random() * 500 + 5, beta: random() * 3, live: true } : null
      })
    );
    sentiments.push(sentimentState(ticker, sentiment, { weighted_confidence: random(), momentum_delta: random() * 0.8 - 0.4, story_velocity: random() * 12 }));
    docs.push(scoredDocument(ticker, flow, sentiment, { quality: random(), tier: random() > 0.2 ? "alert" : "context" }));
  }
  const snapshot = tradeSnapshot(makeStore({ fundamentals, sentiments, docs }), balancedMacro, { limit: 100 });
  assert.ok(snapshot.setups.length >= 30, "Fuzz fixture should produce broad setup coverage.");
  for (const setup of snapshot.setups) {
    assert.ok(["long", "short", "watch", "no_trade"].includes(setup.action), `Unknown setup action for ${setup.ticker}`);
    assertFinite01(setup.conviction, `Fuzz conviction out of range for ${setup.ticker}`);
    assertFinite01(setup.score_components.long, `Fuzz long score out of range for ${setup.ticker}`);
    assertFinite01(setup.score_components.short, `Fuzz short score out of range for ${setup.ticker}`);
    assert.ok(Number.isFinite(Number(setup.position_size_pct)), `Fuzz position size not finite for ${setup.ticker}`);
    if (setup.current_price === null) {
      assert.equal(setup.entry_zone, null, "Missing current price should not produce entry zone.");
    }
  }
  record("System", "deterministic_fuzz_bounds", { setups_checked: snapshot.setups.length });
}

await testUniverseAgent();
await testFundamentalsAgent();
await testMarketAgent();
const { tradeSetups } = await testSignalsAndDeterministicSelection();
await testLlmSelectionAgent(tradeSetups);
const finalContext = await testFinalSelectionPolicyRiskExecutionPortfolio(tradeSetups);
await testAgencyCycleAndLearning({ tradeSetups, ...finalContext });
await testScoreEdgeCases();
await testSecurityAndUnusualDataHardening();

const byAgent = results.reduce((acc, item) => {
  acc[item.agent] = (acc[item.agent] || 0) + 1;
  return acc;
}, {});

console.log(
  JSON.stringify(
    {
      status: "ok",
      checks: results.length,
      agents_covered: Object.keys(byAgent).length,
      by_agent: byAgent,
      highlights: results
    },
    null,
    2
  )
);
