const { createSentimentApp } = await import("../src/app.js");

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function isForbiddenPlaceholderRow(row = {}) {
  return (
    row.data_source === "bootstrap_placeholder" ||
    row.fundamental_data_source === "bootstrap_placeholder" ||
    row.form_type === "BOOTSTRAP" ||
    (row.quality_flags?.anomaly_flags || []).includes("bootstrap_placeholder") ||
    (row.anomaly_flags || []).includes("bootstrap_placeholder")
  );
}

function findForbiddenPlaceholderRows(rows = []) {
  return rows.filter(isForbiddenPlaceholderRow).map((row) => ({
    ticker: row.ticker || row.entity_key,
    data_source: row.data_source || row.fundamental_data_source || null,
    form_type: row.form_type || null
  }));
}

function findForbiddenRuntimeMarkers(value, path = "$", matches = []) {
  if (value === null || value === undefined) {
    return matches;
  }
  if (typeof value === "string") {
    if (/bootstrap/i.test(value) || value === "BOOTSTRAP") {
      matches.push({ path, value });
    }
    return matches;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenRuntimeMarkers(item, `${path}[${index}]`, matches));
    return matches;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (/bootstrap/i.test(key)) {
        matches.push({ path: childPath, value: "[field]" });
        continue;
      }
      findForbiddenRuntimeMarkers(child, childPath, matches);
    }
  }
  return matches;
}

const app = createSentimentApp();

try {
  await app.initialize();

  const secQueue = app.getSecFundamentalsQueue({ limit: 10 });
  const watchlist = app.getWatchlistSnapshot(app.config.defaultWindow || "1h");
  const fundamentals = app.store.fundamentals?.leaderboard || [];
  const tracked = app.getTrackedFundamentalCompanies();
  const liveFundamentals = fundamentals.filter((row) => row.data_source === "live_sec_filing");
  const forbiddenFundamentals = findForbiddenPlaceholderRows(fundamentals);
  const forbiddenTracked = findForbiddenPlaceholderRows(tracked);
  const forbiddenWatchlist = findForbiddenPlaceholderRows(watchlist.leaderboard || []);
  const runtimeMarkers = findForbiddenRuntimeMarkers({
    sec_queue: secQueue,
    watchlist_overview: watchlist.screener_overview,
    watchlist_leaderboard: watchlist.leaderboard,
    fundamentals_screener: app.store.fundamentals?.screener,
    fundamentals_leaderboard: app.store.fundamentals?.leaderboard,
    fundamental_universe: app.store.fundamentalUniverse,
    live_sources: app.store.health?.liveSources,
    source_stats: Object.fromEntries(app.store.sourceStats || [])
  });

  assert(forbiddenFundamentals.length === 0, "Forbidden placeholder rows remain in Fundamentals Agent leaderboard.", {
    rows: forbiddenFundamentals
  });
  assert(forbiddenTracked.length === 0, "Forbidden placeholder rows remain in tracked allowed-universe payload.", {
    rows: forbiddenTracked
  });
  assert(forbiddenWatchlist.length === 0, "Forbidden placeholder rows remain in dashboard watchlist payload.", {
    rows: forbiddenWatchlist
  });
  assert(!Object.hasOwn(secQueue, "pending_bootstrap_companies"), "SEC queue still exposes a legacy placeholder field.", {
    fields: Object.keys(secQueue).filter((key) => /bootstrap/i.test(key))
  });
  assert(runtimeMarkers.length === 0, "Active runtime payloads still expose forbidden placeholder markers.", {
    markers: runtimeMarkers.slice(0, 25),
    marker_count: runtimeMarkers.length
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
        forbidden_runtime_markers: 0,
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
