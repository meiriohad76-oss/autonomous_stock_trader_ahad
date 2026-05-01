process.env.DATABASE_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";

const {
  buildPolicyAdjustedSetup,
  buildPortfolioPolicySnapshot,
  effectiveRiskLimits,
  normalizePortfolioPolicyUpdates,
  readPortfolioPolicy
} = await import("../src/domain/portfolio-policy.js");
const { buildPositionMonitorSnapshot } = await import("../src/domain/position-monitor-agent.js");

const config = {
  executionDefaultEquityUsd: 100000,
  executionMaxPositionPct: 0.05,
  riskMaxGrossExposurePct: 0.4,
  riskMaxSingleNameExposurePct: 0.08,
  riskMaxOpenOrders: 10,
  riskBlockWhenRuntimeConstrained: false,
  portfolioWeeklyTargetPct: 0.03,
  portfolioMaxWeeklyDrawdownPct: 0.04,
  portfolioMaxPositions: 6,
  portfolioMaxNewPositionsPerCycle: 2,
  portfolioMaxPositionPct: 0.025,
  portfolioMaxGrossExposurePct: 0.3,
  portfolioMaxSectorExposurePct: 0.12,
  portfolioCashReservePct: 0.15,
  portfolioDefaultStopLossPct: 0.05,
  portfolioDefaultTakeProfitPct: 0.08,
  portfolioTrailingStopPct: 0.03,
  portfolioMinHoldHours: 4,
  portfolioAllowAdds: false,
  portfolioAllowReductions: true
};

const updates = normalizePortfolioPolicyUpdates({
  portfolioMaxPositionPct: 0.5,
  portfolioAllowAdds: "true",
  ignoredSetting: 123
});

if (updates.portfolioMaxPositionPct !== 0.25 || updates.portfolioAllowAdds !== true || "ignoredSetting" in updates) {
  throw new Error("Portfolio policy normalization did not clamp or filter settings correctly.");
}

const policy = readPortfolioPolicy(config);
const limits = effectiveRiskLimits(config);

if (limits.max_gross_exposure_pct !== 0.3 || limits.max_single_name_exposure_pct !== 0.025) {
  throw new Error("Effective risk limits should include the portfolio policy overlay.");
}

const adjustedSetup = buildPolicyAdjustedSetup(
  {
    ticker: "AAPL",
    action: "long",
    conviction: 0.74,
    position_size_pct: 0.08,
    current_price: 200,
    stop_loss: 170,
    take_profit: 240
  },
  policy
);

if (adjustedSetup.position_size_pct !== 0.025 || adjustedSetup.stop_loss !== 190 || adjustedSetup.take_profit !== 216) {
  throw new Error("Policy-adjusted setup should cap size and apply configured stop/target discipline.");
}

const monitor = buildPositionMonitorSnapshot({
  brokerStatus: {
    provider: "alpaca",
    mode: "paper",
    configured: true,
    submit_enabled: false
  },
  account: {
    equity: "100000",
    buying_power: "25000"
  },
  positions: [
    {
      symbol: "AAPL",
      qty: "10",
      side: "long",
      market_value: "2000",
      avg_entry_price: "200",
      current_price: "184",
      unrealized_pl: "-160",
      unrealized_plpc: "-0.08"
    },
    {
      symbol: "MSFT",
      qty: "8",
      side: "long",
      market_value: "2400",
      avg_entry_price: "280",
      current_price: "302",
      unrealized_pl: "176",
      unrealized_plpc: "0.079"
    }
  ],
  orders: [],
  tradeSetups: [
    { ticker: "AAPL", action: "long", conviction: 0.7, summary: "Still long." },
    { ticker: "MSFT", action: "long", conviction: 0.72, summary: "Still long." }
  ],
  riskSnapshot: { status: "ok" },
  portfolioPolicy: policy
});

const apple = monitor.positions.find((position) => position.symbol === "AAPL");
const microsoft = monitor.positions.find((position) => position.symbol === "MSFT");

if (apple.monitor_action !== "close_candidate" || !apple.reason_codes.includes("policy_stop_loss_breached")) {
  throw new Error("Portfolio Monitor should flag a policy stop-loss breach.");
}

if (microsoft.monitor_action !== "hold" && microsoft.monitor_action !== "reduce_candidate") {
  throw new Error("Portfolio Monitor should keep or reduce a profitable position according to policy.");
}

const snapshot = buildPortfolioPolicySnapshot({
  config,
  riskSnapshot: {
    equity: 100000,
    buying_power: 12000,
    gross_exposure_pct: 0.28,
    positions: monitor.positions
  },
  positionMonitor: monitor
});

if (!snapshot.guardrails.length || snapshot.settings.portfolioMaxPositions !== 6) {
  throw new Error("Portfolio policy snapshot should expose settings and guardrails.");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      policy_status: snapshot.status,
      max_position_pct: policy.portfolioMaxPositionPct,
      adjusted_size_pct: adjustedSetup.position_size_pct,
      close_candidates: monitor.close_candidate_count,
      reduce_candidates: monitor.reduce_candidate_count
    },
    null,
    2
  )
);
