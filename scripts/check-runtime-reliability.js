import { rmSync } from "node:fs";

process.env.DATABASE_ENABLED = process.env.DATABASE_ENABLED || "false";
process.env.SEED_DATA_IN_DECISIONS = "true";
process.env.PI_PERFORMANCE_MODE = process.env.PI_PERFORMANCE_MODE || "true";
process.env.AGENCY_AUTONOMOUS_DATA_ENABLED = process.env.AGENCY_AUTONOMOUS_DATA_ENABLED || "false";
process.env.LIGHTWEIGHT_STATE_ENABLED = process.env.LIGHTWEIGHT_STATE_ENABLED || "true";
process.env.LIGHTWEIGHT_STATE_PATH = process.env.LIGHTWEIGHT_STATE_PATH || "data/runtime-reliability-test-state.json";
process.env.LIVE_NEWS_ENABLED = process.env.LIVE_NEWS_ENABLED || "false";
process.env.MARKET_FLOW_ENABLED = process.env.MARKET_FLOW_ENABLED || "false";
process.env.SEC_FORM4_ENABLED = process.env.SEC_FORM4_ENABLED || "false";
process.env.SEC_13F_ENABLED = process.env.SEC_13F_ENABLED || "false";
process.env.FUNDAMENTAL_SEC_ENABLED = process.env.FUNDAMENTAL_SEC_ENABLED || "false";
process.env.AUTO_START_MARKET_FLOW = process.env.AUTO_START_MARKET_FLOW || "false";
process.env.AUTO_START_SEC_13F = process.env.AUTO_START_SEC_13F || "false";
process.env.AUTO_START_SEC_FUNDAMENTALS = process.env.AUTO_START_SEC_FUNDAMENTALS || "false";
process.env.AUTO_START_FUNDAMENTAL_MARKET_DATA = process.env.AUTO_START_FUNDAMENTAL_MARKET_DATA || "false";

rmSync(process.env.LIGHTWEIGHT_STATE_PATH, { force: true });

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("offline runtime reliability contract blocks network fetches");
};

const { createSentimentApp } = await import("../src/app.js");
const { RUNTIME_PROFILES } = await import("../src/domain/runtime-reliability.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRuntimeSnapshot(snapshot) {
  assert(snapshot, "Runtime reliability snapshot is missing.");
  assert(snapshot.status, "Runtime reliability status is missing.");
  assert(snapshot.pressure?.process, "Runtime pressure process metrics are missing.");
  assert(snapshot.pressure?.system, "Runtime pressure system metrics are missing.");
  assert(Array.isArray(snapshot.sources), "Runtime sources must be an array.");
  assert(snapshot.sources.length >= 8, "Runtime source coverage is unexpectedly small.");
  assert(snapshot.collector_plan, "Runtime collector plan is missing.");
  assert(Array.isArray(snapshot.available_actions), "Runtime actions must be exposed.");
  assert(snapshot.available_actions.some((item) => item.action === "apply_profile"), "Profile action is missing.");
  assert(snapshot.runtime_profiles?.profiles?.length >= 4, "Runtime profiles are missing.");
  assert(snapshot.runtime_profiles?.recommended, "Recommended runtime profile is missing.");

  const sourceKeys = new Set(snapshot.sources.map((item) => item.key));
  for (const key of ["earnings_calendar", "stocktwits_stream", "trade_prints"]) {
    assert(sourceKeys.has(key), `${key} runtime source is missing.`);
  }

  for (const source of ["earnings_calendar", "stocktwits_stream", "trade_prints"]) {
    assert(
      snapshot.available_actions.some((item) => item.action === "poll_once" && item.source === source),
      `${source} poll_once action is missing.`
    );
  }
}

for (const [key, profile] of Object.entries(RUNTIME_PROFILES)) {
  assert(profile.label, `${key} profile is missing a label.`);
  assert(profile.description, `${key} profile is missing a description.`);
  assert(profile.env && Object.keys(profile.env).length > 0, `${key} profile is missing env values.`);
  for (const [envKey, envValue] of Object.entries(profile.env)) {
    assert(typeof envKey === "string" && envKey.length > 0, `${key} profile has an invalid env key.`);
    assert(typeof envValue === "string", `${key}.${envKey} must be a string value.`);
  }
}

const app = createSentimentApp();
await app.initialize();
await app.replay({ reset: false, intervalMs: 0, skipFundamentals: true });

const startingReadiness = app.getReadiness();
assert(startingReadiness.status === "starting", "App readiness should start in starting state outside the HTTP server.");
assert(startingReadiness.ready === false, "App readiness should not be ready before HTTP and initialization are marked complete.");
app.setStartupStatus({ http_listening: true, initialized: true, phase: "running" });
const readyState = app.getReadiness();
assert(readyState.status === "ready", "App readiness should report ready after HTTP and initialization complete.");
assert(readyState.ready === true, "Ready flag should be true after HTTP and initialization complete.");

const runtime = app.getRuntimeReliability();
assertRuntimeSnapshot(runtime);

const health = app.getHealth();
assert(health.readiness?.ready === true, "Health should embed readiness status.");
assert(health.database_backup?.provider === "json", "Pi-safe lightweight state should replace disabled persistence.");
assert(
  health.live_sources?.lightweight_state?.last_success_at,
  "Lightweight state should save a runtime snapshot during the reliability check."
);
assert(health.runtime_reliability?.status === runtime.status, "Health runtime summary is out of sync.");
assert(
  health.live_sources?.sec_fundamentals?.tracked_companies === 168,
  "SEC fundamentals health should expose tracked company count before the first manual batch."
);
assert(
  health.live_sources?.sec_fundamentals?.pending_live_sec_companies === 168,
  "SEC fundamentals health should expose pending live-SEC count before the first manual batch."
);
assert(
  health.live_sources?.fundamental_universe?.sec_directory_source === "unavailable_fallback",
  "Fundamental universe should survive SEC directory fetch failures."
);

const watchlist = app.getWatchlistSnapshot("1h");
assert(watchlist.screener_overview?.full_universe?.tracked === 168, "Full fundamentals universe should remain at 168.");
assert(
  new Set((watchlist.sectors || []).map((sector) => sector.entity_key)).size === (watchlist.sectors || []).length,
  "Sector sentiment rows should be de-duplicated by sector."
);
assert(
  watchlist.screener_overview?.all_universe?.tracked >= watchlist.screener_overview.full_universe.tracked,
  "Sentiment watchlist should expose the full universe plus any sentiment-only rows."
);
const screenOnlyRows = watchlist.leaderboard.filter((row) => !row.sentiment_visible && row.doc_count === 0);
assert(screenOnlyRows.length > 0, "Runtime check should include allowed-universe rows before live SEC scoring.");
assert(
  screenOnlyRows.every((row) => row.weighted_confidence === 0 && row.fundamental_confidence === null),
  "Allowed-universe rows must keep sentiment confidence at zero and avoid provisional fundamental confidence."
);
const forbiddenPlaceholderRows = watchlist.leaderboard.filter(
  (row) => row.fundamental_data_source === "bootstrap_placeholder" && row.sector === "Unknown"
);
assert(
  forbiddenPlaceholderRows.length === 0,
  "Placeholder fundamental rows should not appear in the watchlist."
);

const secQueue = app.getSecFundamentalsQueue({ limit: 5 });
assert(secQueue.tracked_companies === 168, "SEC queue should expose the full fundamentals universe.");
assert(!Object.hasOwn(secQueue, "pending_bootstrap_companies"), "SEC queue should not expose legacy bootstrap fields.");
assert(secQueue.pending_live_sec_companies >= 0, "SEC queue should expose pending live-SEC count.");
assert(secQueue.next_batch.length <= 5, "SEC queue should honor preview limits.");
assert(secQueue.next_batch_size > 0, "SEC queue should expose the next SEC refresh batch.");
assert(
  Array.isArray(secQueue.pending_by_sector) && secQueue.pending_by_sector.length > 0,
  "SEC queue should summarize pending names by sector."
);

const eligibleWatchlist = app.getWatchlistSnapshot("1h", { screenStage: "eligible" });
assert(
  eligibleWatchlist.screener_overview?.full_universe?.tracked === watchlist.screener_overview.full_universe.tracked,
  "Screen-stage filters must not shrink the full universe count."
);
assert(
  eligibleWatchlist.screener_overview?.all_universe?.tracked === watchlist.screener_overview.all_universe.tracked,
  "Screen-stage filters must not shrink the all-row count labels."
);
assert(
  eligibleWatchlist.screener_overview?.visible_universe?.tracked === watchlist.screener_overview.all_universe.eligible,
  "Eligible filter visible count should match the unfiltered eligible count."
);
assert(
  eligibleWatchlist.leaderboard.every((row) => row.screen_stage === "eligible"),
  "Eligible filter should return only eligible rows."
);

const snapshotAction = await app.runRuntimeReliabilityAction({ action: "snapshot" });
assert(snapshotAction.ok, "Snapshot action failed.");
assertRuntimeSnapshot(snapshotAction.runtime_reliability);

const saveStateAction = await app.runRuntimeReliabilityAction({ action: "save_lightweight_state" });
assert(saveStateAction.ok, "Lightweight state save action failed.");
assert(saveStateAction.result?.status?.provider === "json", "Lightweight state action should return JSON state status.");

const refreshUniverseAction = await app.runRuntimeReliabilityAction({ action: "refresh_universe" });
assert(refreshUniverseAction.ok, "Universe refresh action failed.");
assert(refreshUniverseAction.result?.lightweight_state_saved === true, "State-changing runtime actions should auto-save lightweight state.");
assert(
  refreshUniverseAction.result?.lightweight_state_status?.provider === "json",
  "Auto-save should return the lightweight JSON state status."
);

const profilePreview = await app.runRuntimeReliabilityAction({
  action: "apply_profile",
  profile: "live_news_only",
  apply: false
});
assert(profilePreview.ok, "Profile preview failed.");
assert(profilePreview.result?.profile === "live_news_only", "Profile preview returned the wrong profile.");
assert(profilePreview.result?.applied === false, "Profile preview must not apply changes.");
assert(profilePreview.result?.env_updates?.LIVE_NEWS_ENABLED === "true", "Profile preview is missing env updates.");

let disabledError = "";
try {
  await app.runRuntimeReliabilityAction({ action: "poll_once", source: "live_news" });
} catch (error) {
  disabledError = error.message;
}
assert(disabledError.includes("disabled by configuration"), "Disabled live news action should be blocked.");

await app.stopLiveSources();

const restoredApp = createSentimentApp();
await restoredApp.initialize();
const restoredWatchlist = restoredApp.getWatchlistSnapshot("1h");
assert(
  restoredWatchlist.screener_overview?.full_universe?.tracked === watchlist.screener_overview.full_universe.tracked,
  "Lightweight state restore must preserve the full fundamentals universe after restart."
);
assert(
  restoredWatchlist.screener_overview?.all_universe?.eligible === watchlist.screener_overview.all_universe.eligible,
  "Lightweight state restore must preserve screener counts after restart."
);
await restoredApp.stopLiveSources();

globalThis.fetch = originalFetch;
rmSync(process.env.LIGHTWEIGHT_STATE_PATH, { force: true });

console.log(
  JSON.stringify(
    {
      status: "ok",
      runtime_status: runtime.status,
      source_count: runtime.sources.length,
      profile_count: Object.keys(RUNTIME_PROFILES).length,
      recommended_profile: runtime.runtime_profiles.recommended,
      available_actions: runtime.available_actions.length,
      readiness: health.readiness.status,
      full_universe_tracked: watchlist.screener_overview.full_universe.tracked,
      all_universe_rows: watchlist.screener_overview.all_universe.tracked,
      eligible_filter_rows: eligibleWatchlist.screener_overview.visible_universe.tracked,
      sector_count: watchlist.sectors.length,
      screen_only_rows: screenOnlyRows.length,
      placeholder_fundamental_rows: forbiddenPlaceholderRows.length,
      sec_queue_next_batch: secQueue.next_batch.length,
      sec_queue_pending_live_sec: secQueue.pending_live_sec_companies,
      lightweight_state: health.database_backup.provider,
      blocked_disabled_source: Boolean(disabledError)
    },
    null,
    2
  )
);
