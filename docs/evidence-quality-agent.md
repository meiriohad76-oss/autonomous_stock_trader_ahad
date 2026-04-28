# Evidence Quality Agent

The Evidence Quality Agent is the system's reusable trust layer. It is not a dashboard-only feature. It runs inside the backend pipeline and produces a structured quality verdict for every scored document before sentiment states, alerts, trade setups, and dashboards consume that document.

## Purpose

The agent answers a narrow but important question:

> How much should the rest of the product trust this piece of evidence?

It helps prevent weak, stale, duplicated, provisional, or poorly classified events from looking as important as fresh, corroborated, high-quality evidence.

## Pipeline Position

Current order:

```text
raw source item
-> normalize document
-> dedupe cluster assignment
-> rule classification
-> simulated LLM score
-> Evidence Quality Agent
-> sentiment aggregation
-> alerts
-> macro regime
-> trade setup agent
-> dashboards and APIs
```

This order is intentional. The agent needs the normalized document, dedupe cluster, rule/LLM score, and source metadata before it can judge trust. The downstream layers then use the same quality verdict instead of each screen inventing its own interpretation.

## Inputs

The agent consumes:

- `normalized`: ticker mapping, source name/type, freshness, extraction quality, source trust, URL/body availability, novelty score, and ticker mapping confidence.
- `score`: event type, event family, sentiment score, impact score, relevance, classification confidence, final confidence, and reason codes.
- `cluster`: dedupe member count, unique source count, canonical URL/headline, and novelty.
- `store`: recent scored documents and normalized documents for corroboration checks.

## Output Contract

Each document receives an `evidence_quality` object:

```json
{
  "evidence_id": "uuid",
  "doc_id": "uuid",
  "score_id": "uuid",
  "ticker": "AAPL",
  "source_type": "rss",
  "source_name": "google_news_rss",
  "event_type": "monitor_item",
  "published_at": "2026-04-28T10:00:00.000Z",
  "evaluated_at": "2026-04-28T10:01:00.000Z",
  "age_hours": 0.02,
  "freshness_score": 0.99,
  "source_reliability_score": 0.66,
  "classification_confidence": 0.52,
  "duplication_score": 0,
  "corroboration_score": 0.18,
  "extraction_quality_score": 0.8,
  "mapping_confidence": 0.94,
  "data_quality_label": "needs_confirmation",
  "display_tier": "watch",
  "downstream_weight": 0.61,
  "reason_codes": ["limited_corroboration"],
  "explanation": "Useful, but should be confirmed by another source or stronger classification..."
}
```

## Quality Labels

- `high_quality`: fresh, reliable, sufficiently classified, and usable by downstream ranking.
- `needs_confirmation`: useful but has limited corroboration or weaker source reliability.
- `stale`: too old to drive current decisions.
- `duplicate`: likely repeats an existing item.
- `low_signal`: weak classification, weak relevance, or generic monitor item.
- `source_limited`: ticker/source mapping is incomplete.

## Display Tiers

- `alert`: strong enough to drive alerts and high-impact UI.
- `watch`: relevant enough to monitor and use in ranking.
- `context`: useful background, but not a primary driver.
- `suppress`: duplicate or too weak to add meaningful downstream weight.

## Criteria

The agent scores evidence using:

- Freshness: based on normalized timeliness and age in hours.
- Source reliability: combines configured source trust with source type weight.
- Classification confidence: from rule and simulated LLM scoring.
- Duplication: based on novelty score and dedupe cluster behavior.
- Corroboration: checks same ticker/event type across recent independent sources.
- Extraction quality: rewards headline/body/ticker/url completeness.
- Mapping confidence: rewards explicit ticker hints and clean entity mapping.

These criteria produce a `downstream_weight` from `0` to `1`.

## Downstream Consumers

- Sentiment aggregation uses `downstream_weight` and `display_tier` to reduce the impact of weak/context-only evidence.
- Alerts skip `suppress` evidence and carry evidence quality in alert payloads.
- Recent news and ticker detail APIs expose `evidence_quality`, `display_tier`, and `downstream_weight`.
- Trade Setup Agent filters suppressed evidence and adjusts conviction using average evidence quality.
- Dashboard signal drawers display evidence quality and downstream weight for inspectability.

## API

```bash
GET /api/evidence-quality
GET /api/evidence-quality?ticker=NVDA
GET /api/evidence-quality?tier=alert
GET /api/evidence-quality?limit=100
```

## Engine Contract Check

Use the dedicated check whenever this layer or a downstream consumer changes:

```bash
npm run check:evidence-quality
```

The check replays local sample events and verifies that:

- The Evidence Quality Agent produced item-level verdicts.
- Health exposes the evidence-quality summary.
- Recent documents expose `evidence_quality`, `display_tier`, and `downstream_weight`.
- Trade setups expose evidence-quality context.
- Every quality score remains finite and bounded from `0` to `1`.
- Document scores retain reusable `downstream_weight` values for non-UI consumers.

The endpoint returns:

```json
{
  "summary": {
    "total_evidence_items": 20,
    "average_downstream_weight": 0.63,
    "display_tiers": {
      "alert": 3,
      "watch": 8,
      "context": 7,
      "suppress": 2
    }
  },
  "items": []
}
```

## Current Real Data Sources Used

The agent does not fetch data directly. It evaluates evidence produced by the current collectors:

- Google News RSS: ticker and company news.
- Market-data provider: synthetic fallback or Twelve Data when configured.
- Market Flow Monitor: abnormal volume and block-style tape anomaly events.
- SEC Form 4 Collector: official insider transaction filings.
- SEC 13F Collector: institutional holdings changes from tracked managers.
- SEC fundamentals flow: official SEC submissions and company facts for fundamentals context.
- Replay dataset: local sample events for offline testing.

## Design Rule

If another product component needs to decide whether a signal is trustworthy, it should consume this agent's output instead of reimplementing trust logic in UI code.
