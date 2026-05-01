export function checkKillSwitch(executionState) {
  if (executionState.killSwitch) {
    return { allowed: false, reason: `kill_switch_active: ${executionState.killSwitchReason || "manual halt"}` };
  }
  return { allowed: true };
}

export function checkDailyLoss(executionState, config) {
  if (executionState.dailyPnl <= config.executionDailyLossLimitUsd) {
    return { allowed: false, reason: `daily_loss_limit_hit: $${executionState.dailyPnl.toFixed(2)} <= $${config.executionDailyLossLimitUsd}` };
  }
  return { allowed: true };
}

export function checkDrawdown(executionState, config) {
  const hwm = executionState.highWaterMark;
  if (hwm > 0) {
    const drawdownPct = (hwm - executionState.accountEquity) / hwm;
    if (drawdownPct >= config.executionMaxDrawdownPct) {
      return { allowed: false, reason: `drawdown_limit_hit: ${(drawdownPct * 100).toFixed(1)}% >= ${(config.executionMaxDrawdownPct * 100).toFixed(0)}%` };
    }
  }
  return { allowed: true };
}

export function checkMaxPositions(store, config) {
  if (store.positions.size >= config.executionMaxPositions) {
    return { allowed: false, reason: `max_positions_reached: ${store.positions.size}/${config.executionMaxPositions}` };
  }
  return { allowed: true };
}

export function checkMaxPositionSize(dollarSize, executionState, config) {
  const maxDollar = executionState.accountEquity > 0
    ? executionState.accountEquity * config.executionMaxPositionPct
    : config.executionAccountSizeUsd * config.executionMaxPositionPct;
  if (dollarSize > maxDollar) {
    return { allowed: false, reason: `position_too_large: $${dollarSize.toFixed(0)} > $${maxDollar.toFixed(0)}` };
  }
  return { allowed: true };
}

export function checkDuplicate(ticker, store) {
  if (store.positions.has(ticker)) {
    return { allowed: false, reason: `duplicate_position: ${ticker} already open` };
  }
  for (const [, approval] of store.pendingApprovals) {
    if (approval.ticker === ticker && approval.status === "pending") {
      return { allowed: false, reason: `duplicate_pending: ${ticker} already awaiting approval` };
    }
  }
  return { allowed: true };
}

export function runAllGuards(ticker, dollarSize, store, config) {
  const es = store.executionState;
  const checks = [
    checkKillSwitch(es),
    checkDailyLoss(es, config),
    checkDrawdown(es, config),
    checkMaxPositions(store, config),
    checkMaxPositionSize(dollarSize, es, config),
    checkDuplicate(ticker, store)
  ];
  for (const result of checks) {
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
