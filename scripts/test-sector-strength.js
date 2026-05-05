import assert from "node:assert/strict";
import { buildSectorStrengthSnapshot, normalizeReferenceReturn } from "../src/domain/sector-strength.js";

const now = new Date().toISOString();

function row(ticker, sector, percentChange, marketCap, extra = {}) {
  const { market_reference: marketReferenceOverrides = {}, ...rest } = extra;
  return {
    ticker,
    company_name: ticker,
    sector,
    market_reference: {
      provider: "finnhub",
      live: true,
      as_of: now,
      current_price: 100,
      absolute_change: percentChange * 100,
      percent_change: percentChange,
      market_cap: marketCap,
      ...marketReferenceOverrides
    },
    ...rest
  };
}

{
  const normalized = normalizeReferenceReturn({
    current_price: 99.8,
    absolute_change: -0.2,
    percent_change: -0.2004
  });
  assert.equal(normalized.basis, "price_change_recomputed");
  assert.ok(Math.abs(normalized.value + 0.002) < 0.0001, "Provider percent-unit values should be normalized from price/change.");
}

{
  const rows = [
    row("AAPL", "Information Technology", 0.018, 3_000_000_000_000),
    row("MSFT", "Information Technology", 0.012, 2_900_000_000_000),
    row("NVDA", "Information Technology", 0.027, 2_400_000_000_000),
    row("AVGO", "Information Technology", 0.009, 900_000_000_000),
    row("CRM", "Information Technology", 0.006, 300_000_000_000),
    row("AMGN", "Health Care", -4.745, 150_000_000_000, {
      market_reference: { current_price: null, absolute_change: null }
    }),
    row("BAD", "Health Care", -45, 100_000_000_000, {
      market_reference: { current_price: null, absolute_change: null }
    }),
    row("LLY", "Health Care", -0.004, 800_000_000_000),
    row("UNH", "Health Care", -0.006, 500_000_000_000)
  ];
  const etfReferences = new Map([
    [
      "XLK",
      {
        ticker: "XLK",
        provider: "finnhub",
        live: true,
        as_of: now,
        current_price: 250,
        absolute_change: 2.5,
        percent_change: 0.01
      }
    ]
  ]);
  const snapshot = buildSectorStrengthSnapshot(rows, {
    etfReferences,
    sectorStates: [
      {
        entity_key: "Information Technology",
        doc_count: 4,
        weighted_sentiment: 0.2,
        weighted_confidence: 0.7,
        top_event_types: ["abnormal_volume_buying"],
        top_reasons: ["flow"]
      }
    ],
    asOf: now
  });
  const tech = snapshot.sectors.find((item) => item.entity_key === "Information Technology");
  const health = snapshot.sectors.find((item) => item.entity_key === "Health Care");

  assert.equal(tech.score_available, true, "Technology sector should have a usable top-stock tape score.");
  assert.equal(tech.sentiment_regime, "bullish", "Positive top-stock tape should classify as bullish.");
  assert.equal(tech.sector_strength.top_constituent_count, 5);
  assert.equal(tech.sector_strength.etf_status, "available", "Technology sector should attach ETF proxy performance when available.");
  assert.equal(tech.sector_strength.etf_provider, "finnhub");
  assert.ok(
    tech.sector_strength.components.some((component) => component.key === "sector_etf"),
    "Sector scoring should include ETF performance whenever the proxy is available, even when stock coverage is usable."
  );
  assert.ok(
    tech.sector_strength.components.some((component) => component.key === "top_stocks"),
    "Sector scoring should include top-stock tape alongside ETF performance."
  );
  assert.equal(health.sector_strength.normalized_warning_count, 1, "Provider percent-unit rows should be normalized.");
  assert.equal(health.sector_strength.outlier_count, 1, "Extreme impossible provider returns should be rejected as outliers.");
  assert.ok(health.sector_strength.top_constituent_return < 0, "Health Care tape should keep the valid negative rows.");
}

console.log("sector-strength tests passed");
