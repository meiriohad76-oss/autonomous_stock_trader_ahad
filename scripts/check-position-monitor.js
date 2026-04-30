process.env.DATABASE_ENABLED = "false";
process.env.BROKER_SUBMIT_ENABLED = "false";

const { buildPositionMonitorSnapshot } = await import("../src/domain/position-monitor-agent.js");

const brokerStatus = {
  provider: "alpaca",
  mode: "paper",
  configured: true,
  submit_enabled: false
};

const snapshot = buildPositionMonitorSnapshot({
  brokerStatus,
  account: {
    equity: "100000",
    buying_power: "50000"
  },
  positions: [
    {
      symbol: "AAPL",
      qty: "10",
      side: "long",
      market_value: "1950",
      avg_entry_price: "180",
      current_price: "195",
      unrealized_pl: "150",
      unrealized_plpc: "0.083"
    },
    {
      symbol: "TSLA",
      qty: "4",
      side: "long",
      market_value: "800",
      avg_entry_price: "220",
      current_price: "200",
      unrealized_pl: "-80",
      unrealized_plpc: "-0.091"
    }
  ],
  orders: [{ id: "ord-1", symbol: "AAPL", side: "buy", type: "market", status: "new", qty: "1" }],
  tradeSetups: [
    {
      ticker: "AAPL",
      action: "long",
      setup_label: "confirmed_long",
      conviction: 0.72,
      summary: "AAPL still supports a long.",
      risk_flags: []
    },
    {
      ticker: "TSLA",
      action: "no_trade",
      setup_label: "no_trade",
      conviction: 0.28,
      summary: "TSLA does not currently justify a trade.",
      risk_flags: ["fails the stage-one screener"]
    }
  ],
  riskSnapshot: {
    status: "ok"
  }
});

if (snapshot.position_count !== 2 || snapshot.open_order_count !== 1) {
  throw new Error("Position monitor did not count positions and open orders.");
}

const tsla = snapshot.positions.find((position) => position.symbol === "TSLA");
if (!tsla || tsla.monitor_action !== "close_candidate") {
  throw new Error("Position monitor should mark a position with no-trade setup as a close candidate.");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      monitor_status: snapshot.status,
      position_count: snapshot.position_count,
      open_order_count: snapshot.open_order_count,
      review_count: snapshot.review_count,
      close_candidate_count: snapshot.close_candidate_count
    },
    null,
    2
  )
);
