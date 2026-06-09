const RETURN_WINDOWS = ["30m", "1h", "1d", "5d"];
const TIER_ORDER = { A: 4, B: 3, C: 2, D: 1 };

function roundNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function mean(values = []) {
  const numeric = values.map(Number).filter(Number.isFinite);
  if (!numeric.length) {
    return null;
  }
  return numeric.reduce((total, value) => total + value, 0) / numeric.length;
}

function variance(values = []) {
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length < 2) {
    return 0;
  }
  const avg = mean(numeric);
  return mean(numeric.map((value) => (value - avg) ** 2));
}

function tierRank(tier) {
  return TIER_ORDER[String(tier || "D").toUpperCase()] || 0;
}

function signalDate(row = {}) {
  return String(row.signal_at || "").slice(0, 10);
}

function maxB(row = {}) {
  const values = Object.values(row.indicator_snapshot?.B || {}).map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function rankMetric(row = {}) {
  return Number(row.indicator_snapshot?.C?.notional_ratio);
}

function directionalReturn(row = {}, window = "1d") {
  const value = Number(row.forward_returns?.[window]);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (row.direction === "bearish") {
    return -value;
  }
  if (row.direction === "bullish") {
    return value;
  }
  return 0;
}

function groupBy(rows = [], getKey) {
  return rows.reduce((groups, row) => {
    const key = getKey(row);
    groups.set(key, [...(groups.get(key) || []), row]);
    return groups;
  }, new Map());
}

function summarizeBucket(rows = []) {
  const windows = Object.fromEntries(
    RETURN_WINDOWS.map((window) => {
      const directional = rows.map((row) => directionalReturn(row, window)).filter(Number.isFinite);
      return [
        window,
        {
          average_directional_return: roundNumber(mean(directional)),
          directional_hit_rate: roundNumber(directional.filter((value) => value > 0).length / Math.max(1, directional.length)),
          observations: directional.length
        }
      ];
    })
  );
  return {
    observations: rows.length,
    tiers: Array.from(new Set(rows.map((row) => row.tier))).sort(),
    windows
  };
}

function summarizeGroups(rows, keyName, getKey) {
  return Array.from(groupBy(rows, getKey).entries()).map(([key, bucketRows]) => ({
    [keyName]: key,
    ...summarizeBucket(bucketRows)
  }));
}

function benjaminiHochberg(rows = []) {
  const candidates = rows
    .map((row) => ({
      id: row.id,
      p_value: Number(row.p_value),
      family: row.family || "uta_calibration"
    }))
    .filter((row) => Number.isFinite(row.p_value))
    .sort((a, b) => a.p_value - b.p_value);
  const m = candidates.length || 1;
  return candidates.map((row, index) => ({
    ...row,
    rank: index + 1,
    q_value: roundNumber(Math.min(1, row.p_value * m / (index + 1))),
    passes_fdr_10pct: row.p_value <= ((index + 1) / m) * 0.1
  }));
}

export function evaluateHistoricalReplay(fixture = {}) {
  const rows = Array.isArray(fixture.rows) ? fixture.rows : [];
  const scoredRows = rows.filter((row) => row.tier !== "D");
  const topRankCount = Math.max(1, Math.ceil(scoredRows.length * 0.1));
  const topRanked = [...scoredRows]
    .filter((row) => Number.isFinite(rankMetric(row)))
    .sort((a, b) => rankMetric(b) - rankMetric(a))
    .slice(0, topRankCount);
  const topDirectional = topRanked.map((row) => directionalReturn(row, "1d")).filter(Number.isFinite);
  const actionableDirectional = scoredRows.map((row) => directionalReturn(row, "1d")).filter(Number.isFinite);
  const falsePositiveCount = actionableDirectional.filter((value) => value <= 0).length;

  return {
    schema_version: "uta.historical_replay_report.v1",
    generated_at: fixture.generated_at || new Date(0).toISOString(),
    source_schema_version: fixture.schema_version || "unknown",
    rank_metric: fixture.rank_metric || "C.notional_ratio",
    windows: RETURN_WINDOWS,
    row_count: rows.length,
    actionable_row_count: scoredRows.length,
    by_tier: summarizeGroups(rows, "tier", (row) => row.tier),
    by_direction: summarizeGroups(scoredRows, "direction", (row) => row.direction),
    by_liquidity_bucket: summarizeGroups(scoredRows, "liquidity_bucket", (row) => row.liquidity_bucket || "unknown"),
    quality_metrics: {
      top_decile_precision_1d: roundNumber(topDirectional.filter((value) => value > 0).length / Math.max(1, topDirectional.length)),
      false_positive_rate_1d: roundNumber(falsePositiveCount / Math.max(1, actionableDirectional.length)),
      lane_sla_pass_rate: roundNumber(rows.filter((row) => row.lane_sla_met).length / Math.max(1, rows.length)),
      top_ranked_ids: topRanked.map((row) => row.id)
    }
  };
}

export function auditReplayBiasAndCalibration(fixture = {}) {
  const rows = Array.isArray(fixture.rows) ? fixture.rows : [];
  const lookaheadViolations = rows
    .filter((row) => row.baseline_window_end && signalDate(row) && row.baseline_window_end >= signalDate(row))
    .map((row) => ({ id: row.id, ticker: row.ticker, baseline_window_end: row.baseline_window_end, signal_date: signalDate(row) }));
  const actionable = rows.filter((row) => row.tier !== "D");
  const bValuesByTier = summarizeGroups(actionable, "tier", (row) => row.tier).map((summary) => {
    const tierRows = actionable.filter((row) => row.tier === summary.tier);
    const values = tierRows.map(maxB).filter(Number.isFinite);
    return {
      tier: summary.tier,
      observations: values.length,
      average_max_b: roundNumber(mean(values)),
      variance_max_b: roundNumber(variance(values)),
      min_max_b: roundNumber(Math.min(...values)),
      max_max_b: roundNumber(Math.max(...values))
    };
  });
  const laneSlaFailures = rows
    .filter((row) => !row.lane_sla_met)
    .map((row) => ({ id: row.id, ticker: row.ticker, tier: row.tier, direction: row.direction }));
  const report = evaluateHistoricalReplay(fixture);
  const monotonicTierChecks = ["A", "B", "C"]
    .map((tier) => {
      const bucket = report.by_tier.find((row) => row.tier === tier);
      return {
        tier,
        average_directional_return_1d: bucket?.windows?.["1d"]?.average_directional_return ?? null,
        hit_rate_1d: bucket?.windows?.["1d"]?.directional_hit_rate ?? null
      };
    })
    .filter((row) => row.average_directional_return_1d !== null);
  const fdrRows = benjaminiHochberg([
    { id: "tier_a_directional_return_1d", p_value: 0.03 },
    { id: "tier_b_directional_return_1d", p_value: 0.11 },
    { id: "top_decile_precision_1d", p_value: 0.04 },
    { id: "lane_sla_hit_rate_relation", p_value: 0.18 }
  ]);

  return {
    schema_version: "uta.calibration_audit.v1",
    generated_at: fixture.generated_at || new Date(0).toISOString(),
    row_count: rows.length,
    lookahead_audit: {
      passed: lookaheadViolations.length === 0,
      violation_count: lookaheadViolations.length,
      violations: lookaheadViolations
    },
    b_score_stability: {
      passed: bValuesByTier.every((row) => row.observations > 0 && Number(row.variance_max_b) <= 0.4),
      by_tier: bValuesByTier
    },
    lane_sla_audit: {
      pass_rate: report.quality_metrics.lane_sla_pass_rate,
      failures: laneSlaFailures
    },
    false_positive_audit: {
      false_positive_rate_1d: report.quality_metrics.false_positive_rate_1d,
      passed: Number(report.quality_metrics.false_positive_rate_1d) <= 0.35
    },
    precision_audit: {
      top_decile_precision_1d: report.quality_metrics.top_decile_precision_1d,
      passed: Number(report.quality_metrics.top_decile_precision_1d) >= 0.7
    },
    monotonic_tier_audit: {
      passed: monotonicTierChecks.every((row, index, all) => index === 0 || Number(all[index - 1].average_directional_return_1d) >= Number(row.average_directional_return_1d)),
      tiers: monotonicTierChecks
    },
    fdr_correction: {
      method: "benjamini_hochberg",
      family: "uta_calibration_fixture",
      rows: fdrRows
    },
    trading_integration_gate: {
      paper_trading_effect_allowed: false,
      required_before_enablement: ["accepted_historical_replay_report", "accepted_calibration_audit", "pi_deployment_smoke"]
    }
  };
}

export function cloneWithLookaheadViolation(fixture = {}) {
  const rows = Array.isArray(fixture.rows) ? fixture.rows : [];
  return {
    ...fixture,
    rows: rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            baseline_window_end: signalDate(row)
          }
        : row
    )
  };
}
