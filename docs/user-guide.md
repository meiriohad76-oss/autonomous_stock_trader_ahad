# Ahad Trading Agency User Guide

This is the simple operating guide for using the agency from the dashboard.

The agency can analyze stocks, rank candidates, prepare Alpaca paper-trade previews, and explain its decisions. It should not submit an Alpaca order unless you explicitly approve it.

The goal is a supervised weekly portfolio target of 3%. That is a target and risk budget, not a guaranteed return.

## 1. Start Here

Open the dashboard:

```text
http://127.0.0.1:3000
```

If you use the Cloudflare tunnel, open the tunnel URL instead.

Always begin on the **Command** screen.

The Command screen tells you:

- whether the agency is still loading the first baseline
- which agent needs attention
- whether live data is ready
- whether the agency can be used for decisions
- whether Alpaca preview is allowed
- whether Alpaca paper submission is still gated

Do not start from Execution. Start from Command.

## 2. Understand The Main Status

On the Command screen, look for the agency mode.

### Initial Baseline

This means the agency is still doing the first full load.

Wait until the required agents are ready. The system may still be collecting:

- SEC fundamentals
- market/pricing data
- news and signal data
- money-flow data
- broker/risk state

If an agent shows progress like `167/168 SEC-backed`, it is not frozen. It is showing how much of the baseline has finished.

### Ongoing Updates

This means the first baseline is complete.

After that, the agents keep refreshing on a schedule. A warning during ongoing updates is usually less serious than a blocked initial baseline.

### Ready For Decisions

This means the agency has enough data to analyze and rank stocks.

It does not mean you should approve a trade automatically.

### Ready For Preview

This means the agency can prepare an Alpaca paper-order preview.

Preview is not submission.

### Ready For Paper Approval

This means a final candidate passed selection, policy, and risk gates, and Alpaca paper submission may be available behind explicit user approval.

Still read the report before approving.

## 3. The Agent Flow

Use the screens in this order.

### Step 1: Command

Purpose:

Shows the whole agency status.

What to do:

- Check the 12-agent status bar.
- Read the current worker.
- Read blockers and warnings.
- Use **Run Agency Cycle** when you want the agency to refresh and recompute.

Good status:

- baseline ready
- live pricing confirmed
- fresh evidence available
- risk ok
- broker configured

Bad status:

- fallback or synthetic pricing
- no fresh evidence
- risk blocked
- seed/sample decision mode enabled
- Alpaca live mode without explicit permission

### Step 2: Universe

Purpose:

Confirms the agency is only working inside the allowed universe: S&P 100 plus QQQ holdings.

What to do:

- Check the universe count.
- Confirm the names look like real allowed stocks.
- Do not trade names outside this universe.

If the universe is too small, run the universe refresh from Command or System.

### Step 3: Fundamentals Agent

Purpose:

Ranks companies by business quality, growth, valuation, balance sheet, cash quality, stability, and data confidence.

What to do:

- Open **Fundamentals Agent**.
- Look at SEC coverage.
- Look at screen stage:
  - `eligible`: strong enough for ranking
  - `watch`: interesting but incomplete or weaker
  - `reject`: not suitable now
- Open a stock to inspect the factor cards and criteria.

Important:

Only live SEC-backed rows should be scored in production. Pending SEC names can exist in the universe, but should not be treated as scored fundamentals.

### Step 4: Market Agent

Purpose:

Reads the market and sector backdrop.

What to do:

- Check the market regime:
  - `risk_on`: longs need less top-down resistance
  - `risk_off`: longs need stronger proof; shorts may be easier
  - `high_dispersion`: be selective
  - `balanced`: no strong market edge
- Check sector strength and weakness.
- Check market-flow status.

Important:

The Market Agent changes the thresholds used by the Selection Agent.

### Step 5: Signals Agent

Purpose:

Shows fresh evidence around stocks: news, alerts, money flow, insider activity, institutional activity, earnings, unusual volume, and optional social/trade-print feeds.

What to do:

- Check whether evidence is fresh.
- Check whether source links exist.
- Check money-flow concentration.
- Check signal diagnostics.

Good signals:

- fresh linked news
- insider buying
- institutional buying
- abnormal volume with price confirmation
- block buying or smart-money accumulation
- multiple signals supporting the same direction

Weak signals:

- stale alerts
- no links
- context-only evidence
- conflicting signals
- disabled providers

### Step 6: Selection Agent

Purpose:

Shows the two selection lanes:

- Deterministic Selection Agent
- LLM Selection Agent

What to do:

- Review deterministic action:
  - `long`
  - `short`
  - `watch`
  - `no_trade`
- Review conviction.
- Open the explanation.
- Check score components and blockers.
- Check the LLM review and whether it agrees or demotes.

Important:

The LLM cannot promote a watch/no-trade stock directly into execution by itself. Final Selection requires deterministic support.

### Step 7: Final Selection

Purpose:

Combines deterministic selection, LLM review, and portfolio policy.

What to do:

- Look for final candidates.
- Open each stock report.
- Read:
  - why it was selected
  - agent votes
  - concerns
  - policy gates
  - recent evidence
  - proposed trade plan

Only stocks with `approved_for_alpaca_preview` should move toward Execution.

If the stock is `watch_only` or `requires_human_review`, do not approve an order.

### Step 8: Risk

Purpose:

Checks exposure, position size, open orders, buying power, and runtime risk.

What to do:

- Confirm Risk status is `ok`.
- Check hard blocks.
- Check exposure after the proposed trade.
- Check single-name exposure.
- Check open orders.

Do not approve a trade if Risk is blocked.

### Step 9: Execution

Purpose:

Prepares the Alpaca paper ticket.

What to do:

- Open Execution only after Final Selection and Risk are clean.
- Preview the order.
- Check:
  - ticker
  - side
  - quantity
  - notional
  - stop loss
  - take profit
  - bracket order details
  - broker mode is paper

Submission requires explicit approval. Preview alone does not submit an order.

Do not approve if:

- broker mode is live unexpectedly
- ticker is wrong
- quantity is too large
- stop or target is missing
- risk is blocked
- final report is not approved
- live pricing is not confirmed

### Step 10: Portfolio

Purpose:

Shows account, positions, open orders, portfolio rules, and policy usage.

What to do:

- Check current positions.
- Check open orders.
- Review policy settings.
- Adjust policy only when you intentionally want to change the agency rules.

Important policy fields:

- weekly target
- minimum final conviction
- max positions
- max new positions per cycle
- max position size
- max gross exposure
- max sector exposure
- cash reserve
- default stop loss
- default take profit
- trailing stop
- allow adds
- allow reductions

### Step 11: Learning

Purpose:

Reviews paper outcomes and suggests improvements.

What to do:

- After paper trades exist, check the Learning screen.
- Look for which agents need adjustment.
- Do not change algorithms aggressively before enough outcomes exist.

The Learning Agent needs a sample of paper decisions and positions before its suggestions become useful.

### Step 12: System

Purpose:

Shows live data health, credentials, source status, and runtime reliability.

What to do:

- Check live pricing.
- Check Marketaux/news.
- Check SEC fundamentals.
- Check market flow.
- Check broker status.
- Check warnings.

This screen is where you diagnose why the agency is not ready.

## 4. Normal Daily Workflow

Use this flow every day.

1. Open **Command**.
2. Confirm the server is running and baseline is ready.
3. Run **Run Agency Cycle**.
4. Open **System** if Command shows warnings.
5. Open **Fundamentals Agent** to confirm SEC-backed coverage.
6. Open **Market Agent** to understand regime.
7. Open **Signals Agent** to confirm fresh evidence.
8. Open **Selection Agent** to inspect deterministic and LLM reasoning.
9. Open **Final Selection** and read candidate reports.
10. Open **Risk** and confirm no hard blocks.
11. Open **Execution** only for approved final candidates.
12. Preview the Alpaca paper order.
13. Approve only if the report, risk, broker mode, size, stop, and target all make sense.
14. After trades exist, monitor **Portfolio** and **Learning**.

## 5. When To Wait

Wait and do not approve trades when:

- the agency is in initial baseline
- live pricing is not confirmed
- most evidence is stale
- source links are missing
- Marketaux/news is failing
- SEC fundamentals coverage is too low
- the candidate is watch-only
- the LLM demoted the idea
- Risk Manager is blocked
- broker status is not ready
- paper submission gate is closed
- the report does not clearly explain the trade

## 6. Useful Commands On The Pi

Run these from:

```bash
cd ~/sentiment-analyst
```

Check if the service is running:

```bash
systemctl is-active sentiment-analyst
```

Check local readiness:

```bash
curl -s http://127.0.0.1:3000/api/ready
```

Check the agency cycle:

```bash
curl -s http://127.0.0.1:3000/api/agency/cycle
```

Run the deep scoring and selection audit:

```bash
npm run check:scoring-selection-deep
```

Run all agent diagnostics:

```bash
npm run check:agents -- --max-sec-batches 1 --price-limit 5
```

View service logs:

```bash
sudo journalctl -u sentiment-analyst -f
```

View app log file if enabled:

```bash
tail -f ~/sentiment-analyst/data/runtime/logs/server.log
```

Restart the dashboard:

```bash
sudo systemctl restart sentiment-analyst
```

## 7. How To Read Agent States

Common states:

- `ready`: this worker has enough data.
- `loading`: this worker is collecting or refreshing data.
- `review`: the worker ran, but the output needs caution or has no executable result.
- `waiting`: the worker needs more data or a scheduled refresh.
- `blocked`: configuration, credentials, provider failure, or risk gate prevents progress.
- `gated`: intentionally guarded, usually because execution approval is not enabled.

Warnings are not always bad. For example, Execution should often be `gated` until you intentionally enable paper submission.

## 8. The Safest Rule

The safest operating rule is:

Do not approve an Alpaca paper trade unless Command, Final Selection, Risk, and Execution all agree that the candidate is ready, and the selection report makes sense to you.

