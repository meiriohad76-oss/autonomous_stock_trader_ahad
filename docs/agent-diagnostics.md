# Agent Diagnostics

Use the deep agent diagnostic runner when an agent looks stuck, stale, or unclear in the dashboard.

The runner initializes the app, checks each worker independently, optionally performs safe extraction actions, and writes two files:

- `data/runtime/agent-diagnostics/agent-diagnostics-<timestamp>.json`
- `data/runtime/agent-diagnostics/agent-diagnostics-<timestamp>.jsonl`

The JSON report is the full evidence pack. The JSONL file is the event stream and is easier to tail or grep.

Both files are created at startup and checkpointed while the diagnostic is running. If the Pi kills the process or an SSH session drops, inspect the newest `.jsonl` file and the partial `.json` report to see the last completed step.

By default, the all-agent diagnostic does not force a live universe refresh. It inspects the currently loaded S&P 100 plus QQQ universe, then moves on to the rest of the agents. This keeps one slow reference download from blocking the full diagnostic report.

## Common Commands

Inspect all agents without polling live providers:

```bash
npm run check:agents -- --no-extract
```

Run a bounded live check for the stuck baseline agents:

```bash
npm run check:agents -- --agent market,fundamentals --max-sec-batches 2 --price-limit 8
```

SEC fundamentals diagnostics are Pi-safe by default: each diagnostic SEC batch is capped to 2 companies with concurrency 1. Use `--sec-company-limit <n>` and `--sec-concurrency <n>` to change that, or `0` to keep the `.env` values.

Run the Signals Agent and log every source extraction attempt:

```bash
npm run check:agents -- --agent signals
```

Run one specific agent:

```bash
npm run check:agents -- --agent execution
```

Force-test the live Universe Agent reference refresh:

```bash
npm run check:agents -- --agent universe --refresh-universe
```

Watch the live event stream while a diagnostic is running:

```bash
latestlog=$(ls -t data/runtime/agent-diagnostics/*.jsonl | head -1)
tail -f "$latestlog"
```

Fail CI or a deployment script when any agent reports `fail`:

```bash
npm run check:agents -- --fail-on-agent-fail
```

## Agent Keys

`universe`, `fundamentals`, `market`, `signals`, `policy`, `deterministic_selection`, `llm_selection`, `final_selection`, `risk`, `execution`, `portfolio`, `learning`

## What To Read

For each agent, inspect:

- `worker_before` and `worker_after`: dashboard-facing readiness state before and after the check.
- `completion_estimate` and `full_extraction_estimate`: ETA, basis, and blocked/configuration notes for that worker.
- `extraction_log`: every runtime extraction action, payload, duration, source health before and after, counters before and after, and result summary.
- `checks`: pass/warning/fail assertions for that agent.
- `output_summary`: the agent-specific result, such as SEC coverage, live pricing status, recent signal links, final-selection counts, broker readiness, or learning sample size.

Optional sources such as StockTwits, delayed trade prints, and SEC 13F can be skipped or warning-only without failing the whole Signals Agent. Required live-pricing or SEC-fundamentals failures still show as agent failures.

Diagnostics never submit Alpaca orders. The Execution Agent may preview a ticket only when an executable final-selection candidate exists.
