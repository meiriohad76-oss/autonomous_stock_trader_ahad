process.env.DATABASE_ENABLED = "false";
process.env.BROKER_PROVIDER = "alpaca";
process.env.BROKER_ADAPTER = "mcp";
process.env.BROKER_TRADING_MODE = "paper";
process.env.BROKER_SUBMIT_ENABLED = "false";

const { config } = await import("../src/config.js");
const { createAlpacaMcpBroker } = await import("../src/domain/broker-alpaca-mcp.js");

const broker = createAlpacaMcpBroker({ config });
const status = broker.getStatus();

if (!status.configured) {
  console.log(JSON.stringify({
    status: "not_configured",
    broker: status,
    orders_placed: false
  }, null, 2));
  process.exit(0);
}

const account = await broker.getAccount();
const positions = await broker.getPositions();
const orders = await broker.getOrders({ status: "open", limit: 5, nested: false });

console.log(JSON.stringify({
  status: "ok",
  broker_status: status.status || (status.ready_for_order_submission ? "ready" : "guarded"),
  adapter: status.adapter,
  mode: status.mode,
  account_status: account?.status || null,
  trading_blocked: Boolean(account?.trading_blocked),
  account_blocked: Boolean(account?.account_blocked),
  buying_power_available: Boolean(account?.buying_power),
  portfolio_value_available: Boolean(account?.portfolio_value),
  position_count: Array.isArray(positions) ? positions.length : 0,
  open_order_count: Array.isArray(orders) ? orders.length : 0,
  submit_enabled: status.submit_enabled,
  ready_for_order_submission: status.ready_for_order_submission,
  orders_placed: false
}, null, 2));
