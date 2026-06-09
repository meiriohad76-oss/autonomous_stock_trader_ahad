import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { evaluateHistoricalReplay } from "../src/domain/uta-validation.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

try {
  const fixture = JSON.parse(readFileSync(path.join(config.rootDir, "data", "uta", "replay", "historical-evaluation.json"), "utf8"));
  const report = evaluateHistoricalReplay(fixture);
  const tierA = report.by_tier.find((row) => row.tier === "A");
  const bearish = report.by_direction.find((row) => row.direction === "bearish");
  const megaCap = report.by_liquidity_bucket.find((row) => row.liquidity_bucket === "mega_cap");

  assert(report.schema_version === "uta.historical_replay_report.v1", "Historical replay report schema mismatch.");
  assert(report.row_count >= 8, "Historical replay fixture should include enough rows for bucket checks.", report);
  assert(report.actionable_row_count === 7, "Actionable row count should exclude Tier D.", report);
  assert(report.windows.includes("30m") && report.windows.includes("5d"), "Forward return windows are incomplete.", report.windows);
  assert(tierA?.windows?.["1d"]?.directional_hit_rate === 1, "Tier A should show positive 1d directional hit rate in fixture.", tierA);
  assert(Number(tierA?.windows?.["5d"]?.average_directional_return) > 0.03, "Tier A 5d average directional return should be positive.", tierA);
  assert(bearish?.windows?.["1d"]?.observations === 2, "Bearish bucket should include two replay observations.", bearish);
  assert(megaCap?.observations >= 5, "Mega-cap liquidity bucket should be represented.", megaCap);
  assert(report.quality_metrics.top_decile_precision_1d === 1, "Top-decile precision should be deterministic and positive.", report.quality_metrics);
  assert(report.quality_metrics.false_positive_rate_1d <= 0.35, "False-positive rate exceeds fixture gate.", report.quality_metrics);

  console.log(JSON.stringify({
    status: "ok",
    rows: report.row_count,
    actionable_rows: report.actionable_row_count,
    windows: report.windows,
    tier_a_hit_rate_1d: tierA.windows["1d"].directional_hit_rate,
    top_decile_precision_1d: report.quality_metrics.top_decile_precision_1d,
    false_positive_rate_1d: report.quality_metrics.false_positive_rate_1d
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
}
