# Execution Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Alpaca paper-trading execution layer with human-in-the-loop approval, 6 risk guards, and a Trading panel to the dashboard.

**Architecture:** Three new domain modules (`alpaca.js`, `risk-guard.js`, `execution.js`) follow the exact same pattern as existing collectors. The execution agent listens to `store.bus`, creates pending approvals pushed via SSE, and places bracket orders only after the user approves in the dashboard. All state persists via the existing `runtime_state` SQLite table.

**Tech Stack:** Node.js ESM, node:fetch, Alpaca REST API v2, existing store/bus/SSE/persistence infrastructure. No new npm packages.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/config.js` | Modify | 12 new Alpaca + execution config keys |
| `src/domain/store.js` | Modify | 5 new fields: pendingApprovals, positions, orders, executionState, executionLog |
| `src/domain/persistence.js` | Modify | Save/load 4 execution runtime_state rows |
| `src/domain/alpaca.js` | Create | Thin Alpaca REST client, 5 methods |
| `src/domain/risk-guard.js` | Create | 6 pure guard functions + runAllGuards |
| `src/domain/execution.js` | Create | Execution agent: evaluate setups, manage approvals, sync positions |
| `src/app.js` | Modify | Import + wire execution agent, expose 6 methods |
| `src/http/router.js` | Modify | 8 new execution endpoints |
| `src/public/index.html` | Modify | Trading nav + account bar + approval card + Trading panel |
| `src/public/app.js` | Modify | SSE handlers + Trading panel state + APPROVE/REJECT logic |
| `src/public/styles.css` | Modify | Account bar + approval card + Trading panel styles |

---

## Task 1: Config extensions

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Add 12 new config keys**

After `tradePrintsBlockTradeMinNotionalUsd: ...` and before `secRequestTimeoutMs`, insert:

```js
  alpacaApiKey: process.env.ALPACA_API_KEY || "",
  alpacaApiSecret: process.env.ALPACA_API_SECRET || "",
  alpacaPaper: String(process.env.ALPACA_PAPER || "true").toLowerCase() !== "false",
  executionEnabled: String(process.env.EXECUTION_ENABLED || "false").toLowerCase() !== "false",
  executionConvictionThreshold: Number(process.env.EXECUTION_CONVICTION_THRESHOLD || 0.65),
  executionDailyLossLimitUsd: Number(process.env.EXECUTION_DAILY_LOSS_LIMIT_USD || -2000),
  executionMaxDrawdownPct: Number(process.env.EXECUTION_MAX_DRAWDOWN_PCT || 0.10),
  executionMaxPositions: Number(process.env.EXECUTION_MAX_POSITIONS || 10),
  executionMaxPositionPct: Number(process.env.EXECUTION_MAX_POSITION_PCT || 0.20),
  executionAccountSizeUsd: Number(process.env.EXECUTION_ACCOUNT_SIZE_USD || 100000),
  executionSyncMs: Number(process.env.EXECUTION_SYNC_MS || 180000),
  executionApprovalTimeoutMs: Number(process.env.EXECUTION_APPROVAL_TIMEOUT_MS || 600000),
```

- [ ] **Step 2: Add env vars to .env**

Append to `.env`:

```
ALPACA_API_KEY=
ALPACA_API_SECRET=
ALPACA_PAPER=true
EXECUTION_ENABLED=false
EXECUTION_CONVICTION_THRESHOLD=0.65
EXECUTION_DAILY_LOSS_LIMIT_USD=-2000
EXECUTION_MAX_DRAWDOWN_PCT=0.10
EXECUTION_MAX_POSITIONS=10
EXECUTION_MAX_POSITION_PCT=0.20
EXECUTION_ACCOUNT_SIZE_USD=100000
EXECUTION_SYNC_MS=180000
EXECUTION_APPROVAL_TIMEOUT_MS=600000
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module <<'EOF'
import { config } from "./src/config.js";
console.log("executionEnabled:", config.executionEnabled);
console.log("executionConvictionThreshold:", config.executionConvictionThreshold);
console.log("alpacaPaper:", config.alpacaPaper);
EOF
```

Expected:
```
executionEnabled: false
executionConvictionThreshold: 0.65
alpacaPaper: true
```

- [ ] **Step 4: Commit**

```bash
git add src/config.js .env
git commit -m "feat(config): add Alpaca and execution layer config keys"
```

---

## Task 2: Store additions

**Files:**
- Modify: `src/domain/store.js`

- [ ] **Step 1: Add 5 fields to createStore**

After `earningsCalendar: new Map(),` in `createStore`, add:

```js
    pendingApprovals: new Map(),
    positions: new Map(),
    orders: new Map(),
    executionState: {
      enabled: false,
      killSwitch: false,
      killSwitchReason: null,
      dailyPnl: 0,
      dailyPnlResetAt: new Date().toISOString(),
      highWaterMark: 0,
      accountEquity: 0,
      lastSyncAt: null
    },
    executionLog: [],
```

- [ ] **Step 2: Add to resetStore**

After `store.earningsCalendar = new Map();` in `resetStore`, add:

```js
  store.pendingApprovals = new Map();
  store.positions = new Map();
  store.orders = new Map();
  store.executionState = {
    enabled: false,
    killSwitch: false,
    killSwitchReason: null,
    dailyPnl: 0,
    dailyPnlResetAt: new Date().toISOString(),
    highWaterMark: 0,
    accountEquity: 0,
    lastSyncAt: null
  };
  store.executionLog = [];
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module <<'EOF'
import { createStore, resetStore } from "./src/domain/store.js";
const s = createStore({});
console.log("pendingApprovals Map:", s.pendingApprovals instanceof Map);
console.log("positions Map:", s.positions instanceof Map);
console.log("orders Map:", s.orders instanceof Map);
console.log("executionState keys:", Object.keys(s.executionState).join(","));
console.log("executionLog array:", Array.isArray(s.executionLog));
resetStore(s);
console.log("after reset still Map:", s.positions instanceof Map);
EOF
```

Expected:
```
pendingApprovals Map: true
positions Map: true
orders Map: true
executionState keys: enabled,killSwitch,killSwitchReason,dailyPnl,dailyPnlResetAt,highWaterMark,accountEquity,lastSyncAt
executionLog array: true
after reset still Map: true
```

- [ ] **Step 4: Commit**

```bash
git add src/domain/store.js
git commit -m "feat(store): add execution layer fields (pendingApprovals, positions, orders, executionState, executionLog)"
```

---

## Task 3: Persistence extensions

**Files:**
- Modify: `src/domain/persistence.js`

- [ ] **Step 1: Add save in SQLite saveStoreSnapshot**

After `insertRuntime.run("earnings_calendar", now, JSON.stringify([...store.earningsCalendar.entries()]));` add:

```js
        insertRuntime.run("execution_state", now, JSON.stringify(store.executionState));
        insertRuntime.run("execution_positions", now, JSON.stringify([...store.positions.entries()]));
        insertRuntime.run("execution_orders", now, JSON.stringify([...store.orders.entries()]));
        insertRuntime.run("execution_log", now, JSON.stringify(store.executionLog.slice(0, 500)));
```

- [ ] **Step 2: Add load in hydrateStoreFromRows**

After the `persistedEarningsCalendar` block (after the `if (Array.isArray(persistedEarningsCalendar))` closing brace), add:

```js
  const persistedExecutionState = runtimeMap.get("execution_state");
  if (persistedExecutionState && typeof persistedExecutionState === "object") {
    store.executionState = { ...store.executionState, ...persistedExecutionState };
  }

  const persistedPositions = runtimeMap.get("execution_positions");
  if (Array.isArray(persistedPositions)) {
    store.positions = new Map(persistedPositions);
  }

  const persistedOrders = runtimeMap.get("execution_orders");
  if (Array.isArray(persistedOrders)) {
    store.orders = new Map(persistedOrders);
  }

  const persistedExecutionLog = runtimeMap.get("execution_log");
  if (Array.isArray(persistedExecutionLog)) {
    store.executionLog = persistedExecutionLog;
  }
```

- [ ] **Step 3: Add save in Postgres saveStoreSnapshot**

Find the Postgres path — after the `earnings_calendar` INSERT block (around the comment `/* runtime */` or after the fundamentals block), add:

```js
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at, payload_json = EXCLUDED.payload_json`,
          ["execution_state", now, JSON.stringify(store.executionState)]
        );
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at, payload_json = EXCLUDED.payload_json`,
          ["execution_positions", now, JSON.stringify([...store.positions.entries()])]
        );
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at, payload_json = EXCLUDED.payload_json`,
          ["execution_orders", now, JSON.stringify([...store.orders.entries()])]
        );
        await client.query(
          `INSERT INTO runtime_state (state_key, updated_at, payload_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (state_key) DO UPDATE
           SET updated_at = EXCLUDED.updated_at, payload_json = EXCLUDED.payload_json`,
          ["execution_log", now, JSON.stringify(store.executionLog.slice(0, 500))]
        );
```

- [ ] **Step 4: Commit**

```bash
git add src/domain/persistence.js
git commit -m "feat(persistence): save and restore execution layer state across restarts"
```

---

## Task 4: alpaca.js — Alpaca REST client

**Files:**
- Create: `src/domain/alpaca.js`

- [ ] **Step 1: Write the file**

Create `src/domain/alpaca.js`:

```js
const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";

export function createAlpacaClient(config) {
  const base = config.alpacaPaper ? PAPER_BASE : LIVE_BASE;
  const headers = {
    "APCA-API-KEY-ID": config.alpacaApiKey,
    "APCA-API-SECRET-KEY": config.alpacaApiSecret,
    "Content-Type": "application/json",
    "User-Agent": "SentimentAnalyst/1.0 (+execution)"
  };

  async function request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Alpaca ${method} ${path} → ${response.status}: ${text}`);
      }
      if (response.status === 204) return null;
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getAccount: () => request("GET", "/v2/account"),
    getPositions: () => request("GET", "/v2/positions"),
    placeOrder: (params) => request("POST", "/v2/orders", params),
    cancelOrder: (orderId) => request("DELETE", `/v2/orders/${orderId}`),
    getOrders: (status = "all") => request("GET", `/v2/orders?status=${status}&limit=200`)
  };
}
```

- [ ] **Step 2: Verify**

```bash
node --input-type=module <<'EOF'
import { createAlpacaClient } from "./src/domain/alpaca.js";
const client = createAlpacaClient({ alpacaPaper: true, alpacaApiKey: "test", alpacaApiSecret: "test" });
console.log("type:", typeof client.placeOrder);
console.log("methods:", ["getAccount","getPositions","placeOrder","cancelOrder","getOrders"].every(m => typeof client[m] === "function") ? "OK" : "FAIL");
EOF
```

Expected:
```
type: function
methods: OK
```

- [ ] **Step 3: Commit**

```bash
git add src/domain/alpaca.js
git commit -m "feat(execution): add thin Alpaca REST client"
```

---

## Task 5: risk-guard.js — Pure guard functions

**Files:**
- Create: `src/domain/risk-guard.js`

- [ ] **Step 1: Write the file**

Create `src/domain/risk-guard.js`:

```js
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
```

- [ ] **Step 2: Verify**

```bash
node --input-type=module <<'EOF'
import { runAllGuards } from "./src/domain/risk-guard.js";
import { createStore } from "./src/domain/store.js";
const store = createStore({});

// kill switch test
store.executionState.killSwitch = true;
store.executionState.killSwitchReason = "test halt";
const r1 = runAllGuards("AAPL", 10000, store, { executionDailyLossLimitUsd: -2000, executionMaxDrawdownPct: 0.1, executionMaxPositions: 10, executionMaxPositionPct: 0.2, executionAccountSizeUsd: 100000 });
console.log("kill switch blocked:", !r1.allowed && r1.reason.includes("kill_switch") ? "OK" : "FAIL");

// allowed test
store.executionState.killSwitch = false;
store.executionState.dailyPnl = 0;
store.executionState.highWaterMark = 100000;
store.executionState.accountEquity = 100000;
const r2 = runAllGuards("AAPL", 10000, store, { executionDailyLossLimitUsd: -2000, executionMaxDrawdownPct: 0.1, executionMaxPositions: 10, executionMaxPositionPct: 0.2, executionAccountSizeUsd: 100000 });
console.log("clean pass:", r2.allowed ? "OK" : "FAIL");
EOF
```

Expected:
```
kill switch blocked: OK
clean pass: OK
```

- [ ] **Step 3: Commit**

```bash
git add src/domain/risk-guard.js
git commit -m "feat(execution): add pure risk guard functions"
```

---

## Task 6: execution.js — Execution agent

**Files:**
- Create: `src/domain/execution.js`

- [ ] **Step 1: Write the file**

Create `src/domain/execution.js`:

```js
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
  const closedToday = alpacaOrders
    .filter((o) => o.status === "filled" && o.filled_at && isNewEtDay(o.filled_at))
    .reduce((sum, o) => sum + (Number(o.filled_avg_price) - Number(o.limit_price || o.filled_avg_price)) * Number(o.filled_qty || 0), 0);
  store.executionState.dailyPnl = todayPnl + closedToday;

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
        approval.status = "pending";
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
```

- [ ] **Step 2: Verify**

```bash
node --input-type=module <<'EOF'
import { createExecutionAgent } from "./src/domain/execution.js";
console.log("type:", typeof createExecutionAgent);
const fakeApp = {
  config: { alpacaPaper: true, alpacaApiKey: "", alpacaApiSecret: "", executionEnabled: false,
    executionConvictionThreshold: 0.65, executionDailyLossLimitUsd: -2000, executionMaxDrawdownPct: 0.1,
    executionMaxPositions: 10, executionMaxPositionPct: 0.2, executionAccountSizeUsd: 100000,
    executionSyncMs: 180000, executionApprovalTimeoutMs: 600000 },
  store: { executionState: { killSwitch: false, dailyPnl: 0, highWaterMark: 0, accountEquity: 0, lastSyncAt: null, dailyPnlResetAt: new Date().toISOString(), enabled: false }, tradeSetups: [], pendingApprovals: new Map(), positions: new Map(), orders: new Map(), executionLog: [], bus: { on: () => {}, emit: () => {} } }
};
const agent = createExecutionAgent(fakeApp);
console.log("has start:", typeof agent.start === "function" ? "OK" : "FAIL");
console.log("has stop:", typeof agent.stop === "function" ? "OK" : "FAIL");
console.log("has approve:", typeof agent.approve === "function" ? "OK" : "FAIL");
console.log("has reject:", typeof agent.reject === "function" ? "OK" : "FAIL");
console.log("has setKillSwitch:", typeof agent.setKillSwitch === "function" ? "OK" : "FAIL");
console.log("has sync:", typeof agent.sync === "function" ? "OK" : "FAIL");
EOF
```

Expected:
```
type: function
has start: OK
has stop: OK
has approve: OK
has reject: OK
has setKillSwitch: OK
has sync: OK
```

- [ ] **Step 3: Commit**

```bash
git add src/domain/execution.js
git commit -m "feat(execution): add execution agent with approval flow, risk guards, and Alpaca sync"
```

---

## Task 7: app.js wiring

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add import**

After `import { createTradeSetupAgent } from "./domain/trade-setup.js";` add:

```js
import { createExecutionAgent } from "./domain/execution.js";
```

- [ ] **Step 2: Instantiate after tradeSetupAgent**

After `const tradeSetupAgent = createTradeSetupAgent(app);` add:

```js
  const executionAgent = createExecutionAgent(app);
```

- [ ] **Step 3: Add to startLiveSources Promise.all**

After `tradePrintsCollector.start()` in the `Promise.all` add:

```js
      executionAgent.start(),
```

- [ ] **Step 4: Add to stopLiveSources**

After `tradePrintsCollector.stop();` in `app.stopLiveSources` add:

```js
    executionAgent.stop();
```

- [ ] **Step 5: Expose 6 new app methods**

After `getEarningsCalendar()` in the app object, add:

```js
    getExecutionState() {
      const pending = [...store.pendingApprovals.values()].filter((a) => a.status === "pending");
      return { ...store.executionState, pending_count: pending.length, pending_approvals: pending };
    },
    getPositions() {
      return [...store.positions.values()];
    },
    getOrders(status = "all") {
      const orders = [...store.orders.values()];
      if (status === "all") return orders;
      return orders.filter((o) => o.status === status);
    },
    getExecutionLog() {
      return store.executionLog.slice(0, 200);
    },
    async approveExecution(approvalId) {
      return executionAgent.approve(approvalId);
    },
    rejectExecution(approvalId, reason) {
      return executionAgent.reject(approvalId, reason);
    },
    setKillSwitch(enabled, reason) {
      executionAgent.setKillSwitch(enabled, reason);
    },
    async syncExecution() {
      return executionAgent.sync();
    },
```

- [ ] **Step 6: Run smoke test**

```bash
node scripts/check.js
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/app.js
git commit -m "feat(app): wire execution agent, expose execution methods"
```

---

## Task 8: router.js — 8 new endpoints

**Files:**
- Modify: `src/http/router.js`

- [ ] **Step 1: Add 8 endpoints**

Before the final `await serveStaticFile(...)` line at the bottom of `routeRequest`, insert:

```js
  if (pathname === "/api/execution/state" && request.method === "GET") {
    sendJson(response, 200, app.getExecutionState());
    return;
  }

  if (pathname === "/api/execution/positions" && request.method === "GET") {
    sendJson(response, 200, { positions: app.getPositions() });
    return;
  }

  if (pathname === "/api/execution/orders" && request.method === "GET") {
    sendJson(response, 200, { orders: app.getOrders(query.status || "all") });
    return;
  }

  if (pathname === "/api/execution/log" && request.method === "GET") {
    sendJson(response, 200, { log: app.getExecutionLog() });
    return;
  }

  if (pathname?.startsWith("/api/execution/approve/") && request.method === "POST") {
    const approvalId = decodeURIComponent(pathname.split("/").pop());
    try {
      const result = await app.approveExecution(approvalId);
      sendJson(response, 200, { ok: true, order_id: result.order.order_id, ticker: result.approval.ticker });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (pathname?.startsWith("/api/execution/reject/") && request.method === "POST") {
    const approvalId = decodeURIComponent(pathname.split("/").pop());
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const payload = parseJsonBody(body) || {};
        const result = app.rejectExecution(approvalId, payload.reason || "");
        sendJson(response, 200, { ok: true, ticker: result.approval.ticker });
      } catch (err) {
        sendJson(response, 400, { ok: false, error: err.message });
      }
    });
    return;
  }

  if (pathname === "/api/execution/kill-switch" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const payload = parseJsonBody(body) || {};
        if (typeof payload.enabled !== "boolean") {
          sendJson(response, 400, { ok: false, error: "enabled (boolean) required" });
          return;
        }
        app.setKillSwitch(payload.enabled, payload.reason || "");
        sendJson(response, 200, { ok: true, kill_switch: payload.enabled });
      } catch (err) {
        sendJson(response, 400, { ok: false, error: err.message });
      }
    });
    return;
  }

  if (pathname === "/api/execution/sync" && request.method === "POST") {
    app.syncExecution().catch(() => {});
    sendJson(response, 202, { status: "accepted" });
    return;
  }
```

- [ ] **Step 2: Update the SSE snapshot to include execution state**

In the `/api/stream` handler, find the `sseWrite(response, { type: "snapshot", ... })` block and add `execution: app.getExecutionState()` alongside `trade_setups`:

```js
    sseWrite(response, {
      type: "snapshot",
      health: app.getHealth(),
      watchlist: app.getWatchlistSnapshot(app.config.defaultWindow),
      fundamentals: app.getFundamentalsSnapshot(),
      macro_regime: app.getMacroRegime(),
      trade_setups: app.getTradeSetups(),
      execution: app.getExecutionState()
    });
```

- [ ] **Step 3: Verify endpoints load**

```bash
node scripts/check.js
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/http/router.js
git commit -m "feat(router): add 8 execution endpoints and execution state to SSE snapshot"
```

---

## Task 9: Frontend HTML

**Files:**
- Modify: `src/public/index.html`

- [ ] **Step 1: Add Trading nav button to side-nav**

After the `<button class="side-link" data-view="setups" ...>` block and before `<div class="side-nav-footer">`, add:

```html
      <button class="side-link" data-view="trading" type="button">
        <span class="material-symbols-outlined">candlestick_chart</span>
        <span>Trading</span>
      </button>
```

- [ ] **Step 2: Add Trading topnav link**

After `<button class="topnav-link" data-view="setups" ...>Setups</button>`, add:

```html
          <button class="topnav-link" data-view="trading" type="button">Trading</button>
```

- [ ] **Step 3: Add account bar below macro-regime-bar**

After the closing `</div>` of `macro-regime-bar`, add:

```html
    <div class="execution-account-bar" id="execution-account-bar" data-enabled="false" data-halted="false">
      <span class="exec-bar-label">TRADING</span>
      <span class="exec-bar-status" id="exec-bar-status">DISABLED</span>
      <span class="exec-bar-divider">|</span>
      <span class="exec-bar-item">Equity <strong id="exec-bar-equity">—</strong></span>
      <span class="exec-bar-item">Day P&amp;L <strong id="exec-bar-pnl">—</strong></span>
      <span class="exec-bar-item">Positions <strong id="exec-bar-positions">0</strong></span>
      <button class="exec-kill-btn" id="exec-kill-btn" type="button" title="Toggle kill switch">
        <span class="material-symbols-outlined">emergency_home</span>
      </button>
    </div>
```

- [ ] **Step 4: Add approval card overlay**

After the closing `</div>` of `execution-account-bar`, add:

```html
    <div class="approval-overlay" id="approval-overlay" hidden>
      <div class="approval-card" id="approval-card">
        <div class="approval-header">
          <span class="approval-action-badge" id="approval-action-badge">LONG</span>
          <span class="approval-ticker" id="approval-ticker">—</span>
          <span class="approval-countdown" id="approval-countdown">10:00</span>
        </div>
        <div class="approval-body">
          <div class="approval-thesis" id="approval-thesis"></div>
          <div class="approval-risk-flags" id="approval-risk-flags"></div>
          <div class="approval-prices">
            <div class="approval-price-item">
              <span>Entry</span><strong id="approval-entry">—</strong>
            </div>
            <div class="approval-price-item">
              <span>Stop</span><strong id="approval-stop" class="bearish">—</strong>
            </div>
            <div class="approval-price-item">
              <span>Target</span><strong id="approval-target" class="bullish">—</strong>
            </div>
          </div>
          <div class="approval-size">
            <span id="approval-shares">— shares</span>
            <span id="approval-dollar">$—</span>
            <div class="approval-conviction-bar">
              <div class="approval-conviction-fill" id="approval-conviction-fill"></div>
            </div>
            <span id="approval-conviction-label">— conviction</span>
          </div>
        </div>
        <div class="approval-actions">
          <button class="approval-reject-btn" id="approval-reject-btn" type="button">REJECT</button>
          <button class="approval-approve-btn" id="approval-approve-btn" type="button">APPROVE</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 5: Add Trading panel**

After the setups panel `</section>` (look for `data-view-panel="setups"`), add a new view:

```html
      <section class="view" data-view-panel="trading">
        <div class="dashboard-shell">
          <section class="column column-left">
            <article class="panel">
              <div class="panel-head">
                <div><h2>Open Positions</h2><p id="positions-subtitle">No open positions</p></div>
                <button class="icon-button" id="sync-execution-btn" type="button" title="Sync from Alpaca">
                  <span class="material-symbols-outlined">sync</span>
                </button>
              </div>
              <div id="positions-table-wrap">
                <table class="execution-table" id="positions-table">
                  <thead>
                    <tr>
                      <th>Ticker</th><th>Side</th><th>Qty</th>
                      <th>Entry</th><th>Price</th><th>P&amp;L</th>
                      <th>Stop</th><th>Target</th>
                    </tr>
                  </thead>
                  <tbody id="positions-tbody"></tbody>
                </table>
              </div>
            </article>
          </section>
          <section class="column column-center">
            <article class="panel">
              <div class="panel-head">
                <div><h2>Order History</h2><p>Placed bracket orders</p></div>
              </div>
              <table class="execution-table" id="orders-table">
                <thead>
                  <tr>
                    <th>Ticker</th><th>Side</th><th>Qty</th>
                    <th>Entry</th><th>Status</th><th>Placed</th>
                  </tr>
                </thead>
                <tbody id="orders-tbody"></tbody>
              </table>
            </article>
          </section>
          <section class="column column-right">
            <article class="panel">
              <div class="panel-head">
                <div><h2>Execution Log</h2><p>All trade decisions</p></div>
              </div>
              <div id="execution-log-list" class="execution-log-list"></div>
            </article>
          </section>
        </div>
      </section>
```

- [ ] **Step 6: Commit**

```bash
git add src/public/index.html
git commit -m "feat(html): add Trading panel, account bar, and approval card overlay"
```

---

## Task 10: Frontend JS

**Files:**
- Modify: `src/public/app.js`

- [ ] **Step 1: Add execution state to the global state object**

Find `const state = {` and add these fields inside it:

```js
  executionState: null,
  pendingApproval: null,
  approvalCountdownTimer: null,
  positions: [],
  orders: [],
  executionLog: [],
```

- [ ] **Step 2: Add SSE event handlers**

Find the SSE `evtSource.addEventListener` section (where `document_scored`, `ticker_update`, etc. are handled) and add these handlers:

```js
evtSource.addEventListener("snapshot", (e) => {
  const data = JSON.parse(e.data);
  if (data.execution) {
    state.executionState = data.execution;
    renderExecutionAccountBar(data.execution);
    if (data.execution.pending_approvals?.length > 0) {
      showApprovalCard(data.execution.pending_approvals[0]);
    }
  }
});

evtSource.addEventListener("execution_state_update", (e) => {
  const data = JSON.parse(e.data);
  state.executionState = data.executionState;
  renderExecutionAccountBar(data.executionState);
});

evtSource.addEventListener("trade_approval_request", (e) => {
  const data = JSON.parse(e.data);
  showApprovalCard(data);
});

evtSource.addEventListener("trade_approved", (e) => {
  const data = JSON.parse(e.data);
  hideApprovalCard();
  fetchExecutionData();
  console.log(`[trading] Order placed: ${data.ticker} ${data.action} ${data.shares} shares`);
});

evtSource.addEventListener("trade_rejected", () => {
  hideApprovalCard();
});

evtSource.addEventListener("trade_expired", () => {
  hideApprovalCard();
});
```

- [ ] **Step 3: Add renderExecutionAccountBar function**

Add this function near the other render functions:

```js
function renderExecutionAccountBar(es) {
  if (!es) return;
  const bar = document.getElementById("execution-account-bar");
  const statusEl = document.getElementById("exec-bar-status");
  const equityEl = document.getElementById("exec-bar-equity");
  const pnlEl = document.getElementById("exec-bar-pnl");
  const posEl = document.getElementById("exec-bar-positions");
  const killBtn = document.getElementById("exec-kill-btn");
  if (!bar) return;

  bar.dataset.enabled = es.enabled ? "true" : "false";
  bar.dataset.halted = es.killSwitch ? "true" : "false";

  if (!es.enabled) {
    statusEl.textContent = "DISABLED";
  } else if (es.killSwitch) {
    statusEl.textContent = "HALTED";
  } else {
    statusEl.textContent = "ACTIVE";
  }

  equityEl.textContent = es.accountEquity > 0
    ? `$${es.accountEquity.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "—";

  const pnl = es.dailyPnl || 0;
  pnlEl.textContent = `${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  pnlEl.className = pnl >= 0 ? "bullish" : "bearish";

  posEl.textContent = es.pending_count > 0
    ? `${state.positions?.length || 0} (+${es.pending_count} pending)`
    : String(state.positions?.length || 0);

  killBtn.dataset.active = es.killSwitch ? "true" : "false";
}
```

- [ ] **Step 4: Add showApprovalCard / hideApprovalCard functions**

```js
function showApprovalCard(approval) {
  state.pendingApproval = approval;
  const overlay = document.getElementById("approval-overlay");
  if (!overlay) return;

  document.getElementById("approval-action-badge").textContent = approval.action?.toUpperCase() || "—";
  document.getElementById("approval-action-badge").dataset.action = approval.action || "long";
  document.getElementById("approval-ticker").textContent = approval.ticker || "—";
  document.getElementById("approval-thesis").textContent = approval.thesis || "No thesis available.";

  const flagsEl = document.getElementById("approval-risk-flags");
  flagsEl.innerHTML = (approval.risk_flags || []).map((f) =>
    `<span class="risk-flag">${f}</span>`
  ).join("");

  document.getElementById("approval-entry").textContent = approval.entry ? `$${approval.entry.toFixed(2)}` : "—";
  document.getElementById("approval-stop").textContent = approval.stop ? `$${approval.stop.toFixed(2)}` : "—";
  document.getElementById("approval-target").textContent = approval.target ? `$${approval.target.toFixed(2)}` : "—";
  document.getElementById("approval-shares").textContent = `${approval.shares || 0} shares`;
  document.getElementById("approval-dollar").textContent = approval.dollar_size
    ? `$${approval.dollar_size.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "$—";

  const convFill = document.getElementById("approval-conviction-fill");
  const pct = Math.round((approval.conviction || 0) * 100);
  convFill.style.width = `${pct}%`;
  document.getElementById("approval-conviction-label").textContent = `${pct}% conviction`;

  if (state.approvalCountdownTimer) clearInterval(state.approvalCountdownTimer);
  const expiresAt = new Date(approval.expires_at).getTime();
  function updateCountdown() {
    const remaining = Math.max(0, expiresAt - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const el = document.getElementById("approval-countdown");
    if (el) el.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
    if (remaining <= 0) {
      clearInterval(state.approvalCountdownTimer);
      hideApprovalCard();
    }
  }
  updateCountdown();
  state.approvalCountdownTimer = setInterval(updateCountdown, 1000);

  overlay.hidden = false;
}

function hideApprovalCard() {
  const overlay = document.getElementById("approval-overlay");
  if (overlay) overlay.hidden = true;
  if (state.approvalCountdownTimer) {
    clearInterval(state.approvalCountdownTimer);
    state.approvalCountdownTimer = null;
  }
  state.pendingApproval = null;
}
```

- [ ] **Step 5: Add APPROVE / REJECT button handlers**

Add this inside the DOMContentLoaded or init section:

```js
document.getElementById("approval-approve-btn")?.addEventListener("click", async () => {
  if (!state.pendingApproval) return;
  const id = state.pendingApproval.approval_id;
  try {
    const res = await fetch(`/api/execution/approve/${encodeURIComponent(id)}`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      alert(`Approval failed: ${err.error}`);
    }
  } catch {
    alert("Network error approving trade.");
  }
});

document.getElementById("approval-reject-btn")?.addEventListener("click", async () => {
  if (!state.pendingApproval) return;
  const id = state.pendingApproval.approval_id;
  try {
    await fetch(`/api/execution/reject/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "user_rejected" })
    });
    hideApprovalCard();
  } catch {
    alert("Network error rejecting trade.");
  }
});

document.getElementById("exec-kill-btn")?.addEventListener("click", async () => {
  if (!state.executionState) return;
  const newState = !state.executionState.killSwitch;
  const reason = newState ? "manual halt from dashboard" : "";
  try {
    await fetch("/api/execution/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newState, reason })
    });
  } catch {
    alert("Network error toggling kill switch.");
  }
});

document.getElementById("sync-execution-btn")?.addEventListener("click", async () => {
  await fetch("/api/execution/sync", { method: "POST" }).catch(() => {});
  await fetchExecutionData();
});
```

- [ ] **Step 6: Add fetchExecutionData + render functions**

```js
async function fetchExecutionData() {
  try {
    const [posRes, ordRes, logRes] = await Promise.all([
      fetch("/api/execution/positions"),
      fetch("/api/execution/orders"),
      fetch("/api/execution/log")
    ]);
    const [posData, ordData, logData] = await Promise.all([posRes.json(), ordRes.json(), logRes.json()]);

    state.positions = posData.positions || [];
    state.orders = ordData.orders || [];
    state.executionLog = logData.log || [];

    renderPositionsTable(state.positions);
    renderOrdersTable(state.orders);
    renderExecutionLog(state.executionLog);
  } catch {
    // silent — trading may not be enabled
  }
}

function renderPositionsTable(positions) {
  const tbody = document.getElementById("positions-tbody");
  const subtitle = document.getElementById("positions-subtitle");
  if (!tbody) return;
  subtitle.textContent = positions.length === 0 ? "No open positions" : `${positions.length} position${positions.length !== 1 ? "s" : ""}`;
  tbody.innerHTML = positions.map((p) => {
    const pnlClass = p.unrealized_pnl >= 0 ? "bullish" : "bearish";
    return `<tr>
      <td><strong>${p.ticker}</strong></td>
      <td><span class="action-badge action-${p.side}">${p.side.toUpperCase()}</span></td>
      <td>${p.qty}</td>
      <td>$${p.entry_price?.toFixed(2) || "—"}</td>
      <td>$${p.current_price?.toFixed(2) || "—"}</td>
      <td class="${pnlClass}">${p.unrealized_pnl >= 0 ? "+" : ""}$${p.unrealized_pnl?.toFixed(0) || "0"}</td>
      <td>$${p.stop_price?.toFixed(2) || "—"}</td>
      <td>$${p.target_price?.toFixed(2) || "—"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty-row">No open positions</td></tr>`;
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;
  tbody.innerHTML = orders.slice(0, 30).map((o) => `<tr>
    <td><strong>${o.ticker}</strong></td>
    <td><span class="action-badge action-${o.side}">${o.side?.toUpperCase()}</span></td>
    <td>${o.qty}</td>
    <td>$${o.entry_price?.toFixed(2) || "—"}</td>
    <td><span class="order-status order-${o.status}">${o.status}</span></td>
    <td>${o.placed_at ? new Date(o.placed_at).toLocaleString() : "—"}</td>
  </tr>`).join("") || `<tr><td colspan="6" class="empty-row">No orders yet</td></tr>`;
}

function renderExecutionLog(log) {
  const container = document.getElementById("execution-log-list");
  if (!container) return;
  container.innerHTML = log.slice(0, 50).map((entry) => {
    const statusClass = entry.status === "approved" ? "bullish" : entry.status === "rejected" ? "bearish" : "neutral";
    return `<div class="exec-log-item">
      <span class="exec-log-status ${statusClass}">${entry.status?.toUpperCase()}</span>
      <span class="exec-log-ticker">${entry.ticker}</span>
      <span class="exec-log-action">${entry.action?.toUpperCase()}</span>
      <span class="exec-log-time">${entry.decided_at ? new Date(entry.decided_at).toLocaleTimeString() : "—"}</span>
    </div>`;
  }).join("") || `<p class="empty-state">No decisions yet</p>`;
}
```

- [ ] **Step 7: Call fetchExecutionData when Trading view is activated**

Find the view switching logic (where `data-view` buttons are handled) and add:

```js
if (viewName === "trading") {
  fetchExecutionData();
}
```

- [ ] **Step 8: Commit**

```bash
git add src/public/app.js
git commit -m "feat(frontend): add Trading panel JS, approval card, SSE handlers, and APPROVE/REJECT logic"
```

---

## Task 11: Frontend CSS

**Files:**
- Modify: `src/public/styles.css`

- [ ] **Step 1: Add execution account bar styles**

Append to `styles.css`:

```css
/* ── Execution Account Bar ─────────────────────────────────────────── */
.execution-account-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 20px;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--text-secondary, #8a8f9e);
  min-height: 28px;
}
.exec-bar-label {
  color: var(--text-tertiary, #555b6e);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.08em;
}
.exec-bar-status {
  font-weight: 700;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  color: var(--text-secondary, #8a8f9e);
}
.execution-account-bar[data-enabled="true"][data-halted="false"] .exec-bar-status {
  background: rgba(52,199,89,0.15);
  color: #34c759;
}
.execution-account-bar[data-halted="true"] .exec-bar-status {
  background: rgba(255,69,58,0.15);
  color: #ff453a;
}
.exec-bar-divider { color: rgba(255,255,255,0.12); }
.exec-bar-item { color: var(--text-secondary, #8a8f9e); }
.exec-bar-item strong { color: var(--text-primary, #e8eaf0); margin-left: 4px; }
.exec-kill-btn {
  margin-left: auto;
  background: none;
  border: 1px solid rgba(255,69,58,0.3);
  border-radius: 6px;
  color: rgba(255,69,58,0.7);
  cursor: pointer;
  padding: 2px 6px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}
.exec-kill-btn:hover { background: rgba(255,69,58,0.1); color: #ff453a; }
.exec-kill-btn[data-active="true"] { background: rgba(255,69,58,0.2); color: #ff453a; border-color: #ff453a; }
.exec-kill-btn .material-symbols-outlined { font-size: 14px; }

/* ── Approval Overlay ──────────────────────────────────────────────── */
.approval-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  backdrop-filter: blur(4px);
}
.approval-overlay[hidden] { display: none; }
.approval-card {
  background: #12141a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 28px;
  width: 420px;
  max-width: 92vw;
  box-shadow: 0 24px 80px rgba(0,0,0,0.7);
}
.approval-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.approval-action-badge {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.approval-action-badge[data-action="long"] { background: rgba(52,199,89,0.2); color: #34c759; }
.approval-action-badge[data-action="short"] { background: rgba(255,69,58,0.2); color: #ff453a; }
.approval-ticker { font-size: 22px; font-weight: 800; color: #e8eaf0; flex: 1; }
.approval-countdown { font-size: 13px; font-weight: 600; color: #ff9f0a; font-variant-numeric: tabular-nums; }
.approval-thesis {
  font-size: 13px;
  color: #8a8f9e;
  line-height: 1.5;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
}
.approval-risk-flags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.risk-flag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255,159,10,0.15);
  color: #ff9f0a;
  letter-spacing: 0.04em;
}
.approval-prices {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.approval-price-item {
  background: rgba(255,255,255,0.04);
  border-radius: 8px;
  padding: 8px 10px;
  text-align: center;
}
.approval-price-item span { display: block; font-size: 10px; color: #555b6e; margin-bottom: 4px; }
.approval-price-item strong { font-size: 14px; font-weight: 700; color: #e8eaf0; }
.approval-size {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  font-size: 12px;
  color: #8a8f9e;
}
.approval-conviction-bar {
  flex: 1;
  height: 4px;
  background: rgba(255,255,255,0.08);
  border-radius: 2px;
  overflow: hidden;
}
.approval-conviction-fill {
  height: 100%;
  background: linear-gradient(90deg, #007aff, #34c759);
  border-radius: 2px;
  transition: width 0.3s;
}
.approval-actions { display: flex; gap: 10px; }
.approval-reject-btn, .approval-approve-btn {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.15s;
}
.approval-reject-btn { background: rgba(255,69,58,0.15); color: #ff453a; }
.approval-reject-btn:hover { background: rgba(255,69,58,0.3); }
.approval-approve-btn { background: rgba(52,199,89,0.2); color: #34c759; }
.approval-approve-btn:hover { background: rgba(52,199,89,0.35); }

/* ── Execution Tables ──────────────────────────────────────────────── */
.execution-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.execution-table th {
  text-align: left;
  padding: 6px 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #555b6e;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.execution-table td {
  padding: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  color: #8a8f9e;
}
.execution-table td strong { color: #e8eaf0; }
.empty-row { text-align: center; color: #555b6e; padding: 20px !important; }
.order-status { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
.order-filled { background: rgba(52,199,89,0.15); color: #34c759; }
.order-pending_new, .order-new { background: rgba(0,122,255,0.15); color: #007aff; }
.order-canceled, .order-expired { background: rgba(255,255,255,0.06); color: #555b6e; }

/* ── Execution Log ─────────────────────────────────────────────────── */
.execution-log-list { display: flex; flex-direction: column; gap: 4px; }
.exec-log-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.03);
  border-radius: 6px;
  font-size: 12px;
}
.exec-log-status { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.exec-log-status.bullish { background: rgba(52,199,89,0.15); color: #34c759; }
.exec-log-status.bearish { background: rgba(255,69,58,0.15); color: #ff453a; }
.exec-log-status.neutral { background: rgba(255,255,255,0.06); color: #555b6e; }
.exec-log-ticker { font-weight: 700; color: #e8eaf0; }
.exec-log-action { color: #8a8f9e; }
.exec-log-time { margin-left: auto; color: #555b6e; font-size: 11px; }
```

- [ ] **Step 2: Commit**

```bash
git add src/public/styles.css
git commit -m "feat(styles): add execution account bar, approval card, and Trading panel styles"
```

---

## Task 12: Smoke test

**Files:**
- Modify: `scripts/check.js`

- [ ] **Step 1: Add execution store field assertions**

After the `earnings_calendar_tickers` assertion in check.js, add:

```js
if (!(app.store.pendingApprovals instanceof Map))
  throw new Error("store.pendingApprovals is not a Map");
if (!(app.store.positions instanceof Map))
  throw new Error("store.positions is not a Map");
if (!(app.store.orders instanceof Map))
  throw new Error("store.orders is not a Map");
if (typeof app.store.executionState !== "object" || app.store.executionState === null)
  throw new Error("store.executionState is not an object");
if (!Array.isArray(app.store.executionLog))
  throw new Error("store.executionLog is not an array");
if (typeof app.getExecutionState !== "function")
  throw new Error("app.getExecutionState is not a function");
if (typeof app.setKillSwitch !== "function")
  throw new Error("app.setKillSwitch is not a function");
```

- [ ] **Step 2: Add to summary output**

In the final `console.log` output block, add:

```js
execution_enabled: app.store.executionState.enabled,
execution_kill_switch: app.store.executionState.killSwitch,
open_positions: app.store.positions.size,
```

- [ ] **Step 3: Run smoke test**

```bash
node scripts/check.js
```

Expected: exits 0, summary includes `execution_enabled: false`.

- [ ] **Step 4: Commit**

```bash
git add scripts/check.js
git commit -m "test(check): assert execution layer store fields and app methods"
```

---

## Self-Review

**Spec coverage:**
- ✅ Layer 5 architecture: alpaca.js + risk-guard.js + execution.js
- ✅ 6 risk guards in correct order, portfolio-halt vs per-trade-reject distinction
- ✅ Human approval flow: pending approval → SSE notification → APPROVE/REJECT → bracket order
- ✅ Approval expiry (10 min default, configurable)
- ✅ Position sizing: full/half/quarter/starter → $20k/$10k/$5k/$2.5k
- ✅ Bracket orders via Alpaca API
- ✅ 3-minute Alpaca sync
- ✅ Daily P&L reset at midnight ET
- ✅ Kill switch: manual toggle via dashboard button + API endpoint
- ✅ 8 REST endpoints
- ✅ 5 SSE events
- ✅ Account bar (persistent, all views)
- ✅ Approval card modal (appears on any view)
- ✅ Trading panel (positions + orders + log)
- ✅ All 5 store fields persisted via runtime_state
- ✅ EXECUTION_ENABLED=false by default
- ✅ ALPACA_PAPER=true → live swap is one env var
- ✅ Real-money promotion: only ALPACA_PAPER + API keys need changing

**Type consistency:**
- `approval.entry` / `approval.stop` / `approval.target` — set in execution.js evaluateSetups, read in approve(), rendered in frontend
- `store.positions.values()` → array of `{ ticker, side, qty, entry_price, current_price, unrealized_pnl }` — consistent across execution.js syncFromAlpaca and router getPositions
- `store.executionState` shape — defined in store.js, read in risk-guard.js, emitted in execution.js, rendered in frontend
