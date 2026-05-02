# Autonomous Trading Agency Operating Model

Last updated: 2026-05-02

This document explains how the trading agency is intended to work, what each agent does, what each agent produces, and how the LLM Selection Agent should behave inside the workflow.

The product goal is a supervised autonomous paper-trading agency that works toward a configurable weekly portfolio target, currently 3%. That target is a planning and risk-budget objective, not a promise of return and not a reason to force trades.

The system is intentionally guarded:

- The allowed equity universe is S&P 100 plus QQQ holdings.
- The agency may analyze and prepare Alpaca paper-trade previews automatically.
- Alpaca order submission stays gated and requires explicit user approval.
- Seed/sample data must not be used for production trade decisions.
- The LLM Selection Agent is a reviewer, not an execution authority.

## High-Level Flow

The agency runs in two phases:

1. Initial baseline load
   - Load the allowed universe.
   - Build fundamentals coverage.
   - Refresh market/pricing context.
   - Refresh signals, news, money flow, insider/institutional evidence, earnings, and other event feeds.
   - Confirm portfolio policy, risk, broker status, and system health.
   - Only after required baseline workers are ready should the agency be considered decision-ready.

2. Ongoing updates
   - Refresh data on a scheduled cadence.
   - Recompute deterministic setups.
   - Re-run LLM review.
   - Re-run final selection.
   - Re-run risk and execution preview readiness.
   - Feed results into the learning/monitoring loop.

Recommended cadence:

- Initial baseline cycle: every 5 minutes until all required workers are baseline-ready.
- Ongoing agency cycle: every 15 minutes during market hours.
- SEC fundamentals catch-up: bounded batches during baseline, then lower-frequency refresh.
- Market/news/signals: run on their configured source intervals.

## Agent Summary

| Step | Agent | Main Question | Main Output |
| --- | --- | --- | --- |
| 1 | Universe Agent | Which tickers are allowed? | S&P 100 plus QQQ allowed universe |
| 2 | Fundamentals Agent | Which companies are fundamentally strong enough? | Research-governed factor scores and screen stage |
| 3 | Market Agent | Is the market/sector backdrop supportive or hostile? | Regime, bias, thresholds, sector/market context |
| 4 | Signals Agent | What fresh evidence exists around the stocks? | News, alerts, money flow, insider/institutional evidence |
| 5 | Portfolio Policy Agent | What rules must the portfolio obey? | User-editable sizing, target, stop, exposure, and capacity rules |
| 6 | Deterministic Selection Agent | What does the rules engine recommend? | Long, short, watch, or no-trade setups with conviction |
| 7 | LLM Selection Agent | Does a qualitative reviewer agree, demote, or challenge? | Structured review with action, confidence, support, concerns, missing data |
| 8 | Final Selection Agent | Which names survive both selectors and policy? | Final buy/sell/review/watch list and selection reports |
| 9 | Risk Manager | Is the recommendation safe against risk limits? | Risk pass/block result and exposure checks |
| 10 | Execution Agent | What Alpaca paper ticket would be prepared? | Previewable order intent, bracket details, submit gate state |
| 11 | Portfolio Monitor | What positions/orders need action? | Hold/reduce/close candidates and weekly progress |
| 12 | Learning Agent | What did the agency learn from outcomes? | Improvement suggestions for each worker |

## Agent Details

### 1. Universe Agent

Mission:

Keep the agency inside the approved stock universe: S&P 100 plus QQQ holdings.

Inputs:

- Tracked universe files or provider-derived holdings.
- Company metadata such as ticker, company name, sector, aliases, and base/reference price.

Process:

- Normalize tickers.
- Remove duplicates.
- Maintain the allowed boundary.
- Prevent sample/test tickers from becoming production candidates.

Output:

- Allowed ticker list.
- Universe count.
- Company metadata used by downstream agents.

Dashboard role:

Shows whether the agency has loaded the full allowed universe and whether any universe refresh is needed.

### 2. Fundamentals Agent

Mission:

Rank allowed stocks by business quality, valuation sanity, growth, stability, balance sheet, cash efficiency, and data confidence.

Inputs:

- SEC fundamentals when available.
- Bootstrap/fallback fundamentals only as provisional visibility, not as fully trusted production proof.
- Market reference data such as price, beta, and valuation references.
- User-editable screener thresholds.

Process:

- Compute factor scores.
- Apply first-pass criteria.
- Assign a stage such as eligible, watch, or reject.
- Explain each criterion using the research-governed registry.
- Track whether data is live SEC-backed or still bootstrap.

Default factor families:

- Profitability quality.
- Fundamental growth.
- Valuation.
- Financial strength.
- Cash efficiency.
- Earnings stability.
- Sector context.
- Data quality.

Research basis:

- Piotroski-style accounting signal discipline.
- Fama-French profitability and investment factors.
- Sloan accrual/cash-flow quality logic.
- Gross profitability and quality-style evidence.
- Factor-zoo caution: thresholds are research-aligned defaults until validated by local point-in-time backtests.

Output:

- Composite fundamental score.
- Screen stage.
- Direction label, such as bullish_supportive, neutral, or bearish_headwind.
- Reason codes.
- Data source status, including SEC-backed versus bootstrap.
- Criteria explanations.

Dashboard role:

Shows factor scores, criteria, research basis, live SEC coverage, and why a company passed, stayed watch, or failed.

### 3. Market Agent

Mission:

Read the market and sector backdrop that may help or hurt individual stocks.

Inputs:

- Market/sector sentiment states.
- Market-flow evidence.
- Pricing data.
- Breadth data.
- Fresh alerts and market-level evidence.

Process:

- Compute long and short market scores.
- Classify regime:
  - risk_on
  - risk_off
  - high_dispersion
  - balanced
- Set long/short thresholds used by Deterministic Selection.

Example thresholds:

- Balanced: long threshold 0.56, short threshold 0.56.
- Risk-on: long threshold lower, short threshold higher.
- Risk-off: long threshold higher, short threshold lower.
- High dispersion: both thresholds higher because selectivity matters.

Output:

- Regime label.
- Bias label.
- Risk posture.
- Exposure multiplier.
- Market long/short thresholds.
- Supporting signals and risk flags.

Dashboard role:

Explains whether the agency should be aggressive, defensive, or selective.

### 4. Signals Agent

Mission:

Collect and interpret fresh evidence around stocks and the market.

Inputs:

- Marketaux/news feeds.
- RSS/news fallback feeds.
- SEC Form 4 insider activity.
- SEC 13F institutional activity.
- Market flow from pricing/volume.
- Trade prints/block trades when a provider is configured.
- Earnings calendar.
- Social/crowd data when a provider is configured.

Signal types:

- News sentiment.
- Insider buying/selling.
- Institutional buying/selling.
- Abnormal volume.
- Block trade buying/selling.
- Smart money accumulation/distribution.
- Earnings events.
- High-confidence positive/negative alerts.
- Polarity reversals.

Process:

- Normalize raw documents.
- Match evidence to tickers.
- Score event type, confidence, freshness, and downstream weight.
- Suppress low-quality evidence.
- Preserve source links where available.

Output:

- Fresh evidence items.
- Alert history.
- Money-flow radar.
- Evidence quality diagnostics.
- Source health and freshness.

Dashboard role:

Shows live evidence, links to sources, money-flow concentration, and signal diagnostics.

### 5. Portfolio Policy Agent

Mission:

Own user-editable portfolio rules. These rules must be followed by selection, risk, execution, monitoring, and learning.

Inputs:

- User policy settings from environment/config/dashboard.
- Broker account and position state when available.

Current policy areas:

- Weekly target percentage.
- Minimum final conviction for execution preview.
- Maximum weekly drawdown.
- Maximum positions.
- Maximum new positions per cycle.
- Maximum position size.
- Maximum gross exposure.
- Maximum sector exposure.
- Cash reserve.
- Default stop loss.
- Default take profit.
- Trailing stop.
- Minimum hold period.
- Allow/disallow adding to existing positions.
- Allow/disallow reductions.

Output:

- Normalized policy object.
- Policy status.
- Policy guardrails.
- Policy usage/capacity.

Dashboard role:

Lets the user see and edit the rules the agency must obey.

### 6. Deterministic Selection Agent

Mission:

Use rules and scores to convert the allowed universe into trade setups.

Inputs:

- Fundamentals Agent output.
- Market Agent regime and thresholds.
- Signals Agent evidence.
- Money-flow evidence.
- Runtime reliability.
- Earnings risk.
- Price/reference data.

Process:

- Build a long score and short score for each ticker.
- Add/subtract score components from:
  - sentiment
  - momentum
  - story velocity
  - evidence quality
  - money flow
  - fundamentals
  - alerts
  - earnings risk
  - market regime
  - runtime reliability
- Compare scores to market-regime thresholds.
- Require directional separation between long and short scores.
- Assign action:
  - long
  - short
  - watch
  - no_trade
- Build a price plan:
  - current price
  - entry zone
  - stop loss
  - take profit
  - timeframe
  - suggested position size

Output:

- Trade setup per ticker.
- Deterministic action.
- Deterministic conviction.
- Score components.
- Decision thresholds.
- Decision blockers.
- Thesis.
- Risk flags.
- Positive/negative evidence.
- Entry/stop/target plan.

Dashboard role:

Shows what the rules engine is doing and why a stock is buy, short, watch, or no trade.

### 7. LLM Selection Agent

Mission:

Act as a parallel qualitative reviewer. The LLM Selection Agent should behave like an investment committee member that reviews the same candidate pack and challenges the deterministic result.

It should not replace the deterministic rules engine. It should add qualitative reasoning, disagreement detection, missing-data detection, and better explanation.

Current model path:

- Provider: OpenAI when configured.
- Model: gpt-5.4-mini by default.
- API: Responses API.
- Output mode: strict JSON schema.
- Fallback: local shadow reviewer when the API key is missing or provider errors.

Current prompt version:

```text
llm_selection_committee_v2
```

Inputs sent to the LLM:

- Mission and role.
- Non-negotiable constraints.
- Decision protocol.
- Review rubric.
- Confidence calibration scale.
- Portfolio policy.
- Candidate field guide.
- Candidate list, usually capped by `LLM_SELECTION_MAX_CANDIDATES`.

Each candidate includes:

- Ticker.
- Company name.
- Sector.
- Deterministic action.
- Deterministic conviction.
- Setup label.
- Summary.
- Score components.
- Decision thresholds.
- Decision blockers.
- Fundamentals.
- Macro regime.
- Sentiment.
- Evidence.
- Evidence quality.
- Runtime reliability.
- Position size.
- Timeframe.
- Current price.
- Entry zone.
- Stop loss.
- Take profit.
- Risk flags.
- Recent documents, including headline, source, published time, event type, confidence, display tier, downstream weight, and URL when present.

Required LLM output per candidate:

```json
{
  "ticker": "AAPL",
  "action": "long | short | watch | no_trade",
  "confidence": 0.0,
  "rationale": "Plain-language reason for the chosen action.",
  "supporting_factors": ["Grounded support item"],
  "concerns": ["Grounded concern item"],
  "evidence_alignment": "How the agent lanes agree or conflict.",
  "risk_assessment": "Biggest execution or data risk.",
  "confidence_reason": "Why this confidence level is calibrated here.",
  "missing_data": ["Missing or weak input"]
}
```

What the LLM can do:

- Agree with a deterministic long or short.
- Demote a deterministic long/short to watch/no_trade.
- Flag direction conflict.
- Flag weak evidence, stale evidence, or missing data.
- Identify when the story does not justify the risk.
- Improve explanations for the user-facing selection report.

What the LLM cannot do:

- It cannot submit orders.
- It cannot override portfolio policy.
- It cannot override Risk Manager.
- It cannot promote a watch/no_trade candidate directly into execution by itself.
- It cannot invent data not provided in the candidate pack.
- It cannot use external memory or market knowledge unless that data is in the JSON packet.
- It cannot treat the 3% weekly target as a reason to force a trade.

How Final Selection uses the LLM:

- If deterministic and LLM agree on long/short, the candidate can continue to policy and risk gates.
- If the LLM demotes, the candidate goes to review.
- If the LLM conflicts on direction, the candidate goes to review.
- If the LLM promotes a deterministic watch/no_trade, the candidate stays watch/review.
- Final Selection still applies portfolio policy after selector agreement.

Dashboard role:

Shows LLM mode, provider, model, review counts, action, confidence, rationale, support, concerns, evidence alignment, risk assessment, confidence reason, and missing data.

### 8. Final Selection Agent

Mission:

Arbitrate between the deterministic selector and the LLM selector, then apply portfolio policy.

Inputs:

- Deterministic setups.
- LLM reviews.
- Portfolio policy.
- Risk snapshot.
- Position monitor.

Process:

- Combine deterministic conviction and LLM confidence.
- Apply agreement bonus or disagreement penalty.
- Apply runtime and risk-flag penalties.
- Require final conviction to clear the user policy minimum.
- Apply policy gates:
  - single position size
  - final conviction minimum
  - position capacity
  - new positions per cycle
  - allow adds
  - cash reserve
  - gross exposure
  - sector exposure

Current final conviction formula:

```text
final_conviction =
  deterministic_conviction * 0.62
  + llm_confidence * 0.28
  + agreement_bonus
  - runtime_penalty
  - risk_flag_penalty
```

Agreement effects:

- Agree on tradable action: +0.07.
- Direction conflict: -0.18.
- LLM demotion: -0.09.
- LLM-only promotion: -0.12.

Output:

- Final action.
- Final conviction.
- Required final conviction.
- Execution allowed yes/no.
- Policy gates.
- Reason codes.
- Setup for execution, if allowed.
- Selection report.

Dashboard role:

Shows final buy/sell/review/watch lists and expands each stock into a selection report.

### 9. Risk Manager

Mission:

Check whether a recommendation is safe against exposure, buying power, position limits, open orders, and runtime reliability.

Inputs:

- Final Selection candidate.
- Broker account.
- Open positions.
- Open orders.
- Portfolio policy.
- Runtime reliability.

Process:

- Check gross exposure.
- Check single-name exposure.
- Check open order count.
- Check buying power.
- Check risk hard blocks.
- Confirm broker state.

Output:

- Risk status.
- Allowed/blocked result.
- Checks and reasons.
- Proposed post-trade exposure.

Dashboard role:

Shows why a candidate can or cannot move toward execution preview.

### 10. Execution Agent

Mission:

Translate approved final selections into Alpaca paper-trade previews, then wait for explicit user approval before submission.

Inputs:

- Final selected setup.
- Portfolio policy.
- Risk check.
- Alpaca broker configuration.

Process:

- Create order intent.
- Estimate notional and quantity.
- Attach bracket order details when enabled:
  - take profit
  - stop loss
- Verify minimum conviction.
- Verify minimum notional.
- Verify maximum order size.
- Verify broker mode and submit gate.

Output:

- Preview order.
- Risk evaluation.
- Broker readiness.
- Submit eligibility.

Hard guardrail:

No order should be submitted unless:

- Alpaca is configured.
- Paper mode is active or live mode is explicitly allowed.
- `BROKER_SUBMIT_ENABLED=true`.
- User gives the required confirmation.
- Risk allows the order.
- The setup is final-selected and execution-ready.

Dashboard role:

Shows preview and submission status. Submission remains supervised.

### 11. Portfolio Monitor

Mission:

Watch existing positions, open orders, sell/reduce candidates, and progress toward the weekly target.

Inputs:

- Alpaca positions.
- Alpaca orders.
- Latest trade setups.
- Portfolio policy.

Process:

- Match current positions to latest setup action.
- Detect stop-loss breach.
- Detect take-profit reached.
- Detect trailing stop review.
- Detect no-trade/close candidates.
- Track visible unrealized P/L.

Output:

- Position list.
- Open order list.
- Close candidates.
- Reduce candidates.
- Weekly target progress.

Dashboard role:

Shows what the agency should hold, reduce, or close after positions exist.

### 12. Learning Agent

Mission:

Compare agency decisions with outcomes and recommend algorithm improvements.

Inputs:

- Final selections.
- Approved/rejected decisions.
- Alpaca paper fills.
- Open and closed position P/L.
- Position monitor output.
- Trade reports.

Process:

- Attribute revenue/loss to decision drivers.
- Identify repeated weak signals.
- Identify good signals that led to winning trades.
- Suggest changes to thresholds, sizing, evidence weighting, LLM instructions, and risk rules.

Output:

- Decision journal.
- Revenue/loss attribution.
- Improvement suggestions by worker.

Dashboard role:

Shows how the agency should improve after enough paper outcomes exist.

## Selection Report

When a stock passes through Final Selection, the system creates a structured selection report.

Report sections:

- Approval status.
- Executive summary.
- Agent votes.
- Why it passed.
- Concerns to watch.
- Policy gates.
- Recent evidence.
- Trade plan.

Report status examples:

- `approved_for_alpaca_preview`
- `requires_human_review`
- `watch_only`
- `not_selected`

The report is meant to answer:

- Why was this stock selected?
- Which agents supported it?
- Which agents were cautious?
- Which policy gates passed or blocked it?
- What is the planned size, stop, target, and notional?
- What data is missing or weak?
- What should the user check before approving a paper trade?

## How To Write Better Instructions For The LLM Selection Agent

Use this section as a template when rewriting the LLM Selection Agent prompt.

### 1. Identity And Mandate

Define what the LLM is:

- Investment committee reviewer.
- Qualitative challenger.
- Evidence auditor.
- Risk-aware selection reviewer.
- Explanation generator.

Define what it is not:

- Not a broker.
- Not a trade submitter.
- Not a deterministic replacement.
- Not allowed to invent market facts.

### 2. Decision Authority

Specify authority boundaries:

- Can agree with deterministic selector.
- Can demote.
- Can flag conflict.
- Can recommend watch/no_trade.
- Can suggest long/short only from supplied evidence.
- Cannot send anything to execution without deterministic and policy support.

### 3. Evidence Rules

Tell the LLM exactly how to treat evidence:

- Prefer fresh evidence.
- Penalize stale evidence.
- Penalize context-only evidence.
- Require source-linked evidence when possible.
- Treat missing source links as lower confidence.
- Treat conflicting evidence as reason for watch/review.
- Never fill missing evidence from memory.

### 4. Scoring And Confidence

Define how confidence should be calibrated:

- High confidence requires multi-agent alignment.
- Medium confidence means actionable but still supervised.
- Low confidence means watch/no_trade.
- Confidence is not probability of profit.
- Confidence is not a price target.
- Confidence should fall when data quality falls.

### 5. Risk Rules

Tell the LLM to explicitly consider:

- Earnings windows.
- Runtime/source reliability.
- Thin evidence.
- Negative money flow.
- Stretched valuation.
- Poor fundamentals.
- Sector concentration.
- Position sizing.
- Stop/target distance.
- Policy capacity.

### 6. Missing Data

Force the LLM to list what would improve the decision:

- More recent news.
- Source-linked money flow.
- Insider/institutional confirmation.
- SEC-backed fundamentals.
- Fresh price/volume data.
- Market/sector confirmation.
- Earnings date confirmation.

### 7. Output Style

Require output to be:

- Short but complete.
- Grounded in supplied fields.
- Specific to the ticker.
- Clear enough for a user to approve or reject.
- JSON only.

## Suggested LLM Instruction Draft Structure

Use this outline when you write the instructions you want me to implement:

```text
You are the LLM Selection Agent for a supervised autonomous paper-trading agency.

Mission:
[Your mission text]

Authority:
[What the LLM can and cannot decide]

Evidence Rules:
[How to treat fundamentals, market, signals, money flow, news, insider, institutional, and data quality]

Decision Protocol:
[Step-by-step review process for each candidate]

Confidence Calibration:
[Your desired confidence scale]

Risk Discipline:
[How to handle risk flags, missing data, policy gates, and uncertainty]

Output Requirements:
[Fields, tone, length, and JSON-only requirements]

Hard Prohibitions:
[No invented data, no trade submission, no guarantees, no outside knowledge unless supplied]
```

## Current Known Production Gaps

These are operational gaps, not design goals:

- If `OPENAI_API_KEY` or `LLM_SELECTION_API_KEY` is blank, the LLM Selection Agent uses local shadow review.
- If StockTwits is disabled, social/crowd sentiment is missing.
- If trade prints are disabled, direct block-trade evidence is missing.
- If a fundamentals row is still bootstrap, it should stay watch-only until live SEC data is available.
- Paper submission should remain gated until the user deliberately enables it.

## Glossary

- Deterministic selector: Rules-based scoring engine.
- LLM selector: Qualitative parallel reviewer.
- Final selector: Arbitration layer combining deterministic, LLM, and portfolio policy.
- Execution-ready: Candidate has passed final selection and can be sent to guarded Alpaca preview.
- Paper submit ready: Broker is configured and submit gate is intentionally enabled.
- Bootstrap fundamentals: Provisional fundamentals data that should not be treated as fully live SEC-backed.
- Shadow review: Local non-OpenAI fallback reviewer used when the LLM provider is unavailable.
- Evidence quality: Freshness, source reliability, classification confidence, and corroboration strength.
