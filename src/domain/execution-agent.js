import { clamp, normalizeTickerSymbol, round } from "../utils/helpers.js";

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function accountNumber(account, key, fallback = null) {
  return numberOrNull(account?.[key]) ?? fallback;
}

function normalizeTicker(value) {
  return normalizeTickerSymbol(value);
}

function orderSideForAction(action) {
  if (action === "long") {
    return "buy";
  }
  if (action === "short") {
    return "sell";
  }
  return null;
}

function block(reason, details = {}) {
  return {
    allowed: false,
    blocked_reason: reason,
    order: null,
    ...details
  };
}

function effectiveExecutionMinConviction(config) {
  return Number(config.portfolioExecutionMinConviction ?? config.executionMinConviction ?? 0.62);
}

function buildClientOrderId(ticker, action, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `ahad-${ticker}-${action}-${stamp}`.toLowerCase().slice(0, 48);
}

function bracketLegs(setup, action) {
  const stopLoss = numberOrNull(setup.stop_loss);
  const takeProfit = numberOrNull(setup.take_profit);

  if (!stopLoss || !takeProfit) {
    return null;
  }

  if (action === "long" && takeProfit <= stopLoss) {
    return null;
  }

  if (action === "short" && takeProfit >= stopLoss) {
    return null;
  }

  return {
    order_class: "bracket",
    take_profit: {
      limit_price: String(round(takeProfit, 2))
    },
    stop_loss: {
      stop_price: String(round(stopLoss, 2))
    }
  };
}

export function summarizeExecutionConfig(config) {
  const minConviction = effectiveExecutionMinConviction(config);
  return {
    provider: config.brokerProvider,
    adapter: config.brokerAdapter,
    mode: config.brokerTradingMode,
    submit_enabled: Boolean(config.brokerSubmitEnabled),
    min_conviction: minConviction,
    min_notional_usd: config.executionMinNotionalUsd,
    max_order_notional_usd: config.executionMaxOrderNotionalUsd,
    max_position_pct: Math.min(config.executionMaxPositionPct, config.portfolioMaxPositionPct || config.executionMaxPositionPct),
    portfolio_policy: {
      max_positions: config.portfolioMaxPositions,
      max_new_positions_per_cycle: config.portfolioMaxNewPositionsPerCycle,
      cash_reserve_pct: config.portfolioCashReservePct,
      default_stop_loss_pct: config.portfolioDefaultStopLossPct,
      default_take_profit_pct: config.portfolioDefaultTakeProfitPct
    },
    allow_shorts: Boolean(config.executionAllowShorts),
    use_bracket_orders: Boolean(config.executionUseBracketOrders),
    order_type: config.executionDefaultOrderType,
    time_in_force: config.executionDefaultTimeInForce
  };
}

export function buildExecutionIntent(setup, account, config, { now = new Date() } = {}) {
  if (!setup) {
    return block("missing_trade_setup");
  }

  const rawTicker = String(setup.ticker ?? "").trim();
  const ticker = normalizeTicker(rawTicker);
  const action = setup.action;
  const side = orderSideForAction(action);
  const conviction = numberOrNull(setup.conviction) ?? 0;
  const currentPrice = numberOrNull(setup.current_price);
  const minConviction = effectiveExecutionMinConviction(config);

  if (!rawTicker) {
    return block("missing_ticker", { setup });
  }

  if (!ticker) {
    return block("invalid_ticker", { setup });
  }

  if (!side) {
    return block("setup_action_is_not_tradable", { ticker, action, setup });
  }

  if (action === "short" && !config.executionAllowShorts) {
    return block("short_trading_disabled", { ticker, action, setup });
  }

  if (conviction < minConviction) {
    return block("conviction_below_execution_minimum", {
      ticker,
      action,
      conviction,
      required_conviction: minConviction,
      setup
    });
  }

  if (setup.evidence_breadth?.breadth_gate_pass === false) {
    return block("signal_breadth_below_execution_minimum", {
      ticker,
      action,
      evidence_breadth: setup.evidence_breadth,
      setup
    });
  }

  if (!currentPrice || currentPrice <= 0) {
    return block("missing_current_price", { ticker, action, setup });
  }

  const equity = accountNumber(account, "equity", config.executionDefaultEquityUsd);
  const buyingPower = accountNumber(account, "buying_power", equity);
  const setupPositionPct = clamp(
    numberOrNull(setup.position_size_pct) ?? 0,
    0,
    Math.min(config.executionMaxPositionPct, config.portfolioMaxPositionPct || config.executionMaxPositionPct)
  );
  const targetNotional = equity * setupPositionPct;
  const cappedNotional = Math.min(
    targetNotional,
    config.executionMaxOrderNotionalUsd,
    action === "long" ? buyingPower : config.executionMaxOrderNotionalUsd
  );
  const targetOrderNotional = round(Math.max(0, cappedNotional), 2);

  if (targetOrderNotional < config.executionMinNotionalUsd) {
    return block("notional_below_execution_minimum", {
      ticker,
      action,
      notional: targetOrderNotional,
      required_notional: config.executionMinNotionalUsd,
      setup
    });
  }

  const quantity = config.executionUseBracketOrders
    ? Math.floor(targetOrderNotional / currentPrice)
    : round(targetOrderNotional / currentPrice, 6);
  if (!quantity || quantity <= 0) {
    return block("quantity_rounds_to_zero", { ticker, action, notional: targetOrderNotional, current_price: currentPrice, setup });
  }

  const notional = round(quantity * currentPrice, 2);
  if (notional < config.executionMinNotionalUsd) {
    return block("whole_share_notional_below_execution_minimum", {
      ticker,
      action,
      notional,
      target_notional: targetOrderNotional,
      required_notional: config.executionMinNotionalUsd,
      current_price: currentPrice,
      setup
    });
  }

  const baseOrder = {
    symbol: ticker,
    side,
    type: config.executionDefaultOrderType,
    time_in_force: config.executionDefaultTimeInForce,
    qty: String(quantity),
    client_order_id: buildClientOrderId(ticker, action, now)
  };
  const bracket = config.executionUseBracketOrders ? bracketLegs(setup, action) : null;
  const order = bracket ? { ...baseOrder, ...bracket } : baseOrder;

  return {
    allowed: true,
    blocked_reason: null,
    ticker,
    action,
    side,
    estimated_notional_usd: notional,
    estimated_quantity: quantity,
    current_price: currentPrice,
    equity_basis_usd: round(equity, 2),
    buying_power_basis_usd: round(buyingPower, 2),
    position_size_pct: round(setupPositionPct, 4),
    uses_live_account: Boolean(account),
    order,
    setup: {
      ticker,
      action,
      setup_label: setup.setup_label,
      conviction,
      timeframe: setup.timeframe,
      summary: setup.summary,
      thesis: setup.thesis || [],
      risk_flags: setup.risk_flags || [],
      entry_zone: setup.entry_zone,
      stop_loss: setup.stop_loss,
      take_profit: setup.take_profit,
      macro_regime: setup.macro_regime || null,
      runtime_reliability: setup.runtime_reliability || null,
      evidence_quality: setup.evidence_quality || null
    }
  };
}

export function createExecutionAgent({ config, broker, getTradeSetup, evaluateRisk = null }) {
  async function accountIfAvailable() {
    const status = broker.getStatus();
    if (!status.configured) {
      return null;
    }
    return broker.getAccount();
  }

  function getStatus() {
    const brokerStatus = broker.getStatus();
    const submitRequires = [
      "valid Alpaca credentials",
      "BROKER_SUBMIT_ENABLED=true",
      "paper mode or explicit ALPACA_ALLOW_LIVE_TRADING=true",
      "confirmation phrase: paper-trade or live-trade",
      "trade setup action long/short with enough conviction"
    ];

    if (config.brokerAdapter === "mcp") {
      submitRequires[2] = "MCP paper mode with ALPACA_PAPER_TRADE=true";
      submitRequires[3] = "confirmation phrase: paper-trade";
    }

    return {
      as_of: new Date().toISOString(),
      status: brokerStatus.ready_for_order_submission ? "ready" : brokerStatus.configured ? "guarded" : "not_configured",
      broker: brokerStatus,
      safety: summarizeExecutionConfig(config),
      order_submission_policy: {
        default: "preview_only",
        submit_requires: submitRequires
      }
    };
  }

  async function previewOrder({ ticker, window = "1h", setup = null } = {}) {
    const tradeSetup = setup || getTradeSetup(normalizeTicker(ticker), { window });
    const account = await accountIfAvailable();
    const intent = buildExecutionIntent(tradeSetup, account, config);
    const risk = evaluateRisk && intent.allowed ? await evaluateRisk(intent) : null;
    const brokerStatus = broker.getStatus();

    return {
      ok: true,
      dry_run: true,
      broker_ready: brokerStatus.ready_for_order_submission,
      broker: brokerStatus,
      execution_allowed: Boolean(intent.allowed && (!risk || risk.allowed)),
      intent,
      risk
    };
  }

  async function submitOrder({ ticker, window = "1h", setup = null, confirm = "" } = {}) {
    const status = broker.getStatus();
    const requiredConfirm = status.mode === "live" ? "live-trade" : "paper-trade";

    if (!config.brokerSubmitEnabled) {
      throw new Error("Order submission is disabled. Set BROKER_SUBMIT_ENABLED=true after paper-trading setup is verified.");
    }

    if (confirm !== requiredConfirm) {
      throw new Error(`Order submission requires confirm="${requiredConfirm}".`);
    }

    if (!status.ready_for_order_submission) {
      throw new Error(status.blocked_reason || "Broker is not ready for order submission.");
    }

    const preview = await previewOrder({ ticker, window, setup });
    if (!preview.intent.allowed) {
      throw new Error(`Execution blocked: ${preview.intent.blocked_reason}`);
    }
    if (preview.risk && !preview.risk.allowed) {
      throw new Error(`Risk blocked execution: ${preview.risk.blocked_reason}`);
    }

    const submittedOrder = await broker.submitOrder(preview.intent.order);
    return {
      ok: true,
      submitted: true,
      broker: broker.getStatus(),
      intent: preview.intent,
      order: submittedOrder
    };
  }

  return {
    getStatus,
    previewOrder,
    submitOrder
  };
}
