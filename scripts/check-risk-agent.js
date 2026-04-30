process.env.DATABASE_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";
process.env.RISK_MAX_GROSS_EXPOSURE_PCT = "0.35";
process.env.RISK_MAX_SINGLE_NAME_EXPOSURE_PCT = "0.08";
process.env.RISK_MAX_OPEN_ORDERS = "10";

const { config } = await import("../src/config.js");
const { buildPortfolioRiskSnapshot, evaluateExecutionRisk } = await import("../src/domain/risk-agent.js");

const portfolio = buildPortfolioRiskSnapshot({
  account: {
    equity: "100000",
    buying_power: "50000"
  },
  positions: [
    {
      symbol: "AAPL",
      side: "long",
      qty: "10",
      market_value: "5000",
      unrealized_pl: "250",
      unrealized_plpc: "0.05"
    }
  ],
  orders: [{ id: "1" }],
  runtimeReliability: {
    pressure: {
      isConstrained: false
    }
  },
  config
});

if (portfolio.status !== "ok" || portfolio.gross_exposure_pct !== 0.05) {
  throw new Error("Risk snapshot did not compute the expected base exposure.");
}

const allowedIntent = {
  allowed: true,
  ticker: "MSFT",
  action: "long",
  side: "buy",
  estimated_notional_usd: 2000
};
const allowedRisk = evaluateExecutionRisk(allowedIntent, portfolio, config);
if (!allowedRisk.allowed) {
  throw new Error(`Expected risk check to allow modest order, got ${allowedRisk.blocked_reason}`);
}

const blockedIntent = {
  ...allowedIntent,
  ticker: "AAPL",
  estimated_notional_usd: 6000
};
const blockedRisk = evaluateExecutionRisk(blockedIntent, portfolio, config);
if (blockedRisk.allowed || blockedRisk.blocked_reason !== "single_name_exposure_failed") {
  throw new Error("Risk check should block an order that breaches single-name exposure.");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      portfolio_status: portfolio.status,
      gross_exposure_pct: portfolio.gross_exposure_pct,
      allowed_order: allowedRisk.allowed,
      blocked_reason: blockedRisk.blocked_reason,
      checks: blockedRisk.checks.length
    },
    null,
    2
  )
);
