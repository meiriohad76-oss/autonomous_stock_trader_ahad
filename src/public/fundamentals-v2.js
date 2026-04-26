const state = {
  dashboard: null,
  health: null,
  detail: null,
  search: "",
  minConfidence: 0,
  sector: null,
  stage: null,
  onlyChanged: false,
  refreshState: ""
};

const elements = {
  summaryGrid: document.querySelector("#summary-grid"),
  tickerSearch: document.querySelector("#ticker-search"),
  confidenceFilter: document.querySelector("#confidence-filter"),
  confidenceValue: document.querySelector("#confidence-value"),
  sectorFilter: document.querySelector("#sector-filter"),
  changedOnly: document.querySelector("#changed-only"),
  refreshButton: document.querySelector("#refresh-button"),
  stageTabs: document.querySelector("#stage-tabs"),
  screenerNote: document.querySelector("#screener-note"),
  criteriaList: document.querySelector("#criteria-list"),
  resultsCaption: document.querySelector("#results-caption"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  detailTitle: document.querySelector("#detail-title"),
  detailSubtitle: document.querySelector("#detail-subtitle"),
  detailSummary: document.querySelector("#detail-summary"),
  detailNotes: document.querySelector("#detail-notes"),
  changesFeed: document.querySelector("#changes-feed")
};

function pct(value, digits = 0) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function score(value) {
  return Number(value || 0).toFixed(2);
}

function titleCase(value) {
  return String(value || "").replace(/_/g, " ");
}

function signed(value) {
  const number = Number(value || 0) * 100;
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
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

function sourceLabel(value) {
  if (value === "live_sec_filing") {
    return "SEC live";
  }
  if (value === "bootstrap_placeholder") {
    return "Bootstrap";
  }
  return "Sample";
}

function screenStageLabel(initialScreen = {}) {
  const base = titleCase(initialScreen.stage || "unknown");
  return initialScreen.provisional ? `${base} (Provisional)` : base;
}

function dashboardUrl() {
  const params = new URLSearchParams();
  if (state.search) {
    params.set("search", state.search);
  }
  if (state.minConfidence > 0) {
    params.set("minConfidence", String(state.minConfidence));
  }
  if (state.sector) {
    params.set("sector", state.sector);
  }
  if (state.stage) {
    params.set("screenStage", state.stage);
  }
  if (state.onlyChanged) {
    params.set("onlyChanged", "true");
  }
  return `/api/fundamentals/dashboard?${params.toString()}`;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.json();
}

async function loadDetail(ticker) {
  if (!ticker) {
    state.detail = null;
    return;
  }
  state.detail = await getJson(`/api/fundamentals/ticker/${ticker}`);
}

async function loadDashboard() {
  const [health, dashboard] = await Promise.all([
    getJson("/api/health"),
    getJson(dashboardUrl())
  ]);
  state.health = health;
  state.dashboard = dashboard;

  const firstTicker = dashboard.leaderboard[0]?.ticker || null;
  if (!state.detail || !dashboard.leaderboard.some((item) => item.ticker === state.detail?.ticker)) {
    await loadDetail(firstTicker);
  }

  render();
}

function renderSummary() {
  const summary = state.dashboard?.summary || {};
  const screener = state.dashboard?.screener || {};
  elements.summaryGrid.innerHTML = `
    <article class="summary-card"><span>Coverage</span><strong>${summary.coverage_count || 0}</strong></article>
    <article class="summary-card"><span>Eligible</span><strong>${screener.eligible_count || 0}</strong></article>
    <article class="summary-card"><span>Watch</span><strong>${screener.watch_count || 0}</strong></article>
    <article class="summary-card"><span>Rejected</span><strong>${screener.rejected_count || 0}</strong></article>
    <article class="summary-card"><span>Avg Confidence</span><strong>${pct(summary.average_confidence || 0, 0)}</strong></article>
    <article class="summary-card"><span>Live SEC</span><strong>${screener.live_sec_backed_count || 0}</strong></article>
  `;
}

function renderToolbar() {
  const sectors = state.dashboard?.sectors || [];
  const selected = state.sector || "";
  elements.sectorFilter.innerHTML = [
    `<option value="">All sectors</option>`,
    ...sectors.map((item) => `<option value="${item.sector}" ${selected === item.sector ? "selected" : ""}>${item.sector}</option>`)
  ].join("");
  elements.confidenceValue.textContent = pct(state.minConfidence, 0);
}

function renderStages() {
  const screener = state.dashboard?.screener || {};
  const stages = [
    { key: "", label: `All (${screener.tracked_count || 0})` },
    { key: "eligible", label: `Eligible (${screener.eligible_count || 0})` },
    { key: "watch", label: `Watch (${screener.watch_count || 0})` },
    { key: "reject", label: `Reject (${screener.rejected_count || 0})` }
  ];

  elements.stageTabs.innerHTML = stages
    .map((item) => `<button type="button" class="${(state.stage || "") === item.key ? "active" : ""}" data-stage="${item.key}">${item.label}</button>`)
    .join("");

  elements.screenerNote.innerHTML = `
    <strong>${screener.explanation?.headline || "Stage one is the first-pass gate."}</strong>
    <p>${screener.explanation?.eligible || "Eligible names pass most checks."}</p>
    <p>${screener.explanation?.watch || "Watch names need more evidence or live SEC support."}</p>
  `;

  for (const button of elements.stageTabs.querySelectorAll("[data-stage]")) {
    button.addEventListener("click", async () => {
      state.stage = button.dataset.stage || null;
      await loadDashboard();
    });
  }
}

function renderCriteria() {
  const criteria = state.dashboard?.screener?.criteria || [];
  elements.criteriaList.innerHTML = criteria.length
    ? criteria
        .map(
          (item) => `
            <article class="criteria-card">
              <strong>${item.label}</strong>
              <p>${item.summary || ""}</p>
              <div class="criteria-rule">${item.rule || ""}</div>
              <p>${item.why || ""}</p>
            </article>
          `
        )
        .join("")
    : `<div class="note-card">No criteria loaded.</div>`;
}

function renderLeaderboard() {
  const rows = state.dashboard?.leaderboard || [];
  const screener = state.dashboard?.screener || {};
  elements.resultsCaption.textContent = state.stage
    ? `Showing ${rows.length} ${titleCase(state.stage)} names from the currently filtered universe.`
    : `Showing ${rows.length} rows from the screened universe. ${screener.eligible_count || 0} names currently pass stage one.`;

  elements.leaderboardBody.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr class="${state.detail?.ticker === row.ticker ? "is-selected" : ""}" data-ticker="${row.ticker}">
              <td>
                <div class="ticker-cell">
                  <strong>${row.ticker}</strong>
                  <small>${row.company_name}</small>
                  <small>${sourceLabel(row.data_source)}</small>
                </div>
              </td>
              <td><span class="badge ${row.initial_screen?.stage || "reject"}">${screenStageLabel(row.initial_screen)}</span></td>
              <td>${score(row.composite_fundamental_score)}</td>
              <td>${pct(row.final_confidence, 0)}</td>
              <td>${row.sector}</td>
              <td class="summary-line">${row.initial_screen?.summary || row.explanation_short || "No summary available."}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6">No companies match the current filter set.</td></tr>`;

  for (const row of elements.leaderboardBody.querySelectorAll("[data-ticker]")) {
    row.addEventListener("click", async () => {
      await loadDetail(row.dataset.ticker);
      renderDetail();
      renderLeaderboard();
    });
  }
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    elements.detailTitle.textContent = "Select a company";
    elements.detailSubtitle.textContent = "Use the table to inspect a screen result.";
    elements.detailSummary.innerHTML = "";
    elements.detailNotes.innerHTML = "";
    return;
  }

  elements.detailTitle.textContent = `${detail.ticker} - ${detail.company_name}`;
  elements.detailSubtitle.textContent = `${detail.sector} / ${detail.industry} / ${screenStageLabel(detail.initial_screen)}`;
  elements.detailSummary.innerHTML = `
    <article class="detail-stat"><span>Composite</span><strong>${score(detail.composite_fundamental_score)}</strong></article>
    <article class="detail-stat"><span>Confidence</span><strong>${pct(detail.final_confidence, 0)}</strong></article>
    <article class="detail-stat"><span>Checks Passed</span><strong>${detail.initial_screen?.passed_count || 0} / ${detail.initial_screen?.total_checks || 0}</strong></article>
    <article class="detail-stat"><span>Data Source</span><strong>${sourceLabel(detail.data_source)}</strong></article>
    <article class="detail-stat"><span>Rating</span><strong>${titleCase(detail.rating_label)}</strong></article>
    <article class="detail-stat"><span>Direction</span><strong>${titleCase(detail.direction_label)}</strong></article>
  `;

  const notes = [
    `<div class="change-card"><strong>Screen Summary</strong><p>${detail.initial_screen?.summary || "No screener summary available."}</p></div>`,
    detail.initial_screen?.failed_checks?.length
      ? `<div class="change-card"><strong>Missed Checks</strong><p>${detail.initial_screen.failed_checks.join(", ")}</p></div>`
      : "",
    detail.initial_screen?.hard_failures?.length
      ? `<div class="change-card"><strong>Hard Failures</strong><p>${detail.initial_screen.hard_failures.join(", ")}</p></div>`
      : "",
    `<div class="change-card"><strong>Explanation</strong><p>${detail.explanation_short}</p></div>`
  ].filter(Boolean);
  elements.detailNotes.innerHTML = notes.join("");
}

function renderChanges() {
  const changes = state.dashboard?.changes || [];
  elements.changesFeed.innerHTML = changes.length
    ? changes
        .map(
          (item) => `
            <article class="change-card">
              <strong>${item.ticker} - ${titleCase(item.type)}</strong>
              <p>${item.changes.join(", ")}</p>
              <small class="subtle">${relativeTime(item.as_of)} · ${pct(item.confidence, 0)} confidence</small>
            </article>
          `
        )
        .join("")
    : `<div class="note-card">No change events yet.</div>`;
}

function render() {
  renderSummary();
  renderToolbar();
  renderStages();
  renderCriteria();
  renderLeaderboard();
  renderDetail();
  renderChanges();
  elements.refreshButton.textContent = state.refreshState === "refreshing" ? "Refreshing..." : "Refresh";
  elements.refreshButton.disabled = state.refreshState === "refreshing";
}

function attachEvents() {
  elements.tickerSearch.addEventListener("input", async () => {
    state.search = elements.tickerSearch.value.trim();
    await loadDashboard();
  });

  elements.confidenceFilter.addEventListener("input", async () => {
    state.minConfidence = Number(elements.confidenceFilter.value) / 100;
    await loadDashboard();
  });

  elements.sectorFilter.addEventListener("change", async () => {
    state.sector = elements.sectorFilter.value || null;
    await loadDashboard();
  });

  elements.changedOnly.addEventListener("change", async () => {
    state.onlyChanged = elements.changedOnly.checked;
    await loadDashboard();
  });

  elements.refreshButton.addEventListener("click", async () => {
    state.refreshState = "refreshing";
    render();
    try {
      await fetch("/api/fundamentals/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceUniverse: true })
      });
      await loadDashboard();
    } finally {
      state.refreshState = "";
      render();
    }
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

init().catch((error) => console.error(error));
