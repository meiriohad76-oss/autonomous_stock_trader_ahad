process.env.DATABASE_ENABLED = "false";
process.env.LIGHTWEIGHT_STATE_ENABLED = "false";
process.env.SEED_DATA_ON_EMPTY = "false";
process.env.SEED_DATA_IN_DECISIONS = "false";
process.env.LIVE_NEWS_ENABLED = "false";
process.env.MARKET_FLOW_ENABLED = "false";
process.env.AUTO_START_MARKET_FLOW = "false";
process.env.MARKET_DATA_PROVIDER = "synthetic";
process.env.FUNDAMENTAL_MARKET_DATA_PROVIDER = "synthetic";
process.env.AUTO_START_FUNDAMENTAL_MARKET_DATA = "false";
process.env.AUTO_START_SEC_FUNDAMENTALS = "false";
process.env.SEC_FORM4_ENABLED = "false";
process.env.SEC_13F_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";
process.env.ALPACA_API_KEY_ID = "";
process.env.ALPACA_API_SECRET_KEY = "";

const { createSentimentApp } = await import("../src/app.js");

const app = createSentimentApp();

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

try {
  app.setStartupStatus({ http_listening: true, phase: "initializing" });
  await app.initialize();
  app.setStartupStatus({ initialized: true, live_sources_started: true, phase: "running" });

  await app.pipeline.processRawDocument(
    liveDocument({
      url: "https://www.marketaux.com/news/aapl-services-outlook-live-check",
      title: "Apple raises services outlook after stronger-than-expected quarter",
      body: "Apple reported stronger services growth, margin expansion, and a better full-year outlook.",
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
      title: "Amazon director reports sizable open-market share purchase",
      body: "A Form 4 filing shows an Amazon director purchased shares in the open market.",
      source_metadata: {
        ticker_hint: "AMZN",
        sector_hint: "Consumer Discretionary"
      }
    })
  );

  const workflow = await app.getTradingWorkflowStatus({ window: "1h", limit: 20 });

  if (!["ready", "review_required", "not_ready"].includes(workflow.status)) {
    throw new Error(`Unexpected workflow status: ${workflow.status}`);
  }

  if (!workflow.can_use_for_decisions) {
    throw new Error(`Expected production-mode live evidence to be decision-ready: ${workflow.summary}`);
  }

  if (workflow.live_data.seed_data_in_decisions || workflow.live_data.seed_data_on_empty) {
    throw new Error("Workflow check should run with seed data blocked from decisions.");
  }

  if (workflow.live_data.fresh_decision_evidence_count < 1) {
    throw new Error("Expected at least one fresh alert/watch evidence item.");
  }

  if ((workflow.steps || []).length < 6) {
    throw new Error("Workflow status should expose the full end-to-end step list.");
  }

  if (!(workflow.live_data.sources || []).length) {
    throw new Error("Workflow status should report live source freshness.");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow_status: workflow.status,
        can_use_for_decisions: workflow.can_use_for_decisions,
        can_preview_orders: workflow.can_preview_orders,
        can_submit_orders: workflow.can_submit_orders,
        fresh_decision_evidence_count: workflow.live_data.fresh_decision_evidence_count,
        trade_plan: workflow.trade_plan,
        blockers: workflow.blockers,
        warnings: workflow.warnings
      },
      null,
      2
    )
  );
} finally {
  await app.stopLiveSources();
}
