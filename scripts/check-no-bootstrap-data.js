const { createSentimentApp } = await import("../src/app.js");

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function isBootstrapRow(row = {}) {
  return (
    row.data_source === "bootstrap_placeholder" ||
    row.fundamental_data_source === "bootstrap_placeholder" ||
    row.form_type === "BOOTSTRAP" ||
    (row.quality_flags?.anomaly_flags || []).includes("bootstrap_placeholder") ||
    (row.anomaly_flags || []).includes("bootstrap_placeholder")
  );
}

function findBootstrapRows(rows = []) {
  return rows.filter(isBootstrapRow).map((row) => ({
    ticker: row.ticker || row.entity_key,
    data_source: row.data_source || row.fundamental_data_source || null,
    form_type: row.form_type || null
  }));
}

const app = createSentimentApp();

try {
  await app.initialize();

  const secQueue = app.getSecFundamentalsQueue({ limit: 10 });
  const watchlist = app.getWatchlistSnapshot(app.config.defaultWindow || "1h");
  const fundamentals = app.store.fundamentals?.leaderboard || [];
  const tracked = app.getTrackedFundamentalCompanies();
  const liveFundamentals = fundamentals.filter((row) => row.data_source === "live_sec_filing");
  const bootstrapFundamentals = findBootstrapRows(fundamentals);
  const bootstrapTracked = findBootstrapRows(tracked);
  const bootstrapWatchlist = findBootstrapRows(watchlist.leaderboard || []);

  assert(bootstrapFundamentals.length === 0, "Bootstrap rows remain in Fundamentals Agent leaderboard.", {
    rows: bootstrapFundamentals
  });
  assert(bootstrapTracked.length === 0, "Bootstrap rows remain in tracked allowed-universe payload.", {
    rows: bootstrapTracked
  });
  assert(bootstrapWatchlist.length === 0, "Bootstrap rows remain in dashboard watchlist payload.", {
    rows: bootstrapWatchlist
  });
  assert(Number(secQueue.pending_bootstrap_companies || 0) === 0, "SEC queue still reports pending bootstrap rows.", {
    pending_bootstrap_companies: secQueue.pending_bootstrap_companies
  });
  assert(
    tracked.every((row) => row.data_source === "live_sec_filing" || row.data_source === "universe_membership"),
    "Tracked universe contains an unexpected data source.",
    { sources: [...new Set(tracked.map((row) => row.data_source || "unknown"))] }
  );
  assert(
    fundamentals.every((row) => row.data_source === "live_sec_filing"),
    "Fundamentals Agent may only score live SEC-backed rows.",
    { sources: [...new Set(fundamentals.map((row) => row.data_source || "unknown"))] }
  );

  await app.persistence?.saveStoreSnapshot(app.store);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        tracked_allowed_universe: tracked.length,
        live_sec_fundamentals: liveFundamentals.length,
        pending_live_sec_companies: secQueue.pending_live_sec_companies || 0,
        pending_bootstrap_companies: secQueue.pending_bootstrap_companies || 0,
        bootstrap_rows_found: 0,
        note: "Pending names are allowed-universe metadata only; Fundamentals scoring contains live SEC-backed rows only."
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: "error",
        error: error.message,
        details: error.details || {}
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await app.stopLiveSources?.();
}
