import { clamp, round } from "../utils/helpers.js";

export const PORTFOLIO_POLICY_FIELDS = {
  portfolioWeeklyTargetPct: {
    env: "PORTFOLIO_WEEKLY_TARGET_PCT",
    type: "number",
    min: 0.0025,
    max: 0.2,
    digits: 4,
    step: 0.0025,
    label: "Weekly Target",
    help: "Target return used for progress tracking and sizing discipline. This is not a guaranteed return."
  },
  portfolioMaxWeeklyDrawdownPct: {
    env: "PORTFOLIO_MAX_WEEKLY_DRAWDOWN_PCT",
    type: "number",
    min: 0.005,
    max: 0.25,
    digits: 4,
    step: 0.0025,
    label: "Max Weekly Drawdown",
    help: "If visible weekly P/L falls past this level, new buys are blocked for review."
  },
  portfolioMaxPositions: {
    env: "PORTFOLIO_MAX_POSITIONS",
    type: "number",
    min: 1,
    max: 60,
    digits: 0,
    step: 1,
    label: "Max Positions",
    help: "Maximum number of simultaneous portfolio positions."
  },
  portfolioMaxNewPositionsPerCycle: {
    env: "PORTFOLIO_MAX_NEW_POSITIONS_PER_CYCLE",
    type: "number",
    min: 0,
    max: 20,
    digits: 0,
    step: 1,
    label: "New Positions / Cycle",
    help: "Maximum new tickers the Final Selector may promote in one cycle."
  },
  portfolioMaxPositionPct: {
    env: "PORTFOLIO_MAX_POSITION_PCT",
    type: "number",
    min: 0.0025,
    max: 0.25,
    digits: 4,
    step: 0.0025,
    label: "Max Single Position",
    help: "Hard cap on one ticker before risk review and order sizing."
  },
  portfolioMaxGrossExposurePct: {
    env: "PORTFOLIO_MAX_GROSS_EXPOSURE_PCT",
    type: "number",
    min: 0.01,
    max: 1,
    digits: 4,
    step: 0.01,
    label: "Max Gross Exposure",
    help: "Total long plus short exposure cap used by Risk and Final Selection."
  },
  portfolioMaxSectorExposurePct: {
    env: "PORTFOLIO_MAX_SECTOR_EXPOSURE_PCT",
    type: "number",
    min: 0.01,
    max: 0.75,
    digits: 4,
    step: 0.01,
    label: "Max Sector Exposure",
    help: "Maximum new-cycle exposure in one sector before candidates are pushed to review."
  },
  portfolioCashReservePct: {
    env: "PORTFOLIO_CASH_RESERVE_PCT",
    type: "number",
    min: 0,
    max: 0.8,
    digits: 4,
    step: 0.01,
    label: "Cash Reserve",
    help: "Minimum cash/buying-power reserve to preserve after new long exposure."
  },
  portfolioDefaultStopLossPct: {
    env: "PORTFOLIO_DEFAULT_STOP_LOSS_PCT",
    type: "number",
    min: 0.005,
    max: 0.35,
    digits: 4,
    step: 0.005,
    label: "Default Stop Loss",
    help: "Policy stop used for bracket planning and monitor alerts."
  },
  portfolioDefaultTakeProfitPct: {
    env: "PORTFOLIO_DEFAULT_TAKE_PROFIT_PCT",
    type: "number",
    min: 0.005,
    max: 0.6,
    digits: 4,
    step: 0.005,
    label: "Default Take Profit",
    help: "Policy target used for bracket planning and weekly goal discipline."
  },
  portfolioTrailingStopPct: {
    env: "PORTFOLIO_TRAILING_STOP_PCT",
    type: "number",
    min: 0,
    max: 0.25,
    digits: 4,
    step: 0.005,
    label: "Trailing Stop",
    help: "Monitor threshold for protecting gains after a position moves in favor."
  },
  portfolioMinHoldHours: {
    env: "PORTFOLIO_MIN_HOLD_HOURS",
    type: "number",
    min: 0,
    max: 240,
    digits: 0,
    step: 1,
    label: "Minimum Hold Hours",
    help: "Soft review window before reducing a fresh position."
  },
  portfolioAllowAdds: {
    env: "PORTFOLIO_ALLOW_ADDS",
    type: "boolean",
    label: "Allow Adds",
    help: "When disabled, Final Selection will not add to an existing ticker."
  },
  portfolioAllowReductions: {
    env: "PORTFOLIO_ALLOW_REDUCTIONS",
    type: "boolean",
    label: "Allow Reductions",
    help: "When enabled, the monitor can recommend reduce candidates after targets or risk alerts."
  }
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value) {
  return String(value).toLowerCase() !== "false";
}

export function normalizePortfolioPolicyValue(value, spec) {
  if (spec.type === "boolean") {
    return String(value).toLowerCase() === "true";
  }

  const normalized = clamp(toNumber(value, spec.min ?? 0), spec.min ?? -Infinity, spec.max ?? Infinity);
  return round(normalized, spec.digits ?? 4);
}

export function normalizePortfolioPolicyUpdates(nextSettings = {}) {
  const updates = {};

  for (const [key, spec] of Object.entries(PORTFOLIO_POLICY_FIELDS)) {
    if (!(key in nextSettings)) {
      continue;
    }
    updates[key] = normalizePortfolioPolicyValue(nextSettings[key], spec);
  }

  return updates;
}

export function portfolioPolicyFieldList() {
  return Object.entries(PORTFOLIO_POLICY_FIELDS).map(([key, spec]) => ({
    key,
    type: spec.type,
    label: spec.label,
    help: spec.help,
    min: spec.min ?? null,
    max: spec.max ?? null,
    step: spec.step ?? null
  }));
}

export function readPortfolioPolicy(config) {
  return {
    portfolioWeeklyTargetPct: toNumber(config.portfolioWeeklyTargetPct, 0.03),
    portfolioMaxWeeklyDrawdownPct: toNumber(config.portfolioMaxWeeklyDrawdownPct, 0.04),
    portfolioMaxPositions: Math.round(toNumber(config.portfolioMaxPositions, 10)),
    portfolioMaxNewPositionsPerCycle: Math.round(toNumber(config.portfolioMaxNewPositionsPerCycle, 3)),
    portfolioMaxPositionPct: toNumber(config.portfolioMaxPositionPct, 0.03),
    portfolioMaxGrossExposurePct: toNumber(config.portfolioMaxGrossExposurePct, 0.35),
    portfolioMaxSectorExposurePct: toNumber(config.portfolioMaxSectorExposurePct, 0.18),
    portfolioCashReservePct: toNumber(config.portfolioCashReservePct, 0.1),
    portfolioDefaultStopLossPct: toNumber(config.portfolioDefaultStopLossPct, 0.06),
    portfolioDefaultTakeProfitPct: toNumber(config.portfolioDefaultTakeProfitPct, 0.09),
    portfolioTrailingStopPct: toNumber(config.portfolioTrailingStopPct, 0.04),
    portfolioMinHoldHours: Math.round(toNumber(config.portfolioMinHoldHours, 4)),
    portfolioAllowAdds: Boolean(config.portfolioAllowAdds),
    portfolioAllowReductions: toBoolean(config.portfolioAllowReductions)
  };
}

export function portfolioPolicyEnvUpdates(updates = {}) {
  return Object.entries(updates).reduce((acc, [key, value]) => {
    const spec = PORTFOLIO_POLICY_FIELDS[key];
    if (!spec) {
      return acc;
    }
    acc[spec.env] = spec.type === "boolean" ? String(Boolean(value)) : value;
    return acc;
  }, {});
}

export function effectiveRiskLimits(config) {
  return {
    max_gross_exposure_pct: Math.min(
      toNumber(config.riskMaxGrossExposurePct, 0.35),
      toNumber(config.portfolioMaxGrossExposurePct, toNumber(config.riskMaxGrossExposurePct, 0.35))
    ),
    max_single_name_exposure_pct: Math.min(
      toNumber(config.riskMaxSingleNameExposurePct, 0.08),
      toNumber(config.portfolioMaxPositionPct, toNumber(config.riskMaxSingleNameExposurePct, 0.08))
    ),
    max_open_orders: Math.min(
      Math.round(toNumber(config.riskMaxOpenOrders, 10)),
      Math.max(1, Math.round(toNumber(config.portfolioMaxNewPositionsPerCycle, toNumber(config.riskMaxOpenOrders, 10))) + 2)
    ),
    block_when_runtime_constrained: Boolean(config.riskBlockWhenRuntimeConstrained)
  };
}

export function policyExitPlan(setup, policy) {
  const currentPrice = toNumber(setup?.current_price, 0);
  const action = setup?.action;

  if (!currentPrice || !["long", "short"].includes(action)) {
    return {
      stop_loss: setup?.stop_loss ?? null,
      take_profit: setup?.take_profit ?? null,
      source: "setup"
    };
  }

  const stopPct = clamp(toNumber(policy.portfolioDefaultStopLossPct, 0.06), 0.001, 0.8);
  const targetPct = clamp(toNumber(policy.portfolioDefaultTakeProfitPct, 0.09), 0.001, 2);
  const setupStop = toNumber(setup.stop_loss, null);
  const setupTarget = toNumber(setup.take_profit, null);

  if (action === "short") {
    const policyStop = currentPrice * (1 + stopPct);
    const policyTarget = currentPrice * (1 - targetPct);
    return {
      stop_loss: round(setupStop ? Math.min(setupStop, policyStop) : policyStop, 2),
      take_profit: round(setupTarget ? Math.max(setupTarget, policyTarget) : policyTarget, 2),
      source: "portfolio_policy"
    };
  }

  const policyStop = currentPrice * (1 - stopPct);
  const policyTarget = currentPrice * (1 + targetPct);
  return {
    stop_loss: round(setupStop ? Math.max(setupStop, policyStop) : policyStop, 2),
    take_profit: round(setupTarget ? Math.min(setupTarget, policyTarget) : policyTarget, 2),
    source: "portfolio_policy"
  };
}

export function buildPolicyAdjustedSetup(setup, policy, { finalAction = setup?.action, finalConviction = setup?.conviction } = {}) {
  const nextSetup = {
    ...setup,
    action: finalAction,
    conviction: round(toNumber(finalConviction, setup?.conviction || 0), 3),
    position_size_pct: round(
      clamp(toNumber(setup?.position_size_pct, 0), 0, toNumber(policy.portfolioMaxPositionPct, 0.03)),
      4
    )
  };
  const exits = policyExitPlan(nextSetup, policy);

  return {
    ...nextSetup,
    stop_loss: exits.stop_loss,
    take_profit: exits.take_profit,
    portfolio_policy: {
      max_position_pct: policy.portfolioMaxPositionPct,
      default_stop_loss_pct: policy.portfolioDefaultStopLossPct,
      default_take_profit_pct: policy.portfolioDefaultTakeProfitPct,
      trailing_stop_pct: policy.portfolioTrailingStopPct,
      exit_plan_source: exits.source
    }
  };
}

export function buildPortfolioPolicySnapshot({ config, riskSnapshot = null, positionMonitor = null } = {}) {
  const policy = readPortfolioPolicy(config);
  const account = positionMonitor?.account || {};
  const equity = Math.max(1, toNumber(account.portfolio_value || account.equity || riskSnapshot?.equity || config.executionDefaultEquityUsd, 1));
  const buyingPower = toNumber(account.buying_power || riskSnapshot?.buying_power, 0);
  const positions = positionMonitor?.positions || riskSnapshot?.positions || [];
  const openOrders = positionMonitor?.open_orders || [];
  const visiblePnl = positions.reduce((sum, position) => sum + toNumber(position.unrealized_pl), 0);
  const weeklyProgressPct = visiblePnl / equity;
  const cashReservePct = buyingPower / equity;
  const grossExposurePct = toNumber(riskSnapshot?.gross_exposure_pct, 0);
  const positionCount = positionMonitor?.position_count ?? positions.length;
  const openOrderCount = positionMonitor?.open_order_count ?? openOrders.length;
  const warnings = [];
  const hardBlocks = [];

  if (weeklyProgressPct <= -policy.portfolioMaxWeeklyDrawdownPct) {
    hardBlocks.push("weekly_drawdown_limit_reached");
  }
  if (grossExposurePct > policy.portfolioMaxGrossExposurePct) {
    hardBlocks.push("portfolio_gross_exposure_policy_exceeded");
  }
  if (positionCount >= policy.portfolioMaxPositions) {
    warnings.push("portfolio_position_capacity_full");
  }
  if (cashReservePct < policy.portfolioCashReservePct) {
    warnings.push("cash_reserve_below_policy");
  }

  return {
    as_of: new Date().toISOString(),
    status: hardBlocks.length ? "blocked" : warnings.length ? "caution" : "ok",
    summary: hardBlocks.length
      ? "Portfolio policy is blocking new selections until the hard limit is cleared."
      : warnings.length
        ? "Portfolio policy allows review, but at least one rule is close to its limit."
        : "Portfolio policy is clear for normal supervised selection.",
    settings: policy,
    fields: portfolioPolicyFieldList(),
    usage: {
      equity: round(equity, 2),
      buying_power: round(buyingPower, 2),
      cash_reserve_pct: round(cashReservePct, 4),
      weekly_progress_pct: round(weeklyProgressPct, 4),
      visible_unrealized_pl: round(visiblePnl, 2),
      gross_exposure_pct: round(grossExposurePct, 4),
      position_count: positionCount,
      open_order_count: openOrderCount,
      new_position_slots: Math.max(0, policy.portfolioMaxPositions - positionCount - openOrderCount)
    },
    guardrails: [
      {
        key: "weekly_target",
        label: "Weekly target",
        value: round(weeklyProgressPct, 4),
        limit: policy.portfolioWeeklyTargetPct,
        pass: true
      },
      {
        key: "weekly_drawdown",
        label: "Weekly drawdown",
        value: round(weeklyProgressPct, 4),
        limit: -policy.portfolioMaxWeeklyDrawdownPct,
        pass: weeklyProgressPct > -policy.portfolioMaxWeeklyDrawdownPct
      },
      {
        key: "position_capacity",
        label: "Position capacity",
        value: positionCount,
        limit: policy.portfolioMaxPositions,
        pass: positionCount < policy.portfolioMaxPositions
      },
      {
        key: "cash_reserve",
        label: "Cash reserve",
        value: round(cashReservePct, 4),
        limit: policy.portfolioCashReservePct,
        pass: cashReservePct >= policy.portfolioCashReservePct
      },
      {
        key: "gross_exposure",
        label: "Gross exposure",
        value: round(grossExposurePct, 4),
        limit: policy.portfolioMaxGrossExposurePct,
        pass: grossExposurePct <= policy.portfolioMaxGrossExposurePct
      }
    ],
    warnings,
    hard_blocks: hardBlocks
  };
}
