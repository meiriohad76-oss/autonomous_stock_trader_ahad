const state = {
  dashboard: null,
  health: null,
  detail: null,
  filingHistory: [],
  factSeries: [],
  selectedTicker: null,
  sector: null,
  search: "",
  minConfidence: 0,
  onlyChanged: false,
  screenStage: null,
  selectedFactField: "revenue",
  selectedFactPeriod: "quarterly"
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
  screenerSummary: document.querySelector("#screener-summary"),
  screenerCriteria: document.querySelector("#screener-criteria"),
  screenerCandidates: document.querySelector("#screener-candidates"),
  screenerWatchlist: document.querySelector("#screener-watchlist"),
  screenerStageChips: document.querySelector("#screener-stage-chips"),
  sectorFilterChips: document.querySelector("#sector-filter-chips"),
  sectorCards: document.querySelector("#sector-cards"),
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
  if (state.screenStage) {
    params.set("screenStage", state.screenStage);
  }
  return `/api/fundamentals/dashboard?${params.toString()}`;
}

async function loadDashboard() {
  const [health, dashboard] = await Promise.all([getJson("/api/health"), getJson(dashboardUrl())]);
  state.health = health;
  state.dashboard = dashboard;

  const availableTickers = dashboard.leaderboard.map((item) => item.ticker);
  if (!state.selectedTicker || !availableTickers.includes(state.selectedTicker)) {
    state.selectedTicker = availableTickers[0] || null;
  }

  await loadSelectedDetail();
  render();
}

function renderSummary() {
  const summary = state.dashboard?.summary || {};
  elements.coverageCount.textContent = summary.coverage_count || 0;
  elements.sectorCount.textContent = `${summary.sectors_covered || 0} sectors`;
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

function renderScreener() {
  const screener = state.dashboard?.screener || {};
  const stageOptions = [
    { key: "", label: "All tracked" },
    { key: "eligible", label: "Eligible" },
    { key: "watch", label: "Watch" },
    { key: "reject", label: "Reject" }
  ];

  elements.screenerSummary.innerHTML = `
    <article class="summary-card"><span>Tracked</span><strong>${screener.tracked_count || 0}</strong></article>
    <article class="summary-card"><span>Eligible</span><strong>${screener.eligible_count || 0}</strong></article>
    <article class="summary-card"><span>Watch</span><strong>${screener.watch_count || 0}</strong></article>
    <article class="summary-card"><span>Rejected</span><strong>${screener.rejected_count || 0}</strong></article>
    <article class="summary-card"><span>Pass Rate</span><strong>${pct(screener.pass_rate || 0, 0)}</strong></article>
    <article class="summary-card"><span>Criteria</span><strong>${(screener.criteria || []).length}</strong></article>
  `;

  elements.screenerCriteria.innerHTML = (screener.criteria || []).length
    ? screener.criteria
        .map(
          (item) => `<span class="chip" title="${item.key || ""}">${item.label}</span>`
        )
        .join("")
    : `<span class="subtle">No screening criteria loaded yet.</span>`;

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
            </article>
          `
        )
        .join("")
    : `<p class="subtle">No names currently pass the initial screener.</p>`;

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
                <span>Screen ${score(item.screen_score)}</span>
                <span>${(item.failed_checks || []).slice(0, 2).join(", ") || "Needs review"}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="subtle">No watch-stage names right now.</p>`;

  for (const card of [...elements.screenerCandidates.querySelectorAll("[data-screener-ticker]"), ...elements.screenerWatchlist.querySelectorAll("[data-screener-ticker]")]) {
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
  const rows = state.dashboard?.leaderboard || [];
  elements.leaderboardBody.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr class="${state.selectedTicker === row.ticker ? "is-selected" : ""}" data-ticker="${row.ticker}">
              <td><strong>${row.ticker}</strong><br><small>${row.company_name}</small></td>
              <td>${row.sector}</td>
              <td><span class="badge ${row.initial_screen?.stage === "eligible" ? "strong" : row.initial_screen?.stage === "watch" ? "balanced" : "weak"}">${titleCase(row.initial_screen?.stage || "unknown")}</span></td>
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
  const changes = state.dashboard?.changes || [];
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
    <article class="summary-card"><span>Screen Stage</span><strong>${titleCase(detail.initial_screen?.stage || "unknown")}</strong></article>
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
  renderSectorFilters();
  renderSectors();
  renderLeaderboard();
  renderChanges();
  renderDetail();
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

  elements.refreshButton.addEventListener("click", loadDashboard);
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
