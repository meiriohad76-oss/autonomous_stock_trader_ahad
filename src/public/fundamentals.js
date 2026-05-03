const state = {
  dashboard: null,
  health: null,
  backtest: null,
  detail: null,
  filingHistory: [],
  factSeries: [],
  selectedTicker: null,
  sector: null,
  search: "",
  minConfidence: 0,
  onlyChanged: false,
  screenStage: null,
  screenerConfig: null,
  screenerSaveState: "",
  refreshState: "",
  selectedFactField: "revenue",
  selectedFactPeriod: "quarterly",
  selectedCriteriaKey: null
};

const elements = {
  coverageCount: document.querySelector("#coverage-count"),
  sectorCount: document.querySelector("#sector-count"),
  averageConfidence: document.querySelector("#average-confidence"),
  dataCompleteness: document.querySelector("#data-completeness"),
  newFilings: document.querySelector("#new-filings"),
  lastUpdate: document.querySelector("#last-update"),
  healthStatus: document.querySelector("#health-status"),
  healthFundamentals: document.querySelector("#health-fundamentals"),
  screenerExplainer: document.querySelector("#screener-explainer"),
  screenerSummary: document.querySelector("#screener-summary"),
  screenerCriteria: document.querySelector("#screener-criteria"),
  screenerCriteriaDetail: document.querySelector("#screener-criteria-detail"),
  screenerSettings: document.querySelector("#screener-settings"),
  screenerCandidates: document.querySelector("#screener-candidates"),
  screenerWatchlist: document.querySelector("#screener-watchlist"),
  screenerRejected: document.querySelector("#screener-rejected"),
  screenerStageChips: document.querySelector("#screener-stage-chips"),
  backtestSummary: document.querySelector("#backtest-summary"),
  backtestTests: document.querySelector("#backtest-tests"),
  sectorFilterChips: document.querySelector("#sector-filter-chips"),
  sectorCards: document.querySelector("#sector-cards"),
  leaderboardExplainer: document.querySelector("#leaderboard-explainer"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  changesFeed: document.querySelector("#changes-feed"),
  detailTitle: document.querySelector("#detail-title"),
  detailSubtitle: document.querySelector("#detail-subtitle"),
  detailSummary: document.querySelector("#detail-summary"),
  factorCards: document.querySelector("#factor-cards"),
  confidenceBreakdown: document.querySelector("#confidence-breakdown"),
  reasonCodes: document.querySelector("#reason-codes"),
  detailNotes: document.querySelector("#detail-notes"),
  filingTimeline: document.querySelector("#filing-timeline"),
  scoreHistory: document.querySelector("#score-history"),
  warehouseFilings: document.querySelector("#warehouse-filings"),
  warehouseFilingsCaption: document.querySelector("#warehouse-filings-caption"),
  factSeriesField: document.querySelector("#fact-series-field"),
  factSeriesPeriod: document.querySelector("#fact-series-period"),
  factSeriesCaption: document.querySelector("#fact-series-caption"),
  factSeriesChart: document.querySelector("#fact-series-chart"),
  tickerSearch: document.querySelector("#ticker-search"),
  confidenceFilter: document.querySelector("#confidence-filter"),
  confidenceValue: document.querySelector("#confidence-value"),
  changedOnly: document.querySelector("#changed-only"),
  refreshButton: document.querySelector("#refresh-button")
};

function pct(value, digits = 0) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function score(value) {
  return Number(value || 0).toFixed(2);
}

function compactCurrency(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "-";
  }
  if (Math.abs(number) >= 1_000_000_000_000) {
    return `$${(number / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (Math.abs(number) >= 1_000_000_000) {
    return `$${(number / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(number) >= 1_000_000) {
    return `$${(number / 1_000_000).toFixed(1)}M`;
  }
  return `$${number.toFixed(0)}`;
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000) {
    return `${number < 0 ? "-" : ""}${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${number < 0 ? "-" : ""}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${number < 0 ? "-" : ""}${(abs / 1_000).toFixed(1)}K`;
  }
  if (abs >= 10) {
    return number.toFixed(1);
  }
  return number.toFixed(2);
}

function signed(value) {
  const number = Number(value || 0) * 100;
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function maybePct(value, digits = 1) {
  if (value === null || value === undefined) {
    return "pending";
  }
  const number = Number(value) * 100;
  return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%` : "pending";
}

function statusLabel(value) {
  return titleCase(value || "pending_validation");
}

function relativeTime(value) {
  if (!value) {
    return "-";
  }
  const deltaMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (deltaMinutes < 1) {
    return "now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function titleCase(value) {
  return String(value || "").replace(/_/g, " ");
}

function periodLabel(point) {
  if (point.period_type === "annual") {
    return `FY${point.fiscal_year}`;
  }
  if (Number.isFinite(point.fiscal_quarter)) {
    return `Q${point.fiscal_quarter} ${point.fiscal_year}`;
  }
  return point.period_end || "-";
}

function formatFactValue(point) {
  if (!point) {
    return "-";
  }
  if (String(point.unit || "").includes("shares")) {
    return Number(point.value || 0).toFixed(2);
  }
  if (String(point.unit || "").includes("USD")) {
    return `$${compactNumber(point.value)}`;
  }
  return compactNumber(point.value);
}

function badgeClass(label) {
  if (label === "fundamentally_strong") {
    return "strong";
  }
  if (label === "balanced" || label === "fair" || label === "neutral") {
    return "balanced";
  }
  return "weak";
}

function sourceLabel(value) {
  if (value === "live_sec_filing") {
    return "SEC live";
  }
  if (value === "universe_membership") {
    return "Awaiting SEC";
  }
  return "Not live";
}

function screenStageLabel(initialScreen = {}) {
  const base = titleCase(initialScreen.stage || "unknown");
  return initialScreen.provisional ? `${base} (Provisional)` : base;
}

function criteriaTooltip(item = {}) {
  return [item.summary, item.rule, item.why].filter(Boolean).join(" ");
}

function renderCriteriaDetail(criteria = [], selectedKey = null) {
  const active = criteria.find((item) => item.key === selectedKey) || criteria[0];
  if (!active) {
    elements.screenerCriteriaDetail.innerHTML = "";
    return;
  }

  elements.screenerCriteriaDetail.innerHTML = `
    <article class="criteria-card">
      <div class="criteria-card-head">
        <strong>${active.label}</strong>
        <span class="chip">${active.key}</span>
      </div>
      <p>${active.summary || "This rule is part of the stage-one gate."}</p>
      <div class="criteria-meta">
        <span><strong>Pass rule:</strong> ${active.rule || "Not specified."}</span>
        <span><strong>Why it matters:</strong> ${active.why || "Helps reduce false positives in the first-pass screen."}</span>
      </div>
    </article>
  `;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.json();
}

async function loadSelectedDetail() {
  if (!state.selectedTicker) {
    state.detail = null;
    state.filingHistory = [];
    state.factSeries = [];
    return;
  }

  const [detail, filingsResponse, factsResponse] = await Promise.all([
    getJson(`/api/fundamentals/ticker/${state.selectedTicker}`),
    getJson(`/api/fundamentals/storage/ticker/${state.selectedTicker}/filings?limit=8`),
    getJson(
      `/api/fundamentals/storage/ticker/${state.selectedTicker}/facts/${state.selectedFactField}?periodType=${state.selectedFactPeriod}&limit=8`
    )
  ]);

  state.detail = detail;
  state.filingHistory = filingsResponse.filings || [];
  state.factSeries = factsResponse.series || [];
}

function dashboardUrl() {
  const params = new URLSearchParams();
  if (state.sector) {
    params.set("sector", state.sector);
  }
  if (state.search) {
    params.set("search", state.search);
  }
  if (state.minConfidence > 0) {
    params.set("minConfidence", String(state.minConfidence));
  }
  if (state.onlyChanged) {
    params.set("onlyChanged", "true");
  }
  return `/api/fundamentals/dashboard?${params.toString()}`;
}

function stageRows(stage = state.screenStage) {
  const rows = state.dashboard?.leaderboard || [];
  return stage ? rows.filter((item) => item.initial_screen?.stage === stage) : rows;
}

function stageCount(stage) {
  return (state.dashboard?.leaderboard || []).filter((item) => item.initial_screen?.stage === stage).length;
}

function stageEmptyMessage(stage) {
  if (stage === "eligible") {
    return "No names currently pass the current screener settings.";
  }
  if (stage === "watch") {
    return "No watch-stage names right now.";
  }
  return "No rejected names match the current non-stage filters.";
}

async function loadDashboard() {
  const [healthResult, dashboardResult, screenerConfigResult, backtestResult] = await Promise.allSettled([
    getJson("/api/health"),
    getJson(dashboardUrl()),
    getJson("/api/settings/fundamental-screener"),
    getJson("/api/backtests/fundamentals?horizonDays=5&minSample=30")
  ]);

  if (healthResult.status === "fulfilled") {
    state.health = healthResult.value;
  }

  if (dashboardResult.status === "fulfilled") {
    state.dashboard = dashboardResult.value;
  } else {
    console.error(dashboardResult.reason);
    state.dashboard = state.dashboard || {
      as_of: null,
      summary: {
        coverage_count: 0,
        sectors_covered: 0,
        new_filings_today: 0,
        average_confidence: 0,
        average_composite_score: 0,
        data_completeness: 0
      },
      screener: {
        explanation: {
          headline: "Stage one filters the universe before full ranking.",
          eligible: "Passes most checks with no hard failure.",
          watch: "Partial pass or still awaiting live filing support."
        },
        tracked_count: 0,
        eligible_count: 0,
        watch_count: 0,
        rejected_count: 0,
        criteria: [],
        candidates: [],
        watchlist: [],
        live_sec_backed_count: 0,
        pass_rate: 0
      },
      leaderboard: [],
      sectors: [],
      changes: []
    };
  }

  if (screenerConfigResult.status === "fulfilled") {
    state.screenerConfig = screenerConfigResult.value;
  } else {
    console.error(screenerConfigResult.reason);
    state.screenerConfig = state.screenerConfig || { settings: {}, fields: [] };
  }

  if (backtestResult.status === "fulfilled") {
    state.backtest = backtestResult.value;
  } else {
    console.error(backtestResult.reason);
    state.backtest = state.backtest || null;
  }

  const availableTickers = stageRows().map((item) => item.ticker);
  if (!state.selectedTicker || !availableTickers.includes(state.selectedTicker)) {
    state.selectedTicker = availableTickers[0] || null;
  }

  await loadSelectedDetail();
  render();
}

function renderSummary() {
  const summary = state.dashboard?.summary || {};
  const activeRows = stageRows();
  elements.coverageCount.textContent = state.screenStage ? activeRows.length : summary.coverage_count || 0;
  elements.sectorCount.textContent = state.screenStage
    ? `${titleCase(state.screenStage)} view`
    : `${summary.sectors_covered || 0} sectors`;
  elements.averageConfidence.textContent = pct(summary.average_confidence, 0);
  elements.dataCompleteness.textContent = `${pct(summary.data_completeness, 0)} complete`;
  elements.newFilings.textContent = summary.new_filings_today || 0;
  elements.lastUpdate.textContent = state.dashboard?.as_of ? `As of ${new Date(state.dashboard.as_of).toLocaleString()}` : "No refresh yet";
  elements.healthStatus.textContent = state.health?.status || "-";
  elements.healthFundamentals.textContent = `${state.health?.fundamental_companies_scored || 0} companies scored`;
}

function renderSectorFilters() {
  const sectors = state.dashboard?.sectors || [];
  const buttons = [
    `<button class="chip-button ${state.sector ? "" : "active"}" data-sector="">All sectors</button>`,
    ...sectors.map(
      (item) =>
        `<button class="chip-button ${state.sector === item.sector ? "active" : ""}" data-sector="${item.sector}">${item.sector}</button>`
    )
  ];
  elements.sectorFilterChips.innerHTML = buttons.join("");

  for (const button of elements.sectorFilterChips.querySelectorAll("[data-sector]")) {
    button.addEventListener("click", async () => {
      state.sector = button.dataset.sector || null;
      await loadDashboard();
    });
  }
}

function renderBacktest() {
  if (!elements.backtestSummary || !elements.backtestTests) {
    return;
  }

  const backtest = state.backtest;
  if (!backtest) {
    elements.backtestSummary.innerHTML = `<article class="summary-card"><span>Status</span><strong>Unavailable</strong></article>`;
    elements.backtestTests.innerHTML = `<p class="subtle">Backtest evidence is not available yet.</p>`;
    return;
  }

  const summary = backtest.summary || {};
  elements.backtestSummary.innerHTML = `
    <article class="summary-card"><span>Status</span><strong>${statusLabel(backtest.status)}</strong></article>
    <article class="summary-card"><span>Horizon</span><strong>${backtest.horizon_days}d</strong></article>
    <article class="summary-card"><span>Observations</span><strong>${summary.observations || 0}</strong></article>
    <article class="summary-card"><span>Matured Returns</span><strong>${summary.matured_forward_returns || 0}</strong></article>
    <article class="summary-card"><span>Synthetic Excluded</span><strong>${summary.synthetic_outcomes_excluded || 0}</strong></article>
    <article class="summary-card"><span>Min Sample</span><strong>${backtest.min_sample || 0}</strong></article>
  `;

  const tests = [...(backtest.profiles || []), ...(backtest.criteria || [])].slice(0, 10);
  elements.backtestTests.innerHTML = tests.length
    ? tests
        .map((item) => `
          <article class="backtest-card">
            <div class="backtest-card-head">
              <strong>${item.label}</strong>
              <span class="badge ${item.status === "validated_sample" ? "strong" : item.status === "blocked_synthetic_prices" ? "balanced" : "weak"}">${statusLabel(item.status)}</span>
            </div>
            <div class="backtest-metrics">
              <span>Sample <strong>${item.sample_size || 0}/${item.evaluated_count || 0}</strong></span>
              <span>Hit Rate <strong>${item.hit_rate === null || item.hit_rate === undefined ? "pending" : pct(item.hit_rate, 0)}</strong></span>
              <span>Avg Return <strong>${maybePct(item.average_forward_return)}</strong></span>
              <span>False Positives <strong>${item.false_positive_rate === null || item.false_positive_rate === undefined ? "pending" : pct(item.false_positive_rate, 0)}</strong></span>
            </div>
            <small>${(item.limitations || [])[0] || "Enough real forward-return observations exist for this rule."}</small>
          </article>
        `)
        .join("")
    : `<p class="subtle">No backtest rules are available yet.</p>`;
}

function renderScreener() {
  const screener = state.dashboard?.screener || {};
  const allRows = state.dashboard?.leaderboard || [];
  const activeRows = stageRows();
  const stageSourceRows = state.screenStage ? activeRows : allRows;
  const eligibleRows = stageSourceRows.filter((item) => item.initial_screen?.stage === "eligible");
  const watchRows = stageSourceRows.filter((item) => item.initial_screen?.stage === "watch");
  const rejectedRows = stageSourceRows.filter((item) => item.initial_screen?.stage === "reject");
  const stageOptions = [
    { key: "", label: `All tracked (${screener.tracked_count || allRows.length || 0})` },
    { key: "eligible", label: `Eligible (${stageCount("eligible")})` },
    { key: "watch", label: `Watch (${stageCount("watch")})` },
    { key: "reject", label: `Reject (${stageCount("reject")})` }
  ];

  const liveSecBacked = screener.live_sec_backed_count || 0;
  const pendingLiveSec = screener.pending_live_sec_count || 0;
  const healthLiveCompanies = state.health?.live_sources?.sec_fundamentals?.live_companies || 0;

  elements.screenerExplainer.innerHTML = `
    <article class="explain-card explain-card-primary">
      <strong>${screener.explanation?.headline || "Stage one filters the universe before full ranking."}</strong>
      <p>${screener.explanation?.eligible || "Eligible names are the ones that clear the first-pass gate cleanly."}</p>
    </article>
    <article class="explain-card">
      <span>What eligible means</span>
      <p>${screener.explanation?.eligible || "Passes most checks with no hard failure."}</p>
    </article>
    <article class="explain-card">
      <span>What watch means</span>
      <p>${screener.explanation?.watch || "Partial pass or still awaiting live filing support."}</p>
    </article>
    <article class="explain-card">
      <span>Data quality note</span>
      <p>${pendingLiveSec ? `${pendingLiveSec} names are awaiting live SEC refresh and are excluded from ranked fundamentals. ${liveSecBacked || healthLiveCompanies} names are fully SEC-backed right now.` : "All displayed names are currently backed by live SEC refresh."}</p>
    </article>
  `;

  elements.screenerSummary.innerHTML = `
    <article class="summary-card"><span>Tracked</span><strong>${screener.tracked_count || 0}</strong></article>
    <article class="summary-card"><span>Eligible</span><strong>${stageCount("eligible")}</strong></article>
    <article class="summary-card"><span>Watch</span><strong>${stageCount("watch")}</strong></article>
    <article class="summary-card"><span>Rejected</span><strong>${stageCount("reject")}</strong></article>
    <article class="summary-card"><span>Pass Rate</span><strong>${pct(screener.pass_rate || 0, 0)}</strong></article>
    <article class="summary-card"><span>Criteria</span><strong>${(screener.criteria || []).length}</strong></article>
    <article class="summary-card"><span>SEC Live</span><strong>${liveSecBacked || healthLiveCompanies}</strong></article>
    <article class="summary-card"><span>Awaiting SEC</span><strong>${pendingLiveSec}</strong></article>
  `;

  elements.screenerCriteria.innerHTML = (screener.criteria || []).length
    ? screener.criteria
          .map(
            (item) =>
              `<button type="button" class="chip-button ${state.selectedCriteriaKey === item.key || (!state.selectedCriteriaKey && screener.criteria[0]?.key === item.key) ? "active" : ""}" data-criteria-key="${item.key}" title="${criteriaTooltip(item)}">${item.label}</button>`
          )
          .join("")
    : `<span class="subtle">No screening criteria loaded yet.</span>`;

  renderCriteriaDetail(screener.criteria || [], state.selectedCriteriaKey);

  for (const button of elements.screenerCriteria.querySelectorAll("[data-criteria-key]")) {
    button.addEventListener("click", () => {
      state.selectedCriteriaKey = button.dataset.criteriaKey;
      renderScreener();
    });
    button.addEventListener("mouseenter", () => {
      state.selectedCriteriaKey = button.dataset.criteriaKey;
      renderCriteriaDetail(screener.criteria || [], state.selectedCriteriaKey);
    });
    button.addEventListener("focus", () => {
      state.selectedCriteriaKey = button.dataset.criteriaKey;
      renderCriteriaDetail(screener.criteria || [], state.selectedCriteriaKey);
    });
  }

  const screenerFields = state.screenerConfig?.fields || [];
  const screenerValues = state.screenerConfig?.settings || {};
  elements.screenerSettings.innerHTML = screenerFields
    .map((field) => {
      if (field.type === "boolean") {
        return `
          <label class="setting-card">
            <span>${field.label}</span>
            <small>${field.help || ""}</small>
            <input type="checkbox" data-screener-setting="${field.key}" ${screenerValues[field.key] ? "checked" : ""}>
          </label>
        `;
      }

      return `
        <label class="setting-card">
          <span>${field.label}</span>
          <small>${field.help || ""}</small>
          <input
            type="number"
            data-screener-setting="${field.key}"
            min="${field.min ?? ""}"
            max="${field.max ?? ""}"
            step="${field.step ?? "0.01"}"
            value="${screenerValues[field.key] ?? ""}"
          >
        </label>
      `;
    })
    .join("");

  for (const input of elements.screenerSettings.querySelectorAll("[data-screener-setting]")) {
    const key = input.dataset.screenerSetting;
    input.addEventListener("input", () => {
      state.screenerSaveState = "";
      if (input.type === "checkbox") {
        state.screenerConfig.settings[key] = input.checked;
      } else {
        state.screenerConfig.settings[key] = Number(input.value);
      }
    });
  }

  elements.screenerSettings.insertAdjacentHTML(
    "beforeend",
    `<div class="settings-actions"><button type="button" class="primary-button" id="save-screener-settings">${state.screenerSaveState === "saving" ? "Saving..." : state.screenerSaveState === "saved" ? "Saved" : "Save Screener Settings"}</button></div>`
  );

  elements.screenerSettings.querySelector("#save-screener-settings")?.addEventListener("click", async () => {
    state.screenerSaveState = "saving";
    renderScreener();
    try {
      const response = await fetch("/api/settings/fundamental-screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...state.screenerConfig.settings, persist: true })
      });
      if (!response.ok) {
        throw new Error("Failed to save screener settings");
      }
      const payload = await response.json();
      state.screenerConfig = payload.screener;
      state.screenerSaveState = "saved";
      await loadDashboard();
    } catch (error) {
      console.error(error);
      state.screenerSaveState = "";
      renderScreener();
    }
  });

  elements.screenerStageChips.innerHTML = stageOptions
    .map(
      (option) =>
        `<button class="chip-button ${state.screenStage === (option.key || null) || (!state.screenStage && !option.key) ? "active" : ""}" data-screen-stage="${option.key}">${option.label}</button>`
    )
    .join("");

  for (const button of elements.screenerStageChips.querySelectorAll("[data-screen-stage]")) {
    button.addEventListener("click", async () => {
      state.screenStage = button.dataset.screenStage || null;
      await loadDashboard();
    });
  }

  elements.screenerCandidates.innerHTML = (screener.candidates || []).length
    ? screener.candidates
        .map(
          (item) => `
            <article class="feed-card" data-screener-ticker="${item.ticker}">
              <div class="feed-card-head">
                <strong>${item.ticker}</strong>
                <span>${item.sector}</span>
              </div>
              <p>${item.company_name}</p>
              <div class="score-row">
                <span>Screen ${score(item.screen_score)}</span>
                <span>${pct(item.final_confidence, 0)} conf</span>
              </div>
              <div class="score-row">
                <span>Checks ${item.passed_count || 0}/${item.total_checks || 0}</span>
                <span>${sourceLabel(item.data_source)}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="subtle">No names currently pass the current screener settings. Loosen the thresholds below or disable "Require Live SEC For Eligible" to allow provisional candidates through.</p>`;

  elements.screenerWatchlist.innerHTML = (screener.watchlist || []).length
    ? screener.watchlist
        .map(
          (item) => `
            <article class="feed-card" data-screener-ticker="${item.ticker}">
              <div class="feed-card-head">
                <strong>${item.ticker}</strong>
                <span>${item.sector}</span>
              </div>
              <p>${item.company_name}</p>
              <div class="score-row">
                <span>Screen ${score(item.screen_score)} · ${item.passed_count || 0}/${item.total_checks || 0}</span>
                <span>${(item.failed_checks || []).slice(0, 2).join(", ") || "Needs review"}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="subtle">No watch-stage names right now.</p>`;

  const renderStageCards = (rows, stage) => rows.length
    ? rows
        .slice(0, 12)
        .map((item) => {
          const screen = item.initial_screen || {};
          const failedChecks = screen.failed_checks || item.failed_checks || [];
          return `
            <article class="feed-card" data-screener-ticker="${item.ticker}">
              <div class="feed-card-head">
                <strong>${item.ticker}</strong>
                <span>${item.sector}</span>
              </div>
              <p>${item.company_name}</p>
              <div class="score-row">
                <span>Screen ${score(screen.score ?? item.screen_score)}</span>
                <span>${pct(item.final_confidence, 0)} conf</span>
              </div>
              <div class="score-row">
                <span>Checks ${screen.passed_count ?? item.passed_count ?? 0}/${screen.total_checks ?? item.total_checks ?? 0}</span>
                <span>${stage === "reject" ? titleCase(item.rating_label) : sourceLabel(item.data_source)}</span>
              </div>
              ${
                stage !== "eligible" && failedChecks.length
                  ? `<p class="subtle">${failedChecks.slice(0, 2).join(", ")}</p>`
                  : ""
              }
            </article>
          `;
        })
        .join("")
    : `<p class="subtle">${stageEmptyMessage(stage)}</p>`;

  elements.screenerCandidates.innerHTML = renderStageCards(eligibleRows, "eligible");
  elements.screenerWatchlist.innerHTML = renderStageCards(watchRows, "watch");
  elements.screenerRejected.innerHTML = renderStageCards(rejectedRows, "reject");

  for (const card of [
    ...elements.screenerCandidates.querySelectorAll("[data-screener-ticker]"),
    ...elements.screenerWatchlist.querySelectorAll("[data-screener-ticker]"),
    ...elements.screenerRejected.querySelectorAll("[data-screener-ticker]")
  ]) {
    card.addEventListener("click", async () => {
      state.selectedTicker = card.dataset.screenerTicker;
      await loadSelectedDetail();
      renderDetail();
      renderLeaderboard();
    });
  }
}

function renderSectors() {
  const sectors = state.dashboard?.sectors || [];
  elements.sectorCards.innerHTML = sectors.length
    ? sectors
        .map(
          (sector) => `
            <article class="sector-card">
              <button type="button" data-sector-card="${sector.sector}">
                <div class="sector-card-head">
                  <strong>${sector.sector}</strong>
                  <span>#${sector.rank}</span>
                </div>
                <div class="score-row">
                  <span>Attractiveness</span>
                  <strong>${score(sector.sector_attractiveness_score)}</strong>
                </div>
                <div class="score-track"><div class="score-fill strong" style="width:${Math.round(sector.sector_attractiveness_score * 100)}%"></div></div>
                <div class="score-row">
                  <span>Median growth</span>
                  <span>${pct(sector.median_revenue_growth, 1)}</span>
                </div>
                <div class="score-row">
                  <span>Median margin</span>
                  <span>${pct(sector.median_operating_margin, 1)}</span>
                </div>
              </button>
            </article>
          `
        )
        .join("")
    : `<p class="subtle">No sectors match the current filters.</p>`;

  for (const button of elements.sectorCards.querySelectorAll("[data-sector-card]")) {
    button.addEventListener("click", async () => {
      state.sector = button.dataset.sectorCard;
      await loadDashboard();
    });
  }
}

function renderLeaderboard() {
  const rows = stageRows();
  elements.leaderboardExplainer.textContent =
    "This table is the full ranking model after the stage-one screener. Screen shows the first-pass gate result. Composite is the blended overall score. Confidence measures data trust, not upside. Rating is the qualitative interpretation. Delta 30d shows how the composite changed over the last month.";
  elements.leaderboardBody.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr class="${state.selectedTicker === row.ticker ? "is-selected" : ""}" data-ticker="${row.ticker}">
              <td><strong>${row.ticker}</strong><br><small>${row.company_name}</small><br><small class="source-note">${sourceLabel(row.data_source)}</small></td>
              <td>${row.sector}</td>
                <td><span class="badge ${row.initial_screen?.stage === "eligible" ? "strong" : row.initial_screen?.stage === "watch" ? "balanced" : "weak"}">${screenStageLabel(row.initial_screen)}</span></td>
              <td>${score(row.composite_fundamental_score)}</td>
              <td>${pct(row.final_confidence, 0)}</td>
              <td><span class="badge ${badgeClass(row.rating_label)}">${titleCase(row.rating_label)}</span></td>
              <td>${signed(row.score_delta_30d)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="7">No companies match the current filters.</td></tr>`;

  for (const row of elements.leaderboardBody.querySelectorAll("[data-ticker]")) {
    row.addEventListener("click", async () => {
      state.selectedTicker = row.dataset.ticker;
      await loadSelectedDetail();
      renderDetail();
      renderLeaderboard();
    });
  }
}

function renderChanges() {
  const visibleTickers = new Set(stageRows().map((item) => item.ticker));
  const changes = (state.dashboard?.changes || []).filter((item) => !state.screenStage || visibleTickers.has(item.ticker));
  elements.changesFeed.innerHTML = changes.length
    ? changes
        .map(
          (item) => `
            <article class="feed-card">
              <div class="feed-card-head">
                <strong>${item.ticker}</strong>
                <span>${relativeTime(item.as_of)}</span>
              </div>
              <p>${titleCase(item.type)}: ${item.changes.join(", ")}.</p>
              <div class="score-row">
                <span>${titleCase(item.rating_label)}</span>
                <span>${pct(item.confidence, 0)} conf</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="subtle">No change events yet.</p>`;
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    elements.detailTitle.textContent = "Select a company";
    elements.detailSubtitle.textContent = "Factor cards, confidence, and filing context.";
    elements.detailSummary.innerHTML = "";
    elements.factorCards.innerHTML = "";
    elements.confidenceBreakdown.innerHTML = "";
    elements.reasonCodes.innerHTML = "";
    elements.detailNotes.innerHTML = "";
    elements.filingTimeline.innerHTML = "";
    elements.scoreHistory.innerHTML = "";
    elements.warehouseFilings.innerHTML = "";
    elements.factSeriesChart.innerHTML = "";
    elements.warehouseFilingsCaption.textContent = "Recent persisted filing events and mapped record counts.";
    elements.factSeriesCaption.textContent = "Quarterly history for the selected canonical field.";
    return;
  }

  elements.detailTitle.textContent = `${detail.ticker} | ${detail.company_name}`;
  elements.detailSubtitle.textContent = `${detail.sector} / ${detail.industry} / ${titleCase(detail.regime_label)}`;
  elements.detailSummary.innerHTML = `
    <article class="summary-card"><span>Data Source</span><strong>${sourceLabel(detail.data_source)}</strong></article>
      <article class="summary-card"><span>Screen Stage</span><strong>${screenStageLabel(detail.initial_screen)}</strong></article>
    <article class="summary-card"><span>Checks Passed</span><strong>${detail.initial_screen?.passed_count || 0} / ${detail.initial_screen?.total_checks || 0}</strong></article>
    <article class="summary-card"><span>Composite</span><strong>${score(detail.composite_fundamental_score)}</strong></article>
    <article class="summary-card"><span>Confidence</span><strong>${pct(detail.final_confidence, 0)}</strong></article>
    <article class="summary-card"><span>Valuation</span><strong>${titleCase(detail.valuation_label)}</strong></article>
    <article class="summary-card"><span>Direction</span><strong>${titleCase(detail.direction_label)}</strong></article>
    <article class="summary-card"><span>Current Price</span><strong>${detail.market_reference?.current_price ? `$${score(detail.market_reference.current_price)}` : "-"}</strong></article>
    <article class="summary-card"><span>Market Cap</span><strong>${compactCurrency(detail.market_reference?.market_cap)}</strong></article>
  `;

  elements.factorCards.innerHTML = detail.factor_cards
    .map(
      (card) => `
        <article class="factor-card">
          <div class="score-row">
            <strong>${card.label}</strong>
            <span>${score(card.value)}</span>
          </div>
          <div class="score-track"><div class="score-fill ${badgeClass(detail.rating_label)}" style="width:${Math.round(card.value * 100)}%"></div></div>
          <p>${card.summary}</p>
        </article>
      `
    )
    .join("");

  elements.confidenceBreakdown.innerHTML = Object.entries(detail.confidence_breakdown)
    .map(
      ([key, value]) => `
        <div class="metric-row">
          <strong>${titleCase(key)}</strong>
          <span>${key === "anomaly_penalty" ? pct(value, 0) : pct(value, 0)}</span>
        </div>
      `
    )
    .join("");

  elements.reasonCodes.innerHTML = detail.reason_codes.map((code) => `<span class="chip">${titleCase(code)}</span>`).join("");
  elements.detailNotes.innerHTML = [
    `<li>Initial screener: ${detail.initial_screen?.summary || "No screener summary available."}</li>`,
    `<li>Data source: ${sourceLabel(detail.data_source)}.</li>`,
    `<li>${detail.explanation_short}</li>`,
    ...detail.notes.map((note) => `<li>${note}</li>`),
    `<li>Top strengths: ${detail.top_strengths.join(", ")}.</li>`,
    `<li>Top weaknesses: ${detail.top_weaknesses.join(", ")}.</li>`,
    detail.initial_screen?.failed_checks?.length ? `<li>Missed screener checks: ${detail.initial_screen.failed_checks.join(", ")}.</li>` : "",
    detail.initial_screen?.hard_failures?.length ? `<li>Hard screener failures: ${detail.initial_screen.hard_failures.join(", ")}.</li>` : "",
    detail.market_reference
      ? `<li>Market reference source: ${detail.market_reference.provider}${detail.market_reference.live ? " (live)" : " (fallback)"}.</li>`
      : ""
  ].join("");

  elements.filingTimeline.innerHTML = detail.filing_timeline
    .map(
      (item) => `
        <div class="timeline-item">
          <div>
            <strong>${item.form_type}</strong>
            <small>${item.filing_date}</small>
          </div>
          <span>${item.note}</span>
        </div>
      `
    )
    .join("");

  elements.warehouseFilingsCaption.textContent = state.filingHistory.length
    ? `${state.filingHistory.length} persisted filing event${state.filingHistory.length === 1 ? "" : "s"} loaded from warehouse storage.`
    : "No persisted SEC filing events are available for this ticker yet.";

  elements.warehouseFilings.innerHTML = state.filingHistory.length
    ? state.filingHistory
        .map(
          (item) => `
            <div class="timeline-item timeline-item-rich">
              <div>
                <strong>${item.form_type}</strong>
                <small>${item.filing_date}</small>
              </div>
              <div class="timeline-metrics">
                <span>${item.periods_count} periods</span>
                <span>${item.facts_count} facts</span>
              </div>
            </div>
          `
        )
        .join("")
    : `<p class="subtle">Live SEC-backed warehouse history will appear here after filings are ingested.</p>`;

  elements.scoreHistory.innerHTML = detail.score_history
    .map(
      (point) => `
        <article class="history-card">
          <span>${point.label}</span>
          <strong>${score(point.score)}</strong>
        </article>
      `
    )
    .join("");

  elements.factSeriesCaption.textContent = state.factSeries.length
    ? `${titleCase(state.selectedFactField)} over ${titleCase(state.selectedFactPeriod)} periods from the warehouse fact layer.`
    : `${titleCase(state.selectedFactField)} history is not available for this ticker in the current warehouse snapshot.`;

  const maxAbsValue = Math.max(...state.factSeries.map((point) => Math.abs(Number(point.value || 0))), 1);
  elements.factSeriesChart.innerHTML = state.factSeries.length
    ? state.factSeries
        .map((point) => {
          const value = Number(point.value || 0);
          const intensity = Math.max(12, Math.round((Math.abs(value) / maxAbsValue) * 100));
          return `
            <article class="fact-point">
              <div class="fact-point-head">
                <strong>${periodLabel(point)}</strong>
                <span>${formatFactValue(point)}</span>
              </div>
              <div class="fact-bar-track">
                <div class="fact-bar ${value >= 0 ? "positive" : "negative"}" style="width:${intensity}%"></div>
              </div>
              <div class="fact-point-meta">
                <span>${point.form_type || "-"}</span>
                <span>${point.period_end || "-"}</span>
              </div>
            </article>
          `;
        })
        .join("")
    : `<p class="subtle">No canonical series points are available for the selected metric.</p>`;
}

function render() {
  renderSummary();
  renderScreener();
  renderBacktest();
  renderSectorFilters();
  renderSectors();
  renderLeaderboard();
  renderChanges();
  renderDetail();
  elements.refreshButton.textContent =
    state.refreshState === "refreshing" ? "Refreshing..." : state.refreshState === "done" ? "Refreshed" : "Refresh";
  elements.refreshButton.disabled = state.refreshState === "refreshing";
}

function attachEvents() {
  elements.tickerSearch.addEventListener("input", async () => {
    state.search = elements.tickerSearch.value.trim();
    await loadDashboard();
  });

  elements.confidenceFilter.addEventListener("input", async () => {
    state.minConfidence = Number(elements.confidenceFilter.value) / 100;
    elements.confidenceValue.textContent = pct(state.minConfidence, 0);
    await loadDashboard();
  });

  elements.changedOnly.addEventListener("change", async () => {
    state.onlyChanged = elements.changedOnly.checked;
    await loadDashboard();
  });

  elements.factSeriesField.addEventListener("change", async () => {
    state.selectedFactField = elements.factSeriesField.value;
    await loadSelectedDetail();
    renderDetail();
  });

  elements.factSeriesPeriod.addEventListener("change", async () => {
    state.selectedFactPeriod = elements.factSeriesPeriod.value;
    await loadSelectedDetail();
    renderDetail();
  });

  elements.refreshButton.addEventListener("click", async () => {
    state.refreshState = "refreshing";
    render();

    try {
      const response = await fetch("/api/fundamentals/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceUniverse: true })
      });

      if (!response.ok) {
        throw new Error("Failed to refresh fundamentals");
      }

      await loadDashboard();
      state.refreshState = "done";
    } catch (error) {
      console.error(error);
      state.refreshState = "";
      render();
      return;
    }

    render();
    setTimeout(() => {
      state.refreshState = "";
      render();
    }, 1200);
  });
}

function startStream() {
  const stream = new EventSource("/api/stream");
  let refreshTimer = null;

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      loadDashboard().catch((error) => console.error(error));
    }, 150);
  };

  for (const eventName of ["snapshot", "fundamental_score_update", "fundamental_change"]) {
    stream.addEventListener(eventName, scheduleRefresh);
  }
}

async function init() {
  attachEvents();
  await loadDashboard();
  startStream();
}

init().catch((error) => {
  console.error(error);
});
