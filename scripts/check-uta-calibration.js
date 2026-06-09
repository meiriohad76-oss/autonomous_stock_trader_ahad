import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import {
  auditReplayBiasAndCalibration,
  cloneWithLookaheadViolation
} from "../src/domain/uta-validation.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

try {
  const fixture = JSON.parse(readFileSync(path.join(config.rootDir, "data", "uta", "replay", "historical-evaluation.json"), "utf8"));
  const audit = auditReplayBiasAndCalibration(fixture);
  const lookaheadMutation = auditReplayBiasAndCalibration(cloneWithLookaheadViolation(fixture));

  assert(audit.schema_version === "uta.calibration_audit.v1", "Calibration audit schema mismatch.");
  assert(audit.lookahead_audit.passed === true, "Historical replay fixture should pass no-look-ahead audit.", audit.lookahead_audit);
  assert(lookaheadMutation.lookahead_audit.passed === false, "Intentional look-ahead mutation should be caught.", lookaheadMutation.lookahead_audit);
  assert(lookaheadMutation.lookahead_audit.violation_count === 1, "Look-ahead mutation should create one violation.", lookaheadMutation.lookahead_audit);
  assert(audit.b_score_stability.passed === true, "B-score stability gate failed.", audit.b_score_stability);
  assert(audit.false_positive_audit.passed === true, "False-positive audit gate failed.", audit.false_positive_audit);
  assert(audit.precision_audit.passed === true, "Top-decile precision gate failed.", audit.precision_audit);
  assert(audit.monotonic_tier_audit.passed === true, "Tier monotonicity gate failed.", audit.monotonic_tier_audit);
  assert(audit.lane_sla_audit.failures.length === 1, "Fixture should retain one lane SLA failure for QA visibility.", audit.lane_sla_audit);
  assert(
    audit.fdr_correction.rows.some((row) => row.id === "top_decile_precision_1d" && row.q_value <= 0.1),
    "FDR correction rows should include top-decile precision evidence.",
    audit.fdr_correction
  );
  assert(
    audit.trading_integration_gate.paper_trading_effect_allowed === false,
    "Calibration audit must keep paper-trading effects blocked.",
    audit.trading_integration_gate
  );

  console.log(JSON.stringify({
    status: "ok",
    rows: audit.row_count,
    lookahead_passed: audit.lookahead_audit.passed,
    intentional_lookahead_caught: !lookaheadMutation.lookahead_audit.passed,
    b_score_stability_passed: audit.b_score_stability.passed,
    false_positive_rate_1d: audit.false_positive_audit.false_positive_rate_1d,
    top_decile_precision_1d: audit.precision_audit.top_decile_precision_1d,
    paper_trading_effect_allowed: audit.trading_integration_gate.paper_trading_effect_allowed
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
}
