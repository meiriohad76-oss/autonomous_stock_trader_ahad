import { makeId } from "../utils/helpers.js";
import { createAlpacaClient } from "./alpaca.js";
import { runAllGuards } from "./risk-guard.js";

const POSITION_SIZE_PCT = { full: 0.20, half: 0.10, quarter: 0.05, starter: 0.025 };

function dollarSize(positionSizeLabel, accountEquity, maxPct) {
  const pct = POSITION_SIZE_PCT[positionSizeLabel] ?? 0.025;
  const raw = pct * accountEquity;
  return Math.min(raw, maxPct * accountEquity);
}

function isNewEtDay(lastResetAt) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  const today = fmt.format(new Date());
  const last = lastResetAt ? fmt.format(new Date(lastResetAt)) : null;
  return today !== last;
}

function expireStaleApprovals(store) {
  const now = Date.now();
  for (const [id, approval] of store.pendingApprovals) {
    if (approval.status === "pending" && new Date(approval.expires_at).getTime() <= now) {
      approval.status = "expired";
      store.executionLog.unshift({ ...approval, decided_at: new Date().toISOString() });
      store.bus.emit("event", { type: "trade_expired", approval_id: id, ticker: approval.ticker });
    }
  }
}

async function syncFromAlpaca(alpaca, store, config) {
  let account, alpacaPositions, alpacaOrders;
  try {
    [account, alpacaPositions, alpacaOrders] = await Promise.all([
      alpaca.getAccount(),
      alpaca.getPositions(),
      alpaca.getOrders("all")
    ]);
  } catch (err) {
    console.error("[execution] Alpaca sync failed:", err.message);
    return;
  }

  const now = new Date().toISOString();
  const equity = Number(account.equity) || 0;

  if (isNewEtDay(store.executionState.dailyPnlResetAt)) {
    store.executionState.dailyPnl = 0;
    store.executionState.dailyPnlResetAt = now;
  }

  store.executionState.accountEquity = equity;
  if (equity > store.executionState.highWaterMark) {
    store.executionState.highWaterMark = equity;
  }
  store.executionState.lastSyncAt = now;

  store.positions = new Map(
    alpacaPositions.map((p) => [
      p.symbol,
      {
        ticker: p.symbol,
        side: p.side,
        qty: Number(p.qty),
        entry_price: Number(p.avg_entry_price),
        current_price: Number(p.current_price),
        unrealized_pnl: Number(p.unrealized_pl),
        alpaca_position_id: p.asset_id,
        opened_at: now
      }
    ])
  );

  for (const o of alpacaOrders) {
    if (store.orders.has(o.id)) {
      const existing = store.orders.get(o.id);
      existing.status = o.status;
      existing.filled_at = o.filled_at || null;
      existing.closed_at = o.canceled_at || o.expired_at || null;
    }
  }

  const todayPnl = alpacaPositions.reduce((sum, p) => sum + Number(p.unrealized_pl || 0), 0);
  store.executionState.dailyPnl = todayPnl;

  store.bus.emit("event", {
    type: "execution_state_update",
    executionState: { ...store.executionState },
    position_count: store.positions.size
  });
}

export function createExecutionAgent(app) {
  const { config, store } = app;
  const alpaca = createAlpacaClient(config);
  let debounceTimer = null;
  let syncTimer = null;
  let expiryTimer = null;
  let running = false;

  function evaluateSetups() {
    if (!config.executionEnabled || store.executionState.killSwitch) return;

    const accountEquity = store.executionState.accountEquity > 0
      ? store.executionState.accountEquity
      : config.executionAccountSizeUsd;

    for (const setup of store.tradeSetups) {
      if (setup.action !== "long" && setup.action !== "short") continue;
      if (setup.conviction < config.executionConvictionThreshold) continue;

      const dollar = dollarSize(setup.position_size, accountEquity, config.executionMaxPositionPct);
      const guardResult = runAllGuards(setup.ticker, dollar, store, config);
      if (!guardResult.allowed) {
        store.bus.emit("event", {
          type: "execution_guard_rejected",
          ticker: setup.ticker,
          reason: guardResult.reason
        });
        continue;
      }

      const entryPrice = setup.entry_price || setup.guidance?.entry;
      if (!entryPrice || entryPrice <= 0) continue;
      const shares = Math.floor(dollar / entryPrice);
      if (shares <= 0) continue;

      const approvalId = makeId();
      const expiresAt = new Date(Date.now() + config.executionApprovalTimeoutMs).toISOString();
      const approval = {
        approval_id: approvalId,
        ticker: setup.ticker,
        action: setup.action,
        conviction: setup.conviction,
        thesis: setup.thesis || "",
        risk_flags: setup.risk_flags || [],
        entry: entryPrice,
        stop: setup.stop_price || setup.guidance?.stop,
        target: setup.target_price || setup.guidance?.target,
        dollar_size: dollar,
        shares,
        position_size: setup.position_size,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        status: "pending"
      };

      store.pendingApprovals.set(approvalId, approval);
      store.bus.emit("event", {
        type: "trade_approval_request",
        approval_id: approvalId,
        ticker: approval.ticker,
        action: approval.action,
        conviction: approval.conviction,
        thesis: approval.thesis,
        risk_flags: approval.risk_flags,
        entry: approval.entry,
        stop: approval.stop,
        target: approval.target,
        dollar_size: approval.dollar_size,
        shares: approval.shares,
        expires_at: expiresAt
      });
    }
  }

  function scheduledEvaluate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try { evaluateSetups(); } catch (err) { console.error("[execution] evaluate error:", err.message); }
    }, 500);
  }

  return {
    async start() {
      if (running) return;
      running = true;
      store.executionState.enabled = config.executionEnabled;

      store.bus.on("event", (ev) => {
        if (ev.type === "trade_setup_refresh") scheduledEvaluate();
      });

      if (config.executionEnabled) {
        await syncFromAlpaca(alpaca, store, config).catch(() => {});
        syncTimer = setInterval(() => {
          syncFromAlpaca(alpaca, store, config).catch(() => {});
        }, config.executionSyncMs);
      }

      expiryTimer = setInterval(() => {
        expireStaleApprovals(store);
      }, 60000);
    },

    stop() {
      running = false;
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    },

    async approve(approvalId) {
      const approval = store.pendingApprovals.get(approvalId);
      if (!approval) throw new Error(`Approval ${approvalId} not found`);
      if (approval.status !== "pending") throw new Error(`Approval ${approvalId} is ${approval.status}`);
      if (new Date(approval.expires_at).getTime() <= Date.now()) {
        approval.status = "expired";
        throw new Error(`Approval ${approvalId} has expired`);
      }

      const orderParams = {
        symbol: approval.ticker,
        qty: String(approval.shares),
        side: approval.action === "long" ? "buy" : "sell",
        type: "limit",
        time_in_force: "day",
        limit_price: String(approval.entry.toFixed(2)),
        order_class: "bracket",
        stop_loss: { stop_price: String(approval.stop.toFixed(2)) },
        take_profit: { limit_price: String(approval.target.toFixed(2)) }
      };

      let alpacaOrder;
      try {
        alpacaOrder = await alpaca.placeOrder(orderParams);
      } catch (err) {
        throw new Error(`Alpaca order failed: ${err.message}`);
      }

      approval.status = "approved";
      const order = {
        order_id: alpacaOrder.id,
        approval_id: approvalId,
        ticker: approval.ticker,
        side: orderParams.side,
        qty: approval.shares,
        status: alpacaOrder.status,
        entry_price: approval.entry,
        stop_price: approval.stop,
        target_price: approval.target,
        dollar_size: approval.dollar_size,
        placed_at: new Date().toISOString(),
        filled_at: null,
        closed_at: null
      };

      store.orders.set(alpacaOrder.id, order);
      store.executionLog.unshift({ ...approval, order_id: alpacaOrder.id, decided_at: new Date().toISOString() });

      store.bus.emit("event", {
        type: "trade_approved",
        approval_id: approvalId,
        order_id: alpacaOrder.id,
        ticker: approval.ticker,
        action: approval.action,
        shares: approval.shares,
        dollar_size: approval.dollar_size
      });

      return { approval, order };
    },

    reject(approvalId, reason = "") {
      const approval = store.pendingApprovals.get(approvalId);
      if (!approval) throw new Error(`Approval ${approvalId} not found`);
      if (approval.status !== "pending") throw new Error(`Approval ${approvalId} is ${approval.status}`);

      approval.status = "rejected";
      approval.reject_reason = reason;
      store.executionLog.unshift({ ...approval, decided_at: new Date().toISOString() });

      store.bus.emit("event", {
        type: "trade_rejected",
        approval_id: approvalId,
        ticker: approval.ticker,
        reason
      });

      return { approval };
    },

    setKillSwitch(enabled, reason = "") {
      store.executionState.killSwitch = enabled;
      store.executionState.killSwitchReason = enabled ? (reason || "manual halt") : null;
      store.bus.emit("event", {
        type: "execution_state_update",
        executionState: { ...store.executionState },
        position_count: store.positions.size
      });
    },

    async sync() {
      await syncFromAlpaca(alpaca, store, config);
    }
  };
}
