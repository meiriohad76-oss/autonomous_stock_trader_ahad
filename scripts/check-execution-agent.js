process.env.DATABASE_ENABLED = "false";
process.env.BROKER_PROVIDER = "alpaca";
process.env.BROKER_TRADING_MODE = "paper";
process.env.BROKER_SUBMIT_ENABLED = "false";
process.env.ALPACA_API_KEY_ID = "";
process.env.ALPACA_API_SECRET_KEY = "";

const { config } = await import("../src/config.js");
const { createAlpacaBroker } = await import("../src/domain/broker-alpaca.js");
const { buildExecutionIntent, createExecutionAgent } = await import("../src/domain/execution-agent.js");

const longSetup = {
  ticker: "AAPL",
  action: "long",
  setup_label: "confirmed_long",
  conviction: 0.74,
  position_size_pct: 0.018,
  current_price: 195.25,
  timeframe: "swing_3d_to_2w",
  entry_zone: {
    low: 191.8,
    high: 195.25,
    bias: "buy_pullback"
  },
  stop_loss: 186.5,
  take_profit: 214.25,
  summary: "AAPL is a confirmed long with 74% conviction.",
  thesis: ["passes the stage-one screener"],
  risk_flags: []
};

const watchSetup = {
  ...longSetup,
  ticker: "MSFT",
  action: "watch",
  conviction: 0.69
};

const account = {
  equity: "50000",
  buying_power: "12000"
};

const intent = buildExecutionIntent(longSetup, account, config, {
  now: new Date("2026-04-30T12:00:00Z")
});

if (!intent.allowed) {
  throw new Error(`Expected long setup to be executable, got ${intent.blocked_reason}`);
}

if (intent.order.symbol !== "AAPL" || intent.order.side !== "buy" || intent.order.type !== "market") {
  throw new Error("Execution intent did not build the expected Alpaca market order.");
}

if (!intent.order.order_class || !intent.order.take_profit || !intent.order.stop_loss) {
  throw new Error("Execution intent should attach bracket legs when stop/take-profit are valid.");
}

if (intent.estimated_notional_usd > config.executionMaxOrderNotionalUsd) {
  throw new Error("Execution intent exceeded max order notional.");
}

const watchIntent = buildExecutionIntent(watchSetup, account, config);
if (watchIntent.allowed || watchIntent.blocked_reason !== "setup_action_is_not_tradable") {
  throw new Error("Execution intent should block watch-only setups.");
}

const broker = createAlpacaBroker({ config });
const agent = createExecutionAgent({
  config,
  broker,
  getTradeSetup: (ticker) => (ticker === "AAPL" ? longSetup : watchSetup)
});

const status = agent.getStatus();
if (status.status !== "not_configured" || status.broker.ready_for_order_submission) {
  throw new Error("Execution status should remain not_configured without Alpaca keys.");
}

const preview = await agent.previewOrder({ ticker: "AAPL" });
if (!preview.ok || !preview.dry_run || !preview.intent.allowed) {
  throw new Error("Execution preview should produce a dry-run order without broker credentials.");
}

let submitBlocked = false;
try {
  await agent.submitOrder({ ticker: "AAPL", confirm: "paper-trade" });
} catch (error) {
  submitBlocked = /disabled|missing|not ready/i.test(error.message);
}

if (!submitBlocked) {
  throw new Error("Execution submit should be blocked while BROKER_SUBMIT_ENABLED=false.");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      broker_status: status.status,
      dry_run_allowed: preview.intent.allowed,
      order_symbol: intent.order.symbol,
      order_side: intent.order.side,
      estimated_notional_usd: intent.estimated_notional_usd,
      bracket_order: intent.order.order_class === "bracket",
      watch_blocked_reason: watchIntent.blocked_reason,
      submit_blocked: submitBlocked
    },
    null,
    2
  )
);
