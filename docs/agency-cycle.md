# Agency Cycle

The Agency Cycle is the step-by-step operating state for the autonomous trade agency. It turns the separate worker dashboards into one ordered flow:

1. Universe Agent
2. Fundamentals Agent
3. Market Agent
4. Signals Agent
5. Selection Agent
6. Risk Manager
7. Execution Agent
8. Portfolio Monitor
9. Learning Agent

The cycle is autonomous for analysis, ranking, risk checks, portfolio monitoring, and learning from paper outcomes. Alpaca paper submission remains supervised and requires explicit user approval.

## Dashboard

Open the Command screen. The `Autonomous Cycle` panel shows:

- the current worker stage
- whether the agency is collecting inputs, ready for preview, or ready for supervised paper approval
- the next action to take
- a nine-step timeline that opens each worker dashboard

If a data source is stale or missing, the panel surfaces the matching one-shot runtime action, such as polling news, market flow, or SEC fundamentals.

## API

```bash
curl -s http://127.0.0.1:3000/api/agency/cycle | jq
```

Useful fields:

- `mode`: `collecting_inputs`, `analysis_ready`, `ready_for_preview`, or `ready_for_paper_approval`
- `current_worker_label`: the worker that needs attention now
- `workers`: all nine worker states
- `next_actions`: operator-readable next steps
- `can_preview_orders`: whether execution previews are allowed
- `can_submit_orders`: whether supervised Alpaca paper submission is allowed

## Check

```bash
npm run check:agency-cycle
```
