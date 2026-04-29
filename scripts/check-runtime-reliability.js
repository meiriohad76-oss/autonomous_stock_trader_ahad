process.env.DATABASE_ENABLED = process.env.DATABASE_ENABLED || "false";
process.env.PI_PERFORMANCE_MODE = process.env.PI_PERFORMANCE_MODE || "true";
process.env.LIVE_NEWS_ENABLED = process.env.LIVE_NEWS_ENABLED || "false";
process.env.MARKET_FLOW_ENABLED = process.env.MARKET_FLOW_ENABLED || "false";
process.env.SEC_FORM4_ENABLED = process.env.SEC_FORM4_ENABLED || "false";
process.env.SEC_13F_ENABLED = process.env.SEC_13F_ENABLED || "false";
process.env.FUNDAMENTAL_SEC_ENABLED = process.env.FUNDAMENTAL_SEC_ENABLED || "false";
process.env.AUTO_START_MARKET_FLOW = process.env.AUTO_START_MARKET_FLOW || "false";
process.env.AUTO_START_SEC_13F = process.env.AUTO_START_SEC_13F || "false";
process.env.AUTO_START_SEC_FUNDAMENTALS = process.env.AUTO_START_SEC_FUNDAMENTALS || "false";
process.env.AUTO_START_FUNDAMENTAL_MARKET_DATA = process.env.AUTO_START_FUNDAMENTAL_MARKET_DATA || "false";

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

const runtime = app.getRuntimeReliability();
assertRuntimeSnapshot(runtime);

const health = app.getHealth();
assert(health.runtime_reliability?.status === runtime.status, "Health runtime summary is out of sync.");
assert(
  health.live_sources?.fundamental_universe?.sec_directory_source === "unavailable_fallback",
  "Fundamental universe should survive SEC directory fetch failures."
);

const watchlist = app.getWatchlistSnapshot("1h");
assert(watchlist.screener_overview?.full_universe?.tracked === 168, "Full fundamentals universe should remain at 168.");
assert(
  watchlist.screener_overview?.all_universe?.tracked >= watchlist.screener_overview.full_universe.tracked,
  "Sentiment watchlist should expose the full universe plus any sentiment-only rows."
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
globalThis.fetch = originalFetch;

console.log(
  JSON.stringify(
    {
      status: "ok",
      runtime_status: runtime.status,
      source_count: runtime.sources.length,
      profile_count: Object.keys(RUNTIME_PROFILES).length,
      recommended_profile: runtime.runtime_profiles.recommended,
      available_actions: runtime.available_actions.length,
      full_universe_tracked: watchlist.screener_overview.full_universe.tracked,
      all_universe_rows: watchlist.screener_overview.all_universe.tracked,
      eligible_filter_rows: eligibleWatchlist.screener_overview.visible_universe.tracked,
      blocked_disabled_source: Boolean(disabledError)
    },
    null,
    2
  )
);
