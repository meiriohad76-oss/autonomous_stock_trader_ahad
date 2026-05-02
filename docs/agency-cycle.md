# Agency Cycle

The Agency Cycle is the step-by-step operating state for the autonomous trade agency. It turns the separate worker dashboards into one ordered flow:

1. Universe Agent
2. Fundamentals Agent
3. Market Agent
4. Signals Agent
5. Portfolio Policy Agent
6. Deterministic Selection Agent
7. LLM Selection Agent
8. Final Selection Agent
9. Risk Manager
10. Execution Agent
11. Portfolio Monitor
12. Learning Agent

The cycle is autonomous for analysis, ranking, risk checks, portfolio monitoring, and learning from paper outcomes. Alpaca paper submission remains supervised and requires explicit user approval.

## Initial Baseline vs Ongoing Updates

The agency now separates first-load readiness from normal refreshes:

- `initial_baseline`: the first full operating baseline is still being built. Required workers must load their baseline data before the system promotes decisions to preview or paper approval.
- `ongoing_updates`: the first baseline is complete. Workers continue refreshing on their configured schedule, and stale or blocked sources are shown as update issues rather than first-load blockers.

Recommended cadence:

- initial baseline cycle: every 5 minutes until all required workers are baseline-ready
- ongoing agency cycle: every 15 minutes during market hours
- SEC fundamentals first-load catch-up: one bounded batch every 15 minutes, then the normal SEC refresh interval after coverage is complete
- market/news/signals: use the configured source intervals, with paper execution gated whenever live pricing is fallback, synthetic, or unconfirmed

The Command dashboard exposes `Initial Baseline`, `Ongoing Updates`, `Recommended Cadence`, and `Next Scheduled` cards so a worker no longer looks stuck when it is either waiting for a scheduled catch-up batch or blocked by missing live data.

## Dashboard

Open the Command screen. The `Autonomous Cycle` panel shows:

- the current worker stage
- whether the agency is collecting inputs, ready for preview, or ready for supervised paper approval
- whether the agency is in first-load baseline mode or ongoing update mode
- the next action to take
- a twelve-agent status bar and timeline that open each worker dashboard

If a data source is stale or missing, the panel surfaces the matching one-shot runtime action, such as polling news, market flow, or SEC fundamentals.

Use `Run Agency Cycle` when you want the system to perform a bounded autonomous pass. It refreshes the data workers, recomputes deterministic selection, LLM-shadow selection, final selection, risk, portfolio, and learning snapshots, and records the run in the cycle log. It never submits an Alpaca order.

## API

```bash
curl -s http://127.0.0.1:3000/api/agency/cycle | jq
```

Useful fields:

- `mode`: `initial_baseline`, `collecting_inputs`, `analysis_ready`, `ready_for_preview`, or `ready_for_paper_approval`
- `baseline_ready`: whether the first full baseline is complete
- `initial_baseline`: aggregate first-load readiness
- `ongoing_refresh`: scheduled update state after baseline readiness
- `refresh_cadence`: configured baseline and ongoing cadence recommendation
- `current_worker_label`: the worker that needs attention now
- `workers`: all twelve worker states
- `next_actions`: operator-readable next steps
- `can_preview_orders`: whether execution previews are allowed
- `can_submit_orders`: whether supervised Alpaca paper submission is allowed

## Run A Bounded Cycle

```bash
curl -s -X POST http://127.0.0.1:3000/api/agency/cycle/run \
  -H 'Content-Type: application/json' \
  -d '{"window":"1h","priceLimit":25,"includeHeavy":false}' | jq
```

The bounded run refreshes:

- allowed universe
- a limited pricing/reference sample
- market flow
- live news
- SEC Form 4 insider flow
- selection, final selection, risk, portfolio, and learning snapshots

Heavy actions such as SEC fundamentals and SEC 13F are skipped unless `includeHeavy` is `true`.

## Advance One Stage

```bash
curl -s -X POST http://127.0.0.1:3000/api/agency/cycle/advance \
  -H 'Content-Type: application/json' \
  -d '{"window":"1h"}' | jq
```

Advance runs only the safest next worker action:

- Universe: refresh the allowed universe
- Fundamentals: run one SEC fundamentals batch
- Market: refresh pricing and broad market-flow context
- Signals: refresh news, Form 4 insider flow, trade prints, and inferred money flow
- Risk, Portfolio, Learning: refresh read-only snapshots
- Execution: preview a paper ticket only when previews are allowed

It never submits an Alpaca order. Paper submission remains behind the Execution Agent confirmation flow.

## Check

```bash
npm run check:agency-cycle
```
