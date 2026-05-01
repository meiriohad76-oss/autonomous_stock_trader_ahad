const WINDOWS = ["15m", "1h", "4h", "1d", "7d"];
const FALLBACK_TICKER_META = {
  AAPL: { company: "Apple", sector: "Technology" },
  MSFT: { company: "Microsoft", sector: "Technology" },
  NVDA: { company: "Nvidia", sector: "Technology" },
  TSLA: { company: "Tesla", sector: "Consumer Discretionary" },
  AMZN: { company: "Amazon", sector: "Consumer Discretionary" },
  META: { company: "Meta Platforms", sector: "Communication Services" },
  GOOGL: { company: "Alphabet", sector: "Communication Services" },
  QQQ: { company: "Invesco QQQ Trust", sector: "Macro" },
  SPY: { company: "SPDR S&P 500 ETF Trust", sector: "Macro" }
};
const INSIDER_FLOW_EVENT_TYPES = new Set(["insider_buy", "insider_sell", "activist_stake"]);
const INSTITUTIONAL_FLOW_EVENT_TYPES = new Set(["institutional_buying", "institutional_selling"]);
const TAPE_FLOW_EVENT_TYPES = new Set([
  "abnormal_volume_buying",
  "abnormal_volume_selling",
  "block_trade_buying",
  "block_trade_selling"
]);
const MONEY_FLOW_EVENT_TYPES = new Set([
  ...INSIDER_FLOW_EVENT_TYPES,
  ...INSTITUTIONAL_FLOW_EVENT_TYPES,
  ...TAPE_FLOW_EVENT_TYPES
]);
const MARKET_FLOW_FIELD_META = {
  marketFlowVolumeSpikeThreshold: { label: "Volume Spike", step: "0.1", help: "Minimum share-volume multiple versus recent baseline." },
  marketFlowMinPriceMoveThreshold: { label: "Min Price Move", step: "0.001", help: "Minimum bar-to-bar move before directional flow matters." },
  marketFlowBlockTradeSpikeThreshold: { label: "Block Spike", step: "0.1", help: "Volume or dollar-volume multiple needed for block-style classification." },
  marketFlowBlockTradeShockThreshold: { label: "Shock Multiple", step: "0.1", help: "Move shock versus recent move baseline." },
  marketFlowBlockTradeMinShares: { label: "Block Min Shares", step: "1000", help: "Minimum shares in the latest bar before a block signal is allowed." },
  marketFlowBlockTradeMinNotionalUsd: { label: "Block Min USD", step: "100000", help: "Minimum estimated notional turnover for block-style flow." },
  marketFlowAbnormalVolumeMinNotionalUsd: { label: "Abnormal Min USD", step: "100000", help: "Minimum estimated notional turnover for abnormal-volume flow." }
};

const state = {
  config: null,
  health: null,
  runtimeReliability: null,
  secQueue: null,
  workflowStatus: null,
  executionStatus: null,
  riskSnapshot: null,
  positionMonitor: null,
  snapshot: null,
  macroRegime: null,
  tradeSetups: null,
  selectedTicker: null,
  tickerDetail: null,
  liveFeed: [],
  alerts: [],
  highImpact: [],
  activeWindow: "1h",
  searchTerm: "",
  activeView: "overview",
  screenFilter: "all",
  marketFilter: "all",
  alertFilter: "all",
  marketFlowSettings: {},
  marketFlowSaveState: "",
  runtimeActionState: "",
  runtimeActionResult: null,
  selectedSignal: null,
  selectedSector: null
};

const elements = {
  searchInput: document.querySelector("#ticker-search"),
  topNavButtons: [...document.querySelectorAll(".topnav-link[data-view]")],
  sideNavButtons: [...document.querySelectorAll(".side-link[data-view]")],
  mobileNavButtons: [...document.querySelectorAll(".mobile-nav-link[data-view]")],
  viewPanels: [...document.querySelectorAll(".view[data-view-panel]")],
  healthStatus: document.querySelector("#health-status"),
  healthUpdate: document.querySelector("#health-update"),
  healthQueue: document.querySelector("#health-queue"),
  healthLatency: document.querySelector("#health-latency"),
  healthLatencyCompact: document.querySelector("#health-latency-compact"),
  healthSources: document.querySelector("#health-sources"),
  healthDocs: document.querySelector("#health-docs"),
  universeName: document.querySelector("#universe-name"),
  alertCount: document.querySelector("#alert-count"),
  tradeSetupSummary: document.querySelector("#trade-setup-summary"),
  tradeSetupList: document.querySelector("#trade-setup-list"),
  marketPulseScore: document.querySelector("#market-pulse-score"),
  marketRegime: document.querySelector("#market-regime"),
  marketVolume: document.querySelector("#market-volume"),
  marketImpact: document.querySelector("#market-impact"),
  pulseGaugeFill: document.querySelector("#pulse-gauge-fill"),
  sectorStrip: document.querySelector("#sector-strip"),
  leaderboardExplainer: document.querySelector("#leaderboard-explainer"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  liveFeedList: document.querySelector("#live-feed-list"),
  tickerDetailTitle: document.querySelector("#ticker-detail-title"),
  tickerDetailSubtitle: document.querySelector("#ticker-detail-subtitle"),
  detailChart: document.querySelector("#detail-chart"),
  detailWindowCards: document.querySelector("#detail-window-cards"),
  detailTopEvents: document.querySelector("#detail-top-events"),
  detailFamilyBreakdown: document.querySelector("#detail-family-breakdown"),
  detailSourceBreakdown: document.querySelector("#detail-source-breakdown"),
  marketsSectorGrid: document.querySelector("#markets-sector-grid"),
  marketsBreadth: document.querySelector("#markets-breadth"),
  marketsSectorChart: document.querySelector("#markets-sector-chart"),
  marketsSectorFocus: document.querySelector("#markets-sector-focus"),
  marketsComparisonStrip: document.querySelector("#markets-comparison-strip"),
  marketsTableBody: document.querySelector("#markets-table-body"),
  marketsDetail: document.querySelector("#markets-detail"),
  watchCards: document.querySelector("#watch-cards"),
  watchFeed: document.querySelector("#watch-feed"),
  watchSummary: document.querySelector("#watch-summary"),
  alertsCritical: document.querySelector("#alerts-critical"),
  alertsSummaryStrip: document.querySelector("#alerts-summary-strip"),
  alertsHighImpact: document.querySelector("#alerts-high-impact"),
  alertsMoneyFlow: document.querySelector("#alerts-money-flow"),
  tradingWorkflowStatus: document.querySelector("#trading-workflow-status"),
  tradingPlanSummary: document.querySelector("#trading-plan-summary"),
  tradingPlanLists: document.querySelector("#trading-plan-lists"),
  tradingExecutionConsole: document.querySelector("#trading-execution-console"),
  systemOverview: document.querySelector("#system-overview"),
  systemSourceQuality: document.querySelector("#system-source-quality"),
  systemNotes: document.querySelector("#system-notes"),
  replayButton: document.querySelector("#replay-button"),
  engineProgressBar: document.querySelector("#engine-progress-bar"),
  windowTabs: document.querySelector("#window-tabs"),
  fundamentalFilterTabs: document.querySelector("#fundamental-filter-tabs"),
  marketsFilterTabs: document.querySelector("#markets-filter-tabs"),
  alertsFilterTabs: document.querySelector("#alerts-filter-tabs"),
  mobileFab: document.querySelector(".mobile-fab"),
  signalBackdrop: document.querySelector("#signal-backdrop"),
  signalDrawer: document.querySelector("#signal-drawer"),
  signalDrawerClose: document.querySelector("#signal-drawer-close"),
  signalDrawerTitle: document.querySelector("#signal-drawer-title"),
  signalDrawerSubtitle: document.querySelector("#signal-drawer-subtitle"),
  signalDrawerBadge: document.querySelector("#signal-drawer-badge"),
  signalDrawerTime: document.querySelector("#signal-drawer-time"),
  signalDrawerSummary: document.querySelector("#signal-drawer-summary"),
  signalDrawerStats: document.querySelector("#signal-drawer-stats"),
  signalDrawerExplanation: document.querySelector("#signal-drawer-explanation"),
  signalDrawerContext: document.querySelector("#signal-drawer-context"),
  signalFocusButton: document.querySelector("#signal-focus-button"),
  signalSourceButton: document.querySelector("#signal-source-button"),
  topEntityGraph: document.querySelector("#top-entity-graph"),
  topSensors: document.querySelector("#top-sensors"),
  topNotifications: document.querySelector("#top-notifications"),
  topProfile: document.querySelector("#top-profile"),
  sideHelp: document.querySelector("#side-help"),
  sideTerminal: document.querySelector("#side-terminal")
};

let refreshTimer = null;
let refreshInFlight = false;
let refreshQueued = false;
let snapshotLoadToken = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000_000) {
    return `${formatNumber(number / 1_000_000_000, 1)}B`;
  }
  if (number >= 1_000_000) {
    return `${formatNumber(number / 1_000_000, 1)}M`;
  }
  if (number >= 1_000) {
    return `${formatNumber(number / 1_000, 1)}K`;
  }
  return `${number}`;
}

function formatUsdCompact(value) {
  const number = Number(value || 0);
  return `$${formatCompactNumber(number)}`;
}

function formatSignedPercent(value) {
  const number = Number(value || 0) * 100;
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatNumber(number, 1)}%`;
}

function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function healthLabel(value) {
  if (String(value).toLowerCase() === "green") {
    return "Optimal";
  }
  if (String(value).toLowerCase() === "yellow") {
    return "Degraded";
  }
  if (String(value).toLowerCase() === "red") {
    return "Critical";
  }
  return value || "Unknown";
}

function relativeTime(value) {
  if (!value) {
    return "-";
  }

  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function sentimentClass(regime) {
  return regime === "bullish" ? "bullish" : regime === "bearish" ? "bearish" : "neutral";
}

function sentimentLabel(score) {
  if (score >= 0.65) {
    return "Ext. Bullish";
  }
  if (score >= 0.2) {
    return "Bullish";
  }
  if (score <= -0.65) {
    return "Ext. Bearish";
  }
  if (score <= -0.2) {
    return "Bearish";
  }
  return "Neutral";
}

function badgeClass(label) {
  if (/bearish/i.test(label)) {
    return "bearish";
  }
  if (/bullish/i.test(label)) {
    return "bullish";
  }
  return "neutral";
}

function setupActionClass(action) {
  return action === "long" ? "bullish" : action === "short" ? "bearish" : "neutral";
}

function prettyLabel(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function sourceLabel(value) {
  if (value === "live_sec_filing") {
    return "SEC live";
  }
  if (value === "bootstrap_placeholder") {
    return "Bootstrap";
  }
  return "Sentiment only";
}

function screenLabel(row) {
  const stage = row?.screen_stage ? prettyLabel(row.screen_stage) : "unscored";
  return row?.screen_provisional ? `${stage} (provisional)` : stage;
}

function eventTypeLabel(value) {
  return value === "monitor_item" ? "monitor item" : prettyLabel(value);
}

function evidenceQualityLabel(value) {
  if (!value) {
    return "quality n/a";
  }
  return prettyLabel(value.data_quality_label || value.display_tier || "quality n/a");
}

function getRuntimeAction(action, source = null) {
  return (state.runtimeReliability?.available_actions || []).find(
    (item) => item.action === action && (source === null || item.source === source)
  );
}

function sourceStatusClass(status) {
  if (["healthy", "fallback", "manual", "pending", "polling"].includes(status)) {
    return "neutral";
  }
  if (["degraded", "error", "stale"].includes(status)) {
    return "bearish";
  }
  return "neutral";
}

function sourceStatusMeaning(status) {
  const meanings = {
    healthy: "Fresh enough to trust for normal decisions.",
    fallback: "Using fallback or synthetic data; useful for continuity, not live confirmation.",
    manual: "Enabled, but intentionally not running in the background. Use one-shot actions when needed.",
    pending: "Enabled and waiting for its first successful refresh.",
    polling: "Currently running a refresh.",
    stale: "Usable data exists, but it is older than the freshness target.",
    degraded: "Usable data exists, but recent errors lower confidence.",
    error: "No usable successful refresh yet.",
    disabled: "Off by configuration."
  };
  return meanings[status] || "Status unavailable.";
}

function runtimeActionSummary(action, result = {}) {
  const savedSuffix = result.lightweight_state_saved ? " Lightweight state saved." : "";
  if (action === "poll_once" && result.refreshBatchSize !== undefined) {
    return `SEC batch refreshed ${result.ingested || 0}/${result.refreshBatchSize} names. ${result.liveCompanies || 0} live SEC-backed, ${result.pendingBootstrapCompanies || 0} still bootstrap.${savedSuffix}`;
  }
  if (action === "poll_once" && result.ingested_documents !== undefined) {
    return `Poll completed with ${result.ingested_documents} ingested document${result.ingested_documents === 1 ? "" : "s"}.${savedSuffix}`;
  }
  if (action === "poll_once" && result.ingested !== undefined && result.skipped !== undefined) {
    const errors = result.errors ? `, ${result.errors} error${result.errors === 1 ? "" : "s"}` : "";
    return `Poll completed with ${result.ingested} ingested, ${result.skipped} skipped${errors}.${savedSuffix}`;
  }
  if (action === "poll_once" && result.refreshed_companies !== undefined) {
    return `Fundamental market reference refreshed for ${result.refreshed_companies} companies.${savedSuffix}`;
  }
  if (action === "refresh_universe") {
    return `Universe refreshed: ${result?.counts?.combined || 0} tracked companies.${savedSuffix}`;
  }
  if (action === "save_lightweight_state") {
    return `Lightweight state saved to ${result.status?.last_backup_path || "runtime-state.json"}.`;
  }
  if (action === "backup_now") {
    return `SQLite backup completed: ${result.last_backup_path || "backup file"}.`;
  }
  return `${prettyLabel(action)} completed.`;
}

function runtimeActionButton(action, source, label, icon = "play_arrow") {
  const runtimeAction = getRuntimeAction(action, source);
  const disabled = !runtimeAction?.enabled || state.runtimeActionState === "running";
  return `
    <button
      type="button"
      class="panel-action runtime-action-button"
      data-runtime-action="${action}"
      data-runtime-source="${source || ""}"
      ${disabled ? "disabled" : ""}
      title="${runtimeAction?.disabled_reason || runtimeAction?.description || ""}"
    >
      <span class="material-symbols-outlined">${icon}</span>
      ${label}
    </button>
  `;
}

function runtimeActionCard({ title, body, metric, submetric, action, source, label, icon = "play_arrow", progress = null, emphasis = false }) {
  return `
    <div class="runtime-control-card${emphasis ? " primary" : ""}">
      <div class="runtime-control-head">
        <div>
          <strong>${title}</strong>
          <span>${body}</span>
        </div>
        ${metric ? `<b>${metric}</b>` : ""}
      </div>
      ${progress !== null ? `<div class="runtime-progress"><span style="width: ${Math.min(100, Math.max(0, progress))}%"></span></div>` : ""}
      ${submetric ? `<p class="workspace-copy">${submetric}</p>` : ""}
      ${runtimeActionButton(action, source, label, icon)}
    </div>
  `;
}

function renderSecQueuePanel(secQueue) {
  if (!secQueue) {
    return `
      <div class="runtime-action-panel">
        <div class="section-kicker">SEC Coverage Queue</div>
        <p class="workspace-copy">SEC queue details are not available yet. Refresh runtime telemetry, then retry.</p>
      </div>
    `;
  }

  const coveragePct = Math.round((secQueue.coverage_ratio || 0) * 100);
  const nextBatch = secQueue.next_batch || [];
  const pendingSectors = (secQueue.pending_by_sector || []).slice(0, 8);
  const lastRun = secQueue.last_success_at ? relativeTime(secQueue.last_success_at) : "not run yet";

  return `
    <div class="runtime-action-panel sec-queue-panel">
      <div class="section-kicker">SEC Coverage Queue</div>
      <h3>What the next fundamentals batch will try</h3>
      <p class="workspace-copy">${secQueue.explanation}</p>
      <div class="workspace-detail-grid">
        <div class="workspace-stat-card"><span>Tracked</span><strong>${secQueue.tracked_companies || 0}</strong></div>
        <div class="workspace-stat-card"><span>SEC Live</span><strong>${secQueue.live_sec_companies || 0}</strong></div>
        <div class="workspace-stat-card"><span>Bootstrap Pending</span><strong>${secQueue.pending_bootstrap_companies || 0}</strong></div>
        <div class="workspace-stat-card"><span>Coverage</span><strong>${coveragePct}%</strong></div>
        <div class="workspace-stat-card"><span>Next Batch</span><strong>${secQueue.next_batch_size || 0}</strong></div>
        <div class="workspace-stat-card"><span>Last SEC Run</span><strong>${lastRun}</strong></div>
      </div>
      <div class="runtime-progress"><span style="width: ${Math.min(100, Math.max(0, coveragePct))}%"></span></div>
      ${
        nextBatch.length
          ? `<div class="workspace-card-grid compact-grid">
              ${nextBatch
                .map(
                  (company) => `
                    <button type="button" class="workspace-card" data-focus-ticker="${company.ticker}">
                      <span>${company.ticker}</span>
                      <strong>${company.company_name || company.ticker}</strong>
                      <small>${company.sector || "Unknown"} - ${sourceLabel(company.data_source)} - ${prettyLabel(company.screen_stage || "unscored")}</small>
                    </button>
                  `
                )
                .join("")}
            </div>`
          : `<div class="workspace-empty">No next SEC batch is queued. Either the universe is complete, or SEC fundamentals are disabled.</div>`
      }
      ${
        pendingSectors.length
          ? `<ul class="workspace-list inline-list">
              ${pendingSectors.map((item) => `<li>${item.sector}: ${item.count} pending</li>`).join("")}
            </ul>`
          : ""
      }
      ${secQueue.last_error ? `<p class="workspace-copy">Latest SEC queue warning: ${secQueue.last_error}</p>` : ""}
    </div>
  `;
}

function screenBadgeClass(row) {
  if (row?.screen_stage === "eligible") {
    return "bullish";
  }
  if (row?.screen_stage === "watch") {
    return "neutral";
  }
  return "bearish";
}

function confidenceCell(row) {
  if (row?.sentiment_visible) {
    return `
      <span>${formatNumber((row.sentiment_confidence ?? row.weighted_confidence ?? 0) * 100, 1)}%</span>
      <small>sentiment</small>
    `;
  }

  if (row?.fundamental_confidence !== null && row?.fundamental_confidence !== undefined) {
    return `
      <span>${formatNumber(row.fundamental_confidence * 100, 1)}%</span>
      <small>fund only</small>
    `;
  }

  return "<span>--</span><small>no signal</small>";
}

function signalTimestamp(item) {
  return item?.published_at || item?.timestamp || null;
}

function signalSourceName(item, fallback = "Source n/a") {
  return item?.source_name || item?.sourceName || item?.payload?.source_name || item?.payload?.evidence_quality?.source_name || fallback;
}

function alertEvidenceTimestamp(alert) {
  return alert?.published_at || alert?.payload?.published_at || alert?.payload?.evidence_quality?.published_at || alert?.detected_at || alert?.created_at || null;
}

function alertSourceName(alert) {
  return alert?.source_name || alert?.payload?.source_name || alert?.payload?.evidence_quality?.source_name || "Sentiment Engine";
}

function sourceStamp(sourceName, timestamp, { includeAbsolute = true } = {}) {
  const parts = [
    `<span>Source: ${escapeHtml(sourceName || "n/a")}</span>`,
    `<span>Observed: ${relativeTime(timestamp)}</span>`
  ];
  if (includeAbsolute) {
    parts.push(`<span>${formatDateTime(timestamp)}</span>`);
  }
  return `<div class="feed-meta source-stamp">${parts.join("")}</div>`;
}

function isMoneyFlowEvent(item) {
  return MONEY_FLOW_EVENT_TYPES.has(item?.event_type);
}

function moneyFlowBucket(eventType) {
  if (INSIDER_FLOW_EVENT_TYPES.has(eventType)) {
    return "Insider";
  }
  if (INSTITUTIONAL_FLOW_EVENT_TYPES.has(eventType)) {
    return "Institutional";
  }
  if (TAPE_FLOW_EVENT_TYPES.has(eventType)) {
    return "Tape Flow";
  }
  return "Other";
}

function collectMoneyFlowSignals() {
  const combined = [...state.liveFeed, ...state.highImpact].filter(isMoneyFlowEvent);
  const deduped = [];
  const seen = new Set();

  for (const item of combined) {
    const key = [item.ticker || "MKT", item.event_type || "signal", signalTimestamp(item) || "-", item.source_name || "-", item.headline || "-"].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort((a, b) => new Date(signalTimestamp(b) || 0) - new Date(signalTimestamp(a) || 0));
}

function findTickerRow(ticker) {
  return (state.snapshot?.leaderboard || []).find((row) => row.entity_key === ticker) || null;
}

function tickerMeta(ticker) {
  const row = findTickerRow(ticker);
  const setup = (state.tradeSetups?.setups || []).find((item) => item.ticker === ticker) || null;
  const detail = state.tickerDetail?.ticker === ticker ? state.tickerDetail : null;
  const feedItem = [...state.liveFeed, ...state.highImpact].find((item) => item.ticker === ticker) || null;
  const fallback = FALLBACK_TICKER_META[ticker] || null;

  return {
    company: row?.company_name || setup?.company_name || detail?.company_name || fallback?.company || ticker || "Unknown",
    sector: row?.sector || setup?.sector || detail?.sector || feedItem?.source_metadata?.sector_hint || fallback?.sector || "Other",
    industry: row?.industry || detail?.industry || null
  };
}

function tickerSector(ticker) {
  return tickerMeta(ticker).sector;
}

function tickerCompany(ticker) {
  return tickerMeta(ticker).company;
}

function matchesSearch(row) {
  if (!state.searchTerm) {
    return true;
  }

  const haystack = [
    row.entity_key,
    row.company_name,
    row.sector,
    row.industry,
    row.fundamental_rating,
    row.fundamental_direction_label,
    ...(row.top_event_types || []),
    ...(row.top_reasons || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(state.searchTerm.toLowerCase());
}

function dedupeSignals(items) {
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const key = [
      item.ticker || "MKT",
      item.event_type || item.alert_type || "signal",
      item.headline || "-",
      signalTimestamp(item) || item.created_at || "-"
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function deriveVisibleSectorSummaries(rows = filteredLeaderboard()) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.sector || tickerSector(row.entity_key);
    const entry = grouped.get(key) || {
      sector: key,
      count: 0,
      sentimentSum: 0,
      confidenceSum: 0,
      momentumSum: 0,
      activeCount: 0
    };
    entry.count += 1;
    entry.sentimentSum += Number(row.weighted_sentiment || 0);
    entry.confidenceSum += Number(row.weighted_confidence || 0);
    entry.momentumSum += Math.abs(Number(row.momentum_delta || 0));
    if (row.sentiment_visible || Number(row.doc_count || 0) > 0) {
      entry.activeCount += 1;
    }
    grouped.set(key, entry);
  }

  return [...grouped.values()]
    .map((entry) => {
      const avgSentiment = entry.count ? entry.sentimentSum / entry.count : 0;
      const avgConfidence = entry.count ? entry.confidenceSum / entry.count : 0;
      return {
        entity_key: entry.sector,
        sentiment_regime: sentimentLabel(avgSentiment).toLowerCase().includes("bearish")
          ? "bearish"
          : sentimentLabel(avgSentiment).toLowerCase().includes("bullish")
            ? "bullish"
            : "neutral",
        weighted_sentiment: avgSentiment,
        weighted_confidence: avgConfidence,
        average_momentum: entry.count ? entry.momentumSum / entry.count : 0,
        tracked_names: entry.count,
        active_names: entry.activeCount
      };
    })
    .sort((a, b) => Math.abs(b.weighted_sentiment) - Math.abs(a.weighted_sentiment) || b.weighted_confidence - a.weighted_confidence);
}

function buildPriorityWatchRows(limit = 8) {
  const setupByTicker = new Map((state.tradeSetups?.setups || []).map((item) => [item.ticker, item]));
  const alertCounts = state.alerts.reduce((acc, alert) => {
    acc[alert.entity_key] = (acc[alert.entity_key] || 0) + 1;
    return acc;
  }, {});

  return filteredLeaderboard()
    .map((row) => {
      const setup = setupByTicker.get(row.entity_key);
      const actionWeight =
        setup?.action === "long" ? 4 : setup?.action === "short" ? 4 : setup?.action === "watch" ? 2.5 : 0;
      const alertWeight = alertCounts[row.entity_key] || 0;
      const score =
        actionWeight +
        alertWeight * 0.9 +
        Math.abs(Number(row.weighted_sentiment || 0)) * 2 +
        Number(row.weighted_confidence || 0) +
        Math.abs(Number(row.momentum_delta || 0)) * 1.5 +
        Math.min(2, Number(row.unique_story_count || 0) * 0.25) +
        (row.sentiment_visible ? 1.2 : 0) +
        Number(row.composite_fundamental_score || 0) * 0.8;

      return { row, score, setup };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function collectWatchlistFeedItems(watchRows, limit = 8) {
  const watchTickers = new Set(watchRows.map(({ row }) => row.entity_key));
  return dedupeSignals([...state.highImpact, ...state.liveFeed])
    .filter((item) => watchTickers.has(item.ticker))
    .sort((a, b) => {
      const monitorPenaltyA = a.event_type === "monitor_item" ? 0.15 : 0;
      const monitorPenaltyB = b.event_type === "monitor_item" ? 0.15 : 0;
      return (Number(b.confidence || 0) - monitorPenaltyB) - (Number(a.confidence || 0) - monitorPenaltyA);
    })
    .slice(0, limit);
}

function visibleScreenerOverview() {
  const rows = filteredLeaderboard();
  return {
    tracked: rows.length,
    eligible: rows.filter((row) => row.screen_stage === "eligible").length,
    watch: rows.filter((row) => row.screen_stage === "watch").length,
    reject: rows.filter((row) => row.screen_stage === "reject").length
  };
}

function buildHelpSignal() {
  const overview = state.snapshot?.screener_overview || {};
  const fullUniverse = overview.full_universe || {};
  const allUniverse = overview.all_universe || overview.visible_universe || visibleScreenerOverview();
  const visible = overview.filtered_universe || overview.visible_universe || visibleScreenerOverview();
  const sentimentVisible = overview.sentiment_visible_universe || visible;
  return {
    ticker: null,
    title: "Dashboard Help",
    subtitle: "How the sentiment workspace works",
    label: "Neutral",
    confidence: 1,
    timestamp: new Date().toISOString(),
    sourceName: "Product Guide",
    headline:
      "Overview is sentiment-first, Screen shows the stage-one fundamentals gate, and Trade Setups are the combined decision layer.",
    explanation:
      `This table now merges the full screened fundamentals universe with currently active sentiment names. Full fundamentals universe: ${fullUniverse.tracked || 0} tracked, ${fullUniverse.eligible || 0} eligible, ${fullUniverse.watch || 0} watch, ${fullUniverse.reject || 0} reject. All table rows before filters: ${allUniverse.tracked || 0}. Current visible rows after search/filter: ${visible.tracked} tracked, ${visible.eligible} eligible, ${visible.watch} watch, ${visible.reject} reject. Names with active sentiment right now: ${sentimentVisible.tracked} tracked, ${sentimentVisible.eligible} eligible, ${sentimentVisible.watch} watch, ${sentimentVisible.reject} reject.`,
    eventType: "dashboard_help",
    url: null,
    sourceMetadata: null
  };
}

function viewNeedsTickerDetail(view = state.activeView) {
  return view === "overview" || view === "markets" || view === "watch";
}

function buildSignalFromFeed(item, sourceLabel = "Live Feed") {
  return {
    ticker: item.ticker || null,
    title: `${item.ticker || "MKT"}: ${eventTypeLabel(item.event_type)}`,
    subtitle: sourceLabel,
    label: item.label || sentimentLabel(item.sentiment_score || 0),
    confidence: item.confidence || 0,
    timestamp: signalTimestamp(item),
    sourceName: signalSourceName(item, sourceLabel),
    headline: item.headline || "Untitled signal",
    explanation: item.explanation_short || item.headline || "No additional analyst explanation is available for this signal yet.",
    eventType: item.event_type || "signal",
    url: item.url || null,
    sourceMetadata: item.source_metadata || null,
    evidenceQuality: item.evidence_quality || null,
    downstreamWeight: item.downstream_weight ?? item.evidence_quality?.downstream_weight ?? null
  };
}

function buildSignalFromAlert(alert) {
  const label = alert.alert_type === "high_confidence_negative"
    ? "Bearish"
    : alert.alert_type === "high_confidence_positive"
      ? "Bullish"
      : "Neutral";

  return {
    ticker: alert.entity_key || null,
    title: `${alert.entity_key || "MKT"}: ${prettyLabel(alert.alert_type)}`,
    subtitle: "Alert Trigger",
    label,
    confidence: alert.confidence || 0,
    timestamp: alertEvidenceTimestamp(alert),
    sourceName: alertSourceName(alert),
    headline: alert.headline || "State-based alert trigger",
    explanation:
      alert.headline ||
      "This alert was generated from the current state transition and confidence threshold in the sentiment engine.",
    eventType: alert.alert_type || "alert",
    url: alert.url || null,
    sourceMetadata: alert.source_metadata || alert.payload?.source_metadata || null,
    evidenceQuality: alert.payload?.evidence_quality || null,
    contextItems: [
      `Alert generated: ${formatDateTime(alert.created_at)}.`,
      alert.published_at || alert.payload?.published_at
        ? `Underlying evidence timestamp: ${formatDateTime(alertEvidenceTimestamp(alert))}.`
        : null,
      alert.event_type || alert.payload?.event_type ? `Underlying event type: ${prettyLabel(alert.event_type || alert.payload?.event_type)}.` : null,
      `Source: ${alertSourceName(alert)}.`
    ].filter(Boolean)
  };
}

function buildSignalFromDocument(doc, ticker = null) {
  return {
    ticker: ticker || doc.ticker || null,
    title: `${ticker || doc.ticker || "MKT"}: ${prettyLabel(doc.event_type)}`,
    subtitle: doc.source_name || "Recent Document",
    label: doc.label || sentimentLabel(doc.sentiment_score || 0),
    confidence: doc.confidence || 0,
    timestamp: doc.published_at || doc.timestamp || null,
    sourceName: doc.source_name || "Document",
    headline: doc.headline || "Untitled document",
    explanation: doc.explanation_short || doc.headline || "No short explanation is available for this document yet.",
    eventType: doc.event_type || "document",
    url: doc.url || null,
    sourceMetadata: doc.source_metadata || null,
    evidenceQuality: doc.evidence_quality || null,
    downstreamWeight: doc.downstream_weight ?? doc.evidence_quality?.downstream_weight ?? null
  };
}

function buildSignalFromTradeSetup(setup) {
  const runtime = setup.runtime_reliability || {};
  const score = setup.score_components || {};
  const runtimeMultiplier = Number(runtime.adjustment_multiplier || 1);
  const rawLong = Number(score.raw_long ?? score.long ?? 0);
  const rawShort = Number(score.raw_short ?? score.short ?? 0);
  const rawEdge = Math.max(rawLong, rawShort);
  const haircutPct = Math.max(0, Math.round((1 - runtimeMultiplier) * 100));
  const contextItems = [
    `Raw long score: ${Math.round(rawLong * 100)}%. Raw short score: ${Math.round(rawShort * 100)}%.`,
    `Runtime multiplier: x${formatNumber(runtimeMultiplier, 2)}${haircutPct ? `, reducing conviction by ${haircutPct}%` : ""}.`,
    setup.position_size_pct ? `Suggested position size: ${formatNumber(setup.position_size_pct * 100, 1)}%.` : "No position size is assigned until the setup clears trade thresholds.",
    setup.timeframe ? `Expected holding frame: ${setup.timeframe.replace(/_/g, " ")}.` : null,
    ...(setup.thesis || []).slice(0, 3).map((item) => `Thesis: ${item}`),
    ...(setup.risk_flags || []).slice(0, 4).map((item) => `Risk: ${item}`),
    ...(runtime.degraded_sources || []).slice(0, 3).map((source) => `Runtime source: ${source.label} is ${prettyLabel(source.status)}.`)
  ].filter(Boolean);

  return {
    ticker: setup.ticker || null,
    title: `${setup.ticker}: ${prettyLabel(setup.setup_label)}`,
    subtitle: "Trade Setup Agent",
    label: prettyLabel(setup.action),
    badgeClass: setupActionClass(setup.action),
    confidence: setup.conviction || 0,
    timestamp: state.tradeSetups?.as_of || null,
    sourceName: "Trade Setup Agent",
    headline: setup.summary || "Trade setup decision",
    explanation:
      `${setup.summary || "This setup was generated by the combined decision layer."} Raw edge was ${Math.round(rawEdge * 100)}%, runtime trust multiplier is x${formatNumber(runtimeMultiplier, 2)}, and final conviction is ${Math.round((setup.conviction || 0) * 100)}%.`,
    eventType: "trade_setup",
    url: null,
    sourceMetadata: null,
    downstreamWeight: runtimeMultiplier,
    contextItems,
    statsHtml: `
      <div class="workspace-stat-card"><span>Ticker</span><strong>${setup.ticker || "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Action</span><strong>${prettyLabel(setup.action)}</strong></div>
      <div class="workspace-stat-card"><span>Conviction</span><strong>${formatNumber((setup.conviction || 0) * 100, 0)}%</strong></div>
      <div class="workspace-stat-card"><span>Raw Edge</span><strong>${formatNumber(rawEdge * 100, 0)}%</strong></div>
      <div class="workspace-stat-card"><span>Runtime Haircut</span><strong>${haircutPct ? `-${haircutPct}%` : "0%"}</strong></div>
      <div class="workspace-stat-card"><span>Position Size</span><strong>${setup.position_size_pct ? `${formatNumber(setup.position_size_pct * 100, 1)}%` : "None"}</strong></div>
      <div class="workspace-stat-card"><span>Screen</span><strong>${prettyLabel(setup.fundamentals?.screen_stage || "unknown")}</strong></div>
      <div class="workspace-stat-card"><span>Runtime</span><strong>${prettyLabel(runtime.status || "unknown")}</strong></div>
    `
  };
}

function buildSignalFromExecutionPreview(ticker, payload, submitted = null) {
  const intent = payload.intent || payload.preview?.intent || {};
  const risk = payload.risk || payload.preview?.risk || null;
  const order = intent.order || {};
  const allowed = Boolean(payload.execution_allowed ?? (intent.allowed && (!risk || risk.allowed)));
  const blockedReason = intent.blocked_reason || risk?.blocked_reason || submitted?.error || null;
  const orderJson = Object.keys(order).length ? JSON.stringify(order, null, 2) : "No order payload generated.";
  const riskChecks = risk?.checks || [];

  return {
    ticker: ticker || intent.ticker || null,
    title: `${ticker || intent.ticker || "Order"} execution ${submitted ? "submit" : "preview"}`,
    subtitle: "Execution Agent",
    label: submitted?.ok ? "Paper submitted" : allowed ? "Preview allowed" : "Blocked",
    badgeClass: submitted?.ok || allowed ? "bullish" : "bearish",
    confidence: intent.setup?.conviction || 0,
    timestamp: new Date().toISOString(),
    sourceName: "Execution Agent",
    headline: submitted?.ok
      ? "Paper order was submitted through the guarded broker path."
      : allowed
        ? "This setup currently passes execution and risk preview checks."
        : `Execution is blocked: ${prettyLabel(blockedReason || "unknown")}.`,
    explanation:
      "Execution preview translates the Trade Setup Agent output into an Alpaca-ready order, then passes it through Portfolio Risk Agent before any paper submission is allowed.",
    eventType: "execution_preview",
    statsHtml: `
      <div class="workspace-stat-card"><span>Ticker</span><strong>${intent.ticker || ticker || "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Action</span><strong>${prettyLabel(intent.action)}</strong></div>
      <div class="workspace-stat-card"><span>Side</span><strong>${prettyLabel(intent.side)}</strong></div>
      <div class="workspace-stat-card"><span>Notional</span><strong>${formatUsdCompact(intent.estimated_notional_usd || 0)}</strong></div>
      <div class="workspace-stat-card"><span>Quantity</span><strong>${formatNumber(intent.estimated_quantity || 0, 4)}</strong></div>
      <div class="workspace-stat-card"><span>Risk</span><strong>${risk?.allowed === false ? "Blocked" : "Allowed"}</strong></div>
    `,
    contextItems: [
      intent.setup?.summary ? `Setup: ${intent.setup.summary}` : null,
      intent.setup?.timeframe ? `Timeframe: ${prettyLabel(intent.setup.timeframe)}.` : null,
      risk?.proposed ? `Post-trade gross exposure: ${formatNumber(risk.proposed.gross_exposure_pct_after * 100, 1)}%.` : null,
      riskChecks.length
        ? `Risk checks: ${riskChecks.map((check) => `${prettyLabel(check.key)} ${check.pass ? "pass" : "fail"}`).join(", ")}.`
        : null,
      blockedReason ? `Blocked reason: ${prettyLabel(blockedReason)}.` : null,
      `<pre class="drawer-json">${escapeHtml(orderJson)}</pre>`
    ].filter(Boolean)
  };
}

function moneyFlowEvidence(item) {
  const meta = item?.source_metadata || {};

  if (TAPE_FLOW_EVENT_TYPES.has(item?.event_type)) {
    const evidence = [];
    if (meta.volume_spike) {
      evidence.push(`${formatNumber(meta.volume_spike, 1)}x volume`);
    }
    if (meta.latest_dollar_volume_usd) {
      evidence.push(formatUsdCompact(meta.latest_dollar_volume_usd));
    }
    if (meta.latest_move !== undefined && meta.latest_move !== null) {
      evidence.push(`${formatSignedPercent(meta.latest_move)} move`);
    }
    return evidence;
  }

  if (INSTITUTIONAL_FLOW_EVENT_TYPES.has(item?.event_type)) {
    const evidence = [];
    if (meta.filer_name) {
      evidence.push(meta.filer_name);
    }
    if (meta.position_delta_shares) {
      evidence.push(`${formatCompactNumber(Math.abs(meta.position_delta_shares))} shares`);
    }
    if (meta.position_delta_value_usd) {
      evidence.push(formatUsdCompact(Math.abs(meta.position_delta_value_usd)));
    }
    return evidence;
  }

  if (INSIDER_FLOW_EVENT_TYPES.has(item?.event_type)) {
    const evidence = [];
    if (meta.insider_owner) {
      evidence.push(meta.insider_owner);
    }
    if (meta.insider_role) {
      evidence.push(prettyLabel(meta.insider_role));
    }
    if (meta.transaction_value_usd) {
      evidence.push(formatUsdCompact(Math.abs(meta.transaction_value_usd)));
    }
    return evidence;
  }

  return [];
}

function moneyFlowGroups(signals) {
  return {
    insider: signals.filter((item) => INSIDER_FLOW_EVENT_TYPES.has(item.event_type)),
    institutional: signals.filter((item) => INSTITUTIONAL_FLOW_EVENT_TYPES.has(item.event_type)),
    tape: signals.filter((item) => TAPE_FLOW_EVENT_TYPES.has(item.event_type))
  };
}

function renderMoneyFlowSection(title, emptyText, signals, sourceLabel) {
  return `
    <section class="money-flow-section">
      <div class="money-flow-section-head">
        <div class="section-kicker">${title}</div>
        <span>${signals.length}</span>
      </div>
      ${
        signals.length
          ? signals
              .slice(0, 3)
              .map((item, index) => {
                const evidence = moneyFlowEvidence(item);
                const timestamp = signalTimestamp(item);
                const sourceName = signalSourceName(item, "Money Flow Radar");
                return `
                  <button type="button" class="money-flow-card ${badgeClass(item.label)}" data-money-flow-index="${sourceLabel}:${index}">
                    <div class="money-flow-card-head">
                      <div>
                        <strong>${item.ticker || "MKT"}: ${eventTypeLabel(item.event_type)}</strong>
                      </div>
                      <span>${relativeTime(timestamp)}</span>
                    </div>
                    ${sourceStamp(sourceName, timestamp)}
                    <p>${item.headline}</p>
                    <div class="feed-meta">
                      <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
                      <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
                      <span>${evidenceQualityLabel(item.evidence_quality)}</span>
                    </div>
                    ${
                      evidence.length
                        ? `<div class="money-flow-evidence">${evidence.map((entry) => `<span class="money-flow-pill">${entry}</span>`).join("")}</div>`
                        : ""
                    }
                  </button>
                `;
              })
              .join("")
          : `<div class="workspace-empty">${emptyText}</div>`
      }
    </section>
  `;
}

function renderMarketFlowControls() {
  const saveLabel =
    state.marketFlowSaveState === "saving"
      ? "Saving..."
      : state.marketFlowSaveState === "saved"
        ? "Saved"
        : "Save Thresholds";

  return `
    <section class="money-flow-controls">
      <div class="money-flow-controls-head">
        <div>
          <div class="section-kicker">Radar Controls</div>
          <p>These controls tune the live money-flow radar. Tape flow comes from market-data anomalies, insider flow comes from SEC Form 4, and institutional flow comes from 13F filings.</p>
        </div>
        <button type="button" class="panel-action" id="market-flow-save-button" ${state.marketFlowSaveState === "saving" ? "disabled" : ""}>${saveLabel}</button>
      </div>
      <div class="money-flow-controls-grid">
        ${Object.entries(MARKET_FLOW_FIELD_META)
          .map(
            ([key, meta]) => `
              <label class="money-flow-control" title="${meta.help}">
                <span>${meta.label}</span>
                <input type="number" data-market-flow-setting="${key}" step="${meta.step}" value="${state.marketFlowSettings[key] ?? ""}">
                <small>${meta.help}</small>
              </label>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function applyMarketFilter(rows) {
  if (state.marketFilter === "all") {
    return rows;
  }
  return rows.filter((row) => row.sentiment_regime === state.marketFilter);
}

function activeMarketSignalRows(rows) {
  return rows.filter(
    (row) =>
      row.sentiment_visible &&
      (
        Number(row.doc_count || 0) > 0 ||
        Number(row.unique_story_count || 0) > 0 ||
        Number(row.weighted_confidence || 0) > 0 ||
        Math.abs(Number(row.momentum_delta || 0)) > 0
      )
  );
}

function applyAlertFilter(alerts) {
  if (state.alertFilter === "all") {
    return alerts;
  }
  return alerts.filter((alert) => alert.alert_type === state.alertFilter);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Failed to post ${url}`);
  }
  return body;
}

async function loadConfig() {
  state.config = await getJson("/api/config");
  state.activeWindow = state.config.default_window || "1h";
  state.marketFlowSettings = { ...(state.config.market_flow_settings || {}) };
  elements.universeName.textContent = state.config.universe_name;
  updateWindowButtons();
}

async function loadHealth() {
  const [health, runtimeReliability, secQueue, workflowStatus, executionStatus, riskSnapshot, positionMonitor] = await Promise.all([
    getJson("/api/health"),
    getJson("/api/runtime-reliability").catch(() => null),
    getJson("/api/fundamentals/sec-queue?limit=8").catch(() => null),
    getJson(`/api/trading-workflow/status?window=${encodeURIComponent(state.activeWindow)}&limit=25`).catch(() => null),
    getJson("/api/execution/status").catch(() => null),
    getJson("/api/risk/status").catch(() => null),
    getJson(`/api/positions/monitor?window=${encodeURIComponent(state.activeWindow)}&limit=12`).catch(() => null)
  ]);
  state.health = health;
  state.runtimeReliability = runtimeReliability || health.runtime_reliability || null;
  state.secQueue = secQueue;
  state.workflowStatus = workflowStatus;
  state.executionStatus = executionStatus || health.execution || null;
  state.riskSnapshot = riskSnapshot;
  state.positionMonitor = positionMonitor;
  elements.healthStatus.textContent = healthLabel(health.status);
  elements.healthUpdate.textContent = formatTime(health.last_update);
  elements.healthQueue.textContent = health.queue_depth;
  elements.healthLatency.textContent = `${formatNumber(health.llm_latency_ms, 1)}ms`;
  elements.healthLatencyCompact.textContent = `${formatNumber(health.llm_latency_ms, 1)}ms`;
  elements.healthDocs.textContent = `${health.documents_processed_today} docs`;
  elements.healthSources.textContent = health.active_sources;
  elements.engineProgressBar.style.width = `${Math.min(100, Math.max(12, health.documents_processed_today * 10))}%`;
}

function filteredLeaderboard() {
  let rows = state.snapshot?.leaderboard || [];
  if (state.screenFilter !== "all") {
    rows = rows.filter((row) => row.screen_stage === state.screenFilter);
  }
  return rows.filter(matchesSearch);
}

async function ensureTickerDetail(force = false) {
  if (!state.selectedTicker) {
    state.tickerDetail = null;
    return;
  }

  if (!force && state.tickerDetail?.ticker === state.selectedTicker) {
    return;
  }

  try {
    state.tickerDetail = await getJson(`/api/sentiment/ticker/${state.selectedTicker}`);
  } catch (error) {
    console.warn(`Ticker detail unavailable for ${state.selectedTicker}`, error);
    state.tickerDetail = null;
  }
}

async function loadSnapshot() {
  const loadToken = ++snapshotLoadToken;
  const params = new URLSearchParams({ window: state.activeWindow });
  const [snapshotResult, liveFeedResult, highImpactResult, macroRegimeResult, tradeSetupsResult] = await Promise.allSettled([
    getJson(`/api/sentiment/watchlist?${params.toString()}`),
    getJson("/api/news/recent?limit=12"),
    getJson("/api/events/high-impact?limit=10"),
    getJson(`/api/macro-regime?window=${encodeURIComponent(state.activeWindow)}`),
    getJson(`/api/trade-setups?window=${encodeURIComponent(state.activeWindow)}&limit=6`)
  ]);
  if (snapshotResult.status !== "fulfilled") {
    throw snapshotResult.reason;
  }
  if (loadToken !== snapshotLoadToken) {
    return;
  }
  state.snapshot = snapshotResult.value;
  state.liveFeed = liveFeedResult.status === "fulfilled" ? liveFeedResult.value : [];
  state.highImpact = highImpactResult.status === "fulfilled" ? highImpactResult.value : [];
  state.macroRegime = macroRegimeResult.status === "fulfilled" ? macroRegimeResult.value : null;
  state.tradeSetups = tradeSetupsResult.status === "fulfilled" ? tradeSetupsResult.value : { counts: {}, setups: [] };
  state.alerts = state.snapshot.alerts || [];

  const currentRows = filteredLeaderboard();
  if (!state.selectedTicker || !currentRows.some((row) => row.entity_key === state.selectedTicker)) {
    state.selectedTicker = currentRows[0]?.entity_key || null;
  }

  if (viewNeedsTickerDetail()) {
    await ensureTickerDetail(true);
  } else if (state.selectedTicker && state.tickerDetail?.ticker !== state.selectedTicker) {
    state.tickerDetail = null;
  }

  render();
}

async function performRefresh() {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }

  refreshInFlight = true;
  try {
    await loadHealth();
    await loadSnapshot();
  } finally {
    refreshInFlight = false;
    if (refreshQueued) {
      refreshQueued = false;
      scheduleRefresh(150);
    }
  }
}

function scheduleRefresh(delayMs = 120) {
  if (refreshTimer) {
    return;
  }

  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    performRefresh().catch((error) => {
      console.error(error);
    });
  }, delayMs);
}

async function focusTicker(ticker, view = null) {
  if (!ticker) {
    return;
  }

  state.selectedTicker = ticker;
  await ensureTickerDetail(true);
  if (view) {
    setActiveView(view);
  }
  render();
}

function openSignalDrawer(signal) {
  state.selectedSignal = signal;
  renderSignalDrawer();
}

function closeSignalDrawer() {
  state.selectedSignal = null;
  renderSignalDrawer();
}

function renderGauge(pulse) {
  const value = Number(pulse.weighted_sentiment || 0);
  const percent = Math.max(0, Math.min(100, 50 + value * 50));
  const circumference = 2 * Math.PI * 82;
  const dashOffset = circumference * (1 - percent / 100);

  elements.pulseGaugeFill.style.strokeDasharray = `${circumference}`;
  elements.pulseGaugeFill.style.strokeDashoffset = `${dashOffset}`;
  elements.marketPulseScore.textContent = `${Math.round(percent)}%`;
  elements.marketRegime.textContent = pulse.sentiment_regime;
  elements.marketRegime.className = `gauge-label ${sentimentClass(pulse.sentiment_regime)}`;
  elements.marketVolume.textContent = formatCompactNumber(pulse.doc_count || 0);
  elements.marketImpact.textContent = formatNumber(pulse.weighted_impact || 0, 2);
}

function renderSectorStrip() {
  elements.sectorStrip.innerHTML = "";
  for (const sector of (state.snapshot?.sectors || []).slice(0, 4)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sector-chip ${sentimentClass(sector.sentiment_regime)}`;
    button.innerHTML = `
      <span>${sector.entity_key}</span>
      <strong>${formatNumber(sector.weighted_sentiment)}</strong>
    `;
    button.addEventListener("click", async () => {
      state.selectedSector = sector.entity_key;
      const rows = filteredLeaderboard().filter((row) => (row.sector || tickerSector(row.entity_key)) === sector.entity_key);
      const firstMatch = rows[0];
      if (firstMatch) {
        await focusTicker(firstMatch.entity_key, "markets");
        return;
      }
      setActiveView("markets");
      render();
    });
    elements.sectorStrip.appendChild(button);
  }
}

function renderLeaderboard() {
  const rows = filteredLeaderboard();
  elements.leaderboardBody.innerHTML = "";
  const overview = state.snapshot?.screener_overview || {};
  const fullUniverse = overview.full_universe || {};
  const allUniverse = overview.all_universe || overview.visible_universe || visibleScreenerOverview();
  const visibleUniverse = overview.filtered_universe || overview.visible_universe || visibleScreenerOverview();
  const sentimentVisibleUniverse = overview.sentiment_visible_universe || visibleUniverse;
  const extraRows = Math.max(0, (allUniverse.tracked || 0) - (fullUniverse.tracked || 0));
  elements.leaderboardExplainer.textContent = `This is the universe bridge: ${fullUniverse.tracked || 0} fundamentals stocks feed this table, plus ${extraRows} sentiment-only rows such as ETFs when present. Screen is the stage-one fundamentals gate. Composite is the fundamentals score. Sentiment and momentum only reorder names when live signal exists. Current filter shows ${rows.length} rows; active sentiment subset has ${sentimentVisibleUniverse.tracked || 0} rows.`;

  if (!rows.length) {
    elements.leaderboardBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No tickers match the current search and screen filter. The full universe is still ${fullUniverse.tracked || 0} stocks; clear search or choose All Rows to restore it.</td>
      </tr>
    `;
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = state.selectedTicker === row.entity_key ? "selected" : "";
    const label = sentimentLabel(row.weighted_sentiment);
    const labelStyle = badgeClass(label);
    tr.innerHTML = `
      <td>
        <div class="stock-cell">
          <strong>${row.entity_key}</strong>
          <span>${row.company_name || tickerCompany(row.entity_key)}</span>
          <span>${row.sentiment_visible ? `Sentiment live - ${sourceLabel(row.fundamental_data_source)}` : `Screen-only - ${sourceLabel(row.fundamental_data_source)}`}</span>
        </div>
      </td>
      <td>
        <span class="sentiment-badge ${labelStyle}">${label}</span>
      </td>
      <td>
        <span class="sentiment-badge ${screenBadgeClass(row)}">${screenLabel(row)}</span>
      </td>
      <td class="conf-cell">${row.composite_fundamental_score !== null && row.composite_fundamental_score !== undefined ? formatNumber(row.composite_fundamental_score, 2) : "--"}</td>
      <td>
        <span class="momentum ${labelStyle}">${formatSignedPercent(row.momentum_delta)}</span>
      </td>
      <td class="conf-cell">${confidenceCell(row)}</td>
    `;
    tr.addEventListener("click", async () => {
      state.selectedTicker = row.entity_key;
      await ensureTickerDetail(true);
      render();
    });
    elements.leaderboardBody.appendChild(tr);
  }
}

function renderFeed() {
  const allItems = dedupeSignals(state.liveFeed).sort((a, b) => new Date(signalTimestamp(b) || 0) - new Date(signalTimestamp(a) || 0));
  const feedItems = state.searchTerm
    ? allItems.filter((item) =>
        [
          item.ticker || "",
          item.headline || "",
          item.source_name || "",
          item.event_type || ""
        ]
          .join(" ")
          .toLowerCase()
          .includes(state.searchTerm.toLowerCase())
      )
    : allItems;

  elements.liveFeedList.innerHTML = "";

  if (!feedItems.length) {
    elements.liveFeedList.innerHTML = `<div class="feed-empty">No live events match the current search.</div>`;
    return;
  }

  feedItems.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = `feed-card ${badgeClass(item.label)}`;
    article.dataset.feedIndex = `${index}`;
    article.innerHTML = `
      <div class="feed-row">
        <strong>${item.ticker || "MKT"}: ${eventTypeLabel(item.event_type)}</strong>
        <span>${relativeTime(item.timestamp)}</span>
      </div>
      <p>${item.headline}</p>
      <div class="feed-meta">
        <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
        <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
        <span>${evidenceQualityLabel(item.evidence_quality)}</span>
      </div>
    `;
    article.addEventListener("click", () => {
      openSignalDrawer(buildSignalFromFeed(item));
    });
    elements.liveFeedList.appendChild(article);
  });
}

async function previewTradeExecution(ticker) {
  try {
    const payload = await postJson("/api/execution/preview", {
      ticker,
      window: state.activeWindow
    });
    openSignalDrawer(buildSignalFromExecutionPreview(ticker, payload));
    state.executionStatus = await getJson("/api/execution/status").catch(() => state.executionStatus);
    state.riskSnapshot = await getJson("/api/risk/status").catch(() => state.riskSnapshot);
  } catch (error) {
    openSignalDrawer(buildSignalFromExecutionPreview(ticker, {
      intent: {
        ticker,
        allowed: false,
        blocked_reason: error.message
      },
      risk: null
    }));
  }
}

async function submitPaperTrade(ticker) {
  const confirmation = window.prompt(`Type paper-trade to submit a guarded Alpaca paper order for ${ticker}.`);
  if (confirmation !== "paper-trade") {
    return;
  }

  try {
    const payload = await postJson("/api/execution/orders", {
      ticker,
      window: state.activeWindow,
      confirm: "paper-trade"
    });
    openSignalDrawer(buildSignalFromExecutionPreview(ticker, payload, payload));
    await loadHealth();
  } catch (error) {
    openSignalDrawer(buildSignalFromExecutionPreview(ticker, {
      intent: {
        ticker,
        allowed: false,
        blocked_reason: error.message
      },
      risk: null
    }, { error: error.message }));
  }
}

function tradeSetupRuntimeExplain(setup) {
  const runtime = setup.runtime_reliability || {};
  const score = setup.score_components || {};
  const rawEdge = Math.max(Number(score.raw_long || 0), Number(score.raw_short || 0));
  const finalConviction = Number(setup.conviction || 0);
  const multiplier = Number(runtime.adjustment_multiplier || 1);
  const haircutPct = Math.max(0, Math.round((1 - multiplier) * 100));
  const rawPct = Math.round(rawEdge * 100);
  const finalPct = Math.round(finalConviction * 100);
  const issues = (runtime.degraded_sources || []).slice(0, 3);
  const drivers = [
    ...(setup.evidence?.positive || []),
    ...(setup.evidence?.negative || []),
    ...(setup.thesis || [])
  ].slice(0, 3);
  const runtimeText = haircutPct
    ? `Runtime trust reduced the raw setup by ${haircutPct}% because source health is ${prettyLabel(runtime.status || "unknown")}.`
    : "Runtime reliability is not reducing this setup right now.";

  return `
    <div class="setup-explain">
      <div class="setup-score-row">
        <span>Raw edge <b>${rawPct}%</b></span>
        <span>Runtime haircut <b>${haircutPct ? `-${haircutPct}%` : "0%"}</b></span>
        <span>Final <b>${finalPct}%</b></span>
      </div>
      <div class="setup-score-rail" aria-label="Raw edge to final conviction">
        <span class="raw" style="width: ${Math.min(100, Math.max(0, rawPct))}%"></span>
        <span class="final" style="width: ${Math.min(100, Math.max(0, finalPct))}%"></span>
      </div>
      <p class="setup-runtime-copy">${runtimeText}</p>
      ${
        issues.length
          ? `<div class="setup-chip-row">${issues
              .map((source) => `<span title="${source.reason || ""}">${source.label}: ${prettyLabel(source.status)}</span>`)
              .join("")}</div>`
          : ""
      }
      ${
        drivers.length
          ? `<ul class="setup-mini-list">${drivers.map((item) => `<li>${item}</li>`).join("")}</ul>`
          : ""
      }
    </div>
  `;
}

function renderTradeSetups() {
  const payload = state.tradeSetups || { counts: {}, setups: [] };
  const macro = state.macroRegime || {};
  const counts = payload.counts || {};
  const setups = payload.setups || [];
  const runtimeStatus = payload.runtime_reliability?.status || "unknown";
  const broker = state.executionStatus?.broker || {};
  const paperSubmitEnabled = broker.mode === "paper" && broker.ready_for_order_submission;
  const averageRuntimeMultiplier = setups.length
    ? setups.reduce((sum, setup) => sum + Number(setup.runtime_reliability?.adjustment_multiplier || 1), 0) / setups.length
    : 1;

  elements.tradeSetupSummary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card"><span>Regime</span><strong>${prettyLabel(macro.regime_label || "unknown")}</strong></div>
      <div class="summary-card"><span>Bias</span><strong>${prettyLabel(macro.bias_label || "balanced")}</strong></div>
      <div class="summary-card"><span>Exposure</span><strong>${formatNumber((macro.exposure_multiplier || 0) * 100, 0)}%</strong></div>
      <div class="summary-card"><span>Macro Conf</span><strong>${formatNumber((macro.conviction || 0) * 100, 0)}%</strong></div>
      <div class="summary-card"><span>Runtime</span><strong>${prettyLabel(runtimeStatus)}</strong></div>
      <div class="summary-card"><span>Trust Adj.</span><strong>${formatNumber(averageRuntimeMultiplier * 100, 0)}%</strong></div>
      <div class="summary-card"><span>Tracked</span><strong>${counts.tracked_tickers || 0}</strong></div>
      <div class="summary-card"><span>Long</span><strong>${counts.long || 0}</strong></div>
      <div class="summary-card"><span>Short</span><strong>${counts.short || 0}</strong></div>
      <div class="summary-card"><span>Watch</span><strong>${counts.watch || 0}</strong></div>
    </div>
    ${macro.summary ? `<p class="trade-setup-macro-summary">${macro.summary}</p>` : ""}
    ${
      payload.runtime_reliability?.summary
        ? `<p class="trade-setup-runtime-summary">Runtime guardrail: ${payload.runtime_reliability.summary}</p>`
        : ""
    }
    ${renderTradeLists(setups)}
  `;

  elements.tradeSetupList.innerHTML = "";

  if (!setups.length) {
    elements.tradeSetupList.innerHTML = `<div class="feed-empty">No trade setups are ready yet.</div>`;
    return;
  }

  setups.forEach((setup) => {
    const article = document.createElement("article");
    const labelStyle = setupActionClass(setup.action);
    article.className = `feed-card ${labelStyle}`;
    article.title = "Open trade setup decision detail";
    article.innerHTML = `
      <div class="feed-row">
        <strong>${setup.ticker}: ${prettyLabel(setup.setup_label)}</strong>
        <span>${Math.round((setup.conviction || 0) * 100)}% conv</span>
      </div>
      <p>${setup.summary}</p>
      <div class="feed-meta">
        <span class="sentiment-badge ${labelStyle}">${prettyLabel(setup.action)}</span>
        <span>${setup.position_size_pct ? `${formatNumber(setup.position_size_pct * 100, 1)}% size` : "No size"}</span>
      </div>
      <div class="feed-meta">
        <span>${setup.timeframe.replace(/_/g, " ")}</span>
        <span>${setup.current_price ? `$${formatNumber(setup.current_price)}` : "Price n/a"}</span>
        <span>runtime x${formatNumber(setup.runtime_reliability?.adjustment_multiplier || 1, 2)}</span>
      </div>
      <div class="setup-action-row">
        <button type="button" class="panel-action compact-action" data-execution-preview="${setup.ticker}">
          Preview Order
        </button>
        <button
          type="button"
          class="panel-action compact-action danger-action"
          data-paper-submit="${setup.ticker}"
          ${paperSubmitEnabled ? "" : "disabled"}
          title="${paperSubmitEnabled ? "Submit guarded Alpaca paper order" : "Paper submit requires Alpaca credentials, paper mode, and BROKER_SUBMIT_ENABLED=true"}"
        >
          Paper Submit
        </button>
      </div>
      ${tradeSetupRuntimeExplain(setup)}
    `;
    article.addEventListener("click", () => {
      openSignalDrawer(buildSignalFromTradeSetup(setup));
    });
    article.querySelector("[data-execution-preview]")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      await previewTradeExecution(setup.ticker);
    });
    article.querySelector("[data-paper-submit]")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      await submitPaperTrade(setup.ticker);
    });
    elements.tradeSetupList.appendChild(article);
  });

  attachTradeListActions(elements.tradeSetupSummary, setups);
}

function renderTradeLists(setups = [], options = {}) {
  const includePreview = Boolean(options.includePreview);
  const groups = [
    {
      key: "long",
      label: "Buy Candidates",
      empty: "No buy candidates clear the final threshold.",
      items: setups.filter((setup) => setup.action === "long")
    },
    {
      key: "short",
      label: "Short / Sell Candidates",
      empty: "No short candidates clear the final threshold.",
      items: setups.filter((setup) => setup.action === "short")
    },
    {
      key: "watch",
      label: "Watch List",
      empty: "No monitored candidates right now.",
      items: setups.filter((setup) => setup.action === "watch").slice(0, 4)
    }
  ];

  return `
    <div class="trade-list-shell">
      <div class="section-kicker">Trading Lists</div>
      <p class="trade-list-copy">The Trade Setup Agent compiles these from fresh sentiment evidence, fundamentals screen, macro regime, risk/runtime guardrails, and current execution rules.</p>
      <div class="trade-list-grid">
        ${groups
          .map(
            (group) => `
              <section class="trade-list-card ${group.key}">
                <div class="trade-list-head">
                  <strong>${group.label}</strong>
                  <span>${group.items.length}</span>
                </div>
                ${
                  group.items.length
                    ? group.items
                        .map(
                          (setup) => `
                            ${
                              includePreview
                                ? `<div class="trade-list-row trade-list-row-with-action">
                                    <button type="button" class="trade-list-main" data-trade-list-ticker="${setup.ticker}">
                                      <span>${setup.ticker}</span>
                                      <small>${formatNumber((setup.conviction || 0) * 100, 0)}% conv - ${prettyLabel(setup.setup_label)}</small>
                                    </button>
                                    <button type="button" class="panel-action compact-action" data-preview-execution="${setup.ticker}">Preview</button>
                                  </div>`
                                : `<button type="button" class="trade-list-row" data-trade-list-ticker="${setup.ticker}">
                                    <span>${setup.ticker}</span>
                                    <small>${formatNumber((setup.conviction || 0) * 100, 0)}% conv - ${prettyLabel(setup.setup_label)}</small>
                                  </button>`
                            }
                          `
                        )
                        .join("")
                    : `<p>${group.empty}</p>`
                }
              </section>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function attachTradeListActions(container, setups = []) {
  if (!container) {
    return;
  }
  for (const button of container.querySelectorAll("[data-trade-list-ticker]")) {
    button.addEventListener("click", () => {
      const setup = setups.find((item) => item.ticker === button.dataset.tradeListTicker);
      if (setup) {
        openSignalDrawer(buildSignalFromTradeSetup(setup));
      }
    });
  }
}

function buildPath(points, width, height) {
  if (!points.length) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - point * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderDetailChart(detail) {
  const sentimentSeries = detail.sentiment_history || [];
  const priceSeries = detail.price_history || [];

  if (!sentimentSeries.length || !priceSeries.length) {
    elements.detailChart.innerHTML = "";
    return;
  }

  const sentimentPoints = sentimentSeries.map((point) => Math.max(0.08, Math.min(0.92, (point.sentiment + 1) / 2)));
  const priceValues = priceSeries.map((point) => point.price);
  const priceMin = Math.min(...priceValues);
  const priceMax = Math.max(...priceValues);
  const priceRange = Math.max(0.01, priceMax - priceMin);
  const pricePoints = priceSeries.map((point) => Math.max(0.08, Math.min(0.92, (point.price - priceMin) / priceRange)));

  const width = 720;
  const height = 220;
  const sentimentPath = buildPath(sentimentPoints, width, height);
  const pricePath = buildPath(pricePoints, width, height);
  const gridLines = [0.2, 0.4, 0.6, 0.8]
    .map((step) => `<line x1="0" y1="${height * step}" x2="${width}" y2="${height * step}" class="chart-grid"></line>`)
    .join("");
  const labels = priceSeries
    .map((point, index) => {
      const x = (index / Math.max(1, priceSeries.length - 1)) * width;
      const date = new Date(point.timestamp);
      const label = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
      return index % 4 === 0 || index === priceSeries.length - 1
        ? `<text x="${x}" y="244" class="chart-label">${label}</text>`
        : "";
    })
    .join("");

  elements.detailChart.innerHTML = `
    <defs>
      <linearGradient id="sentiment-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(19,255,67,0.28)"></stop>
        <stop offset="100%" stop-color="rgba(19,255,67,0)"></stop>
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${sentimentPath} L ${width} ${height} L 0 ${height} Z" fill="url(#sentiment-fill)" opacity="0.8"></path>
    <path d="${pricePath}" class="chart-line price-line"></path>
    <path d="${sentimentPath}" class="chart-line sentiment-line"></path>
    ${labels}
  `;
}

function renderDetail() {
  const detail = state.tickerDetail;

  if (!detail) {
    elements.tickerDetailTitle.textContent = "Ticker Detail Analysis";
    elements.tickerDetailSubtitle.textContent = "Select a ticker from the leaderboard";
    elements.detailChart.innerHTML = "";
    elements.detailWindowCards.innerHTML = "";
    elements.detailTopEvents.innerHTML = "<li>No event data yet.</li>";
    elements.detailFamilyBreakdown.innerHTML = "<li>No family data yet.</li>";
    elements.detailSourceBreakdown.innerHTML = "<li>No source data yet.</li>";
    return;
  }

  elements.tickerDetailTitle.textContent = `${detail.ticker} - ${detail.company_name || tickerCompany(detail.ticker)}`;
  elements.tickerDetailSubtitle.textContent = `${detail.sector || tickerSector(detail.ticker)} - ${detail.market_snapshot.current_price.toFixed(2)} current price - ${formatSignedPercent(detail.market_snapshot.percent_change)} over ${detail.market_snapshot.baseline_window}`;
  renderDetailChart(detail);

  const windowCards = WINDOWS.map((windowKey) => {
    const item = detail.windows[windowKey];
    return `
      <div class="window-card">
        <span>${windowKey.toUpperCase()} sentiment</span>
        <strong>${formatNumber(item.weighted_sentiment)}</strong>
        <small>${formatNumber(item.confidence * 100, 0)}% confidence in this window</small>
      </div>
    `;
  }).join("");

  const marketCards = `
    <div class="window-card">
      <span>Price</span>
      <strong>${formatNumber(detail.market_snapshot.current_price)}</strong>
      <small>${formatSignedPercent(detail.market_snapshot.percent_change)}</small>
    </div>
    <div class="window-card">
      <span>Day Range</span>
      <strong>${formatNumber(detail.market_snapshot.intraday_low)} - ${formatNumber(detail.market_snapshot.intraday_high)}</strong>
      <small>synthetic local series</small>
    </div>
  `;

  elements.detailWindowCards.innerHTML = `${marketCards}${windowCards}`;

  const recentDocs = detail.recent_documents.slice(0, 5);
  elements.detailTopEvents.innerHTML = recentDocs.length
    ? recentDocs
        .map(
          (item, index) =>
            `<li><button type="button" class="workspace-list-button" data-detail-doc="${index}">${eventTypeLabel(item.event_type)} - ${formatNumber(item.confidence * 100, 0)}% - ${item.headline}</button></li>`
        )
        .join("")
    : "<li>No events yet.</li>";

  elements.detailFamilyBreakdown.innerHTML = detail.event_family_breakdown.length
    ? detail.event_family_breakdown.map((item) => `<li>${item.name} - ${item.value}</li>`).join("")
    : "<li>No family mix yet.</li>";

  elements.detailSourceBreakdown.innerHTML = detail.source_distribution.length
    ? detail.source_distribution.map((item) => `<li>${item.name} - ${item.value}</li>`).join("")
    : "<li>No source mix yet.</li>";

  for (const button of elements.detailTopEvents.querySelectorAll("[data-detail-doc]")) {
    button.addEventListener("click", () => {
      const doc = recentDocs[Number(button.dataset.detailDoc)];
      if (doc) {
        openSignalDrawer(buildSignalFromDocument(doc, detail.ticker));
      }
    });
  }
}

function renderMarketsView() {
  const sectors = deriveVisibleSectorSummaries(filteredLeaderboard());
  const filteredSectors =
    state.marketFilter === "all"
      ? sectors
      : sectors.filter((sector) => sector.sentiment_regime === state.marketFilter);
  if (state.selectedSector && !sectors.some((sector) => sector.entity_key === state.selectedSector)) {
    state.selectedSector = null;
  }
  if (state.selectedSector && !filteredSectors.some((sector) => sector.entity_key === state.selectedSector)) {
    state.selectedSector = null;
  }

  const allRows = applyMarketFilter(filteredLeaderboard());
  const rows = state.selectedSector
    ? allRows.filter((row) => (row.sector || tickerSector(row.entity_key)) === state.selectedSector)
    : allRows;
  const activeRows = activeMarketSignalRows(rows);
  const bullishCount = sectors.filter((sector) => sector.sentiment_regime === "bullish").length;
  const bearishCount = sectors.filter((sector) => sector.sentiment_regime === "bearish").length;
  const neutralCount = sectors.filter((sector) => sector.sentiment_regime === "neutral").length;
  const activeSector = state.selectedSector
    ? sectors.find((sector) => sector.entity_key === state.selectedSector) || null
    : null;

  elements.marketsBreadth.innerHTML = `
    <div class="workspace-stat-card"><span>Bullish Sectors</span><strong>${bullishCount}</strong></div>
    <div class="workspace-stat-card"><span>Neutral Sectors</span><strong>${neutralCount}</strong></div>
    <div class="workspace-stat-card"><span>Bearish Sectors</span><strong>${bearishCount}</strong></div>
    <div class="workspace-stat-card"><span>${activeSector ? "Sector Names" : "Filtered Names"}</span><strong>${rows.length}</strong></div>
    <div class="workspace-stat-card"><span>Fresh Signal Names</span><strong>${activeRows.length}</strong></div>
  `;

  renderMarketsSectorChart(filteredSectors);

  elements.marketsSectorGrid.innerHTML = sectors.length
    ? filteredSectors
        .map(
          (sector) => `
            <button type="button" class="workspace-card sentiment-surface ${sentimentClass(sector.sentiment_regime)} ${state.selectedSector === sector.entity_key ? "selected" : ""}" data-sector="${sector.entity_key}">
              <span>${sector.entity_key}</span>
              <strong>${formatNumber(sector.weighted_sentiment)}</strong>
              <small>${sector.tracked_names} names - ${formatNumber(sector.weighted_confidence * 100, 0)}% conf</small>
              <div class="mini-bar-track"><div class="mini-bar-fill ${sentimentClass(sector.sentiment_regime)}" style="width:${Math.max(10, Math.round(Math.abs(sector.weighted_sentiment) * 100))}%"></div></div>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No sector data available.</div>`;

  const sectorMembers = activeSector
    ? (state.snapshot?.leaderboard || []).filter((row) => (row.sector || tickerSector(row.entity_key)) === activeSector.entity_key)
    : [];
  const sectorFeed = activeSector
    ? state.liveFeed.filter((item) => item.ticker && tickerSector(item.ticker) === activeSector.entity_key).slice(0, 3)
    : [];
  elements.marketsSectorFocus.innerHTML = activeSector
    ? `
        <div class="sector-focus-shell">
          <div class="sector-focus-head">
            <div>
              <div class="section-kicker">Sector Focus</div>
              <h3>${activeSector.entity_key}</h3>
              <p>${prettyLabel(activeSector.sentiment_regime)} sentiment across ${sectorMembers.length} visible names, with ${activeSector.active_names || 0} currently carrying live sentiment flow.</p>
            </div>
            <button type="button" class="panel-action" data-clear-sector>Clear</button>
          </div>
          <div class="workspace-detail-grid">
            <div class="workspace-stat-card"><span>Weighted Sentiment</span><strong>${formatNumber(activeSector.weighted_sentiment)}</strong></div>
            <div class="workspace-stat-card"><span>Sector Confidence</span><strong>${formatNumber(activeSector.weighted_confidence * 100, 0)}%</strong></div>
            <div class="workspace-stat-card"><span>Active Sentiment Names</span><strong>${activeSector.active_names || 0}</strong></div>
            <div class="workspace-stat-card"><span>Recent Feed Items</span><strong>${sectorFeed.length}</strong></div>
          </div>
          <ul class="workspace-list inline-list">
            ${sectorMembers.length
              ? sectorMembers
                  .slice(0, 6)
                  .map(
                    (row) =>
                      `<li><button type="button" class="workspace-list-button" data-sector-ticker="${row.entity_key}">${row.entity_key} - ${row.company_name || tickerCompany(row.entity_key)} - ${formatSignedPercent(row.momentum_delta)}</button></li>`
                  )
                  .join("")
              : "<li>No tracked tickers for this sector.</li>"}
          </ul>
          <ul class="workspace-list">
            ${sectorFeed.length
              ? sectorFeed
                  .map(
                    (item, index) =>
                      `<li><button type="button" class="workspace-list-button" data-sector-feed="${index}">${item.ticker || "MKT"} - ${item.headline}</button></li>`
                  )
                  .join("")
              : "<li>No recent sector-specific events in the live feed.</li>"}
          </ul>
        </div>
      `
    : `
        <div class="workspace-empty">
          Select a sector to narrow the comparison table and inspect which visible names are actually carrying sentiment right now.
        </div>
      `;

  function activeConvictionScore(row) {
    return (
      Math.abs(Number(row.momentum_delta || 0)) * 3 +
      Math.abs(Number(row.weighted_sentiment || 0)) * 2 +
      Number(row.weighted_confidence || 0) +
      Math.min(1.5, Number(row.story_velocity || 0) * 0.25)
    );
  }

  const comparisonRows = activeRows
    .slice()
    .map((row) => ({ row, activeScore: activeConvictionScore(row) }))
    .sort((a, b) => b.activeScore - a.activeScore)
    .slice(0, 4);

  elements.marketsComparisonStrip.innerHTML = comparisonRows.length
    ? comparisonRows
        .map(
          ({ row, activeScore }) => `
            <button type="button" class="workspace-card comparison-card ${state.selectedTicker === row.entity_key ? "selected" : ""}" data-compare-ticker="${row.entity_key}">
              <span>${row.entity_key}</span>
              <strong>${formatNumber(activeScore)}</strong>
              <small>active conviction - ${formatSignedPercent(row.momentum_delta)} momentum - ${formatNumber(row.weighted_confidence * 100, 0)}% conf</small>
              <div class="mini-bar-track"><div class="mini-bar-fill ${sentimentClass(row.sentiment_regime)}" style="width:${Math.max(10, Math.round(Math.min(1, activeScore) * 100))}%"></div></div>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No fresh market-signal names are available for this filter. Screen-only fundamentals rows are intentionally hidden here so stale or zero-signal names do not look actionable.</div>`;

  elements.marketsTableBody.innerHTML = activeRows.length
    ? activeRows
        .map(
          (row) => `
          <tr data-ticker="${row.entity_key}">
              <td>
                <div class="stock-cell">
                  <strong>${row.entity_key}</strong>
                  <span>${row.company_name || tickerCompany(row.entity_key)}</span>
                </div>
              </td>
              <td><span class="sentiment-badge ${badgeClass(sentimentLabel(row.weighted_sentiment))}">${sentimentLabel(row.weighted_sentiment)}</span></td>
              <td>${formatNumber(row.weighted_confidence * 100, 1)}%</td>
              <td>${formatSignedPercent(row.momentum_delta)} - ${formatNumber(row.story_velocity, 2)}/h</td>
            </tr>
          `
        )
        .join("")
    : `<tr class="empty-row"><td colspan="4">No fresh market-comparison rows. Run live news / market flow, or clear filters. Fundamentals-only names stay visible in the leaderboard but are excluded from this active-conviction table.</td></tr>`;

  elements.marketsDetail.innerHTML = state.tickerDetail
    ? `
        <div class="workspace-detail-grid">
          <div class="workspace-stat-card"><span>Ticker</span><strong>${state.tickerDetail.ticker}</strong></div>
          <div class="workspace-stat-card"><span>Company</span><strong>${state.tickerDetail.company_name || tickerCompany(state.tickerDetail.ticker)}</strong></div>
          <div class="workspace-stat-card"><span>Sector</span><strong>${state.tickerDetail.sector || tickerSector(state.tickerDetail.ticker)}</strong></div>
          <div class="workspace-stat-card"><span>Price</span><strong>${formatNumber(state.tickerDetail.market_snapshot.current_price)}</strong></div>
          <div class="workspace-stat-card"><span>Sentiment Regime</span><strong>${state.tickerDetail.regime}</strong></div>
          <div class="workspace-stat-card"><span>Risk Flags</span><strong>${state.tickerDetail.risk_flags.length || 0}</strong></div>
        </div>
        <ul class="workspace-list">
          ${state.tickerDetail.recent_documents
            .slice(0, 5)
            .map(
              (item, index) =>
                `<li><button type="button" class="workspace-list-button" data-market-doc="${index}">${eventTypeLabel(item.event_type)} - ${formatNumber(item.confidence * 100, 0)}% - ${item.headline}</button></li>`
            )
            .join("")}
        </ul>
      `
    : `<div class="workspace-empty">Select a ticker to inspect market detail.</div>`;

  for (const button of elements.marketsComparisonStrip.querySelectorAll("[data-compare-ticker]")) {
    button.addEventListener("click", async () => {
      await focusTicker(button.dataset.compareTicker);
    });
  }

  for (const row of elements.marketsTableBody.querySelectorAll("[data-ticker]")) {
    row.addEventListener("click", async () => {
      await focusTicker(row.dataset.ticker);
    });
  }

  for (const button of elements.marketsSectorGrid.querySelectorAll("[data-sector]")) {
    button.addEventListener("click", async () => {
      const sector = button.dataset.sector;
      state.selectedSector = state.selectedSector === sector ? null : sector;
      const sectorRows = allRows.filter((row) => (row.sector || tickerSector(row.entity_key)) === state.selectedSector);
      if (state.selectedSector && sectorRows.length) {
        await focusTicker(sectorRows[0].entity_key);
        return;
      }
      render();
    });
  }

  for (const button of elements.marketsSectorChart.querySelectorAll("[data-sector]")) {
    button.addEventListener("click", async () => {
      const sector = button.dataset.sector;
      state.selectedSector = state.selectedSector === sector ? null : sector;
      const sectorRows = allRows.filter((row) => (row.sector || tickerSector(row.entity_key)) === state.selectedSector);
      if (state.selectedSector && sectorRows.length) {
        await focusTicker(sectorRows[0].entity_key);
        return;
      }
      render();
    });
  }

  elements.marketsSectorFocus.querySelector("[data-clear-sector]")?.addEventListener("click", () => {
    state.selectedSector = null;
    render();
  });

  for (const button of elements.marketsSectorFocus.querySelectorAll("[data-sector-ticker]")) {
    button.addEventListener("click", async () => {
      await focusTicker(button.dataset.sectorTicker);
    });
  }

  for (const button of elements.marketsSectorFocus.querySelectorAll("[data-sector-feed]")) {
    button.addEventListener("click", () => {
      const item = sectorFeed[Number(button.dataset.sectorFeed)];
      if (item) {
        openSignalDrawer(buildSignalFromFeed(item, `${activeSector?.entity_key || "Sector"} Feed`));
      }
    });
  }

  for (const button of elements.marketsDetail.querySelectorAll("[data-market-doc]")) {
    button.addEventListener("click", () => {
      const doc = state.tickerDetail?.recent_documents?.[Number(button.dataset.marketDoc)];
      if (doc) {
        openSignalDrawer(buildSignalFromDocument(doc, state.tickerDetail.ticker));
      }
    });
  }
}

function renderMarketsSectorChart(sectors) {
  if (!elements.marketsSectorChart) {
    return;
  }

  if (!sectors.length) {
    elements.marketsSectorChart.innerHTML = "";
    return;
  }

  const visibleSectors = sectors.slice(0, 8);
  const width = 760;
  const height = 220;
  const chartBottom = 176;
  const barWidth = Math.min(92, Math.max(52, Math.floor(width / Math.max(1, visibleSectors.length * 1.35))));
  const gap = (width - visibleSectors.length * barWidth) / Math.max(1, visibleSectors.length + 1);
  const zeroLine = 102;
  const grid = [36, 69, 102, 135, 168]
    .map((y) => `<line x1="0" y1="${y}" x2="${width}" y2="${y}" class="chart-grid"></line>`)
    .join("");

  const bars = visibleSectors
    .map((sector, index) => {
      const x = gap + index * (barWidth + gap);
      const amplitude = Math.max(-1, Math.min(1, sector.weighted_sentiment || 0));
      const barHeight = Math.abs(amplitude) * 74;
      const isPositive = amplitude >= 0;
      const y = isPositive ? zeroLine - barHeight : zeroLine;
      const fillClass = `bar-${sentimentClass(sector.sentiment_regime)}`;
      const labelY = chartBottom + 18;
      const shortLabel = sector.entity_key.length > 16 ? `${sector.entity_key.slice(0, 15)}...` : sector.entity_key;
      return `
        <g class="sector-bar-group ${state.selectedSector === sector.entity_key ? "is-selected" : ""}" data-sector="${sector.entity_key}">
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${Math.max(10, barHeight).toFixed(1)}" rx="10" class="sector-bar ${fillClass}"></rect>
          <text x="${(x + barWidth / 2).toFixed(1)}" y="${isPositive ? y - 8 : y + Math.max(18, barHeight + 18)}" class="chart-value">${formatNumber(sector.weighted_sentiment)}</text>
          <text x="${(x + barWidth / 2).toFixed(1)}" y="${labelY}" class="chart-label">${shortLabel}</text>
        </g>
      `;
    })
    .join("");

  elements.marketsSectorChart.innerHTML = `
    ${grid}
    <line x1="0" y1="${zeroLine}" x2="${width}" y2="${zeroLine}" class="chart-axis"></line>
    ${bars}
    <text x="8" y="18" class="chart-caption">Top sectors by visible sentiment intensity</text>
  `;
}

function renderWatchView() {
  const watchRows = buildPriorityWatchRows(8);
  elements.watchCards.innerHTML = watchRows.length
    ? watchRows
        .map(
          ({ row, setup }) => `
            <button type="button" class="watch-card ${state.selectedTicker === row.entity_key ? "selected" : ""}" data-watch-ticker="${row.entity_key}">
              <div class="watch-card-head">
                <strong>${row.entity_key}</strong>
                <span class="sentiment-badge ${badgeClass(sentimentLabel(row.weighted_sentiment))}">${sentimentLabel(row.weighted_sentiment)}</span>
              </div>
              <p>${row.company_name || tickerCompany(row.entity_key)} - ${row.sector || tickerSector(row.entity_key)}</p>
              <div class="watch-card-meta">
                <span title="Stage-one fundamentals gate result">${screenLabel(row)}</span>
                <span title="Full fundamentals composite score">${row.composite_fundamental_score !== null && row.composite_fundamental_score !== undefined ? `F ${formatNumber(row.composite_fundamental_score, 2)}` : "F --"}</span>
                <span title="Confidence in the current sentiment read">${formatNumber(row.weighted_confidence * 100, 0)}% conf</span>
                <span title="Current action or strongest active signal">${setup ? prettyLabel(setup.action) : eventTypeLabel(row.top_event_types[0] || "monitor_item")}</span>
              </div>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No watchlist items match the current search.</div>`;

  const watchFeedItems = collectWatchlistFeedItems(watchRows, 8);
  elements.watchFeed.innerHTML = watchFeedItems.length
    ? watchFeedItems
        .map(
          (item) => `
            <article class="feed-card ${badgeClass(item.label)}" data-watch-feed="${item.ticker || ""}">
              <div class="feed-row">
                <strong>${item.ticker || "MKT"}: ${eventTypeLabel(item.event_type)}</strong>
                <span>${relativeTime(item.timestamp)}</span>
              </div>
              <p>${item.explanation_short || item.headline}</p>
              <div class="feed-meta">
                <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
                <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
                <span>${evidenceQualityLabel(item.evidence_quality)}</span>
                <span>${item.source_name || "Source n/a"}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="workspace-empty">No watchlist feed items available.</div>`;

  const selectedRow = state.tickerDetail
    ? (state.snapshot?.leaderboard || []).find((row) => row.entity_key === state.tickerDetail.ticker) || null
    : null;
  elements.watchSummary.innerHTML = state.tickerDetail
    ? `
        <div class="workspace-detail-grid">
          <div class="workspace-stat-card"><span>Selected</span><strong>${state.tickerDetail.ticker}</strong></div>
          <div class="workspace-stat-card"><span>Company</span><strong>${selectedRow?.company_name || state.tickerDetail.company_name || tickerCompany(state.tickerDetail.ticker)}</strong></div>
          <div class="workspace-stat-card"><span>Current Price</span><strong>${formatNumber(state.tickerDetail.market_snapshot.current_price)}</strong></div>
          <div class="workspace-stat-card"><span>Trend</span><strong>${formatSignedPercent(state.tickerDetail.market_snapshot.percent_change)}</strong></div>
          <div class="workspace-stat-card"><span>Top Source</span><strong>${state.tickerDetail.source_distribution[0]?.name || "n/a"}</strong></div>
          <div class="workspace-stat-card"><span>Fundamental Screen</span><strong>${selectedRow ? screenLabel(selectedRow) : "unscored"}</strong></div>
          <div class="workspace-stat-card"><span>Composite</span><strong>${selectedRow?.composite_fundamental_score !== null && selectedRow?.composite_fundamental_score !== undefined ? formatNumber(selectedRow.composite_fundamental_score, 2) : "--"}</strong></div>
          <div class="workspace-stat-card"><span>Fundamental Rating</span><strong>${selectedRow?.fundamental_rating ? prettyLabel(selectedRow.fundamental_rating) : "n/a"}</strong></div>
          <div class="workspace-stat-card"><span>Fundamental Source</span><strong>${sourceLabel(selectedRow?.fundamental_data_source)}</strong></div>
        </div>
        <ul class="workspace-list">
          ${state.tickerDetail.recent_documents
            .slice(0, 6)
            .map(
              (item, index) =>
                `<li><button type="button" class="workspace-list-button" data-watch-doc="${index}">${relativeTime(item.published_at)} - ${eventTypeLabel(item.event_type)} - ${item.headline}</button></li>`
            )
            .join("")}
        </ul>
      `
    : `<div class="workspace-empty">Select a watchlist ticker to inspect.</div>`;

  for (const button of elements.watchCards.querySelectorAll("[data-watch-ticker]")) {
    button.addEventListener("click", async () => {
      await focusTicker(button.dataset.watchTicker);
    });
  }

  for (const item of elements.watchFeed.querySelectorAll("[data-watch-feed]")) {
    item.addEventListener("click", () => {
      const ticker = item.dataset.watchFeed;
      const matching = watchFeedItems.find((feedItem) => (feedItem.ticker || "") === ticker);
      if (matching) {
        openSignalDrawer(buildSignalFromFeed(matching, "Watchlist Feed"));
      }
    });
  }

  for (const button of elements.watchSummary.querySelectorAll("[data-watch-doc]")) {
    button.addEventListener("click", () => {
      const doc = state.tickerDetail?.recent_documents?.[Number(button.dataset.watchDoc)];
      if (doc) {
        openSignalDrawer(buildSignalFromDocument(doc, state.tickerDetail.ticker));
      }
    });
  }
}

function renderAlertsView() {
  const filteredAlerts = applyAlertFilter(state.alerts);
  const positiveCount = state.alerts.filter((alert) => alert.alert_type === "high_confidence_positive").length;
  const negativeCount = state.alerts.filter((alert) => alert.alert_type === "high_confidence_negative").length;
  const reversalCount = state.alerts.filter((alert) => alert.alert_type === "polarity_reversal").length;
  const moneyFlowSignals = collectMoneyFlowSignals();
  const groupedMoneyFlow = moneyFlowGroups(moneyFlowSignals);
  const insiderCount = moneyFlowSignals.filter((item) => INSIDER_FLOW_EVENT_TYPES.has(item.event_type)).length;
  const institutionalCount = moneyFlowSignals.filter((item) => INSTITUTIONAL_FLOW_EVENT_TYPES.has(item.event_type)).length;
  const tapeFlowCount = moneyFlowSignals.filter((item) => TAPE_FLOW_EVENT_TYPES.has(item.event_type)).length;
  const newestAlertAt = state.alerts
    .map(alertEvidenceTimestamp)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
  const newestFlowAt = moneyFlowSignals
    .map(signalTimestamp)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];

  elements.alertsSummaryStrip.innerHTML = `
    <div class="workspace-stat-card"><span>Positive</span><strong>${positiveCount}</strong></div>
    <div class="workspace-stat-card"><span>Negative</span><strong>${negativeCount}</strong></div>
    <div class="workspace-stat-card"><span>Reversal</span><strong>${reversalCount}</strong></div>
    <div class="workspace-stat-card"><span>Money Flow</span><strong>${moneyFlowSignals.length}</strong></div>
    <div class="workspace-stat-card"><span>Newest Alert</span><strong>${newestAlertAt ? relativeTime(newestAlertAt) : "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>Newest Flow</span><strong>${newestFlowAt ? relativeTime(newestFlowAt) : "n/a"}</strong></div>
  `;

  elements.alertsCritical.innerHTML = filteredAlerts.length
    ? filteredAlerts
        .map(
          (alert, index) => {
            const timestamp = alertEvidenceTimestamp(alert);
            const sourceName = alertSourceName(alert);
            return `
              <article class="workspace-alert ${alert.alert_type}" data-alert-index="${index}">
                <div class="workspace-alert-head">
                  <strong>${alert.alert_type.replace(/_/g, " ")}</strong>
                  <span>${alert.entity_key}</span>
                </div>
                ${sourceStamp(sourceName, timestamp)}
                <p>${alert.headline || "State-based alert trigger"}</p>
                <small>${formatNumber(alert.confidence * 100, 0)}% confidence - generated ${relativeTime(alert.created_at)}</small>
                <div class="mini-bar-track"><div class="mini-bar-fill ${alert.alert_type.includes("negative") ? "bearish" : "bullish"}" style="width:${Math.max(10, Math.round(alert.confidence * 100))}%"></div></div>
              </article>
            `;
          }
        )
        .join("")
    : `<div class="workspace-empty">No active alerts at this time.</div>`;

  elements.alertsHighImpact.innerHTML = state.highImpact.length
    ? state.highImpact
        .map(
          (item, index) => {
            const timestamp = signalTimestamp(item);
            const sourceName = signalSourceName(item, "High Impact Signal");
            return `
              <article class="feed-card ${badgeClass(item.label)}" data-high-impact-index="${index}">
                <div class="feed-row">
                  <strong>${item.ticker || "MKT"}: ${eventTypeLabel(item.event_type)}</strong>
                  <span>${relativeTime(timestamp)}</span>
                </div>
                ${sourceStamp(sourceName, timestamp)}
                <p>${item.headline}</p>
                <div class="feed-meta">
                  <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
                  <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
                  <span>${evidenceQualityLabel(item.evidence_quality)}</span>
                </div>
              </article>
            `;
          }
        )
        .join("")
    : `<div class="workspace-empty">No high impact signals available.</div>`;

  const alertCounts = state.alerts.reduce((acc, alert) => {
    acc[alert.alert_type] = (acc[alert.alert_type] || 0) + 1;
    return acc;
  }, {});
  const moneyFlowTickers = Object.entries(
    moneyFlowSignals.reduce((acc, item) => {
      if (!item.ticker) {
        return acc;
      }
      acc[item.ticker] = (acc[item.ticker] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const moneyFlowIndexMap = {
    insider: groupedMoneyFlow.insider,
    institutional: groupedMoneyFlow.institutional,
    tape: groupedMoneyFlow.tape
  };

  elements.alertsMoneyFlow.innerHTML = `
    <div class="money-flow-shell">
      ${renderMarketFlowControls()}
      <div class="note-card">
        <strong>How this relates to Active Alerts</strong>
        <p>Active Alerts are downstream sentiment-engine triggers. Smart Money Radar shows the upstream raw flow evidence from SEC insider filings, 13F ownership changes, and tape-style market anomalies before or alongside those alerts.</p>
      </div>
      <div class="workspace-detail-grid">
        <div class="workspace-stat-card"><span>Insider</span><strong>${insiderCount}</strong></div>
        <div class="workspace-stat-card"><span>Institutional</span><strong>${institutionalCount}</strong></div>
        <div class="workspace-stat-card"><span>Tape Flow</span><strong>${tapeFlowCount}</strong></div>
        <div class="workspace-stat-card"><span>Filtered Alerts</span><strong>${filteredAlerts.length}</strong></div>
      </div>
      <div class="money-flow-grid">
        ${renderMoneyFlowSection("Insider Flow", "No insider filings in the current live window.", groupedMoneyFlow.insider, "insider")}
        ${renderMoneyFlowSection("Institutional Holdings", "No 13F position changes have surfaced in the current live window.", groupedMoneyFlow.institutional, "institutional")}
        ${renderMoneyFlowSection("Tape / Block Flow", "No abnormal tape-flow or block-style signatures have surfaced in the current live window.", groupedMoneyFlow.tape, "tape")}
      </div>
      <div class="summary-list money-flow-diagnostics">
        <div class="section-kicker">Flow Concentration</div>
        <ul class="workspace-list inline-list">
          ${
            moneyFlowTickers.length
              ? moneyFlowTickers
                  .map(
                    ([ticker, count]) =>
                      `<li><button type="button" class="workspace-list-button" data-money-flow-ticker="${ticker}">${ticker} - ${count} flow signal${count === 1 ? "" : "s"}</button></li>`
                  )
                  .join("")
              : "<li>No concentrated money-flow names yet.</li>"
          }
        </ul>
        <div class="section-kicker">Alert Mix</div>
        <ul class="workspace-list">
          ${Object.entries(alertCounts).length
            ? Object.entries(alertCounts).map(([type, count]) => `<li>${prettyLabel(type)} - ${count}</li>`).join("")
            : "<li>No alert diagnostics yet.</li>"}
        </ul>
      </div>
    </div>
  `;

  for (const alertCard of elements.alertsCritical.querySelectorAll("[data-alert-index]")) {
    alertCard.addEventListener("click", () => {
      const alert = filteredAlerts[Number(alertCard.dataset.alertIndex)];
      if (alert) {
        openSignalDrawer(buildSignalFromAlert(alert));
      }
    });
  }

  for (const item of elements.alertsHighImpact.querySelectorAll("[data-high-impact-index]")) {
    item.addEventListener("click", () => {
      const signal = state.highImpact[Number(item.dataset.highImpactIndex)];
      if (signal) {
        openSignalDrawer(buildSignalFromFeed(signal, "High Impact Signal"));
      }
    });
  }

  for (const card of elements.alertsMoneyFlow.querySelectorAll("[data-money-flow-index]")) {
    card.addEventListener("click", () => {
      const [groupKey, indexRaw] = String(card.dataset.moneyFlowIndex || "").split(":");
      const signal = moneyFlowIndexMap[groupKey]?.[Number(indexRaw)];
      if (signal) {
        openSignalDrawer(buildSignalFromFeed(signal, "Money Flow Radar"));
      }
    });
  }

  for (const button of elements.alertsMoneyFlow.querySelectorAll("[data-money-flow-ticker]")) {
    button.addEventListener("click", async () => {
      await focusTicker(button.dataset.moneyFlowTicker, "overview");
    });
  }

  for (const input of elements.alertsMoneyFlow.querySelectorAll("[data-market-flow-setting]")) {
    input.addEventListener("input", () => {
      state.marketFlowSaveState = "";
      state.marketFlowSettings[input.dataset.marketFlowSetting] = Number(input.value);
    });
  }

  elements.alertsMoneyFlow.querySelector("#market-flow-save-button")?.addEventListener("click", async () => {
    state.marketFlowSaveState = "saving";
    renderAlertsView();

    try {
      const response = await fetch("/api/settings/market-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...state.marketFlowSettings, persist: true })
      });

      if (!response.ok) {
        throw new Error("Failed to save market-flow settings.");
      }

      const payload = await response.json();
      state.marketFlowSettings = { ...(payload.settings || state.marketFlowSettings) };
      state.marketFlowSaveState = "saved";
      await loadHealth();
    } catch (error) {
      console.error(error);
      state.marketFlowSaveState = "";
    }

    renderAlertsView();
  });
}

function renderSignalDrawer() {
  const signal = state.selectedSignal;
  const isOpen = Boolean(signal);

  elements.signalBackdrop.hidden = !isOpen;
  elements.signalDrawer.classList.toggle("is-open", isOpen);
  elements.signalDrawer.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("drawer-open", isOpen);

  if (!signal) {
    elements.signalDrawerTitle.textContent = "No signal selected";
    elements.signalDrawerSubtitle.textContent = "Choose an event from the dashboard to inspect its context.";
    elements.signalDrawerBadge.textContent = "Neutral";
    elements.signalDrawerBadge.className = "sentiment-badge neutral";
    elements.signalDrawerTime.textContent = "-";
    elements.signalDrawerSummary.textContent = "Select a live event, alert, or document to inspect it here.";
    elements.signalDrawerStats.innerHTML = "";
    elements.signalDrawerExplanation.textContent = "No signal selected yet.";
    elements.signalDrawerContext.innerHTML = "<li>No context available.</li>";
    elements.signalFocusButton.disabled = true;
    elements.signalSourceButton.disabled = true;
    elements.signalSourceButton.textContent = "Open Source";
    elements.signalSourceButton.title = "";
    return;
  }

  elements.signalDrawerTitle.textContent = signal.title;
  elements.signalDrawerSubtitle.textContent = signal.subtitle;
  elements.signalDrawerBadge.textContent = signal.label;
  elements.signalDrawerBadge.className = `sentiment-badge ${signal.badgeClass || badgeClass(signal.label)}`;
  elements.signalDrawerTime.textContent = relativeTime(signal.timestamp);
  elements.signalDrawerSummary.textContent = signal.headline;
  elements.signalDrawerStats.innerHTML =
    signal.statsHtml ||
    `
      <div class="workspace-stat-card"><span>Ticker</span><strong>${signal.ticker || "Market"}</strong></div>
      <div class="workspace-stat-card"><span>Event Type</span><strong>${prettyLabel(signal.eventType)}</strong></div>
      <div class="workspace-stat-card"><span>Confidence</span><strong>${formatNumber(signal.confidence * 100, 0)}%</strong></div>
      <div class="workspace-stat-card"><span>Evidence Quality</span><strong>${evidenceQualityLabel(signal.evidenceQuality)}</strong></div>
      <div class="workspace-stat-card"><span>Downstream Weight</span><strong>${signal.downstreamWeight !== null && signal.downstreamWeight !== undefined ? formatNumber(signal.downstreamWeight, 2) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Source</span><strong>${signal.sourceName || signal.subtitle}</strong></div>
    `;
  elements.signalDrawerExplanation.textContent = signal.explanation;
  const contextItems =
    signal.contextItems ||
    [
      signal.timestamp ? `Observed ${relativeTime(signal.timestamp)} at ${formatTime(signal.timestamp)}.` : null,
      signal.sourceName ? `Source: ${signal.sourceName}.` : null,
      signal.evidenceQuality?.explanation ? `Evidence quality: ${signal.evidenceQuality.explanation}` : null,
      signal.ticker ? `Related ticker: ${signal.ticker}.` : "This signal is market-level rather than ticker-specific.",
      `Current classification: ${signal.label.toLowerCase()}.`,
      signal.sourceMetadata?.volume_spike ? `Tape signature: ${formatNumber(signal.sourceMetadata.volume_spike, 1)}x normal volume.` : null,
      signal.sourceMetadata?.latest_dollar_volume_usd ? `Estimated live notional: ${formatUsdCompact(signal.sourceMetadata.latest_dollar_volume_usd)}.` : null,
      signal.sourceMetadata?.filer_name ? `Institutional filer: ${signal.sourceMetadata.filer_name}.` : null,
      signal.sourceMetadata?.position_delta_shares ? `Reported position change: ${formatCompactNumber(Math.abs(signal.sourceMetadata.position_delta_shares))} shares.` : null,
      signal.sourceMetadata?.insider_owner ? `Reported insider: ${signal.sourceMetadata.insider_owner}${signal.sourceMetadata.insider_role ? ` (${prettyLabel(signal.sourceMetadata.insider_role)})` : ""}.` : null,
      signal.sourceMetadata?.transaction_value_usd ? `Reported insider notional: ${formatUsdCompact(Math.abs(signal.sourceMetadata.transaction_value_usd))}.` : null
    ];
  elements.signalDrawerContext.innerHTML = contextItems.filter(Boolean).map((item) => `<li>${item}</li>`).join("");
  elements.signalFocusButton.disabled = !signal.ticker;
  elements.signalSourceButton.disabled = !signal.url;
  elements.signalSourceButton.textContent = signal.url ? "Open Source" : "No Source URL";
  elements.signalSourceButton.title = signal.url
    ? "Open the original source in a new tab."
    : "This signal does not include an original source URL, so it should be treated as lower-trust context.";
}

function monitorActionClass(action) {
  if (["close_candidate", "action_needed", "blocked"].includes(action)) {
    return "bearish";
  }
  if (action === "hold" || action === "ok") {
    return "bullish";
  }
  return "neutral";
}

function renderExecutionConsolePanel() {
  const execution = state.executionStatus || {};
  const monitor = state.positionMonitor || {};
  const risk = state.riskSnapshot || {};
  const broker = execution.broker || monitor.broker || {};
  const safety = execution.safety || {};
  const positions = monitor.positions || [];
  const orders = monitor.open_orders || [];
  const planningCandidates =
    monitor.planning_candidates?.length
      ? monitor.planning_candidates
      : (state.tradeSetups?.setups || [])
          .filter((setup) => ["long", "short"].includes(setup.action))
          .slice(0, 5)
          .map((setup) => ({
            ticker: setup.ticker,
            action: setup.action,
            setup_label: setup.setup_label,
            tradable: ["long", "short"].includes(setup.action),
            blocked_reason: ["long", "short"].includes(setup.action) ? null : "setup_action_is_not_tradable",
            conviction: setup.conviction,
            summary: setup.summary
          }));
  const submitEnabled = broker.mode === "paper" && broker.ready_for_order_submission;
  const brokerLabel = broker.ready_for_order_submission
    ? "ready"
    : broker.configured
      ? "guarded"
      : "not configured";
  const statusClass = broker.ready_for_order_submission ? "bullish" : broker.configured ? "neutral" : "bearish";

  return `
    <div class="runtime-action-panel execution-console-panel">
      <div class="section-kicker">Execution Control</div>
      <h3>Paper Trading And Position Monitor</h3>
      <p class="workspace-copy">This is the guarded execution layer. Preview converts a Trade Setup Agent idea into an Alpaca-ready order and risk check. Paper submit stays disabled until Alpaca paper credentials and BROKER_SUBMIT_ENABLED=true are configured.</p>
      <div class="workspace-detail-grid execution-status-grid">
        <div class="workspace-stat-card"><span>Broker</span><strong>${prettyLabel(broker.provider || "alpaca")}</strong></div>
        <div class="workspace-stat-card"><span>Mode</span><strong>${prettyLabel(broker.mode || "paper")}</strong></div>
        <div class="workspace-stat-card"><span>Submit Guard</span><strong>${broker.submit_enabled ? "Enabled" : "Disabled"}</strong></div>
        <div class="workspace-stat-card"><span>Execution</span><strong>${prettyLabel(execution.status || brokerLabel)}</strong></div>
        <div class="workspace-stat-card"><span>Risk</span><strong>${prettyLabel(risk.status || monitor.risk_status || "unknown")}</strong></div>
        <div class="workspace-stat-card"><span>Equity Basis</span><strong>${formatUsdCompact(risk.equity || monitor.account?.equity || 0)}</strong></div>
        <div class="workspace-stat-card"><span>Positions</span><strong>${monitor.position_count ?? positions.length ?? 0}</strong></div>
        <div class="workspace-stat-card"><span>Open Orders</span><strong>${monitor.open_order_count ?? orders.length ?? 0}</strong></div>
      </div>
      <div class="runtime-control-grid">
        <div class="runtime-control-card">
          <div class="runtime-source-head">
            <strong>Broker Guardrails</strong>
            <span class="sentiment-badge ${statusClass}">${prettyLabel(brokerLabel)}</span>
          </div>
          <p class="workspace-copy">Submission requires credentials, paper mode, the backend safety flag, and the confirmation phrase <strong>paper-trade</strong>. Live trading is intentionally not exposed in this dashboard flow.</p>
          <ul class="workspace-list">
            <li>Max order notional: ${formatUsdCompact(safety.max_order_notional_usd || 0)}</li>
            <li>Max position size: ${formatNumber((safety.max_position_pct || 0) * 100, 1)}%</li>
            <li>Min conviction: ${formatNumber((safety.min_conviction || 0) * 100, 0)}%</li>
            <li>Shorts: ${safety.allow_shorts ? "allowed" : "disabled"}</li>
          </ul>
        </div>
        <div class="runtime-control-card">
          <div class="runtime-source-head">
            <strong>Portfolio Risk</strong>
            <span class="sentiment-badge ${monitorActionClass(risk.status)}">${prettyLabel(risk.status || "unknown")}</span>
          </div>
          <p class="workspace-copy">The Portfolio Risk Agent blocks orders when exposure, single-name concentration, open orders, or runtime pressure exceed configured guardrails.</p>
          <ul class="workspace-list">
            <li>Gross exposure: ${formatNumber((risk.gross_exposure_pct || 0) * 100, 1)}%</li>
            <li>Largest position: ${risk.largest_position?.symbol || "n/a"} ${risk.largest_position ? `${formatNumber(risk.largest_position.exposure_pct * 100, 1)}%` : ""}</li>
            <li>Buying power: ${formatUsdCompact(risk.buying_power || 0)}</li>
            <li>Runtime constrained: ${risk.runtime_constrained ? "yes" : "no"}</li>
          </ul>
        </div>
        <div class="runtime-control-card">
          <div class="runtime-source-head">
            <strong>Position Monitor</strong>
            <span class="sentiment-badge ${monitorActionClass(monitor.status)}">${prettyLabel(monitor.status || "waiting")}</span>
          </div>
          <p class="workspace-copy">The Position Monitor compares open Alpaca positions and orders against the latest trade setups. It flags stale positions, setup drift, and close candidates.</p>
          <ul class="workspace-list">
            <li>Review: ${monitor.review_count || 0}</li>
            <li>Close candidates: ${monitor.close_candidate_count || 0}</li>
            <li>Total position value: ${formatUsdCompact(monitor.total_position_value || 0)}</li>
            <li>Broker configured: ${broker.configured ? "yes" : "no"}</li>
          </ul>
        </div>
      </div>
      <div class="execution-subsection">
        <div>
          <h4>Next Setup Candidates</h4>
          <p class="workspace-copy">Use Preview Order first. Paper Submit is intentionally gated and only sends to Alpaca paper trading when the backend confirms it is safe.</p>
        </div>
        ${
          planningCandidates.length
            ? `<div class="execution-candidate-grid">
                ${planningCandidates
                  .map(
                    (candidate) => `
                      <div class="source-card execution-candidate-card">
                        <div class="runtime-source-head">
                          <strong>${escapeHtml(candidate.ticker)}</strong>
                          <span class="sentiment-badge ${setupActionClass(candidate.action)}">${prettyLabel(candidate.action)}</span>
                        </div>
                        <span>${escapeHtml(candidate.summary || "Trade setup candidate.")}</span>
                        <span>${formatNumber((candidate.conviction || 0) * 100, 0)}% conviction - ${candidate.tradable ? "tradable setup" : `preview explains block: ${prettyLabel(candidate.blocked_reason)}`}</span>
                        <div class="setup-action-row">
                          <button type="button" class="panel-action compact-action" data-preview-execution="${escapeHtml(candidate.ticker)}">Preview</button>
                          <button type="button" class="panel-action compact-action danger-action" data-submit-paper="${escapeHtml(candidate.ticker)}" ${submitEnabled && candidate.tradable ? "" : "disabled"}>Paper Submit</button>
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>`
            : `<div class="workspace-empty">No long or short candidates are ready from the Trade Setup Agent.</div>`
        }
      </div>
      <div class="execution-subsection">
        <h4>Open Position Review</h4>
        ${
          positions.length
            ? `<div class="execution-position-list">
                ${positions
                  .map(
                    (position) => `
                      <div class="source-card execution-position-card ${monitorActionClass(position.monitor_action)}">
                        <div class="runtime-source-head">
                          <strong>${escapeHtml(position.symbol)}</strong>
                          <span class="sentiment-badge ${monitorActionClass(position.monitor_action)}">${prettyLabel(position.monitor_action)}</span>
                        </div>
                        <span>${prettyLabel(position.side)} ${formatNumber(position.qty, 4)} shares - ${formatUsdCompact(position.market_value)}</span>
                        <span>P/L ${formatUsdCompact(position.unrealized_pl)} (${formatNumber((position.unrealized_plpc || 0) * 100, 1)}%)</span>
                        <span>Current setup: ${prettyLabel(position.setup_action || "none")} ${position.setup_conviction !== null ? `- ${formatNumber(position.setup_conviction * 100, 0)}% conviction` : ""}</span>
                        <small>${position.reason_codes?.length ? position.reason_codes.map(prettyLabel).join(", ") : "No monitor warnings."}</small>
                      </div>
                    `
                  )
                  .join("")}
              </div>`
            : `<div class="workspace-empty">No open Alpaca positions are visible. If credentials are not configured, this panel stays in planning mode.</div>`
        }
      </div>
      ${
        orders.length
          ? `<div class="execution-subsection">
              <h4>Open Orders</h4>
              <div class="execution-position-list">
                ${orders
                  .map(
                    (order) => `
                      <div class="source-card">
                        <strong>${escapeHtml(order.symbol)}</strong>
                        <span>${prettyLabel(order.side)} ${order.qty || order.notional || ""} - ${prettyLabel(order.type)} - ${prettyLabel(order.status)}</span>
                        <small>${order.submitted_at ? relativeTime(order.submitted_at) : "submitted time n/a"}</small>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>`
          : ""
      }
    </div>
  `;
}

function workflowStatusClass(status) {
  if (status === "ready" || status === "pass") {
    return "bullish";
  }
  if (status === "not_ready" || status === "fail") {
    return "bearish";
  }
  return "neutral";
}

function renderTradingWorkflowStatus() {
  const workflow = state.workflowStatus;
  if (!workflow) {
    return `<div class="workspace-empty">Workflow readiness is loading. If this persists, check /api/trading-workflow/status.</div>`;
  }

  const liveData = workflow.live_data || {};
  const steps = workflow.steps || [];
  const sources = liveData.sources || [];
  const blockers = workflow.blockers || [];
  const warnings = workflow.warnings || [];
  const actions = workflow.next_actions || [];

  return `
    <div class="workflow-readiness-card ${workflowStatusClass(workflow.status)}">
      <div>
        <div class="section-kicker">End-To-End Readiness</div>
        <h3>${prettyLabel(workflow.status)}</h3>
        <p>${escapeHtml(workflow.summary)}</p>
      </div>
      <div class="workflow-readiness-flags">
        <span class="sentiment-badge ${workflow.can_use_for_decisions ? "bullish" : "bearish"}">${workflow.can_use_for_decisions ? "Decision Ready" : "Decision Blocked"}</span>
        <span class="sentiment-badge ${workflow.can_preview_orders ? "bullish" : "neutral"}">${workflow.can_preview_orders ? "Preview Ready" : "Preview Limited"}</span>
        <span class="sentiment-badge ${workflow.can_submit_orders ? "bullish" : "neutral"}">${workflow.can_submit_orders ? "Paper Submit Ready" : "Submit Gated"}</span>
      </div>
    </div>
    <div class="workflow-step-grid">
      ${steps
        .map(
          (step) => `
            <div class="workflow-step-card ${workflowStatusClass(step.status)}">
              <span>${prettyLabel(step.status)}</span>
              <strong>${escapeHtml(step.label)}</strong>
              <p>${escapeHtml(step.summary)}</p>
            </div>
          `
        )
        .join("")}
    </div>
    <div class="workflow-live-data-grid">
      <div class="workflow-data-card">
        <span>Fresh Decision Evidence</span>
        <strong>${liveData.fresh_decision_evidence_count || 0}</strong>
        <small>Max age ${liveData.freshness_max_hours || 72}h. Seed decisions: ${liveData.seed_data_in_decisions ? "on" : "off"}. Live pricing: ${liveData.live_pricing_ready ? "ready" : "not confirmed"}.</small>
      </div>
      <div class="workflow-data-card">
        <span>Alert / Watch / Context</span>
        <strong>${liveData.display_tiers?.alert || 0} / ${liveData.display_tiers?.watch || 0} / ${liveData.display_tiers?.context || 0}</strong>
        <small>Only fresh alert/watch evidence can make the workflow decision-ready.</small>
      </div>
      <div class="workflow-data-card wide">
        <span>Live Sources</span>
        <div class="workflow-source-list">
          ${sources
            .map(
              (source) => `
                <span title="${escapeHtml(source.last_error || source.label)}">
                  ${escapeHtml(source.label)}: ${prettyLabel(source.status)}${source.age_hours !== null && source.age_hours !== undefined ? `, ${formatNumber(source.age_hours, 1)}h old` : ""}
                </span>
              `
            )
            .join("")}
        </div>
      </div>
    </div>
    ${
      blockers.length || warnings.length || actions.length
        ? `<div class="workflow-action-grid">
            ${
              blockers.length
                ? `<div class="workflow-action-card bearish"><strong>Blockers</strong><ul>${blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`
                : ""
            }
            ${
              warnings.length
                ? `<div class="workflow-action-card neutral"><strong>Warnings</strong><ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`
                : ""
            }
            <div class="workflow-action-card bullish"><strong>Next Actions</strong><ul>${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
          </div>`
        : ""
    }
    <div class="workflow-control-card">
      <div>
        <strong>One-Shot Live Refresh</strong>
        <p>Use these when the workflow says fresh evidence, pricing, or SEC coverage is missing. They do not enable permanent background polling.</p>
        ${state.runtimeActionState ? `<small>${escapeHtml(state.runtimeActionState)}</small>` : ""}
      </div>
      <div class="workflow-control-actions">
        ${runtimeActionButton("poll_once", "live_news", "Poll News", "newspaper")}
        ${runtimeActionButton("poll_once", "earnings_calendar", "Poll Earnings", "event")}
        ${runtimeActionButton("poll_once", "stocktwits_stream", "Poll Social", "forum")}
        ${runtimeActionButton("poll_once", "trade_prints", "Poll Prints", "receipt_long")}
        ${runtimeActionButton("poll_once", "sec_form4", "Poll Form 4", "badge")}
        ${runtimeActionButton("poll_once", "market_flow", "Poll Flow", "monitoring")}
        ${runtimeActionButton("poll_once", "fundamental_market_data", "Refresh Pricing", "database")}
        ${runtimeActionButton("poll_once", "sec_fundamentals", "SEC Batch", "account_balance")}
      </div>
    </div>
  `;
}

function renderTradingView() {
  const payload = state.tradeSetups || { counts: {}, setups: [] };
  const setups = payload.setups || [];
  const counts = payload.counts || {};
  const execution = state.executionStatus || {};
  const broker = execution.broker || state.positionMonitor?.broker || {};
  const risk = state.riskSnapshot || {};
  const monitor = state.positionMonitor || {};
  const tradableSetups = setups.filter((setup) => ["long", "short"].includes(setup.action));
  const watchSetups = setups.filter((setup) => setup.action === "watch");
  const blockedSetups = setups.filter((setup) => !["long", "short", "watch"].includes(setup.action));
  const brokerReady = broker.ready_for_order_submission;

  if (elements.tradingPlanSummary) {
    elements.tradingPlanSummary.innerHTML = `
      <div class="workspace-stat-card"><span>Buy Candidates</span><strong>${counts.long || tradableSetups.filter((setup) => setup.action === "long").length}</strong></div>
      <div class="workspace-stat-card"><span>Short / Sell</span><strong>${counts.short || tradableSetups.filter((setup) => setup.action === "short").length}</strong></div>
      <div class="workspace-stat-card"><span>Watch</span><strong>${counts.watch || watchSetups.length}</strong></div>
      <div class="workspace-stat-card"><span>Blocked / No Trade</span><strong>${blockedSetups.length}</strong></div>
      <div class="workspace-stat-card"><span>Broker</span><strong>${brokerReady ? "Paper Ready" : prettyLabel(broker.blocked_reason || broker.status || "guarded")}</strong></div>
      <div class="workspace-stat-card"><span>Risk</span><strong>${prettyLabel(risk.status || monitor.risk_status || "unknown")}</strong></div>
      <div class="workspace-stat-card"><span>Positions</span><strong>${monitor.position_count ?? 0}</strong></div>
      <div class="workspace-stat-card"><span>Open Orders</span><strong>${monitor.open_order_count ?? 0}</strong></div>
    `;
  }

  if (elements.tradingWorkflowStatus) {
    elements.tradingWorkflowStatus.innerHTML = renderTradingWorkflowStatus();
  }

  if (elements.tradingPlanLists) {
    elements.tradingPlanLists.innerHTML = renderTradeLists(setups, { includePreview: true });
    attachTradeListActions(elements.tradingPlanLists, setups);
  }

  if (elements.tradingExecutionConsole) {
    elements.tradingExecutionConsole.innerHTML = renderExecutionConsolePanel();
  }
}

function renderSystemView() {
  const pulse = state.snapshot?.market_pulse || {};
  const runtimeReliability = state.runtimeReliability || state.health?.runtime_reliability || null;
  const runtimePressure = runtimeReliability?.pressure || null;
  const collectorPlan = runtimeReliability?.collector_plan || {};
  const runtimeActions = runtimeReliability?.available_actions || [];
  const runtimeProfiles = runtimeReliability?.runtime_profiles || {};
  const recommendedProfile = runtimeProfiles.profiles?.find((profile) => profile.key === runtimeProfiles.recommended) || null;
  const secQueue = state.secQueue;
  const screenerOverview = state.snapshot?.screener_overview || {};
  const fullUniverse = screenerOverview.full_universe || {};
  const allUniverse = screenerOverview.all_universe || fullUniverse || {};
  const totalUniverse = secQueue?.tracked_companies || allUniverse.tracked || fullUniverse.tracked || state.health?.fundamental_companies_scored || 0;
  const liveNews = state.health?.live_sources?.google_news_rss || null;
  const marketData = state.health?.live_sources?.market_data || null;
  const marketFlow = state.health?.live_sources?.market_flow || null;
  const earningsCalendar = state.health?.live_sources?.yahoo_earnings_calendar || null;
  const stocktwits = state.health?.live_sources?.stocktwits_stream || null;
  const tradePrintsProvider = state.config?.trade_prints_provider || "polygon";
  const tradePrints = state.health?.live_sources?.[`${tradePrintsProvider}_trade_prints`] || null;
  const secFundamentals = state.health?.live_sources?.sec_fundamentals || null;
  const secForm4 = state.health?.live_sources?.sec_form4 || null;
  const sec13f = state.health?.live_sources?.sec_13f || null;
  const lightweightState = state.health?.live_sources?.lightweight_state || null;
  const evidenceQuality = state.health?.evidence_quality || null;
  const backup = state.health?.database_backup || state.config?.database_backup || null;
  const secLiveCount = secQueue?.live_sec_companies ?? secFundamentals?.live_companies ?? screenerOverview.fundamental_sec_live ?? 0;
  const pendingBootstrap = secQueue?.pending_bootstrap_companies ?? secFundamentals?.pending_bootstrap_companies ?? screenerOverview.bootstrap ?? 0;
  const secProgress = secQueue?.coverage_ratio !== undefined
    ? Math.round(secQueue.coverage_ratio * 100)
    : totalUniverse
      ? Math.round((secLiveCount / totalUniverse) * 100)
      : 0;
  const persistenceMode = state.config?.database_enabled
    ? `${state.config.database_provider || "database"} persistent`
    : state.config?.lightweight_state_enabled
      ? "Lightweight JSON"
      : "Disabled";
  const persistenceNote = state.config?.database_enabled
    ? "Database persistence is active. Runtime data survives restart through the configured database backend."
    : state.config?.lightweight_state_enabled
      ? "Lightweight JSON state is active. It preserves the compact dashboard state without heavy SQLite writes."
      : "Persistence is disabled. Runtime data will reset on service restart.";

  elements.systemOverview.innerHTML = `
    <div class="workspace-stat-card"><span>Status</span><strong>${elements.healthStatus.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Queue Depth</span><strong>${elements.healthQueue.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Latency</span><strong>${elements.healthLatency.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Market Regime</span><strong>${pulse.sentiment_regime || "neutral"}</strong></div>
    <div class="workspace-stat-card"><span>Persistence</span><strong>${persistenceMode}</strong></div>
    <div class="workspace-stat-card"><span>State Target</span><strong>${backup?.last_backup_path || state.config?.lightweight_state_path || state.config?.database_target || "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>Last State Save</span><strong>${backup?.last_backup_at ? relativeTime(backup.last_backup_at) : "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>SEC Live Coverage</span><strong>${secLiveCount}/${totalUniverse || 0}</strong></div>
    <div class="workspace-stat-card"><span>SEC Progress</span><strong>${secProgress}%</strong></div>
    <div class="workspace-stat-card"><span>Bootstrap Pending</span><strong>${pendingBootstrap}</strong></div>
    <div class="workspace-stat-card"><span>Evidence Items</span><strong>${evidenceQuality?.total_evidence_items || 0}</strong></div>
    <div class="workspace-stat-card"><span>Avg Evidence Weight</span><strong>${evidenceQuality ? formatNumber(evidenceQuality.average_downstream_weight, 2) : "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>Runtime Reliability</span><strong>${prettyLabel(runtimeReliability?.status || "unknown")}</strong></div>
    <div class="workspace-stat-card"><span>Runtime Pressure</span><strong>${runtimePressure?.isConstrained ? "Constrained" : "Normal"}</strong></div>
    <div class="workspace-stat-card"><span>Node RSS</span><strong>${runtimePressure?.process?.rss_mb ? `${runtimePressure.process.rss_mb} MB` : "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>Load/Core</span><strong>${runtimePressure?.system?.load_per_core_1m ?? "n/a"}</strong></div>
  `;

  const reliabilitySources = runtimeReliability?.sources || [];
  elements.systemSourceQuality.innerHTML = reliabilitySources.length
    ? reliabilitySources
        .map(
          (source) => `
            <div class="source-card runtime-source-card ${sourceStatusClass(source.status)}">
              <div class="runtime-source-head">
                <strong>${source.label}</strong>
                <span class="sentiment-badge ${sourceStatusClass(source.status)}">${prettyLabel(source.status)}</span>
              </div>
              <span>${sourceStatusMeaning(source.status)}</span>
              <span>${source.reason}</span>
              <span>${source.notes}</span>
              <small>Action: ${prettyLabel(source.action)} - Last success: ${source.last_success_at ? relativeTime(source.last_success_at) : "n/a"}</small>
            </div>
          `
        )
        .join("")
    : state.snapshot.source_quality.length
      ? state.snapshot.source_quality
          .map(
            (source) => `
              <div class="source-card">
                <strong>${source.source_name}</strong>
                <span>Volume ${source.rolling_volume_1d}</span>
                <span>Confidence ${formatNumber(source.rolling_avg_confidence)}</span>
                <span>Lag ${formatNumber(source.avg_lag_seconds, 0)}s</span>
              </div>
            `
          )
          .join("")
      : `<div class="workspace-empty">No source telemetry available.</div>`;

  elements.systemNotes.innerHTML = `
    ${renderExecutionConsolePanel()}
    <div class="runtime-action-panel runtime-console">
      <div class="section-kicker">Runtime Control Console</div>
      <h3>Safe one-shot operations</h3>
      <p class="workspace-copy">Use this panel to advance live coverage without turning on heavy background loops. On the Pi, this is the control room: one batch, observe pressure, save state.</p>
      ${renderSecQueuePanel(secQueue)}
      <div class="runtime-control-grid">
        ${runtimeActionCard({
          title: "SEC fundamentals batch",
          body: "Refresh the next slice of companies from SEC submissions and Company Facts.",
          metric: `${secLiveCount}/${totalUniverse || 0}`,
          submetric: `${pendingBootstrap} names still bootstrap. Next batch size: ${secQueue?.next_batch_size || secFundamentals?.refresh_batch_size || state.config?.fundamental_sec_max_companies_per_poll || 8}.`,
          action: "poll_once",
          source: "sec_fundamentals",
          label: "Poll SEC Batch",
          icon: "request_quote",
          progress: secProgress,
          emphasis: true
        })}
        ${runtimeActionCard({
          title: "Earnings calendar",
          body: "Refresh upcoming earnings dates used by trade setup risk flags.",
          metric: earningsCalendar?.last_success_at ? relativeTime(earningsCalendar.last_success_at) : "Pending",
          submetric: "Runs against Yahoo Finance calendar events.",
          action: "poll_once",
          source: "earnings_calendar",
          label: "Poll Earnings",
          icon: "event"
        })}
        ${runtimeActionCard({
          title: "Save lightweight state",
          body: "Write the compact JSON snapshot so current runtime data survives restart.",
          metric: backup?.last_backup_at ? relativeTime(backup.last_backup_at) : "Not saved",
          submetric: lightweightState?.last_success_at ? `Runtime source saved ${relativeTime(lightweightState.last_success_at)}.` : "Best after every manual SEC batch while SQLite is off.",
          action: "save_lightweight_state",
          source: "lightweight_state",
          label: "Save State",
          icon: "save"
        })}
        ${runtimeActionCard({
          title: "Market flow scan",
          body: "Run one abnormal volume and flow pass without starting the timer.",
          metric: marketFlow?.last_success_at ? relativeTime(marketFlow.last_success_at) : "Manual",
          submetric: "Use after market-data freshness is acceptable.",
          action: "poll_once",
          source: "market_flow",
          label: "Scan Flow",
          icon: "monitoring"
        })}
        ${runtimeActionCard({
          title: "Social pulse",
          body: "Run one StockTwits tagged-sentiment pass for strong crowd skew.",
          metric: stocktwits?.last_success_at ? relativeTime(stocktwits.last_success_at) : "Manual",
          submetric: "Disabled by default; useful as confirming evidence when enabled.",
          action: "poll_once",
          source: "stocktwits_stream",
          label: "Poll Social",
          icon: "forum"
        })}
        ${runtimeActionCard({
          title: "Trade prints",
          body: "Fetch delayed block prints from the configured provider.",
          metric: tradePrints?.last_success_at ? relativeTime(tradePrints.last_success_at) : "Manual",
          submetric: `${prettyLabel(tradePrintsProvider)} provider. Requires provider credentials when enabled.`,
          action: "poll_once",
          source: "trade_prints",
          label: "Poll Prints",
          icon: "receipt_long"
        })}
        ${runtimeActionCard({
          title: "SEC 13F scan",
          body: "Slow institutional-flow check. Useful for context, not intraday urgency.",
          metric: sec13f?.last_success_at ? relativeTime(sec13f.last_success_at) : "Manual",
          submetric: "Keep occasional on the Pi; this is deliberately not autostarted.",
          action: "poll_once",
          source: "sec_13f",
          label: "Poll 13F",
          icon: "account_balance"
        })}
      </div>
      ${
        state.runtimeActionState
          ? `<div class="runtime-action-result">${state.runtimeActionState === "running" ? "Running selected runtime action..." : state.runtimeActionState}</div>`
          : ""
      }
    </div>
    <div class="workspace-detail-grid">
      <div class="workspace-stat-card"><span>Runtime</span><strong>Local MVP</strong></div>
      <div class="workspace-stat-card"><span>Streaming</span><strong>SSE</strong></div>
      <div class="workspace-stat-card"><span>Persistence</span><strong>${persistenceMode}</strong></div>
      <div class="workspace-stat-card"><span>State Path</span><strong>${backup?.last_backup_path || state.config?.lightweight_state_path || "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Snapshot Count</span><strong>${backup?.backup_count ?? 0}</strong></div>
      <div class="workspace-stat-card"><span>State Size</span><strong>${backup?.last_backup_size_bytes ? `${formatNumber(backup.last_backup_size_bytes / 1024, 0)} KB` : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Price Adapter</span><strong>${state.config?.market_data_provider || "synthetic"}</strong></div>
      <div class="workspace-stat-card"><span>Scorer</span><strong>Hybrid Mock</strong></div>
      <div class="workspace-stat-card"><span>Live News</span><strong>${state.config?.live_news_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Last Poll</span><strong>${liveNews?.last_success_at ? formatTime(liveNews.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Market Data</span><strong>${marketData?.fallback_mode ? "Fallback" : "Live"}</strong></div>
      <div class="workspace-stat-card"><span>Market Refresh</span><strong>${marketData?.last_success_at ? formatTime(marketData.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Market Flow</span><strong>${state.config?.market_flow_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Flow Poll</span><strong>${marketFlow?.last_success_at ? formatTime(marketFlow.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Earnings</span><strong>${state.config?.earnings_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Earnings Poll</span><strong>${earningsCalendar?.last_success_at ? formatTime(earningsCalendar.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>StockTwits</span><strong>${state.config?.stocktwits_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Social Poll</span><strong>${stocktwits?.last_success_at ? formatTime(stocktwits.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Trade Prints</span><strong>${state.config?.trade_prints_enabled ? prettyLabel(tradePrintsProvider) : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Prints Poll</span><strong>${tradePrints?.last_success_at ? formatTime(tradePrints.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>SEC Form 4</span><strong>${state.config?.sec_form4_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Insider Poll</span><strong>${secForm4?.last_success_at ? formatTime(secForm4.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>SEC 13F</span><strong>${state.config?.sec_13f_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Institutional Poll</span><strong>${sec13f?.last_success_at ? formatTime(sec13f.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>SEC Fundamentals</span><strong>${state.config?.fundamental_sec_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>SEC Batch</span><strong>${secFundamentals?.refresh_batch_size || state.config?.fundamental_sec_max_companies_per_poll || 0}</strong></div>
      <div class="workspace-stat-card"><span>Safe Autostart</span><strong>${collectorPlan.safe_to_autostart?.length ?? 0}</strong></div>
      <div class="workspace-stat-card"><span>Keep Manual</span><strong>${collectorPlan.keep_manual?.length ?? 0}</strong></div>
      <div class="workspace-stat-card"><span>Investigate</span><strong>${collectorPlan.investigate?.length ?? 0}</strong></div>
      <div class="workspace-stat-card"><span>Disabled</span><strong>${collectorPlan.disabled?.length ?? 0}</strong></div>
      <div class="workspace-stat-card"><span>Current Profile</span><strong>${runtimeProfiles.current ? prettyLabel(runtimeProfiles.current) : "Custom"}</strong></div>
      <div class="workspace-stat-card"><span>Recommended</span><strong>${recommendedProfile?.label || "n/a"}</strong></div>
    </div>
    ${
      collectorPlan.recommendations?.length
        ? `<ul class="workspace-list">${collectorPlan.recommendations.map((item) => `<li>${item}</li>`).join("")}</ul>`
        : ""
    }
    <div class="runtime-action-panel">
      <div class="section-kicker">Runtime Actions</div>
      <p class="workspace-copy">Complete action list. These are still one-shot operations; they do not enable permanent background polling.</p>
      <div class="runtime-action-grid">
        ${runtimeActions
          .map(
            (item) => `
              <button
                type="button"
                class="panel-action runtime-action-button"
                data-runtime-action="${item.action}"
                data-runtime-source="${item.source || ""}"
                ${!item.enabled || state.runtimeActionState === "running" ? "disabled" : ""}
                title="${item.disabled_reason || item.description}"
              >
                <span class="material-symbols-outlined">${item.safe ? "bolt" : "warning"}</span>
                ${item.label}
              </button>
            `
          )
          .join("")}
      </div>
      ${
        state.runtimeActionState
          ? `<p class="workspace-copy">${state.runtimeActionState === "running" ? "Running selected runtime action..." : state.runtimeActionState}</p>`
          : ""
      }
    </div>
    ${
      runtimeProfiles.profiles?.length
        ? `<div class="runtime-action-panel">
            <div class="section-kicker">Runtime Profiles</div>
            <p class="workspace-copy">Preview exact .env changes before applying a runtime mode. Applying writes .env; restart the service afterward.</p>
            <div class="runtime-profile-grid">
              ${runtimeProfiles.profiles
                .map(
                  (profile) => `
                    <div class="source-card">
                      <strong>${profile.label}${profile.key === runtimeProfiles.recommended ? " - Recommended" : ""}</strong>
                      <span>${profile.description}</span>
                      <span>${profile.matches_current ? "Matches current config" : `${profile.change_count} change${profile.change_count === 1 ? "" : "s"}`}</span>
                      <button type="button" class="panel-action runtime-action-button" data-runtime-action="apply_profile" data-runtime-profile="${profile.key}">
                        Preview
                      </button>
                    </div>
                  `
                )
                .join("")}
            </div>
          </div>`
        : ""
    }
    <ul class="workspace-list">
      <li>News sentiment source: Google News RSS with Yahoo Finance RSS fallback, scored through the same normalization and sentiment pipeline as other live events.</li>
      <li>Event and social sources: earnings calendar risk checks and StockTwits crowd-skew evidence when enabled.</li>
      <li>Money-flow sources: inferred tape anomalies from live market bars, delayed trade prints, SEC Form 4 insider filings, and SEC 13F institutional holdings changes.</li>
      <li>The sentiment watchlist is sentiment-first. Fundamentals enrich those rows, but the full fundamentals universe lives in the Fundamentals dashboard and the Trade Setup Agent.</li>
      <li>The Trade Setup Agent is the true combined decision layer: it blends sentiment, fundamentals, macro regime, recent documents, and alerts.</li>
      <li>${persistenceNote}</li>
      ${backup?.last_error ? `<li>Latest backup warning: ${backup.last_error}</li>` : ""}
    </ul>
  `;
}

function renderOverviewView() {
  const pulse = state.snapshot.market_pulse;
  renderGauge(pulse);
  renderSectorStrip();
  renderLeaderboard();
  renderTradeSetups();
  renderFeed();
  renderDetail();
}

function renderActiveView() {
  if (!state.snapshot) {
    return;
  }

  if (state.activeView === "overview") {
    renderOverviewView();
  } else if (state.activeView === "markets") {
    renderMarketsView();
  } else if (state.activeView === "watch") {
    renderWatchView();
  } else if (state.activeView === "alerts") {
    renderAlertsView();
  } else if (state.activeView === "trading") {
    renderTradingView();
  } else if (state.activeView === "system") {
    renderSystemView();
  }
}

function render() {
  renderActiveView();
  renderSignalDrawer();
  elements.alertCount.textContent = state.alerts.length;
  renderScreenFilterTabLabels();
  updateFilterButtons(elements.fundamentalFilterTabs, "screenFilter", state.screenFilter);
}

async function handleExecutionConsoleClick(event) {
  const focusButton = event.target.closest("[data-focus-ticker]");
  if (focusButton) {
    await focusTicker(focusButton.dataset.focusTicker, "overview");
    return true;
  }

  const previewButton = event.target.closest("[data-preview-execution]");
  if (previewButton) {
    await previewTradeExecution(previewButton.dataset.previewExecution);
    return true;
  }

  const submitButton = event.target.closest("[data-submit-paper]");
  if (submitButton && !submitButton.disabled) {
    await submitPaperTrade(submitButton.dataset.submitPaper);
    return true;
  }

  return false;
}

function updateWindowButtons() {
  for (const button of elements.windowTabs.querySelectorAll(".time-chip")) {
    button.classList.toggle("active", button.dataset.window === state.activeWindow);
  }
}

function updateFilterButtons(container, key, value) {
  if (!container) {
    return;
  }
  for (const button of container.querySelectorAll(".time-chip")) {
    button.classList.toggle("active", button.dataset[key] === value);
  }
}

function renderScreenFilterTabLabels() {
  if (!elements.fundamentalFilterTabs) {
    return;
  }
  const overview = state.snapshot?.screener_overview || {};
  const fullUniverse = overview.full_universe || {};
  const allUniverse = overview.all_universe || overview.visible_universe || {};
  const labels = {
    all: `All Rows (${allUniverse.tracked || fullUniverse.tracked || 0})`,
    eligible: `Eligible (${allUniverse.eligible || fullUniverse.eligible || 0})`,
    watch: `Watch (${allUniverse.watch || fullUniverse.watch || 0})`,
    reject: `Reject (${allUniverse.reject || fullUniverse.reject || 0})`
  };

  for (const button of elements.fundamentalFilterTabs.querySelectorAll("[data-screen-filter]")) {
    button.textContent = labels[button.dataset.screenFilter] || button.textContent;
  }
}

function setActiveView(view) {
  state.activeView = view;
  for (const panel of elements.viewPanels) {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  }
  for (const button of [...elements.topNavButtons, ...elements.sideNavButtons, ...elements.mobileNavButtons]) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  if (state.snapshot) {
    if (viewNeedsTickerDetail(view) && state.selectedTicker && state.tickerDetail?.ticker !== state.selectedTicker) {
      ensureTickerDetail().then(render).catch(console.error);
      return;
    }
    render();
  }
}

async function runRuntimeAction(action, source) {
  state.runtimeActionState = "running";
  state.runtimeActionResult = null;
  render();

  try {
    const response = await fetch("/api/runtime-reliability/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, source })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Runtime action failed");
    }

    state.runtimeReliability = payload.runtime_reliability || state.runtimeReliability;
    state.health = payload.health || state.health;
    state.runtimeActionResult = payload.result || null;
    state.runtimeActionState = runtimeActionSummary(action, payload.result || {});
    await loadHealth();
    await loadSnapshot();
  } catch (error) {
    state.runtimeActionResult = null;
    state.runtimeActionState = error.message;
    render();
  }
}

async function runRuntimeProfilePreview(profile) {
  state.runtimeActionState = "running";
  state.runtimeActionResult = null;
  renderSystemView();

  try {
    const response = await fetch("/api/runtime-reliability/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply_profile", profile, apply: false })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Runtime profile preview failed");
    }

    state.runtimeReliability = payload.runtime_reliability || state.runtimeReliability;
    state.health = payload.health || state.health;
    const updateCount = Object.keys(payload.result?.env_updates || {}).length;
    state.runtimeActionState = `${prettyLabel(profile)} profile preview ready: ${updateCount} .env values. Use the API with apply=true when you are ready to write it.`;
    renderSystemView();
  } catch (error) {
    state.runtimeActionState = error.message;
    renderSystemView();
  }
}

function attachEvents() {
  elements.windowTabs.addEventListener("click", async (event) => {
    const button = event.target.closest(".time-chip");
    if (!button) {
      return;
    }

    state.activeWindow = button.dataset.window;
    updateWindowButtons();
    await loadSnapshot();
  });

  elements.searchInput.addEventListener("input", () => {
    state.searchTerm = elements.searchInput.value.trim();
    render();
  });

  elements.fundamentalFilterTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-screen-filter]");
    if (!button) {
      return;
    }
    state.screenFilter = button.dataset.screenFilter;
    updateFilterButtons(elements.fundamentalFilterTabs, "screenFilter", state.screenFilter);
    render();
  });

  elements.marketsFilterTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-market-filter]");
    if (!button) {
      return;
    }
    state.marketFilter = button.dataset.marketFilter;
    updateFilterButtons(elements.marketsFilterTabs, "marketFilter", state.marketFilter);
    renderMarketsView();
  });

  elements.alertsFilterTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-alert-filter]");
    if (!button) {
      return;
    }
    state.alertFilter = button.dataset.alertFilter;
    updateFilterButtons(elements.alertsFilterTabs, "alertFilter", state.alertFilter);
    renderAlertsView();
  });

  for (const button of [...elements.topNavButtons, ...elements.sideNavButtons, ...elements.mobileNavButtons]) {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view);
    });
  }

  elements.topEntityGraph?.addEventListener("click", () => setActiveView("markets"));
  elements.topSensors?.addEventListener("click", () => setActiveView("alerts"));
  elements.topNotifications?.addEventListener("click", () => setActiveView("alerts"));
  elements.topProfile?.addEventListener("click", () => setActiveView("system"));
  elements.sideTerminal?.addEventListener("click", () => setActiveView("system"));
  elements.sideHelp?.addEventListener("click", () => {
    openSignalDrawer(buildHelpSignal());
  });

  elements.systemNotes?.addEventListener("click", async (event) => {
    if (await handleExecutionConsoleClick(event)) {
      return;
    }

    const button = event.target.closest("[data-runtime-action]");
    if (!button || button.disabled) {
      return;
    }

    if (button.dataset.runtimeAction === "apply_profile") {
      await runRuntimeProfilePreview(button.dataset.runtimeProfile);
      return;
    }

    await runRuntimeAction(button.dataset.runtimeAction, button.dataset.runtimeSource || null);
  });

  elements.tradingExecutionConsole?.addEventListener("click", async (event) => {
    await handleExecutionConsoleClick(event);
  });

  elements.tradingPlanLists?.addEventListener("click", async (event) => {
    await handleExecutionConsoleClick(event);
  });

  elements.tradingWorkflowStatus?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-runtime-action]");
    if (!button || button.disabled) {
      return;
    }

    await runRuntimeAction(button.dataset.runtimeAction, button.dataset.runtimeSource || null);
  });

  elements.signalBackdrop?.addEventListener("click", closeSignalDrawer);
  elements.signalDrawerClose?.addEventListener("click", closeSignalDrawer);
  elements.signalFocusButton?.addEventListener("click", async () => {
    if (!state.selectedSignal?.ticker) {
      return;
    }
    await focusTicker(state.selectedSignal.ticker, "overview");
  });
  elements.signalSourceButton?.addEventListener("click", () => {
    if (state.selectedSignal?.url) {
      window.open(state.selectedSignal.url, "_blank", "noopener");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selectedSignal) {
      closeSignalDrawer();
    }
  });

  async function triggerReplay() {
    const refreshActions = ["live_news", "sec_form4", "market_flow"].map((source) =>
      postJson("/api/runtime-reliability/actions", {
        action: "poll_once",
        source
      })
    );
    await Promise.allSettled(refreshActions);
    await performRefresh();
  }

  elements.replayButton.addEventListener("click", triggerReplay);
  elements.mobileFab.addEventListener("click", triggerReplay);
}

function startEventStream() {
  const stream = new EventSource("/api/stream");
  const refresh = () => scheduleRefresh(120);

  stream.addEventListener("snapshot", refresh);
  stream.addEventListener("document_scored", refresh);
  stream.addEventListener("ticker_update", refresh);
  stream.addEventListener("alert", refresh);
  stream.addEventListener("market_tick", refresh);
}

async function init() {
  attachEvents();
  await loadConfig();
  await loadHealth();
  await loadSnapshot();
  setActiveView(state.activeView);
  updateFilterButtons(elements.marketsFilterTabs, "marketFilter", state.marketFilter);
  updateFilterButtons(elements.alertsFilterTabs, "alertFilter", state.alertFilter);
  startEventStream();
}

init().catch((error) => {
  console.error(error);
});
