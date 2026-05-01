# Execution Layer Design — Alpaca Paper Trading

**Date:** 2026-05-01
**Status:** Approved

---

## Overview

Add a human-in-the-loop execution layer (Layer 5) to the autonomous trader system. When a trade setup qualifies for execution, the system sends a push notification to the dashboard for user approval. Only after approval does it place a bracket order via the Alpaca API. Full risk guards protect the portfolio at all times. Designed for paper trading now, real-money promotion later via a single env var swap.

---

## Architecture

The system currently has 4 layers. Execution is Layer 5 — it reads from all upstream layers but writes only to its own store fields.

```
Layer 1  Ingestion    (news, SEC, social, earnings)
Layer 2  Scoring      (pipeline, fundamentals)
Layer 3  Decision     (macro-regime, trade-setup)
Layer 4  Presentation (REST API, SSE, dashboard)
─────────────────────────────────────────────────
Layer 5  Execution    ← NEW
         alpaca.js       thin Alpaca REST client
         risk-guard.js   pure guard functions
         execution.js    execution agent
```

**Three new files, each with one job:**

- `src/domain/alpaca.js` — wraps the Alpaca REST API. No trading system knowledge. `ALPACA_PAPER=true` switches between paper and live base URL — the only change needed for real money.
- `src/domain/risk-guard.js` — pure functions, no I/O. Takes execution state + proposed trade, returns `{ allowed: bool, reason: string }`. Fully testable in isolation.
- `src/domain/execution.js` — the execution agent. Listens to `store.bus` for `trade_setup_refresh`, runs qualifying setups through guards, creates pending approvals, places orders on user approval, syncs positions on a 3-minute poll.

Execution is **disabled by default** (`EXECUTION_ENABLED=false`). Nothing runs unless explicitly enabled.

---

## Execution Flow

```
trade_setup_refresh fires on store.bus
  → filter: action === 'long' or 'short', conviction >= EXECUTION_CONVICTION_THRESHOLD
  → skip: ticker already has open position or pending approval
  → run 6 risk guards in sequence
  → if any guard fails: log rejection, continue to next setup
  → if all guards pass:
      create pendingApproval in store.pendingApprovals
      push trade_approval_request via SSE to dashboard
      start expiry countdown (EXECUTION_APPROVAL_TIMEOUT_MS)

User sees approval card on dashboard:
  APPROVE → place bracket order via Alpaca → update store.orders/positions
  REJECT  → log with optional reason → dismiss card
  Timeout → log as expired → dismiss card
```

---

## Risk Guards

Six guards run in sequence. First failure halts that trade — no further guards checked.

| # | Guard | Type | Behaviour on trigger |
|---|---|---|---|
| 1 | Kill switch | Portfolio halt | Block all new approvals |
| 2 | Daily loss limit | Portfolio halt | Block all new approvals |
| 3 | Drawdown limit | Portfolio halt | Block all new approvals |
| 4 | Max open positions | Per-trade reject | Skip this setup only |
| 5 | Max position size | Per-trade reject | Skip this setup only |
| 6 | Duplicate position | Per-trade reject | Skip if ticker already has open position or pending approval |

**Guards 1–3 halt all new entries** until manually re-enabled via `POST /api/execution/kill-switch`. No auto-recovery — a human decides when to resume. This applies to both paper and real-money operation.

**Guards 4–6 reject the specific trade** but leave the system running.

---

## Position Sizing

Account size: $100,000. Max position: 20% = $20,000. Max open positions: 10.

| Trade setup `position_size` | Dollar amount |
|---|---|
| `full` | $20,000 |
| `half` | $10,000 |
| `quarter` | $5,000 |
| `starter` | $2,500 |

Shares = `floor(dollar_amount / entry_price)`. If result is 0 shares, the trade is skipped.

---

## Order Type

**Bracket order** — one atomic order placed via Alpaca:

```
side:         'buy' (long) or 'sell' (short)
type:         'limit'
limit_price:  entry_price   (from trade setup)
stop_loss:    { stop_price: stop }
take_profit:  { limit_price: target }
time_in_force: 'day'
```

Entry, stop, and target prices come directly from the trade setup agent output.

---

## Store Additions

```js
store.pendingApprovals  // Map<approvalId, Approval>
  // { approval_id, ticker, action, conviction, thesis, risk_flags,
  //   entry, stop, target, dollar_size, shares, created_at,
  //   expires_at, status: 'pending'|'approved'|'rejected'|'expired' }

store.positions         // Map<ticker, Position>
  // { ticker, side, qty, entry_price, current_price,
  //   unrealized_pnl, alpaca_position_id, opened_at }

store.orders            // Map<orderId, Order>
  // { order_id, ticker, side, qty, status, entry_price,
  //   stop_price, target_price, filled_at, closed_at }

store.executionState    // {
  //   enabled: bool,
  //   killSwitch: bool,
  //   killSwitchReason: string | null,
  //   dailyPnl: number,
  //   dailyPnlResetAt: string,
  //   highWaterMark: number,
  //   accountEquity: number,
  //   lastSyncAt: string
  // }

store.executionLog      // Array — all decisions (approved/rejected/expired), persisted
```

`pendingApprovals`, `positions`, `orders`, and `executionState` are all persisted to SQLite via the existing `runtime_state` table (same pattern as `earningsCalendar`). `executionLog` is persisted as its own `runtime_state` row.

---

## Alpaca Client (`alpaca.js`)

Five methods only:

```js
getAccount()            // equity, buying_power
getPositions()          // all open positions
placeOrder(params)      // place bracket order
cancelOrder(orderId)    // cancel pending order
getOrders(status)       // 'open' | 'closed' | 'all'
```

Base URLs:
- Paper: `https://paper-api.alpaca.markets`
- Live:  `https://api.alpaca.markets`

Switched by `ALPACA_PAPER=true/false`. No other code changes for real-money promotion.

---

## Position Sync

The execution agent polls Alpaca every 3 minutes (`EXECUTION_SYNC_MS=180000`) to:
- Sync filled/cancelled/closed orders into `store.orders`
- Update `store.positions` (current price, unrealized P&L)
- Recalculate `store.executionState.dailyPnl` and `accountEquity` (dailyPnl resets to 0 at midnight ET each day)
- Update `highWaterMark` if equity exceeds previous high
- Re-evaluate guards 2 and 3 after each sync

---

## Configuration

All new env vars. Nothing existing changes.

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

For real money: set `ALPACA_PAPER=false` and swap API keys. All risk parameters remain configurable.

---

## REST API

New endpoints added to `src/http/router.js`:

```
GET  /api/execution/state              executionState + pending approvals count
GET  /api/execution/positions          open positions with unrealized P&L
GET  /api/execution/orders             order history (filterable by status)
GET  /api/execution/log                full audit log of all decisions
POST /api/execution/approve/:id        approve a pending trade → place order
POST /api/execution/reject/:id         reject { reason? } → dismiss
POST /api/execution/kill-switch        { enabled: bool } toggle halt
POST /api/execution/sync               force Alpaca position sync
```

---

## SSE Events

Added to the existing `/api/stream` event stream:

```
trade_approval_request    triggers approval card (approval_id, ticker, action,
                          conviction, thesis, risk_flags, entry, stop, target,
                          dollar_size, shares, expires_at)
trade_approved            update positions panel
trade_rejected            dismiss card
trade_expired             dismiss card with 'expired' label
execution_state_update    refresh account bar (P&L, kill switch status)
```

---

## Dashboard — Trading Panel

New "Trading" nav tab added to `index.html`.

**Account bar (persistent across all views):**
- Account equity
- Daily P&L (green/red)
- Kill switch status badge (ACTIVE / HALTED)

**Approval card (modal overlay, appears on any view via SSE):**
- Ticker + action badge (LONG / SHORT)
- Conviction meter (reuses existing Setups panel component)
- Thesis one-liner (from trade setup)
- Risk flags (e.g., `earnings_in_window`)
- Entry / Stop / Target prices
- Dollar size + share count
- Countdown timer to expiry
- APPROVE (green) / REJECT (red) buttons

**Trading panel content:**
- Open positions table — ticker, side, entry, current price, unrealized P&L, stop, target
- Order history — filled/cancelled/expired with timestamps
- Execution log — full audit trail

---

## File Map

| File | Action |
|---|---|
| `src/domain/alpaca.js` | Create |
| `src/domain/risk-guard.js` | Create |
| `src/domain/execution.js` | Create |
| `src/domain/store.js` | Modify — add 5 new fields |
| `src/domain/persistence.js` | Modify — persist execution state |
| `src/config.js` | Modify — 12 new config keys |
| `src/app.js` | Modify — wire execution agent |
| `src/http/router.js` | Modify — 8 new endpoints |
| `src/public/index.html` | Modify — Trading panel + approval card |
| `src/public/app.js` | Modify — SSE handlers + Trading panel logic |
| `src/public/styles.css` | Modify — approval card + Trading panel styles |

---

## Real-Money Promotion Checklist

When ready to go live:
- [ ] Set `ALPACA_PAPER=false`
- [ ] Swap `ALPACA_API_KEY` and `ALPACA_API_SECRET` for live keys
- [ ] Review and tighten risk parameters (`EXECUTION_DAILY_LOSS_LIMIT_USD`, `EXECUTION_MAX_DRAWDOWN_PCT`)
- [ ] Confirm `EXECUTION_ENABLED=true`
- [ ] No code changes required
