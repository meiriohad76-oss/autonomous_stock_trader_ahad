const state = {
  baseDashboard: null,
  dashboard: null,
  health: null,
  detail: null,
  search: "",
  minConfidence: 0,
  sector: null,
  stage: null,
  onlyChanged: false,
  selectedTicker: null,
  selectedCriteriaKey: null,
  screenerConfig: null,
  screenerSaveState: "",
  refreshState: "",
  baseReloadTimer: null,
  searchTimer: null,
  loadingBase: false
};

const elements = {
  summaryGrid: document.querySelector("#summary-grid"),
  tickerSearch: document.querySelector("#ticker-search"),
  confidenceFilter: document.querySelector("#confidence-filter"),
  confidenceValue: document.querySelector("#confidence-value"),
  sectorFilter: document.querySelector("#sector-filter"),
  changedOnly: document.querySelector("#changed-only"),
  clearFilters: document.querySelector("#clear-filters"),
  refreshButton: document.querySelector("#refresh-button"),
  stageTabs: document.querySelector("#stage-tabs"),
  screenerNote: document.querySelector("#screener-note"),
  screenerSummary: document.querySelector("#screener-summary"),
  criteriaList: document.querySelector("#criteria-list"),
  criteriaDetail: document.querySelector("#criteria-detail"),
  settingsList: document.querySelector("#settings-list"),
  activeFilters: document.querySelector("#active-filters"),
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
  return String(value || "")
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
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
  if (value === "universe_membership") {
    return "Awaiting SEC";
  }
  return "Not live";
}

function screenStageLabel(initialScreen = {}) {
  const base = titleCase(initialScreen.stage || "unknown");
  return initialScreen.provisional ? `${base} (Provisional)` : base;
}

function stageBadgeClass(initialScreen = {}) {
  if (initialScreen.stage === "eligible") {
    return "eligible";
  }
  if (initialScreen.stage === "watch") {
    return "watch";
  }
  return "reject";
}

function criteriaTooltip(item = {}) {
  return [item.summary, item.rule, item.why].filter(Boolean).join(" ");
}

function researchBasisLabels(items = []) {
  return items.map((item) => item.label || item.key || "").filter(Boolean).join(", ");
}

function backtestLabel(status = {}) {
  if (!status || status.status === "pending_validation") {
    return "Backtest pending";
  }
  return titleCase(status.status || "unknown");
}

function buildEmptyDashboard() {
  return {
    as_of: null,
    summary: {
      coverage_count: 0,
      sectors_covered: 0,
      new_filings_today: 0,
      average_confidence: 0,
      average_composite_score: 0,
      data_completeness: 0,
      tracked_total: 0,
      visible_count: 0
    },
    screener: {
      explanation: {
        headline: "Stage one filters the universe before the full ranking model.",
        eligible: "Eligible names pass most checks with no hard failure.",
        watch: "Watch names need either fresher live data or fewer failed checks.",
        reject: "Rejected names fail too many checks or trip a hard failure."
      },
      criteria: [],
      governance: null,
      criterion_diagnostics: [],
      tracked_count: 0,
      eligible_count: 0,
      watch_count: 0,
      rejected_count: 0,
      live_sec_backed_count: 0,
      bootstrap_placeholder_count: 0,
      pending_live_sec_count: 0,
      pass_rate: 0,
      candidates: [],
      watchlist: []
    },
    leaderboard: [],
    sectors: [],
    changes: []
  };
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.json();
}

function getBaseRows() {
  return state.baseDashboard?.leaderboard || [];
}

function getBaseScreener() {
  return state.baseDashboard?.screener || buildEmptyDashboard().screener;
}

function getBaseSectors() {
  return state.baseDashboard?.sectors || [];
}

function filterRows(rows) {
  return rows.filter((item) => {
    if (state.sector && item.sector !== state.sector) {
      return false;
    }
    if (state.search && !`${item.ticker} ${item.company_name}`.toLowerCase().includes(state.search.toLowerCase())) {
      return false;
    }
    if (state.minConfidence > 0 && Number(item.final_confidence || 0) < state.minConfidence) {
      return false;
    }
    if (state.onlyChanged && Math.abs(Number(item.score_delta_30d || 0)) < 0.03) {
      return false;
    }
    if (state.stage && item.initial_screen?.stage !== state.stage) {
      return false;
    }
    return true;
  });
}

function deriveSectorSummary(rows) {
  const sectorMap = new Map();
  for (const row of rows) {
    const key = row.sector || "Unknown";
    const entry = sectorMap.get(key) || {
      sector: key,
      count: 0,
      eligible: 0,
      watch: 0,
      reject: 0,
      compositeSum: 0,
      confidenceSum: 0
    };

    entry.count += 1;
    entry.compositeSum += Number(row.composite_fundamental_score || 0);
    entry.confidenceSum += Number(row.final_confidence || 0);
    if (row.initial_screen?.stage === "eligible") {
      entry.eligible += 1;
    } else if (row.initial_screen?.stage === "watch") {
      entry.watch += 1;
    } else {
      entry.reject += 1;
    }

    sectorMap.set(key, entry);
  }

  return [...sectorMap.values()]
    .sort((a, b) => b.count - a.count || b.compositeSum - a.compositeSum)
    .map((entry, index) => ({
      sector: entry.sector,
      rank: index + 1,
      count: entry.count,
      avg_composite: entry.count ? entry.compositeSum / entry.count : 0,
      avg_confidence: entry.count ? entry.confidenceSum / entry.count : 0,
      eligible: entry.eligible,
      watch: entry.watch,
      reject: entry.reject
    }));
}

function deriveScreener(rows) {
  const base = getBaseScreener();
  const eligible = rows.filter((item) => item.initial_screen?.stage === "eligible");
  const watch = rows.filter((item) => item.initial_screen?.stage === "watch");
  const rejected = rows.filter((item) => item.initial_screen?.stage === "reject");
  const liveSec = rows.filter((item) => item.data_source === "live_sec_filing");

  return {
    criteria: base.criteria || [],
    governance: base.governance || null,
    criterion_diagnostics: base.criterion_diagnostics || [],
    explanation: base.explanation || buildEmptyDashboard().screener.explanation,
    tracked_count: rows.length,
    eligible_count: eligible.length,
    watch_count: watch.length,
    rejected_count: rejected.length,
    live_sec_backed_count: liveSec.length,
    bootstrap_placeholder_count: 0,
    pending_live_sec_count: 0,
    pass_rate: rows.length ? eligible.length / rows.length : 0,
    candidates: eligible.slice(0, 8),
    watchlist: watch.slice(0, 8)
  };
}

function deriveDashboard() {
  const baseRows = getBaseRows();
  const rows = filterRows(baseRows);
  const visibleTickers = new Set(rows.map((item) => item.ticker));
  const sectors = deriveSectorSummary(rows);
  const changes = (state.baseDashboard?.changes || []).filter((item) => visibleTickers.has(item.ticker)).slice(0, 10);
  const screener = deriveScreener(rows);

  const summary = {
    coverage_count: rows.length,
    sectors_covered: sectors.length,
    new_filings_today: rows.filter((item) => item.filing_date === String(state.baseDashboard?.as_of || "").slice(0, 10)).length,
    average_confidence: rows.length ? rows.reduce((sum, item) => sum + Number(item.final_confidence || 0), 0) / rows.length : 0,
    average_composite_score: rows.length
      ? rows.reduce((sum, item) => sum + Number(item.composite_fundamental_score || 0), 0) / rows.length
      : 0,
    data_completeness: rows.length
      ? rows.reduce((sum, item) => sum + Math.max(0, 1 - Number(item.quality_flags?.missing_fields_count || 0) * 0.05), 0) / rows.length
      : 0,
    tracked_total: baseRows.length,
    visible_count: rows.length
  };

  return {
    as_of: state.baseDashboard?.as_of || null,
    summary,
    screener,
    leaderboard: rows,
    sectors,
    changes
  };
}

async function loadDetail(ticker) {
  if (!ticker) {
    state.detail = null;
    return;
  }

  try {
    state.detail = await getJson(`/api/fundamentals/ticker/${ticker}`);
  } catch (error) {
    console.error(error);
    state.detail = null;
  }
}

function syncSelectedTicker() {
  const visibleRows = state.dashboard?.leaderboard || [];
  const visibleTickers = new Set(visibleRows.map((item) => item.ticker));
  if (!visibleRows.length) {
    state.selectedTicker = null;
    return;
  }
  if (!state.selectedTicker || !visibleTickers.has(state.selectedTicker)) {
    state.selectedTicker = visibleRows[0].ticker;
  }
}

async function applyFiltersAndRender({ forceDetail = false } = {}) {
  const previousTicker = state.selectedTicker;
  state.dashboard = deriveDashboard();
  syncSelectedTicker();

  if (forceDetail || !state.detail || previousTicker !== state.selectedTicker) {
    await loadDetail(state.selectedTicker);
  }

  render();
}

async function reloadBaseData() {
  if (state.loadingBase) {
    return;
  }

  state.loadingBase = true;
  const [healthResult, dashboardResult, screenerConfigResult] = await Promise.allSettled([
    getJson("/api/health"),
    getJson("/api/fundamentals/dashboard"),
    getJson("/api/settings/fundamental-screener")
  ]);

  if (healthResult.status === "fulfilled") {
    state.health = healthResult.value;
  }

  if (dashboardResult.status === "fulfilled") {
    state.baseDashboard = dashboardResult.value;
  } else {
    console.error(dashboardResult.reason);
    state.baseDashboard = state.baseDashboard || buildEmptyDashboard();
  }

  if (screenerConfigResult.status === "fulfilled") {
    state.screenerConfig = screenerConfigResult.value;
  } else {
    console.error(screenerConfigResult.reason);
    state.screenerConfig = state.screenerConfig || { settings: {}, fields: [] };
  }

  state.loadingBase = false;
  await applyFiltersAndRender({ forceDetail: true });
}

function renderSummary() {
  const summary = state.dashboard?.summary || buildEmptyDashboard().summary;
  const screener = state.dashboard?.screener || buildEmptyDashboard().screener;
  const baseTracked = getBaseRows().length;
  elements.summaryGrid.innerHTML = `
    <article class="summary-card"><span>Shown Now</span><strong>${summary.visible_count || 0}</strong><small>of ${baseTracked} tracked names</small></article>
    <article class="summary-card"><span>Eligible In View</span><strong>${screener.eligible_count || 0}</strong><small>${pct(screener.pass_rate || 0, 0)} pass rate</small></article>
    <article class="summary-card"><span>Watch In View</span><strong>${screener.watch_count || 0}</strong><small>needs more proof</small></article>
    <article class="summary-card"><span>Rejected In View</span><strong>${screener.rejected_count || 0}</strong><small>fails current gate</small></article>
    <article class="summary-card"><span>Avg Confidence</span><strong>${pct(summary.average_confidence || 0, 0)}</strong><small>${pct(summary.data_completeness || 0, 0)} complete</small></article>
    <article class="summary-card"><span>SEC Live In View</span><strong>${screener.live_sec_backed_count || 0}</strong><small>current filtered results</small></article>
    <article class="summary-card"><span>Awaiting SEC</span><strong>${screener.pending_live_sec_count || 0}</strong><small>excluded until live</small></article>
  `;
}

function renderToolbar() {
  const sectors = getBaseSectors();
  elements.sectorFilter.innerHTML = [
    `<option value="">All sectors</option>`,
    ...sectors.map((item) => `<option value="${item.sector}" ${state.sector === item.sector ? "selected" : ""}>${item.sector}</option>`)
  ].join("");
  elements.tickerSearch.value = state.search;
  elements.confidenceFilter.value = String(Math.round(state.minConfidence * 100));
  elements.confidenceValue.textContent = pct(state.minConfidence, 0);
  elements.changedOnly.checked = state.onlyChanged;
}

function renderActiveFilters() {
  const chips = [];
  if (state.stage) {
    chips.push(`Stage: ${titleCase(state.stage)}`);
  }
  if (state.sector) {
    chips.push(`Sector: ${state.sector}`);
  }
  if (state.search) {
    chips.push(`Search: ${state.search}`);
  }
  if (state.minConfidence > 0) {
    chips.push(`Min confidence: ${pct(state.minConfidence, 0)}`);
  }
  if (state.onlyChanged) {
    chips.push("Only changed");
  }

  elements.activeFilters.innerHTML = chips.length
    ? chips.map((chip) => `<span class="filter-chip">${chip}</span>`).join("")
    : `<span class="subtle">No active filters. You are looking at the full tracked universe.</span>`;
}

function renderStages() {
  const base = getBaseScreener();
  const screener = state.dashboard?.screener || buildEmptyDashboard().screener;
  const stages = [
    { key: "", label: `All (${base.tracked_count || 0})` },
    { key: "eligible", label: `Eligible (${base.eligible_count || 0})` },
    { key: "watch", label: `Watch (${base.watch_count || 0})` },
    { key: "reject", label: `Reject (${base.rejected_count || 0})` }
  ];

  elements.stageTabs.innerHTML = stages
    .map((item) => `<button type="button" class="${(state.stage || "") === item.key ? "active" : ""}" data-stage="${item.key}">${item.label}</button>`)
    .join("");

  elements.screenerNote.innerHTML = `
    <strong>${base.explanation?.headline || "Stage one is the first-pass gate."}</strong>
    <p>${base.explanation?.eligible || "Eligible names pass most checks."}</p>
    <p>${base.explanation?.watch || "Watch names need more evidence or fresher live data."}</p>
    <div class="note-meta">
      <span>Current view: ${screener.tracked_count || 0} rows</span>
      <span>SEC live in view: ${screener.live_sec_backed_count || 0}</span>
      <span>Confidence filter: ${pct(state.minConfidence || 0, 0)} minimum</span>
    </div>
  `;

  elements.screenerSummary.innerHTML = `
    <article class="mini-stat"><span>Eligible</span><strong>${screener.eligible_count || 0}</strong></article>
    <article class="mini-stat"><span>Watch</span><strong>${screener.watch_count || 0}</strong></article>
    <article class="mini-stat"><span>Reject</span><strong>${screener.rejected_count || 0}</strong></article>
    <article class="mini-stat"><span>Live SEC</span><strong>${screener.live_sec_backed_count || 0}</strong></article>
  `;

  for (const button of elements.stageTabs.querySelectorAll("[data-stage]")) {
    button.addEventListener("click", async () => {
      state.stage = button.dataset.stage || null;
      await applyFiltersAndRender();
    });
  }
}

function renderCriteria() {
  const criteria = getBaseScreener().criteria || [];
  const diagnostics = new Map((getBaseScreener().criterion_diagnostics || []).map((item) => [item.key, item]));
  const activeKey = state.selectedCriteriaKey || criteria[0]?.key || null;
  state.selectedCriteriaKey = activeKey;

  elements.criteriaList.innerHTML = criteria.length
    ? criteria
        .map(
          (item) => {
            const diagnostic = diagnostics.get(item.key);
            return `
            <button
              type="button"
              class="criteria-tile ${activeKey === item.key ? "active" : ""}"
              data-criteria-key="${item.key}"
              data-tooltip="${criteriaTooltip(item)}"
              title="${criteriaTooltip(item)}"
            >
              <strong>${item.label}</strong>
              <span>${item.factor_family ? titleCase(item.factor_family) : "Stage-one gate"} - ${diagnostic?.pass_rate !== null && diagnostic?.pass_rate !== undefined ? `${pct(diagnostic.pass_rate, 0)} pass rate` : backtestLabel(item.backtest_status)}</span>
            </button>
          `;
          }
        )
        .join("")
    : `<div class="note-card">No criteria loaded.</div>`;

  const active = criteria.find((item) => item.key === activeKey);
  const activeDiagnostic = active ? diagnostics.get(active.key) : null;
  elements.criteriaDetail.innerHTML = active
    ? `
        <article class="criteria-card detail-card">
          <div class="criteria-card-head">
            <strong>${active.label}</strong>
            <span class="chip">${active.factor_family || active.key}</span>
          </div>
          <p>${active.summary || "This rule is part of the stage-one gate."}</p>
          <div class="criteria-rule"><strong>Pass rule:</strong> ${active.rule || "Not specified."}</div>
          <div class="criteria-rule"><strong>Default:</strong> ${active.default_value || "n/a"}</div>
          <div class="criteria-rule"><strong>Current:</strong> ${active.current_value || active.rule || "n/a"}</div>
          <p><strong>Why it matters:</strong> ${active.why || "This helps reduce weak first-pass candidates."}</p>
          <p><strong>Research basis:</strong> ${researchBasisLabels(active.research_basis) || "Not attached yet."}</p>
          <div class="criteria-rule">
            <strong>Current universe:</strong>
            ${activeDiagnostic ? `${activeDiagnostic.pass_count}/${activeDiagnostic.evaluated_count} pass this rule (${pct(activeDiagnostic.pass_rate || 0, 0)}).` : "No diagnostic sample yet."}
          </div>
          <div class="criteria-rule">
            <strong>Backtest status:</strong>
            ${backtestLabel(active.backtest_status)}.
            ${active.backtest_status?.notes || "Point-in-time validation is not available yet."}
          </div>
        </article>
      `
    : `<div class="note-card">Select a rule to inspect it.</div>`;

  for (const button of elements.criteriaList.querySelectorAll("[data-criteria-key]")) {
    button.addEventListener("click", () => {
      state.selectedCriteriaKey = button.dataset.criteriaKey;
      renderCriteria();
    });
  }
}

function renderSettings() {
  const fields = state.screenerConfig?.fields || [];
  const values = state.screenerConfig?.settings || {};
  const governance = state.screenerConfig?.governance || getBaseScreener().governance || {};
  const profiles = governance.profiles || [];

  if (!fields.length) {
    elements.settingsList.innerHTML = `<div class="note-card">Screener settings are unavailable right now.</div>`;
    return;
  }

  elements.settingsList.innerHTML = `
    ${
      profiles.length
        ? `<div class="profile-grid">
            ${profiles
              .map(
                (profile) => `
                  <article class="profile-card ${profile.matches_current ? "active" : ""}">
                    <strong>${profile.label}</strong>
                    <span>${profile.description}</span>
                    <small>${profile.matches_current ? "Current profile" : `${profile.change_count || 0} setting differences`}</small>
                    <button type="button" class="ghost-button" data-screener-profile="${profile.key}" ${profile.matches_current ? "disabled" : ""}>
                      ${profile.matches_current ? "Applied" : "Apply Profile"}
                    </button>
                  </article>
                `
              )
              .join("")}
          </div>`
        : ""
    }
    <div class="settings-grid">
      ${fields
        .map((field) => {
          if (field.type === "boolean") {
            return `
              <label class="setting-card" title="${field.help || ""}">
                <span>${field.label}</span>
                <small>${field.help || ""} This directly changes who can reach Eligible versus Watch.</small>
                <input type="checkbox" data-screener-setting="${field.key}" ${values[field.key] ? "checked" : ""}>
              </label>
            `;
          }

          return `
            <label class="setting-card" title="${field.help || ""}">
              <span>${field.label}</span>
              <small>${field.help || ""} Tightening this threshold makes the screen stricter.</small>
              <input
                type="number"
                data-screener-setting="${field.key}"
                min="${field.min ?? ""}"
                max="${field.max ?? ""}"
                step="${field.step ?? "0.01"}"
                value="${values[field.key] ?? ""}"
              >
            </label>
          `;
        })
        .join("")}
    </div>
    <div class="settings-actions">
      <button type="button" class="primary-button" id="save-screener-settings">${state.screenerSaveState === "saving" ? "Saving..." : state.screenerSaveState === "saved" ? "Saved" : "Save Screener Settings"}</button>
    </div>
  `;

  for (const input of elements.settingsList.querySelectorAll("[data-screener-setting]")) {
    const key = input.dataset.screenerSetting;
    input.addEventListener("input", () => {
      state.screenerSaveState = "";
      values[key] = input.type === "checkbox" ? input.checked : Number(input.value);
    });
  }

  for (const button of elements.settingsList.querySelectorAll("[data-screener-profile]")) {
    button.addEventListener("click", async () => {
      state.screenerSaveState = "saving";
      renderSettings();
      try {
        const payload = await getJson("/api/settings/fundamental-screener", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: button.dataset.screenerProfile, persist: true })
        });
        state.screenerConfig = payload.screener;
        state.screenerSaveState = "saved";
        await reloadBaseData();
      } catch (error) {
        console.error(error);
        state.screenerSaveState = "";
        renderSettings();
      }
    });
  }

  elements.settingsList.querySelector("#save-screener-settings")?.addEventListener("click", async () => {
    state.screenerSaveState = "saving";
    renderSettings();
    try {
      const payload = await getJson("/api/settings/fundamental-screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, persist: true })
      });
      state.screenerConfig = payload.screener;
      await fetch("/api/fundamentals/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceUniverse: false })
      });
      state.screenerSaveState = "saved";
      await reloadBaseData();
    } catch (error) {
      console.error(error);
      state.screenerSaveState = "";
      renderSettings();
    }
  });
}

function renderLeaderboard() {
  const rows = state.dashboard?.leaderboard || [];
  const trackedTotal = getBaseRows().length;
  elements.resultsCaption.textContent = rows.length
    ? `Showing ${rows.length} of ${trackedTotal} tracked names. The stage tabs stay anchored to the full universe, while the table below reflects your current filters instantly.`
    : `No names match the current filters. Clear one or more filters to return to the full ${trackedTotal}-name universe.`;

  elements.leaderboardBody.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr class="${state.selectedTicker === row.ticker ? "is-selected" : ""}" data-ticker="${row.ticker}">
              <td>
                <div class="ticker-cell">
                  <strong>${row.ticker}</strong>
                  <small>${row.company_name}</small>
                  <small>${sourceLabel(row.data_source)}</small>
                </div>
              </td>
              <td><span class="badge ${stageBadgeClass(row.initial_screen)}">${screenStageLabel(row.initial_screen)}</span></td>
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
      state.selectedTicker = row.dataset.ticker;
      await loadDetail(state.selectedTicker);
      renderDetail();
      renderLeaderboard();
    });
  }
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    elements.detailTitle.textContent = "Select a company";
    elements.detailSubtitle.textContent = "Use the results table to inspect a specific stage-one outcome.";
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
    <article class="detail-stat"><span>Delta 30d</span><strong>${signed(detail.score_delta_30d)}</strong></article>
  `;

  const notes = [
    `<div class="change-card"><strong>Why this stage</strong><p>${detail.initial_screen?.summary || "No screener summary available."}</p></div>`,
    detail.initial_screen?.failed_checks?.length
      ? `<div class="change-card"><strong>Missed checks</strong><p>${detail.initial_screen.failed_checks.join(", ")}</p></div>`
      : "",
    detail.initial_screen?.hard_failures?.length
      ? `<div class="change-card"><strong>Hard failures</strong><p>${detail.initial_screen.hard_failures.join(", ")}</p></div>`
      : "",
    `<div class="change-card"><strong>Fundamental read</strong><p>${detail.explanation_short || "No short explanation available."}</p></div>`
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
              <small class="subtle">${relativeTime(item.as_of)} - ${pct(item.confidence, 0)} confidence</small>
            </article>
          `
        )
        .join("")
    : `<div class="note-card">No change events inside the current view.</div>`;
}

function render() {
  renderSummary();
  renderToolbar();
  renderActiveFilters();
  renderStages();
  renderCriteria();
  renderSettings();
  renderLeaderboard();
  renderDetail();
  renderChanges();
  elements.refreshButton.textContent = state.refreshState === "refreshing" ? "Refreshing..." : "Refresh";
  elements.refreshButton.disabled = state.refreshState === "refreshing";
}

function resetFilters() {
  state.search = "";
  state.minConfidence = 0;
  state.sector = null;
  state.stage = null;
  state.onlyChanged = false;
}

function attachEvents() {
  elements.tickerSearch.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.search = elements.tickerSearch.value.trim();
      applyFiltersAndRender().catch((error) => console.error(error));
    }, 120);
  });

  elements.confidenceFilter.addEventListener("input", () => {
    state.minConfidence = Number(elements.confidenceFilter.value) / 100;
    applyFiltersAndRender().catch((error) => console.error(error));
  });

  elements.sectorFilter.addEventListener("change", () => {
    state.sector = elements.sectorFilter.value || null;
    applyFiltersAndRender().catch((error) => console.error(error));
  });

  elements.changedOnly.addEventListener("change", () => {
    state.onlyChanged = elements.changedOnly.checked;
    applyFiltersAndRender().catch((error) => console.error(error));
  });

  elements.clearFilters.addEventListener("click", () => {
    resetFilters();
    applyFiltersAndRender().catch((error) => console.error(error));
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
      await reloadBaseData();
    } catch (error) {
      console.error(error);
    } finally {
      state.refreshState = "";
      render();
    }
  });
}

function startStream() {
  const stream = new EventSource("/api/stream");
  const scheduleReload = () => {
    clearTimeout(state.baseReloadTimer);
    state.baseReloadTimer = setTimeout(() => {
      reloadBaseData().catch((error) => console.error(error));
    }, 450);
  };

  for (const eventName of ["snapshot", "fundamental_score_update", "fundamental_change"]) {
    stream.addEventListener(eventName, scheduleReload);
  }
}

async function init() {
  attachEvents();
  await reloadBaseData();
  startStream();
}

init().catch((error) => console.error(error));
