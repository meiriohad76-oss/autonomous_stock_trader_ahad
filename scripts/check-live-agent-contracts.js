const baseUrl = (process.env.AGENT_AUDIT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const strict = process.argv.includes("--strict");
const now = new Date();
const forbiddenRuntimeMarker = /(sample|fixture|bootstrap|replayed_sample|synthetic_outcome)/i;

const report = {
  status: "unknown",
  base_url: baseUrl,
  as_of: now.toISOString(),
  checks: [],
  failures: [],
  warnings: []
};

function compact(value, limit = 1600) {
  let text = "";
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.slice(0, limit);
}

function addCheck(name, status, detail = {}) {
  const row = { name, status, detail };
  report.checks.push(row);
  if (status === "fail") {
    report.failures.push(row);
  } else if (status === "warning") {
    report.warnings.push(row);
  }
}

function asList(payload, keys = []) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }
  }
  return [];
}

function ageHours(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return (now.getTime() - parsed.getTime()) / 3_600_000;
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}

async function read(path) {
  try {
    return await getJson(path);
  } catch (error) {
    addCheck(`endpoint_${path}`, "fail", { error: error.message });
    return null;
  }
}

function sourceRows(runtime) {
  const raw = runtime?.sources || runtime?.live_sources || runtime?.source_status || {};
  if (Array.isArray(raw)) {
    return raw.filter((item) => item && typeof item === "object").map((item) => [item.key || item.name || "unknown", item]);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw);
  }
  return [];
}

function summarizeSources(runtime) {
  return sourceRows(runtime).map(([key, source]) => ({
    key,
    enabled: source.enabled,
    status: source.status || source.decision_status || null,
    provider: source.provider || source.active_provider || null,
    last_success_at: source.last_success_at || null,
    last_error: source.last_error || null,
    fallback_mode: Boolean(source.fallback_mode || source.fallback_active)
  }));
}

async function main() {
  const ready = await read("/api/ready");
  addCheck("service_ready", ready?.ready ? "pass" : "fail", ready || {});

  const cycle = await read("/api/agency/cycle");
  const workers = Array.isArray(cycle?.workers) ? cycle.workers : [];
  addCheck("agency_worker_count", workers.length === 12 ? "pass" : "fail", { count: workers.length });
  addCheck("agency_baseline_ready", cycle?.baseline_ready ? "pass" : "warning", {
    baseline_ready: cycle?.baseline_ready,
    mode: cycle?.mode,
    status: cycle?.status
  });

  for (const worker of workers) {
    const missing = ["key", "label", "status", "progress_label", "data_state", "primary_action"].filter(
      (key) => !(key in worker)
    );
    addCheck(`worker_contract_${worker.key || "unknown"}`, missing.length ? "fail" : "pass", {
      missing,
      status: worker.status,
      progress_label: worker.progress_label
    });
  }

  const config = await read("/api/config");
  const credentialWarnings = Array.isArray(config?.credential_warnings)
    ? config.credential_warnings.map((item) => item.env).filter(Boolean)
    : [];
  addCheck("config_credential_warnings_visible", credentialWarnings.length ? "warning" : "pass", {
    credential_warnings: credentialWarnings
  });

  const runtime = await read("/api/runtime-reliability");
  const sources = summarizeSources(runtime);
  addCheck("runtime_sources_present", sources.length >= 8 ? "pass" : "warning", {
    count: sources.length,
    sources
  });

  const fundamentals = await read("/api/fundamentals/dashboard");
  const fundamentalRows = Array.isArray(fundamentals?.leaderboard) ? fundamentals.leaderboard : [];
  const eligibleRows = fundamentalRows.filter((row) => row.initial_screen?.stage === "eligible");
  const watchRows = fundamentalRows.filter((row) => row.initial_screen?.stage === "watch");
  const rejectRows = fundamentalRows.filter((row) => row.initial_screen?.stage === "reject");
  const nonLiveRows = fundamentalRows.filter((row) => row.data_source !== "live_sec_filing").map((row) => row.ticker);
  const missingScreenRows = fundamentalRows.filter((row) => !row.initial_screen).map((row) => row.ticker);
  const weakEligible = eligibleRows
    .filter((row) => ["weak", "deteriorating"].includes(row.rating_label))
    .map((row) => row.ticker);

  addCheck("fundamentals_rows", fundamentalRows.length === 168 ? "pass" : "fail", {
    rows: fundamentalRows.length,
    eligible: eligibleRows.length,
    watch: watchRows.length,
    reject: rejectRows.length
  });
  addCheck("fundamentals_live_sec_only", nonLiveRows.length ? "fail" : "pass", {
    non_live_rows: nonLiveRows.slice(0, 30)
  });
  addCheck("fundamentals_screen_contract", missingScreenRows.length ? "fail" : "pass", {
    missing_screen_rows: missingScreenRows.slice(0, 30)
  });
  addCheck("fundamentals_no_weak_eligible_real_gate", weakEligible.length ? "warning" : "pass", {
    weak_eligible: weakEligible.slice(0, 50),
    note: "Expected only while the user intentionally lowers the screener threshold for workflow testing."
  });

  const secQueue = await read("/api/fundamentals/sec-queue?limit=10");
  const trackedSec =
    secQueue?.tracked_companies || secQueue?.trackedCompanies || secQueue?.tracked_count || (Array.isArray(secQueue) ? secQueue.length : 0);
  addCheck("sec_queue_loaded", trackedSec >= 160 ? "pass" : "warning", {
    tracked: trackedSec,
    shape: Array.isArray(secQueue) ? "array" : typeof secQueue
  });

  const news = await read("/api/news/recent?limit=80");
  const documents = asList(news, ["documents", "items", "recent_documents", "data"]);
  const linkedDocuments = documents.filter((item) => item?.url || item?.canonical_url);
  const freshDocuments = documents.filter((item) => (ageHours(item?.published_at || item?.fetched_at || item?.as_of) ?? 9999) <= 36);
  const forbiddenDocuments = documents
    .filter((item) => forbiddenRuntimeMarker.test(compact(item, 1000)))
    .map((item) => item.doc_id || item.headline || item.title || "unknown");
  addCheck("signals_news_links", documents.length && linkedDocuments.length >= Math.min(documents.length, 10) ? "pass" : "warning", {
    documents: documents.length,
    linked: linkedDocuments.length
  });
  addCheck("signals_news_freshness", documents.length && freshDocuments.length >= Math.min(documents.length, 10) ? "pass" : "warning", {
    documents: documents.length,
    fresh_36h: freshDocuments.length
  });
  addCheck("signals_no_forbidden_markers", forbiddenDocuments.length ? "fail" : "pass", {
    forbidden: forbiddenDocuments.slice(0, 10)
  });

  const flow = await read("/api/signals/money-flow?limit=80");
  const flowRows = asList(flow, ["documents", "signals", "items", "data"]);
  addCheck("money_flow_present", flowRows.length ? "pass" : "warning", {
    count: flowRows.length,
    sample: flowRows.slice(0, 3)
  });

  const macro = await read("/api/macro-regime?window=1h");
  addCheck("market_macro_contract", macro?.regime_label || macro?.bias_label || macro?.market_context ? "pass" : "warning", macro || {});

  const setups = await read("/api/trade-setups?window=1h&limit=50&minConviction=0");
  const setupRows = asList(setups, ["setups", "items", "data"]);
  const badSetups = setupRows.filter((row) => !row?.ticker || !row?.action || row.conviction === undefined).map((row) => row?.ticker);
  addCheck("deterministic_setup_contract", badSetups.length ? "fail" : "pass", {
    setups: setupRows.length,
    bad: badSetups.slice(0, 30),
    counts: setups?.counts || null
  });

  const finalSelection = await read("/api/final-selection?window=1h&limit=50&minConviction=0");
  const candidates = asList(finalSelection, ["candidates", "items", "data"]);
  const missingReports = candidates
    .filter((candidate) => !(candidate?.selection_report || candidate?.report || candidate?.decision_report))
    .map((candidate) => candidate?.ticker);
  addCheck("final_selection_report_contract", missingReports.length ? "warning" : "pass", {
    candidates: candidates.length,
    missing_report: missingReports.slice(0, 30),
    counts: finalSelection?.counts || null
  });

  const risk = await read("/api/risk/status");
  addCheck("risk_status_contract", ["ok", "warning", "blocked", "degraded"].includes(risk?.status) ? "pass" : "warning", risk || {});

  const execution = await read("/api/execution/status");
  const submitOpen = Boolean(execution?.submit_enabled || execution?.can_submit_orders || execution?.paper_submit_enabled);
  addCheck("execution_guard_contract", submitOpen ? "warning" : "pass", execution || {});

  const portfolio = await read("/api/positions/monitor");
  addCheck("portfolio_monitor_contract", portfolio?.status || "positions" in (portfolio || {}) ? "pass" : "warning", portfolio || {});

  const workflow = await read("/api/trading-workflow/status?window=1h&limit=50&minConviction=0");
  addCheck("workflow_status_contract", workflow?.status || workflow?.workflow_status ? "pass" : "warning", workflow || {});

  report.status = report.failures.length ? "fail" : report.warnings.length ? "warning" : "ok";
  const summary = {
    status: report.status,
    base_url: baseUrl,
    checks: report.checks.length,
    failures: report.failures.length,
    warnings: report.warnings.length,
    warning_checks: report.warnings.map((item) => item.name),
    failure_checks: report.failures.map((item) => item.name)
  };

  console.log(JSON.stringify(summary, null, 2));
  if (report.failures.length || report.warnings.length) {
    console.log(JSON.stringify({ failures: report.failures, warnings: report.warnings }, null, 2));
  }

  if (report.failures.length || (strict && report.warnings.length)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
