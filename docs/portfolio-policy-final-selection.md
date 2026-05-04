# Portfolio Policy And Final Selection

## Portfolio Policy Agent

The Portfolio Policy Agent owns user-editable trading rules. The dashboard exposes these rules in the Portfolio page and writes them to `.env` through `POST /api/settings/portfolio-policy`.

Current rules:

- Weekly target and weekly drawdown guardrail.
- Minimum Final Selection conviction required before Risk and Execution preview.
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
- LLM Selection Agent: qualitative parallel reviewer. By default it runs in local shadow mode; when `LLM_SELECTION_PROVIDER=openai` and `OPENAI_API_KEY` or `LLM_SELECTION_API_KEY` is configured, it calls OpenAI in strict JSON-review mode and falls back to the local shadow reviewer if the provider errors.

Both lanes explain each ticker decision.

OpenAI configuration:

```env
LLM_SELECTION_ENABLED=true
LLM_SELECTION_PROVIDER=openai
LLM_SELECTION_MODEL=gpt-5.5
LLM_SELECTION_API_URL=https://api.openai.com/v1/responses
LLM_SELECTION_MAX_CANDIDATES=12
LLM_SELECTION_MAX_OUTPUT_TOKENS=12000
LLM_SELECTION_REQUEST_TIMEOUT_MS=30000
OPENAI_API_KEY=
```

If the LLM lane falls back with an invalid or unterminated JSON error, the provider most likely hit the output-token cap while filling the strict review schema. Increase `LLM_SELECTION_MAX_OUTPUT_TOKENS` or temporarily reduce `LLM_SELECTION_MAX_CANDIDATES`.

## Final Selection Procedure

Final Selection uses this sequence:

1. Start only from the allowed upstream universe and fresh evidence gates.
2. Score candidates with the deterministic rules engine.
3. Review the same candidate pack with the LLM selection lane.
4. Promote only names where deterministic and LLM actions agree.
5. Keep LLM-only promotions as watch/review. The LLM cannot override deterministic no-trade by itself.
6. Demote disagreements to review.
7. Apply portfolio policy: minimum final conviction, size cap, new-position cap, position capacity, cash reserve, gross exposure, sector exposure, and add-to-position rules.
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
