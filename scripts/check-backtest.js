process.env.DATABASE_ENABLED = process.env.DATABASE_ENABLED || "false";

const { createSentimentApp } = await import("../src/app.js");

const app = createSentimentApp();

try {
  await app.initialize();
  await app.replay({ reset: true, intervalMs: 0 });
  const snapshot = app.getFundamentalBacktest({ horizonDays: 5, minSample: 5 });

  if (snapshot.engine !== "fundamental_threshold_backtest_v1") {
    throw new Error("Unexpected backtest engine name.");
  }
  if (!snapshot.criteria?.length || !snapshot.profiles?.length) {
    throw new Error("Backtest snapshot must include criteria and profile tests.");
  }
  if (!snapshot.summary || snapshot.summary.observations <= 0) {
    throw new Error("Backtest snapshot did not find any fundamental observations.");
  }
  if (!snapshot.data_requirements?.recommended_history) {
    throw new Error("Backtest snapshot must expose data requirements.");
  }
  if (snapshot.allow_synthetic_prices) {
    throw new Error("Synthetic prices should be excluded by default.");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        engine: snapshot.engine,
        validation_status: snapshot.status,
        observations: snapshot.summary.observations,
        matured_forward_returns: snapshot.summary.matured_forward_returns,
        synthetic_outcomes_excluded: snapshot.summary.synthetic_outcomes_excluded,
        criteria_tests: snapshot.criteria.length,
        profile_tests: snapshot.profiles.length,
        test_status_counts: snapshot.summary.test_status_counts
      },
      null,
      2
    )
  );
} finally {
  await app.stopLiveSources();
}
