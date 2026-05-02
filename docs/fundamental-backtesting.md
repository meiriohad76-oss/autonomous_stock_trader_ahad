# Fundamental Backtesting

The Fundamental Backtest engine is the validation layer for the Fundamentals Agent. It checks whether criteria and profiles are merely research-aligned, or whether they have local evidence inside this system.

## What It Tests

The engine reads the local fundamentals warehouse:

- `fundamental_scores`
- `fundamental_features`
- `fundamental_states`
- `market_reference`
- `coverage_universe`

It evaluates:

- stage-one screener criteria such as growth, profitability, balance sheet, cash efficiency, and valuation sanity
- score factors such as quality, growth, valuation, and composite score
- default profiles such as balanced, conservative quality, growth compounder, and value quality

## What Counts As Proof

A threshold is not treated as proven unless the engine has enough matured forward-return observations using real live/vendor market prices. Synthetic or fallback prices are excluded by default.

Default horizon:

```bash
5 trading/calendar days
```

Default minimum sample:

```bash
30 matured observations per rule
```

The output includes:

- hit rate
- average forward return
- benchmark return from failed names
- excess return versus failed names
- max drawdown
- false-positive rate
- sector sensitivity
- sample size
- limitations

## API

```bash
curl -s "http://127.0.0.1:3000/api/backtests/fundamentals?horizonDays=5&minSample=30" | jq
```

Synthetic/fallback price outcomes can be enabled only for local plumbing tests:

```bash
curl -s "http://127.0.0.1:3000/api/backtests/fundamentals?allowSyntheticPrices=true&minSample=5" | jq
```

Do not use synthetic-price results as research proof.

## Check

```bash
npm run check:backtest
```

## Current Expected State

On a fresh Pi or local machine, the engine will usually return `pending_validation`. That is correct. The system needs live/vendor daily adjusted prices across enough history before thresholds become proven.

The practical path is:

1. Enable Alpaca or Twelve Data market references.
2. Keep SEC fundamentals catch-up running in bounded batches.
3. Let observations mature for the selected horizon.
4. Review the Fundamentals dashboard backtest panel before changing thresholds or increasing paper size.
