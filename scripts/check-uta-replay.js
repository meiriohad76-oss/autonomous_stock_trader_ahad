import { createUtaService } from "../src/domain/uta.js";
import { config } from "../src/config.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

try {
  const service = createUtaService({ config });
  const first = service.getSingleAnalysis("AVGO");
  const second = service.getSingleAnalysis("AVGO");

  assert(first.status === 200, "AVGO replay result should be available.", { status: first.status });
  assert(JSON.stringify(first.payload) === JSON.stringify(second.payload), "Replay result must be deterministic.");
  assert(first.payload.calculation_metadata.source_mode === "replay", "Replay source mode is required.");
  assert(first.payload.calculation_metadata.direction_source === "signed_flow", "Direction must come from signed flow.");
  assert(first.payload.calculation_metadata.price_is_corroboration_only === true, "Price must be corroboration only.");
  assert(first.payload.indicators.A === null, "A must be null for single ticker mode.");
  assert(!Object.hasOwn(first.payload, "composite_score"), "Composite score must not exist.");
  assert(first.payload.calculation_metadata.engine_version === "uta_engine_v1", "Replay payload should be engine-backed.");
  assert(first.payload.engine_diagnostics?.baseline?.session_count === 20, "Replay baseline should use 20 sessions.");
  assert(first.payload.raw_prints?.normalization_summary?.excluded_notional === 200000000, "Replay should preserve excluded notional diagnostics.");
  assert(first.payload.explain_tier?.verdict === `Tier ${first.payload.tier}`, "Explain-tier verdict must mirror classifier tier.");

  const missing = service.getSingleAnalysis("ZZZZ");
  assert(missing.status === 404, "Unknown replay ticker should return a non-actionable 404 payload.");
  assert(missing.payload.tier === "D", "Unknown replay ticker must be Tier D.");
  assert(Object.keys(missing.payload.indicators.B).length === 0, "Unknown replay ticker must not fabricate B values.");

  console.log(JSON.stringify({
    status: "ok",
    ticker: first.payload.ticker,
    tier: first.payload.tier,
    direction_source: first.payload.calculation_metadata.direction_source,
    missing_ticker_tier: missing.payload.tier
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
}
