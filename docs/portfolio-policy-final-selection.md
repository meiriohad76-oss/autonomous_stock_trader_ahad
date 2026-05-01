# Portfolio Policy And Final Selection

## Portfolio Policy Agent

The Portfolio Policy Agent owns user-editable trading rules. The dashboard exposes these rules in the Portfolio page and writes them to `.env` through `POST /api/settings/portfolio-policy`.

Current rules:

- Weekly target and weekly drawdown guardrail.
- Maximum positions and maximum new positions per cycle.
- Maximum single-position size, gross exposure, and sector exposure.
- Cash reserve requirement.
- Default stop loss, take profit, trailing stop, and minimum hold window.
- Whether adding to an existing ticker or reducing a winning position is allowed.

The policy is consumed by:

- Final Selection, before a candidate can reach Risk.
- Risk Manager, as an overlay on existing exposure limits.
- Execution Agent, for position-size caps and bracket exits.
- Portfolio Monitor, for stop-loss, take-profit, and reduction alerts.

## Parallel Selection Agents

The system now has two selection lanes:

- Deterministic Selection Agent: rules-based scoring from fundamentals, market regime, signals, money flow, runtime reliability, and price plan.
- LLM Selection Agent: qualitative parallel reviewer. By default it runs in local shadow mode, explains support and concerns, and can be connected to an LLM provider later through configuration.

Both lanes explain each ticker decision.

## Final Selection Procedure

Final Selection uses this sequence:

1. Start only from the allowed upstream universe and fresh evidence gates.
2. Score candidates with the deterministic rules engine.
3. Review the same candidate pack with the LLM selection lane.
4. Promote only names where deterministic and LLM actions agree.
5. Keep LLM-only promotions as watch/review. The LLM cannot override deterministic no-trade by itself.
6. Demote disagreements to review.
7. Apply portfolio policy: size cap, new-position cap, position capacity, cash reserve, gross exposure, sector exposure, and add-to-position rules.
8. Send only final executable candidates to Risk and Execution preview.
9. Alpaca submission remains supervised and still requires explicit approval.

The main endpoint is `GET /api/final-selection?window=1h&limit=12`.

## Agency Worker Map

The Command Center cycle now exposes twelve workers:

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

For Raspberry Pi verification after pulling a new version:

```bash
cd ~/sentiment-analyst
git pull --ff-only origin main
npm install
npm run check:agency-operational
```
