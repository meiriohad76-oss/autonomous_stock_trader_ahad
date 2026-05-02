import { round } from "../utils/helpers.js";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePosition(position) {
  const symbol = normalizeSymbol(position.symbol);
  const qty = toNumber(position.qty);
  const marketValue = Math.abs(toNumber(position.market_value));
  const currentPrice = toNumber(position.current_price || position.avg_entry_price);
  const side = String(position.side || (qty < 0 ? "short" : "long")).toLowerCase();

  return {
    symbol,
    qty,
    side,
    market_value: round(marketValue, 2),
    avg_entry_price: round(toNumber(position.avg_entry_price), 2),
    current_price: round(currentPrice, 2),
    unrealized_pl: round(toNumber(position.unrealized_pl), 2),
    unrealized_plpc: round(toNumber(position.unrealized_plpc), 4)
  };
}

function setupSupportsPosition(position, setup) {
  if (!setup) {
    return false;
  }
  if (position.side === "short") {
    return setup.action === "short";
  }
  return setup.action === "long";
}

function monitorDecision(position, setup, riskSnapshot, portfolioPolicy = {}) {
  const reasons = [];
  let action = "hold";

  if (!setup) {
    reasons.push("no_current_trade_setup");
    action = "review";
  } else if (!setupSupportsPosition(position, setup)) {
    reasons.push(`setup_now_${setup.action}`);
    action = setup.action === "no_trade" ? "close_candidate" : "review";
  }

  const stopLossPct = toNumber(portfolioPolicy.portfolioDefaultStopLossPct, 0.06);
  const takeProfitPct = toNumber(portfolioPolicy.portfolioDefaultTakeProfitPct, 0.09);
  const trailingStopPct = toNumber(portfolioPolicy.portfolioTrailingStopPct, 0.04);
  const allowReductions = portfolioPolicy.portfolioAllowReductions !== false;

  if (position.unrealized_plpc <= -Math.abs(stopLossPct)) {
    reasons.push("policy_stop_loss_breached");
    action = "close_candidate";
  }

  if (position.unrealized_plpc >= Math.abs(takeProfitPct)) {
    reasons.push("policy_take_profit_reached");
    if (allowReductions && action !== "close_candidate") {
      action = "reduce_candidate";
    }
  }

  if (trailingStopPct > 0 && position.unrealized_plpc >= trailingStopPct) {
    reasons.push("policy_trailing_stop_monitor");
  }

  if (Math.abs(position.unrealized_plpc) >= 0.08) {
    reasons.push(position.unrealized_plpc > 0 ? "large_unrealized_gain" : "large_unrealized_loss");
    if (position.unrealized_plpc < -0.08 && action !== "close_candidate") {
      action = "review";
    }
  }

  if (riskSnapshot?.status === "blocked") {
    reasons.push("portfolio_risk_blocked");
    action = action === "hold" ? "review" : action;
  }

  if (setup?.risk_flags?.length) {
    reasons.push(...setup.risk_flags.slice(0, 2).map((item) => item.replace(/\s+/g, "_").toLowerCase()));
  }

  return {
    action,
    reasons: [...new Set(reasons)].slice(0, 5)
  };
}

function summarizeOpenOrder(order) {
  return {
    id: order.id || null,
    symbol: normalizeSymbol(order.symbol),
    side: order.side || null,
    type: order.type || null,
    status: order.status || null,
    qty: order.qty || null,
    notional: order.notional || null,
    submitted_at: order.submitted_at || order.created_at || null
  };
}

function summarizePlanningCandidate(setup) {
  const tradable = ["long", "short"].includes(setup.action);
  return {
    ticker: setup.ticker,
    action: setup.action,
    setup_label: setup.setup_label || null,
    tradable,
    blocked_reason: tradable ? null : "setup_action_is_not_tradable",
    conviction: setup.conviction,
    current_price: setup.current_price ?? null,
    timeframe: setup.timeframe || null,
    position_size_pct: setup.position_size_pct ?? null,
    summary: setup.summary
  };
}

export function buildPositionMonitorSnapshot({
  brokerStatus,
  account = null,
  positions = [],
  orders = [],
  tradeSetups = [],
  riskSnapshot = null,
  portfolioPolicy = null
}) {
  const setupsByTicker = new Map((tradeSetups || []).map((setup) => [setup.ticker, setup]));
  const normalizedPositions = (positions || []).map(normalizePosition).filter((position) => position.symbol);
  const monitoredPositions = normalizedPositions.map((position) => {
    const setup = setupsByTicker.get(position.symbol) || null;
    const decision = monitorDecision(position, setup, riskSnapshot, portfolioPolicy || {});

    return {
      ...position,
      monitor_action: decision.action,
      reason_codes: decision.reasons,
      setup_action: setup?.action || null,
      setup_conviction: setup?.conviction ?? null,
      setup_label: setup?.setup_label || null,
      setup_summary: setup?.summary || null
    };
  });
  const reviewCount = monitoredPositions.filter((item) => item.monitor_action === "review").length;
  const reduceCandidateCount = monitoredPositions.filter((item) => item.monitor_action === "reduce_candidate").length;
  const closeCandidateCount = monitoredPositions.filter((item) => item.monitor_action === "close_candidate").length;
  const openOrders = (orders || []).map(summarizeOpenOrder);

  return {
    as_of: new Date().toISOString(),
    status: !brokerStatus?.configured
      ? "not_configured"
      : closeCandidateCount
        ? "action_needed"
        : reduceCandidateCount
          ? "review"
        : reviewCount
          ? "review"
          : "ok",
    broker: brokerStatus,
    account: account
      ? {
          equity: round(toNumber(account.equity), 2),
          buying_power: round(toNumber(account.buying_power), 2),
          portfolio_value: round(toNumber(account.portfolio_value || account.equity), 2)
        }
      : null,
    position_count: monitoredPositions.length,
    open_order_count: openOrders.length,
    review_count: reviewCount,
    reduce_candidate_count: reduceCandidateCount,
    close_candidate_count: closeCandidateCount,
    total_position_value: round(monitoredPositions.reduce((sum, position) => sum + position.market_value, 0), 2),
    risk_status: riskSnapshot?.status || null,
    positions: monitoredPositions,
    open_orders: openOrders,
    portfolio_policy: portfolioPolicy
      ? {
          weekly_target_pct: portfolioPolicy.portfolioWeeklyTargetPct,
          max_positions: portfolioPolicy.portfolioMaxPositions,
          max_new_positions_per_cycle: portfolioPolicy.portfolioMaxNewPositionsPerCycle,
          max_position_pct: portfolioPolicy.portfolioMaxPositionPct,
          cash_reserve_pct: portfolioPolicy.portfolioCashReservePct,
          default_stop_loss_pct: portfolioPolicy.portfolioDefaultStopLossPct,
          default_take_profit_pct: portfolioPolicy.portfolioDefaultTakeProfitPct,
          trailing_stop_pct: portfolioPolicy.portfolioTrailingStopPct,
          allow_adds: portfolioPolicy.portfolioAllowAdds,
          allow_reductions: portfolioPolicy.portfolioAllowReductions
        }
      : null,
    planning_candidates: !brokerStatus?.configured
      ? tradeSetups
          .slice(0, 8)
          .map(summarizePlanningCandidate)
      : []
  };
}

export function createPositionMonitorAgent({ broker, getTradeSetups, getRiskSnapshot, getPortfolioPolicy }) {
  async function getSnapshot({ window = "1h", limit = 25 } = {}) {
    const brokerStatus = broker.getStatus();
    const tradeSetups = getTradeSetups({ window, limit, minConviction: 0 })?.setups || [];
    const riskSnapshot = getRiskSnapshot ? await getRiskSnapshot() : null;
    const portfolioPolicy = getPortfolioPolicy ? getPortfolioPolicy() : null;

    if (!brokerStatus.configured) {
      return buildPositionMonitorSnapshot({
        brokerStatus,
        account: null,
        positions: [],
        orders: [],
        tradeSetups,
        riskSnapshot,
        portfolioPolicy
      });
    }

    const [accountResult, positionsResult, ordersResult] = await Promise.allSettled([
      broker.getAccount(),
      broker.getPositions(),
      broker.getOrders({ status: "open", limit: 100 })
    ]);
    const errors = [accountResult, positionsResult, ordersResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || String(result.reason));

    return buildPositionMonitorSnapshot({
      brokerStatus: {
        ...brokerStatus,
        degraded: errors.length > 0,
        last_error: errors[0] || brokerStatus.last_error || null,
        errors
      },
      account: accountResult.status === "fulfilled" ? accountResult.value : null,
      positions: positionsResult.status === "fulfilled" && Array.isArray(positionsResult.value) ? positionsResult.value : [],
      orders: ordersResult.status === "fulfilled" && Array.isArray(ordersResult.value) ? ordersResult.value : [],
      tradeSetups,
      riskSnapshot,
      portfolioPolicy
    });
  }

  return {
    getSnapshot
  };
}
