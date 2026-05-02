process.env.DATABASE_ENABLED = "false";
process.env.LIGHTWEIGHT_STATE_ENABLED = "false";
process.env.SEED_DATA_ON_EMPTY = "false";
process.env.SEED_DATA_IN_DECISIONS = "false";
process.env.LIVE_NEWS_ENABLED = "false";
process.env.MARKETAUX_ENABLED = "true";
process.env.MARKETAUX_API_KEY = "your_marketaux_key_here";
process.env.MARKET_DATA_PROVIDER = "synthetic";
process.env.FUNDAMENTAL_MARKET_DATA_PROVIDER = "synthetic";
process.env.FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL = "4";
process.env.MARKET_FLOW_ENABLED = "false";
process.env.AUTO_START_MARKET_FLOW = "false";
process.env.AUTO_START_FUNDAMENTAL_MARKET_DATA = "false";
process.env.AUTO_START_SEC_FUNDAMENTALS = "false";
process.env.SEC_FORM4_ENABLED = "false";
process.env.SEC_13F_ENABLED = "false";
process.env.STOCKTWITS_ENABLED = "false";
process.env.TRADE_PRINTS_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";
process.env.ALPACA_API_KEY_ID = "";
process.env.ALPACA_API_SECRET_KEY = "";
process.env.TWELVE_DATA_API_KEY = "your_twelve_data_key_here";

const { createSentimentApp } = await import("../src/app.js");
const { routeRequest } = await import("../src/http/router.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function liveDocument(overrides) {
  const now = new Date().toISOString();
  return {
    source_name: "marketaux",
    source_type: "news_api",
    source_priority: 0.84,
    published_at: now,
    fetched_at: now,
    language: "en",
    raw_payload: {},
    ...overrides
  };
}

const app = createSentimentApp();

try {
  app.setStartupStatus({ http_listening: true, phase: "initializing" });
  await app.initialize();
  app.setStartupStatus({ initialized: true, live_sources_started: false, phase: "running" });

  await app.pipeline.processRawDocument(
    liveDocument({
      url: "https://www.marketaux.com/news/aapl-live-check",
      title: "Apple shares rise after stronger services growth",
      body: "Apple reported stronger services growth, margin expansion, and healthier cash conversion.",
      source_metadata: {
        ticker_hint: "AAPL",
        sector_hint: "Technology"
      }
    })
  );

  await app.pipeline.processRawDocument(
    liveDocument({
      source_name: "insider_tracker",
      source_type: "insider",
      source_priority: 0.79,
      url: "https://www.sec.gov/Archives/edgar/data/1018724/live-amzn-form4-buy.html",
      title: "Amazon director reports open-market share purchase",
      body: "A Form 4 filing shows an Amazon director purchased shares in the open market.",
      source_metadata: {
        ticker_hint: "AMZN",
        sector_hint: "Consumer Discretionary"
      }
    })
  );

  const config = app.getConfig();
  const doctor = await app.getSystemDoctor({ window: "1h", limit: 20, minConviction: 0 });
  const routeSource = routeRequest.toString();

  assert(config.twelve_data_api_key !== "your_twelve_data_key_here", "Config API must not expose or use placeholder Twelve Data key.");
  assert(app.config.twelveDataApiKey === "", "Placeholder Twelve Data key should be ignored by config.");
  assert(config.credential_warnings.some((item) => item.env === "TWELVE_DATA_API_KEY"), "Credential warnings should mention ignored Twelve Data placeholder.");
  assert(doctor.agents.worker_count === 12, `Expected 12 agency workers, got ${doctor.agents.worker_count}.`);
  assert(doctor.checks.some((item) => item.key === "allowed_universe" && item.status === "pass"), "Doctor should confirm the full allowed universe.");
  assert(doctor.checks.some((item) => item.key === "production_data_mode" && item.status === "pass"), "Seed/sample data must be blocked from decisions.");
  assert(doctor.checks.some((item) => item.key === "signals" && item.status === "pass"), "Doctor should see fresh live-like decision evidence.");
  assert(!doctor.can_submit_orders, "End-to-end check must keep Alpaca submit gated by default.");
  assert(["analysis_ready", "ready_for_preview", "blocked"].includes(doctor.status), `Unexpected doctor status: ${doctor.status}.`);
  assert(routeSource.includes("/api/system/doctor"), "Router should expose /api/system/doctor.");
  assert(doctor.next_actions.length, "Doctor should return actionable next steps.");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        doctor_status: doctor.status,
        worker_count: doctor.agents.worker_count,
        checks: doctor.checks.length,
        can_use_for_decisions: doctor.can_use_for_decisions,
        can_preview_orders: doctor.can_preview_orders,
        can_submit_orders: doctor.can_submit_orders,
        credential_warnings: config.credential_warnings.map((item) => item.env),
        blockers: doctor.blockers,
        warnings: doctor.warnings.slice(0, 5),
        next_actions: doctor.next_actions.slice(0, 5)
      },
      null,
      2
    )
  );
} finally {
  await app.stopLiveSources();
}
