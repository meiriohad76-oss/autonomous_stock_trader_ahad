# Fundamental Research Governance

The Fundamentals Agent now separates three claims:

1. The factor families are research-aligned.
2. The default thresholds are operational defaults.
3. A threshold is only "proven" after a local point-in-time backtest validates it for the S&P 100 + QQQ universe, the portfolio policy, and execution assumptions.

## Criteria Registry

Each stage-one criterion exposes:

- `factor_family`
- `default_value`
- `current_value`
- `research_basis`
- `why_it_matters`
- `backtest_status`

The current criterion set is:

- Large-cap scale
- High filing quality
- Growth clears baseline
- Profitability clears baseline
- Balance sheet is healthy
- Cash conversion is acceptable
- Valuation is still tradable

## Default Profiles

The API exposes four profiles:

- `balanced`
- `conservative_quality`
- `growth_compounder`
- `value_quality`

Profiles are default threshold bundles. They are not proof that the bundle will outperform. They provide a disciplined starting point for validation and paper trading.

## Backtest Status

Every criterion includes the target backtest outputs:

- hit rate
- average forward return
- max drawdown
- false positive rate
- sector sensitivity

Until the local store has point-in-time fundamentals, forward price history, sector labels, and simulated execution costs, the status remains `pending_validation`.

## API

```bash
curl -s http://127.0.0.1:3000/api/settings/fundamental-screener | jq '.governance'
```

Apply a profile:

```bash
curl -s -X POST http://127.0.0.1:3000/api/settings/fundamental-screener \
  -H 'Content-Type: application/json' \
  -d '{"profile":"conservative_quality","persist":true}' | jq
```

Applying a profile writes the corresponding `.env` values through the existing screener settings flow.
