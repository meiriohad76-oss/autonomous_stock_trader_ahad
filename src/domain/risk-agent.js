import { clamp, round } from "../utils/helpers.js";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePosition(position) {
  const marketValue = Math.abs(toNumber(position.market_value));
  const symbol = String(position.symbol || "").toUpperCase();
  const side = String(position.side || (toNumber(position.qty) < 0 ? "short" : "long")).toLowerCase();

  return {
    symbol,
    side,
    qty: toNumber(position.qty),
    market_value: marketValue,
    unrealized_pl: toNumber(position.unrealized_pl),
    unrealized_plpc: toNumber(position.unrealized_plpc)
  };
}

function buildEmptyAccount(config) {
  return {
    equity: config.executionDefaultEquityUsd,
    buying_power: config.executionDefaultEquityUsd,
    source: "configured_default"
  };
}

export function summarizeRiskConfig(config) {
  return {
    max_gross_exposure_pct: config.riskMaxGrossExposurePct,
    max_single_name_exposure_pct: config.riskMaxSingleNameExposurePct,
    max_open_orders: config.riskMaxOpenOrders,
    block_when_runtime_constrained: Boolean(config.riskBlockWhenRuntimeConstrained),
    execution_max_order_notional_usd: config.executionMaxOrderNotionalUsd,
    execution_max_position_pct: config.executionMaxPositionPct
  };
}

export function buildPortfolioRiskSnapshot({
  account = null,
  positions = [],
  orders = [],
  runtimeReliability = null,
  config
}) {
  const effectiveAccount = account || buildEmptyAccount(config);
  const equity = Math.max(1, toNumber(effectiveAccount.equity, config.executionDefaultEquityUsd));
  const normalizedPositions = (positions || []).map(normalizePosition).filter((position) => position.symbol);
  const longExposure = normalizedPositions
    .filter((position) => position.side !== "short")
    .reduce((sum, position) => sum + position.market_value, 0);
  const shortExposure = normalizedPositions
    .filter((position) => position.side === "short")
    .reduce((sum, position) => sum + position.market_value, 0);
  const grossExposure = longExposure + shortExposure;
  const largestPosition = normalizedPositions
    .map((position) => ({
      symbol: position.symbol,
      side: position.side,
      market_value: round(position.market_value, 2),
      exposure_pct: round(position.market_value / equity, 4),
      unrealized_plpc: round(position.unrealized_plpc, 4)
    }))
    .sort((a, b) => b.exposure_pct - a.exposure_pct)[0] || null;
  const openOrders = Array.isArray(orders) ? orders.length : 0;
  const grossExposurePct = grossExposure / equity;
  const singleNamePct = largestPosition?.exposure_pct || 0;
  const constrainedRuntime = Boolean(runtimeReliability?.pressure?.isConstrained);
  const warnings = [];
  const hardBlocks = [];

  if (grossExposurePct >= config.riskMaxGrossExposurePct * 0.85) {
    warnings.push("gross exposure is near configured maximum");
  }
  if (singleNamePct >= config.riskMaxSingleNameExposurePct * 0.85) {
    warnings.push("largest single-name exposure is near configured maximum");
  }
  if (openOrders >= Math.max(1, config.riskMaxOpenOrders - 2)) {
    warnings.push("open order count is near configured maximum");
  }
  if (grossExposurePct > config.riskMaxGrossExposurePct) {
    hardBlocks.push("gross_exposure_limit_exceeded");
  }
  if (singleNamePct > config.riskMaxSingleNameExposurePct) {
    hardBlocks.push("single_name_limit_exceeded");
  }
  if (openOrders > config.riskMaxOpenOrders) {
    hardBlocks.push("open_order_limit_exceeded");
  }
  if (config.riskBlockWhenRuntimeConstrained && constrainedRuntime) {
    hardBlocks.push("runtime_constrained");
  }

  return {
    as_of: new Date().toISOString(),
    status: hardBlocks.length ? "blocked" : warnings.length ? "caution" : "ok",
    account_source: account ? "broker" : "configured_default",
    equity: round(equity, 2),
    buying_power: round(toNumber(effectiveAccount.buying_power, equity), 2),
    gross_exposure_usd: round(grossExposure, 2),
    long_exposure_usd: round(longExposure, 2),
    short_exposure_usd: round(shortExposure, 2),
    gross_exposure_pct: round(grossExposurePct, 4),
    largest_position: largestPosition,
    open_orders: openOrders,
    runtime_constrained: constrainedRuntime,
    warnings,
    hard_blocks: hardBlocks,
    limits: summarizeRiskConfig(config),
    positions: normalizedPositions
      .map((position) => ({
        ...position,
        market_value: round(position.market_value, 2),
        exposure_pct: round(position.market_value / equity, 4)
      }))
      .sort((a, b) => b.exposure_pct - a.exposure_pct)
  };
}

export function evaluateExecutionRisk(intent, portfolioRisk, config) {
  if (!intent?.allowed) {
    return {
      allowed: false,
      blocked_reason: intent?.blocked_reason || "execution_intent_not_allowed",
      checks: [],
      portfolio: portfolioRisk
    };
  }

  const checks = [];
  const proposedNotional = toNumber(intent.estimated_notional_usd);
  const currentGrossPct = toNumber(portfolioRisk.gross_exposure_pct);
  const proposedGrossPct = currentGrossPct + proposedNotional / Math.max(1, portfolioRisk.equity);
  const existingTickerExposure =
    portfolioRisk.positions.find((position) => position.symbol === intent.ticker)?.exposure_pct || 0;
  const proposedSingleNamePct = existingTickerExposure + proposedNotional / Math.max(1, portfolioRisk.equity);
  const blockedReasons = [];

  checks.push({
    key: "gross_exposure",
    value: round(proposedGrossPct, 4),
    limit: config.riskMaxGrossExposurePct,
    pass: proposedGrossPct <= config.riskMaxGrossExposurePct
  });
  checks.push({
    key: "single_name_exposure",
    value: round(proposedSingleNamePct, 4),
    limit: config.riskMaxSingleNameExposurePct,
    pass: proposedSingleNamePct <= config.riskMaxSingleNameExposurePct
  });
  checks.push({
    key: "open_orders",
    value: portfolioRisk.open_orders,
    limit: config.riskMaxOpenOrders,
    pass: portfolioRisk.open_orders < config.riskMaxOpenOrders
  });
  checks.push({
    key: "runtime_constraint",
    value: portfolioRisk.runtime_constrained,
    limit: config.riskBlockWhenRuntimeConstrained,
    pass: !(config.riskBlockWhenRuntimeConstrained && portfolioRisk.runtime_constrained)
  });

  checks.filter((check) => !check.pass).forEach((check) => blockedReasons.push(`${check.key}_failed`));

  return {
    allowed: blockedReasons.length === 0,
    blocked_reason: blockedReasons[0] || null,
    checks,
    proposed: {
      ticker: intent.ticker,
      action: intent.action,
      side: intent.side,
      notional_usd: round(proposedNotional, 2),
      gross_exposure_pct_after: round(clamp(proposedGrossPct, 0, 10), 4),
      single_name_exposure_pct_after: round(clamp(proposedSingleNamePct, 0, 10), 4)
    },
    portfolio: portfolioRisk
  };
}

export function createRiskAgent({ config, broker, getRuntimeReliability }) {
  async function readBrokerRiskInputs() {
    const status = broker.getStatus();
    if (!status.configured) {
      return {
        account: null,
        positions: [],
        orders: [],
        broker_status: status
      };
    }

    const [account, positions, orders] = await Promise.all([
      broker.getAccount(),
      broker.getPositions(),
      broker.getOrders({ status: "open", limit: config.riskMaxOpenOrders + 10 })
    ]);

    return {
      account,
      positions: Array.isArray(positions) ? positions : [],
      orders: Array.isArray(orders) ? orders : [],
      broker_status: status
    };
  }

  async function getSnapshot() {
    const inputs = await readBrokerRiskInputs();
    const portfolio = buildPortfolioRiskSnapshot({
      account: inputs.account,
      positions: inputs.positions,
      orders: inputs.orders,
      runtimeReliability: getRuntimeReliability ? getRuntimeReliability() : null,
      config
    });

    return {
      ...portfolio,
      broker: inputs.broker_status
    };
  }

  async function evaluateIntent(intent) {
    const portfolio = await getSnapshot();
    return evaluateExecutionRisk(intent, portfolio, config);
  }

  return {
    getSnapshot,
    evaluateIntent
  };
}
