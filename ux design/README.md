# Unusual Trading Activity UX Source

This folder is the canonical UX source for the Unusual Trading Activity Agent.

## Source Of Truth

- `Unusual Trading Activity Agent.html` is the live reference prototype.
- `styles.css`, `components.css`, `app.css`, `extras.css`, `feed.css`, and `scan.css` are the reference visual language.
- `data.js` and the `.jsx` files define prototype behavior and component boundaries.
- `spec/index.html`, `spec/design-system.html`, `spec/screens.html`, `spec/data-logic.html`, and `spec/tickets.html` are the build specification.
- `screenshots/` and `spec/images/` are visual baselines for QA.
- `uploads/` mirrors the UTA planning documents that also exist at the repo root.

## Reference And Archive Material

These files are retained as historical context for the wider trading dashboard, but they are not canonical for the UTA implementation:

- `project_brief_prd_sentiment_intelligence_system.md`
- `please_design_the_exact_sentiment_analyst_pipelin.md`
- `sentiment_intelligence_system/`
- `sentiment_dashboard_desktop/`
- `sentiment_dashboard_tablet/`
- `sentiment_dashboard_mobile/`

## Implementation Rules

- Do not collapse A, B, and C indicators into one score.
- Direction must come from signed flow, not price change.
- Optional lanes can add corroboration but must not penalize a tier.
- Tier D and capped-C states must not invent zero/default indicator values.
- Explain-tier UI must render the classifier payload, not duplicate classifier logic.

