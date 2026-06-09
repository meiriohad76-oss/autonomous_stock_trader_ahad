# UTA Validation And Calibration

This document defines the v1 validation gate for the Unusual Trading Activity Agent.

## Scope

The first validation phase is deterministic and replay-only. It does not enable paper trading, live execution, risk overrides, or buy/sell instructions.

Validation inputs:

- `data/uta/replay/historical-evaluation.json`
- `src/domain/uta-validation.js`
- `npm run check:uta-historical-replay`
- `npm run check:uta-calibration`
- `npm run check:uta-trading-integration`

## Historical Replay Report

`check:uta-historical-replay` evaluates forward returns at:

- 30 minutes
- 1 hour
- 1 day
- 5 days

The report groups results by:

- tier
- direction
- liquidity bucket

It also reports:

- actionable row count, excluding Tier D
- top-decile precision using `C.notional_ratio`
- 1-day false positive rate
- lane SLA pass rate

The rank metric is a raw C metric, not a composite score.

## Bias And Calibration Audit

`check:uta-calibration` verifies:

- no-look-ahead baseline windows
- B-score stability by tier
- lane SLA failures remain visible
- false positive rate is inside the fixture gate
- top-decile precision is inside the fixture gate
- tier averages are monotonic across A, B, and C
- Benjamini-Hochberg FDR correction rows are produced
- paper-trading effects remain blocked

The check also creates an intentional look-ahead mutation and requires the audit to catch it.

## Trading Gate

UTA evidence may not affect paper-trading behavior until all of these are accepted:

- historical replay report
- calibration audit
- Pi deployment smoke
- human review of validation metrics

Until then, UTA remains supporting evidence only.

`check:uta-trading-integration` verifies that UTA evidence can attach to final-selection candidate reports, but cannot change:

- final action
- final conviction
- execution permission
- position size
