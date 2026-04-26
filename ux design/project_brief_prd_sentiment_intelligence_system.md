# Project Brief: Sentiment Intelligence System (SENTIMENT.AI)

## 1. Project Overview
The **Sentiment Intelligence System** is an autonomous, event-driven pipeline designed to convert raw financial market data into structured, confidence-weighted sentiment signals. These signals are visualized in a real-time dashboard and served to downstream decision-making agents (e.g., a Chief Strategist agent).

The goal is to move beyond simple "bullish/bearish" labels to provide deep, ticker-linked insights with time-decayed impact analysis.

---

## 2. Core Objectives
- **Autonomous Ingestion:** Near real-time collection of news, filings, and social sentiment.
- **Structured Enrichment:** Automated ticker mapping, event classification, and importance scoring.
- **Confidence Logic:** Implementation of a hybrid (Rule + LLM) scoring model to ensure signal reliability.
- **Real-Time Visualization:** A multi-platform dashboard (Desktop, Tablet, Mobile) for monitoring live intelligence and engine health.
- **Self-Improvement:** A memory layer to track predicted vs. realized price outcomes for model calibration.

---

## 3. Technical Architecture (The Pipeline)

### Stage 1: Ingestion (Collector Service)
- **Sources:** Google News RSS, SEC EDGAR (8-K, 10-Q, 10-K), Market news APIs (MarketAux/Polygon), Insider trading feeds.
- **Interval:** 1–5 minute polling cycles.

### Stage 2: Processing (Normalizer & Deduper)
- **Normalization:** Mapping diverse source schemas to a canonical `normalized_documents` format.
- **Entity Linking:** Identifying primary and mentioned tickers, sectors, and industries.
- **Deduplication:** Clustering similar articles to prevent signal inflation from syndicated content.

### Stage 3: Scoring (Scorer Service)
- **Hybrid Model:** deterministic regex/rule checks + LLM (Claude/GPT) classification.
- **Metrics:**
    - `sentiment_score` (-1 to 1)
    - `impact_score` (0 to 1)
    - `novelty_score` (0 to 1)
    - `final_confidence` (Weighted average of LLM, rule, and source reliability).

### Stage 4: Aggregation & Serving
- **Rolling Windows:** 15m, 1h, 4h, 1d, 7d states.
- **API/WebSocket:** Real-time fanout to the dashboard and REST endpoints for other agents.

---

## 4. Data Schema Highlights

### `document_scores` (The Atomic Signal)
| Field | Type | Description |
| :--- | :--- | :--- |
| `event_type` | String | Taxonomy-fixed (e.g., `guidance_raise`, `merger`) |
| `sentiment_score` | Float | -1 (Bearish) to +1 (Bullish) |
| `impact_score` | Float | Expected market significance |
| `final_confidence`| Float | Reliability threshold (0.85+ = Actionable) |

### `sentiment_state` (The Aggregate)
| Field | Type | Description |
| :--- | :--- | :--- |
| `weighted_sentiment`| Float | Volume and confidence weighted average |
| `momentum_delta` | Float | Change vs previous window |
| `regime` | Enum | Bullish, Neutral, Bearish |

---

## 5. Design System & UI Requirements
The UI follows the **Sentiment Intelligence System** design tokens:
- **Theme:** High-contrast Dark Mode (`#080808` backgrounds).
- **Color Palette:**
    - Primary: Blue-500 (`#007AFF`) for navigation and neutral actions.
    - Positive: Vibrant Green for bullish signals.
    - Negative: Soft Red for bearish signals.
- **Typography:** Inter (Sans-serif) for high readability in data-dense environments.
- **Components:**
    - **Market Pulse:** Gauge/Waveform showing aggregate conviction.
    - **Ticker Leaderboard:** Sortable list of hot assets.
    - **Live Event Feed:** Streaming updates with "Reason Codes" and "Short Explanations."
    - **System Health:** Real-time latency and throughput monitoring.

---

## 6. Development Roadmap (MVP)
1.  **Database Setup:** PostgreSQL (Audit) + Redis (Live State).
2.  **Ingestion Engine:** RSS and SEC API connectors.
3.  **Scoring Logic:** Implementation of the LLM prompt and rule engine.
4.  **Aggregation Layer:** Incremental updates for rolling windows.
5.  **Dashboard Deployment:** React/Next.js frontend with WebSocket integration.
6.  **Calibration:** Memory table integration for backtesting.
