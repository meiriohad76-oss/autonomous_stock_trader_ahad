const WINDOWS = ["15m", "1h", "4h", "1d", "7d"];
const TICKER_META = {
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
const SMART_MONEY_ALERT_TYPES = new Set([
  "smart_money_accumulation",
  "smart_money_distribution",
  "smart_money_stacking_positive",
  "smart_money_stacking_negative"
]);
const MARKET_FLOW_FIELD_META = {
  marketFlowVolumeSpikeThreshold: { label: "Volume Spike", step: "0.1", help: "Minimum share-volume multiple versus recent baseline." },
  marketFlowVolumeZScoreThreshold: { label: "Volume Z", step: "0.1", help: "Standard-deviation threshold for unusual share volume." },
  marketFlowDollarVolumeZScoreThreshold: { label: "Dollar Z", step: "0.1", help: "Standard-deviation threshold for unusual dollar turnover." },
  marketFlowMinPriceMoveThreshold: { label: "Min Price Move", step: "0.001", help: "Minimum bar-to-bar move before directional flow matters." },
  marketFlowBlockTradeSpikeThreshold: { label: "Block Spike", step: "0.1", help: "Volume or dollar-volume multiple needed for block-style classification." },
  marketFlowBlockTradeShockThreshold: { label: "Shock Multiple", step: "0.1", help: "Move shock versus recent move baseline." },
  marketFlowPersistenceBars: { label: "Persistence", step: "1", help: "Consecutive directional bars needed before classifying block-style flow." },
  marketFlowCloseLocationThreshold: { label: "Close Bias", step: "0.01", help: "How close the bar must finish to its high or low for block-style confirmation." },
  marketFlowBlockTradeMinShares: { label: "Block Min Shares", step: "1000", help: "Minimum shares in the latest bar before a block signal is allowed." },
  marketFlowBlockTradeMinNotionalUsd: { label: "Block Min USD", step: "100000", help: "Minimum estimated notional turnover for block-style flow." },
  marketFlowAbnormalVolumeMinNotionalUsd: { label: "Abnormal Min USD", step: "100000", help: "Minimum estimated notional turnover for abnormal-volume flow." }
};

const state = {
  config: null,
  health: null,
  snapshot: null,
  moneyFlowSnapshot: null,
  selectedMoneyFlowTicker: null,
  moneyFlowTickerDetail: null,
  selectedTicker: null,
  tickerDetail: null,
  liveFeed: [],
  alerts: [],
  highImpact: [],
  activeWindow: "1h",
  searchTerm: "",
  activeView: "overview",
  marketFilter: "all",
  alertFilter: "all",
  marketFlowSettings: {},
  marketFlowSaveState: "",
  selectedSignal: null,
  selectedSector: null,
  macroRegime: null,
  tradeSetups: [],
  setupFilter: "all",
  setupProvisionalOnly: false,
  selectedSetup: null,
  executionState: null,
  pendingApproval: null,
  approvalCountdownTimer: null,
  positions: [],
  orders: [],
  executionLog: []
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
  marketPulseScore: document.querySelector("#market-pulse-score"),
  marketRegime: document.querySelector("#market-regime"),
  marketVolume: document.querySelector("#market-volume"),
  marketImpact: document.querySelector("#market-impact"),
  pulseGaugeFill: document.querySelector("#pulse-gauge-fill"),
  sectorStrip: document.querySelector("#sector-strip"),
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
  systemOverview: document.querySelector("#system-overview"),
  systemSourceQuality: document.querySelector("#system-source-quality"),
  systemNotes: document.querySelector("#system-notes"),
  replayButton: document.querySelector("#replay-button"),
  engineProgressBar: document.querySelector("#engine-progress-bar"),
  windowTabs: document.querySelector("#window-tabs"),
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
  macroRegimeBar: document.querySelector("#macro-regime-bar"),
  macroRegimeBadge: document.querySelector("#macro-regime-badge"),
  macroRegimeBreadth: document.querySelector("#macro-regime-breadth"),
  macroRegimeConfidence: document.querySelector("#macro-regime-confidence"),
  macroRegimeStaleness: document.querySelector("#macro-regime-staleness"),
  macroRegimeUpdated: document.querySelector("#macro-regime-updated"),
  setupsSummary: document.querySelector("#setups-summary"),
  setupsList: document.querySelector("#setups-list"),
  setupsEmpty: document.querySelector("#setups-empty"),
  setupDrawer: document.querySelector("#setup-drawer"),
  setupDrawerClose: document.querySelector("#setup-drawer-close"),
  setupDrawerContent: document.querySelector("#setup-drawer-content"),
  setupFilterBtns: [...document.querySelectorAll(".setup-filter-btn")],
  setupsProvisionalToggle: document.querySelector("#setups-provisional-toggle")
};

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

function prettyLabel(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function signalTimestamp(item) {
  return item?.timestamp || item?.published_at || null;
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

function tickerMeta(ticker) {
  return TICKER_META[ticker] || { company: ticker || "Unknown", sector: "Other" };
}

function tickerSector(ticker) {
  return tickerMeta(ticker).sector;
}

function tickerCompany(ticker) {
  return tickerMeta(ticker).company;
}

function buildSignalFromFeed(item, sourceLabel = "Live Feed") {
  return {
    ticker: item.ticker || null,
    title: `${item.ticker || "MKT"}: ${prettyLabel(item.event_type)}`,
    subtitle: sourceLabel,
    label: item.label || sentimentLabel(item.sentiment_score || 0),
    confidence: item.confidence || 0,
    timestamp: item.timestamp || null,
    sourceName: item.source_name || sourceLabel,
    headline: item.headline || "Untitled signal",
    explanation: item.explanation_short || item.headline || "No additional analyst explanation is available for this signal yet.",
    eventType: item.event_type || "signal",
    url: item.url || null,
    sourceMetadata: item.source_metadata || null
  };
}

function buildSignalFromAlert(alert) {
  const label =
    alert.alert_type === "high_confidence_negative" ||
    alert.alert_type === "smart_money_distribution" ||
    alert.alert_type === "smart_money_stacking_negative"
      ? "Bearish"
      : alert.alert_type === "high_confidence_positive" ||
          alert.alert_type === "smart_money_accumulation" ||
          alert.alert_type === "smart_money_stacking_positive"
        ? "Bullish"
        : "Neutral";

  return {
    ticker: alert.entity_key || null,
    title: `${alert.entity_key || "MKT"}: ${prettyLabel(alert.alert_type)}`,
    subtitle: "Alert Trigger",
    label,
    confidence: alert.confidence || 0,
    timestamp: alert.detected_at || alert.created_at || null,
    sourceName: "Sentiment Engine",
    headline: alert.headline || "State-based alert trigger",
    explanation:
      alert.headline ||
      "This alert was generated from the current state transition and confidence threshold in the sentiment engine.",
    eventType: alert.alert_type || "alert",
    url: null,
    sourceMetadata: null
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
    sourceMetadata: doc.source_metadata || null
  };
}

function moneyFlowEvidence(item) {
  const meta = item?.source_metadata || {};

  if (TAPE_FLOW_EVENT_TYPES.has(item?.event_type)) {
    const evidence = [];
    if (meta.volume_spike) {
      evidence.push(`${formatNumber(meta.volume_spike, 1)}x volume`);
    }
    if (meta.volume_zscore) {
      evidence.push(`${formatNumber(meta.volume_zscore, 1)}z shares`);
    }
    if (meta.dollar_volume_zscore) {
      evidence.push(`${formatNumber(meta.dollar_volume_zscore, 1)}z dollars`);
    }
    if (meta.latest_dollar_volume_usd) {
      evidence.push(formatUsdCompact(meta.latest_dollar_volume_usd));
    }
    if (meta.latest_move !== undefined && meta.latest_move !== null) {
      evidence.push(`${formatSignedPercent(meta.latest_move)} move`);
    }
    if (meta.persistence_bars) {
      evidence.push(`${meta.persistence_bars} bar follow-through`);
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
                return `
                  <button type="button" class="money-flow-card ${badgeClass(item.label)}" data-money-flow-index="${sourceLabel}:${index}">
                    <div class="money-flow-card-head">
                      <div>
                        <strong>${item.ticker || "MKT"}: ${prettyLabel(item.event_type)}</strong>
                      </div>
                      <span>${relativeTime(signalTimestamp(item))}</span>
                    </div>
                    <p>${item.headline}</p>
                    <div class="feed-meta">
                      <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
                      <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
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
  const readOnly = !state.config?.dashboard_mutations_enabled;
  const saveLabel =
    readOnly
      ? "Read Only"
      : state.marketFlowSaveState === "saving"
      ? "Saving..."
      : state.marketFlowSaveState === "saved"
        ? "Saved"
        : "Save Thresholds";

  return `
    <section class="money-flow-controls">
      <div class="money-flow-controls-head">
        <div>
          <div class="section-kicker">Radar Controls</div>
          <p>${readOnly ? "This deployment is read only. Threshold edits are disabled." : "Tune how the engine separates abnormal volume from stronger block-style flow."}</p>
        </div>
        <button type="button" class="panel-action" id="market-flow-save-button" ${(state.marketFlowSaveState === "saving" || readOnly) ? "disabled" : ""}>${saveLabel}</button>
      </div>
      <div class="money-flow-controls-grid">
        ${Object.entries(MARKET_FLOW_FIELD_META)
          .map(
            ([key, meta]) => `
              <label class="money-flow-control">
                <span>${meta.label}</span>
                <input type="number" data-market-flow-setting="${key}" step="${meta.step}" value="${state.marketFlowSettings[key] ?? ""}" ${readOnly ? "disabled" : ""}>
                <small>${meta.help}</small>
              </label>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMoneyFlowTimeline(snapshot) {
  const timeline = snapshot?.timeline || [];

  if (!timeline.length) {
    return `<div class="workspace-empty">No money-flow timeline has accumulated in the current lookback.</div>`;
  }

  const maxCount = Math.max(...timeline.map((point) => point.total), 1);

  return `
    <div class="money-flow-timeline">
      ${timeline
        .map((point) => {
          const height = Math.max(14, Math.round((point.total / maxCount) * 100));
          return `
            <div class="money-flow-timeline-bar" title="${relativeTime(point.timestamp)} | ${point.total} signals">
              <span class="money-flow-timeline-stack">
                <span class="money-flow-timeline-segment bullish" style="height:${Math.max(6, Math.round((point.bullish / Math.max(1, point.total)) * height))}px"></span>
                <span class="money-flow-timeline-segment bearish" style="height:${Math.max(6, Math.round((point.bearish / Math.max(1, point.total)) * height))}px"></span>
              </span>
              <small>${new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMoneyFlowTickerList(snapshot) {
  const rows = snapshot?.top_tickers || [];

  if (!rows.length) {
    return `<div class="workspace-empty">No concentrated money-flow names yet.</div>`;
  }

  return `
    <div class="money-flow-ticker-list">
      ${rows
        .map(
          (row) => `
            <button type="button" class="money-flow-ticker-row" data-money-flow-ticker="${row.ticker}">
              <div>
                <strong>${row.ticker}</strong>
                <span>${row.buckets.join(" / ")}</span>
              </div>
              <div>
                <strong>${row.count}</strong>
                <span>${formatUsdCompact(row.notional_usd || 0)}</span>
              </div>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMoneyFlowFocus(detail) {
  if (!detail) {
    return `<div class="workspace-empty">Choose a concentrated money-flow ticker to inspect its flow stack.</div>`;
  }

  const alertMarkup = detail.recent_alerts?.length
    ? detail.recent_alerts
        .map(
          (alert) => `
            <button type="button" class="workspace-list-button money-flow-briefing-item" data-money-flow-alert="${alert.alert_id}">
              <strong>${prettyLabel(alert.alert_type)}</strong>
              <span>${relativeTime(alert.created_at)}</span>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No dedicated smart-money alerts for this ticker yet.</div>`;

  const signalMarkup = detail.recent_signals?.length
    ? detail.recent_signals
        .slice(0, 5)
        .map(
          (signal, index) => `
            <button type="button" class="workspace-list-button money-flow-briefing-item" data-money-flow-signal="${index}">
              <strong>${prettyLabel(signal.event_type)}</strong>
              <span>${relativeTime(signal.timestamp || signal.published_at)}</span>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No recent flow signals for this ticker.</div>`;

  return `
    <section class="money-flow-briefing">
      <div class="money-flow-briefing-head">
        <div>
          <h3>${detail.ticker} Flow Focus</h3>
          <p>${detail.company} · ${detail.sector} · dominant ${detail.dominant_bucket} flow</p>
        </div>
        <button type="button" class="panel-action" data-money-flow-focus-overview="${detail.ticker}">Open Ticker</button>
      </div>
      <div class="workspace-detail-grid">
        <div class="workspace-stat-card"><span>Total Flow</span><strong>${detail.summary.total}</strong></div>
        <div class="workspace-stat-card"><span>Bullish</span><strong>${detail.summary.bullish}</strong></div>
        <div class="workspace-stat-card"><span>Bearish</span><strong>${detail.summary.bearish}</strong></div>
        <div class="workspace-stat-card"><span>Estimated Notional</span><strong>${formatUsdCompact(detail.summary.estimated_notional_usd)}</strong></div>
      </div>
      <div class="summary-list-wrap money-flow-focus-grid">
        <section class="summary-list">
          <div class="section-kicker">Recent Flow Alerts</div>
          <div class="money-flow-briefing-list">${alertMarkup}</div>
        </section>
        <section class="summary-list">
          <div class="section-kicker">Recent Flow Signals</div>
          <div class="money-flow-briefing-list">${signalMarkup}</div>
        </section>
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

function applyAlertFilter(alerts) {
  if (state.alertFilter === "all") {
    return alerts;
  }
  if (state.alertFilter === "money_flow") {
    return alerts.filter((alert) => SMART_MONEY_ALERT_TYPES.has(alert.alert_type));
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

async function loadConfig() {
  state.config = await getJson("/api/config");
  state.activeWindow = state.config.default_window || "1h";
  state.marketFlowSettings = { ...(state.config.market_flow_settings || {}) };
  elements.universeName.textContent = state.config.universe_name;
  elements.replayButton.hidden = !state.config.dashboard_mutations_enabled;
  elements.mobileFab.hidden = !state.config.dashboard_mutations_enabled;
  updateWindowButtons();
}

async function loadHealth() {
  const health = await getJson("/api/health");
  state.health = health;
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
  const rows = state.snapshot?.leaderboard || [];
  if (!state.searchTerm) {
    return rows;
  }
  return rows.filter((row) => row.entity_key.toLowerCase().includes(state.searchTerm.toLowerCase()));
}

async function loadSnapshot() {
  const params = new URLSearchParams({ window: state.activeWindow });
  state.snapshot = await getJson(`/api/sentiment/watchlist?${params.toString()}`);
  state.liveFeed = await getJson("/api/news/recent?limit=12");
  state.highImpact = await getJson("/api/events/high-impact?limit=10");
  state.moneyFlowSnapshot = await getJson("/api/money-flow?hours=72&limit=120");
  state.alerts = state.snapshot.alerts;

  const currentRows = filteredLeaderboard();
  if ((!state.selectedTicker || !currentRows.some((row) => row.entity_key === state.selectedTicker)) && currentRows.length) {
    state.selectedTicker = currentRows[0].entity_key;
  }

  if (state.selectedTicker) {
    state.tickerDetail = await getJson(`/api/sentiment/ticker/${state.selectedTicker}`);
  }

  const moneyFlowTickers = state.moneyFlowSnapshot?.top_tickers || [];
  if (
    (!state.selectedMoneyFlowTicker || !moneyFlowTickers.some((row) => row.ticker === state.selectedMoneyFlowTicker)) &&
    moneyFlowTickers.length
  ) {
    state.selectedMoneyFlowTicker = moneyFlowTickers[0].ticker;
  }
  if (state.selectedMoneyFlowTicker) {
    try {
      state.moneyFlowTickerDetail = await getJson(`/api/money-flow/ticker/${state.selectedMoneyFlowTicker}?hours=168&limit=60`);
    } catch {
      state.moneyFlowTickerDetail = null;
    }
  }

  render();
}

async function focusTicker(ticker, view = null) {
  if (!ticker) {
    return;
  }

  state.selectedTicker = ticker;
  state.tickerDetail = await getJson(`/api/sentiment/ticker/${ticker}`);
  if (view) {
    setActiveView(view);
  }
  render();
}

async function focusMoneyFlowTicker(ticker) {
  if (!ticker) {
    return;
  }

  state.selectedMoneyFlowTicker = ticker;
  state.moneyFlowTickerDetail = await getJson(`/api/money-flow/ticker/${ticker}?hours=168&limit=60`);
  renderAlertsView();
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
      const rows = filteredLeaderboard().filter((row) => tickerSector(row.entity_key) === sector.entity_key);
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

  if (!rows.length) {
    elements.leaderboardBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="4">No tickers match the current search.</td>
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
          <span>${row.unique_story_count} stories</span>
        </div>
      </td>
      <td>
        <span class="sentiment-badge ${labelStyle}">${label}</span>
      </td>
      <td>
        <span class="momentum ${labelStyle}">${formatSignedPercent(row.momentum_delta)}</span>
      </td>
      <td class="conf-cell">${formatNumber(row.weighted_confidence * 100, 1)}%</td>
    `;
    tr.addEventListener("click", async () => {
      state.selectedTicker = row.entity_key;
      state.tickerDetail = await getJson(`/api/sentiment/ticker/${row.entity_key}`);
      render();
    });
    elements.leaderboardBody.appendChild(tr);
  }
}

function renderFeed() {
  const feedItems = state.searchTerm
    ? state.liveFeed.filter((item) => (item.ticker || "").toLowerCase().includes(state.searchTerm.toLowerCase()))
    : state.liveFeed;

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
        <strong>${item.ticker || "MKT"}: ${item.event_type.replace(/_/g, " ")}</strong>
        <span>${relativeTime(item.timestamp)}</span>
      </div>
      <p>${item.headline}</p>
      <div class="feed-meta">
        <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
        <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
      </div>
    `;
    article.addEventListener("click", () => {
      openSignalDrawer(buildSignalFromFeed(item));
    });
    elements.liveFeedList.appendChild(article);
  });
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
        ? `<text x="${x}" y="252" class="chart-label">${label}</text>`
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

  elements.tickerDetailTitle.textContent = `${detail.ticker} Detail Analysis`;
  elements.tickerDetailSubtitle.textContent = `${detail.market_snapshot.current_price.toFixed(2)} current price · ${formatSignedPercent(detail.market_snapshot.percent_change)} over ${detail.market_snapshot.baseline_window}`;
  renderDetailChart(detail);

  const windowCards = WINDOWS.map((windowKey) => {
    const item = detail.windows[windowKey];
    return `
      <div class="window-card">
        <span>${windowKey.toUpperCase()}</span>
        <strong>${formatNumber(item.weighted_sentiment)}</strong>
        <small>${formatNumber(item.confidence * 100, 0)}% conf</small>
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
            `<li><button type="button" class="workspace-list-button" data-detail-doc="${index}">${prettyLabel(item.event_type)} - ${formatNumber(item.confidence * 100, 0)}% - ${item.headline}</button></li>`
        )
        .join("")
    : "<li>No events yet.</li>";

  elements.detailFamilyBreakdown.innerHTML = detail.event_family_breakdown.length
    ? detail.event_family_breakdown.map((item) => `<li>${item.name} · ${item.value}</li>`).join("")
    : "<li>No family mix yet.</li>";

  elements.detailSourceBreakdown.innerHTML = detail.source_distribution.length
    ? detail.source_distribution.map((item) => `<li>${item.name} · ${item.value}</li>`).join("")
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
  const sectors = state.snapshot?.sectors || [];
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
    ? allRows.filter((row) => tickerSector(row.entity_key) === state.selectedSector)
    : allRows;
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
    <div class="workspace-stat-card"><span>${activeSector ? "Sector Tickers" : "Filtered Tickers"}</span><strong>${rows.length}</strong></div>
  `;

  renderMarketsSectorChart(filteredSectors);

  elements.marketsSectorGrid.innerHTML = sectors.length
    ? filteredSectors
        .map(
          (sector) => `
            <button type="button" class="workspace-card sentiment-surface ${sentimentClass(sector.sentiment_regime)} ${state.selectedSector === sector.entity_key ? "selected" : ""}" data-sector="${sector.entity_key}">
              <span>${sector.entity_key}</span>
              <strong>${formatNumber(sector.weighted_sentiment)}</strong>
              <small>${formatNumber(sector.weighted_confidence * 100, 0)}% conf</small>
              <div class="mini-bar-track"><div class="mini-bar-fill ${sentimentClass(sector.sentiment_regime)}" style="width:${Math.max(10, Math.round(Math.abs(sector.weighted_sentiment) * 100))}%"></div></div>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No sector data available.</div>`;

  const sectorMembers = activeSector
    ? (state.snapshot?.leaderboard || []).filter((row) => tickerSector(row.entity_key) === activeSector.entity_key)
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
              <p>${prettyLabel(activeSector.sentiment_regime)} flow with ${formatNumber(activeSector.weighted_confidence * 100, 0)}% conviction across ${sectorMembers.length} tracked names.</p>
            </div>
            <button type="button" class="panel-action" data-clear-sector>Clear</button>
          </div>
          <div class="workspace-detail-grid">
            <div class="workspace-stat-card"><span>Weighted Sentiment</span><strong>${formatNumber(activeSector.weighted_sentiment)}</strong></div>
            <div class="workspace-stat-card"><span>Sector Confidence</span><strong>${formatNumber(activeSector.weighted_confidence * 100, 0)}%</strong></div>
            <div class="workspace-stat-card"><span>Top Constituent</span><strong>${sectorMembers[0]?.entity_key || "n/a"}</strong></div>
            <div class="workspace-stat-card"><span>Live Flow</span><strong>${sectorFeed.length}</strong></div>
          </div>
          <ul class="workspace-list inline-list">
            ${sectorMembers.length
              ? sectorMembers
                  .slice(0, 6)
                  .map(
                    (row) =>
                      `<li><button type="button" class="workspace-list-button" data-sector-ticker="${row.entity_key}">${row.entity_key} - ${tickerCompany(row.entity_key)} - ${formatSignedPercent(row.momentum_delta)}</button></li>`
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
          Select a sector from the chart or cards to pivot the market table and inspect its constituent names.
        </div>
      `;

  const comparisonRows = (() => {
    const selected = rows.find((row) => row.entity_key === state.selectedTicker);
    const others = rows.filter((row) => row.entity_key !== state.selectedTicker).slice(0, selected ? 3 : 4);
    return selected ? [selected, ...others] : others;
  })();

  elements.marketsComparisonStrip.innerHTML = comparisonRows.length
    ? comparisonRows
        .map(
          (row) => `
            <button type="button" class="workspace-card comparison-card ${state.selectedTicker === row.entity_key ? "selected" : ""}" data-compare-ticker="${row.entity_key}">
              <span>${row.entity_key}</span>
              <strong>${formatNumber(row.weighted_sentiment)}</strong>
              <small>${formatSignedPercent(row.momentum_delta)} momentum</small>
              <div class="mini-bar-track"><div class="mini-bar-fill ${sentimentClass(row.sentiment_regime)}" style="width:${Math.max(10, Math.round(row.weighted_confidence * 100))}%"></div></div>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No comparison tickers available.</div>`;

  elements.marketsTableBody.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr data-ticker="${row.entity_key}">
              <td>
                <div class="stock-cell">
                  <strong>${row.entity_key}</strong>
                  <span>${row.top_event_types[0] || "mixed flow"}</span>
                </div>
              </td>
              <td><span class="sentiment-badge ${badgeClass(sentimentLabel(row.weighted_sentiment))}">${sentimentLabel(row.weighted_sentiment)}</span></td>
              <td>${formatNumber(row.weighted_confidence * 100, 1)}%</td>
              <td>${formatNumber(row.story_velocity, 2)}/h</td>
            </tr>
          `
        )
        .join("")
    : `<tr class="empty-row"><td colspan="4">No market rows available.</td></tr>`;

  elements.marketsDetail.innerHTML = state.tickerDetail
    ? `
        <div class="workspace-detail-grid">
          <div class="workspace-stat-card"><span>Ticker</span><strong>${state.tickerDetail.ticker}</strong></div>
          <div class="workspace-stat-card"><span>Sector</span><strong>${tickerSector(state.tickerDetail.ticker)}</strong></div>
          <div class="workspace-stat-card"><span>Price</span><strong>${formatNumber(state.tickerDetail.market_snapshot.current_price)}</strong></div>
          <div class="workspace-stat-card"><span>Regime</span><strong>${state.tickerDetail.regime}</strong></div>
          <div class="workspace-stat-card"><span>Risk Flags</span><strong>${state.tickerDetail.risk_flags.length || 0}</strong></div>
        </div>
        <ul class="workspace-list">
          ${state.tickerDetail.recent_documents
            .slice(0, 5)
            .map(
              (item, index) =>
                `<li><button type="button" class="workspace-list-button" data-market-doc="${index}">${prettyLabel(item.event_type)} - ${formatNumber(item.confidence * 100, 0)}% - ${item.headline}</button></li>`
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
      const sectorRows = allRows.filter((row) => tickerSector(row.entity_key) === state.selectedSector);
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
      const sectorRows = allRows.filter((row) => tickerSector(row.entity_key) === state.selectedSector);
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

  const width = 760;
  const height = 220;
  const chartBottom = 176;
  const barWidth = Math.min(92, Math.max(44, Math.floor(width / Math.max(1, sectors.length * 1.6))));
  const gap = (width - sectors.length * barWidth) / Math.max(1, sectors.length + 1);
  const zeroLine = 102;
  const grid = [36, 69, 102, 135, 168]
    .map((y) => `<line x1="0" y1="${y}" x2="${width}" y2="${y}" class="chart-grid"></line>`)
    .join("");

  const bars = sectors
    .map((sector, index) => {
      const x = gap + index * (barWidth + gap);
      const amplitude = Math.max(-1, Math.min(1, sector.weighted_sentiment || 0));
      const barHeight = Math.abs(amplitude) * 74;
      const isPositive = amplitude >= 0;
      const y = isPositive ? zeroLine - barHeight : zeroLine;
      const fillClass = `bar-${sentimentClass(sector.sentiment_regime)}`;
      const labelY = chartBottom + 18;
      return `
        <g class="sector-bar-group ${state.selectedSector === sector.entity_key ? "is-selected" : ""}" data-sector="${sector.entity_key}">
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${Math.max(10, barHeight).toFixed(1)}" rx="10" class="sector-bar ${fillClass}"></rect>
          <text x="${(x + barWidth / 2).toFixed(1)}" y="${isPositive ? y - 8 : y + Math.max(18, barHeight + 18)}" class="chart-value">${formatNumber(sector.weighted_sentiment)}</text>
          <text x="${(x + barWidth / 2).toFixed(1)}" y="${labelY}" class="chart-label">${sector.entity_key}</text>
        </g>
      `;
    })
    .join("");

  elements.marketsSectorChart.innerHTML = `
    ${grid}
    <line x1="0" y1="${zeroLine}" x2="${width}" y2="${zeroLine}" class="chart-axis"></line>
    ${bars}
  `;
}

function renderWatchView() {
  const rows = filteredLeaderboard().slice(0, 6);
  elements.watchCards.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <button type="button" class="watch-card ${state.selectedTicker === row.entity_key ? "selected" : ""}" data-watch-ticker="${row.entity_key}">
              <div class="watch-card-head">
                <strong>${row.entity_key}</strong>
                <span class="sentiment-badge ${badgeClass(sentimentLabel(row.weighted_sentiment))}">${sentimentLabel(row.weighted_sentiment)}</span>
              </div>
              <p>${row.top_event_types[0] || "mixed flow"}</p>
              <div class="watch-card-meta">
                <span>${formatNumber(row.weighted_confidence * 100, 0)}% conf</span>
                <span>${formatSignedPercent(row.momentum_delta)}</span>
              </div>
            </button>
          `
        )
        .join("")
    : `<div class="workspace-empty">No watchlist items match the current search.</div>`;

  const watchFeedItems = state.liveFeed.filter((item) => rows.some((row) => row.entity_key === item.ticker)).slice(0, 8);
  elements.watchFeed.innerHTML = watchFeedItems.length
    ? watchFeedItems
        .map(
          (item) => `
            <article class="feed-card ${badgeClass(item.label)}" data-watch-feed="${item.ticker || ""}">
              <div class="feed-row">
                <strong>${item.ticker || "MKT"}: ${item.event_type.replace(/_/g, " ")}</strong>
                <span>${relativeTime(item.timestamp)}</span>
              </div>
              <p>${item.explanation_short}</p>
              <div class="feed-meta">
                <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
                <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="workspace-empty">No watchlist feed items available.</div>`;

  elements.watchSummary.innerHTML = state.tickerDetail
    ? `
        <div class="workspace-detail-grid">
          <div class="workspace-stat-card"><span>Selected</span><strong>${state.tickerDetail.ticker}</strong></div>
          <div class="workspace-stat-card"><span>Current Price</span><strong>${formatNumber(state.tickerDetail.market_snapshot.current_price)}</strong></div>
          <div class="workspace-stat-card"><span>Trend</span><strong>${formatSignedPercent(state.tickerDetail.market_snapshot.percent_change)}</strong></div>
          <div class="workspace-stat-card"><span>Top Source</span><strong>${state.tickerDetail.source_distribution[0]?.name || "n/a"}</strong></div>
        </div>
        <ul class="workspace-list">
          ${state.tickerDetail.recent_documents
            .slice(0, 6)
            .map(
              (item, index) =>
                `<li><button type="button" class="workspace-list-button" data-watch-doc="${index}">${relativeTime(item.published_at)} - ${item.headline}</button></li>`
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
  const moneyFlowAlertCount = state.alerts.filter((alert) => SMART_MONEY_ALERT_TYPES.has(alert.alert_type)).length;
  const fallbackSignals = collectMoneyFlowSignals();
  const fallbackGroups = moneyFlowGroups(fallbackSignals);
  const moneyFlowSnapshot = state.moneyFlowSnapshot || null;
  const groupedMoneyFlow = moneyFlowSnapshot?.groups || fallbackGroups;
  const moneyFlowSignals = [...groupedMoneyFlow.insider, ...groupedMoneyFlow.institutional, ...groupedMoneyFlow.tape];
  const insiderCount = moneyFlowSnapshot?.summary?.insider ?? groupedMoneyFlow.insider.length;
  const institutionalCount = moneyFlowSnapshot?.summary?.institutional ?? groupedMoneyFlow.institutional.length;
  const tapeFlowCount = moneyFlowSnapshot?.summary?.tape ?? groupedMoneyFlow.tape.length;
  const blockCount = moneyFlowSnapshot?.summary?.block ?? moneyFlowSignals.filter((item) => item.event_type?.startsWith("block_trade")).length;
  const abnormalCount =
    moneyFlowSnapshot?.summary?.abnormal ?? moneyFlowSignals.filter((item) => item.event_type?.startsWith("abnormal_volume")).length;

  elements.alertsSummaryStrip.innerHTML = `
    <div class="workspace-stat-card"><span>Positive</span><strong>${positiveCount}</strong></div>
    <div class="workspace-stat-card"><span>Negative</span><strong>${negativeCount}</strong></div>
    <div class="workspace-stat-card"><span>Reversal</span><strong>${reversalCount}</strong></div>
    <div class="workspace-stat-card"><span>Money Flow</span><strong>${moneyFlowAlertCount}</strong></div>
  `;

  elements.alertsCritical.innerHTML = filteredAlerts.length
    ? filteredAlerts
        .map(
          (alert, index) => `
            <article class="workspace-alert ${alert.alert_type}" data-alert-index="${index}">
              <div class="workspace-alert-head">
                <strong>${alert.alert_type.replace(/_/g, " ")}</strong>
                <span>${alert.entity_key}</span>
              </div>
              <p>${alert.headline || "State-based alert trigger"}</p>
              <small>${formatNumber(alert.confidence * 100, 0)}% confidence</small>
              <div class="mini-bar-track"><div class="mini-bar-fill ${alert.alert_type.includes("negative") ? "bearish" : "bullish"}" style="width:${Math.max(10, Math.round(alert.confidence * 100))}%"></div></div>
            </article>
          `
        )
        .join("")
    : `<div class="workspace-empty">No active alerts at this time.</div>`;

  elements.alertsHighImpact.innerHTML = state.highImpact.length
    ? state.highImpact
        .map(
          (item, index) => `
            <article class="feed-card ${badgeClass(item.label)}" data-high-impact-index="${index}">
              <div class="feed-row">
                <strong>${item.ticker || "MKT"}: ${item.event_type.replace(/_/g, " ")}</strong>
                <span>${relativeTime(item.timestamp)}</span>
              </div>
              <p>${item.headline}</p>
              <div class="feed-meta">
                <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
                <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
              </div>
            </article>
          `
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
      <div class="workspace-detail-grid">
        <div class="workspace-stat-card"><span>Insider</span><strong>${insiderCount}</strong></div>
        <div class="workspace-stat-card"><span>Institutional</span><strong>${institutionalCount}</strong></div>
        <div class="workspace-stat-card"><span>Tape Flow</span><strong>${tapeFlowCount}</strong></div>
        <div class="workspace-stat-card"><span>Block Signals</span><strong>${blockCount}</strong></div>
        <div class="workspace-stat-card"><span>Abnormal Volume</span><strong>${abnormalCount}</strong></div>
        <div class="workspace-stat-card"><span>Filtered Alerts</span><strong>${filteredAlerts.length}</strong></div>
      </div>
      <div class="summary-list-wrap money-flow-summary-grid">
        <section class="summary-list">
          <div class="section-kicker">Flow Timeline</div>
          ${renderMoneyFlowTimeline(moneyFlowSnapshot)}
        </section>
        <section class="summary-list">
          <div class="section-kicker">Concentrated Names</div>
          ${renderMoneyFlowTickerList(moneyFlowSnapshot)}
        </section>
        <section class="summary-list">
          <div class="section-kicker">Tape Diagnostics</div>
          <ul class="workspace-list">
            <li>Peak volume spike: ${formatNumber(moneyFlowSnapshot?.diagnostics?.tape?.maxVolumeSpike || 0, 1)}x</li>
            <li>Peak dollar spike: ${formatNumber(moneyFlowSnapshot?.diagnostics?.tape?.maxDollarSpike || 0, 1)}x</li>
            <li>Peak volume z-score: ${formatNumber(moneyFlowSnapshot?.diagnostics?.tape?.maxVolumeZScore || 0, 1)}</li>
            <li>Peak dollar z-score: ${formatNumber(moneyFlowSnapshot?.diagnostics?.tape?.maxDollarVolumeZScore || 0, 1)}</li>
            <li>Peak move shock: ${formatNumber(moneyFlowSnapshot?.diagnostics?.tape?.maxMoveShock || 0, 1)}x</li>
            <li>Max persistence: ${formatNumber(moneyFlowSnapshot?.diagnostics?.tape?.maxPersistenceBars || 0, 0)} bars</li>
          </ul>
        </section>
      </div>
      ${renderMoneyFlowFocus(state.moneyFlowTickerDetail)}
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
      await focusMoneyFlowTicker(button.dataset.moneyFlowTicker);
    });
  }

  for (const button of elements.alertsMoneyFlow.querySelectorAll("[data-money-flow-focus-overview]")) {
    button.addEventListener("click", async () => {
      await focusTicker(button.dataset.moneyFlowFocusOverview, "overview");
    });
  }

  for (const button of elements.alertsMoneyFlow.querySelectorAll("[data-money-flow-alert]")) {
    button.addEventListener("click", () => {
      const alert = state.moneyFlowTickerDetail?.recent_alerts?.find((entry) => entry.alert_id === button.dataset.moneyFlowAlert);
      if (alert) {
        openSignalDrawer(buildSignalFromAlert(alert));
      }
    });
  }

  for (const button of elements.alertsMoneyFlow.querySelectorAll("[data-money-flow-signal]")) {
    button.addEventListener("click", () => {
      const signal = state.moneyFlowTickerDetail?.recent_signals?.[Number(button.dataset.moneyFlowSignal)];
      if (signal) {
        openSignalDrawer(buildSignalFromFeed(signal, "Money Flow Focus"));
      }
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
    return;
  }

  elements.signalDrawerTitle.textContent = signal.title;
  elements.signalDrawerSubtitle.textContent = signal.subtitle;
  elements.signalDrawerBadge.textContent = signal.label;
  elements.signalDrawerBadge.className = `sentiment-badge ${badgeClass(signal.label)}`;
  elements.signalDrawerTime.textContent = relativeTime(signal.timestamp);
  elements.signalDrawerSummary.textContent = signal.headline;
  elements.signalDrawerStats.innerHTML = `
    <div class="workspace-stat-card"><span>Ticker</span><strong>${signal.ticker || "Market"}</strong></div>
    <div class="workspace-stat-card"><span>Event Type</span><strong>${prettyLabel(signal.eventType)}</strong></div>
    <div class="workspace-stat-card"><span>Confidence</span><strong>${formatNumber(signal.confidence * 100, 0)}%</strong></div>
    <div class="workspace-stat-card"><span>Source</span><strong>${signal.sourceName || signal.subtitle}</strong></div>
  `;
  elements.signalDrawerExplanation.textContent = signal.explanation;
  elements.signalDrawerContext.innerHTML = [
    signal.timestamp ? `<li>Observed ${relativeTime(signal.timestamp)} at ${formatTime(signal.timestamp)}.</li>` : null,
    signal.sourceName ? `<li>Source: ${signal.sourceName}.</li>` : null,
    signal.ticker ? `<li>Related ticker: ${signal.ticker}.</li>` : "<li>This signal is market-level rather than ticker-specific.</li>",
    `<li>Current classification: ${signal.label.toLowerCase()}.</li>`,
    signal.sourceMetadata?.volume_spike ? `<li>Tape signature: ${formatNumber(signal.sourceMetadata.volume_spike, 1)}x normal volume.</li>` : null,
    signal.sourceMetadata?.volume_zscore ? `<li>Volume z-score: ${formatNumber(signal.sourceMetadata.volume_zscore, 1)}.</li>` : null,
    signal.sourceMetadata?.dollar_volume_zscore ? `<li>Dollar-volume z-score: ${formatNumber(signal.sourceMetadata.dollar_volume_zscore, 1)}.</li>` : null,
    signal.sourceMetadata?.latest_dollar_volume_usd ? `<li>Estimated live notional: ${formatUsdCompact(signal.sourceMetadata.latest_dollar_volume_usd)}.</li>` : null,
    signal.sourceMetadata?.persistence_bars ? `<li>Directional persistence: ${signal.sourceMetadata.persistence_bars} bars.</li>` : null,
    signal.sourceMetadata?.filer_name ? `<li>Institutional filer: ${signal.sourceMetadata.filer_name}.</li>` : null,
    signal.sourceMetadata?.position_delta_shares ? `<li>Reported position change: ${formatCompactNumber(Math.abs(signal.sourceMetadata.position_delta_shares))} shares.</li>` : null,
    signal.sourceMetadata?.insider_owner ? `<li>Reported insider: ${signal.sourceMetadata.insider_owner}${signal.sourceMetadata.insider_role ? ` (${prettyLabel(signal.sourceMetadata.insider_role)})` : ""}.</li>` : null,
    signal.sourceMetadata?.transaction_value_usd ? `<li>Reported insider notional: ${formatUsdCompact(Math.abs(signal.sourceMetadata.transaction_value_usd))}.</li>` : null
  ]
    .filter(Boolean)
    .join("");
  elements.signalFocusButton.disabled = !signal.ticker;
  elements.signalSourceButton.disabled = !signal.url;
}

function renderSystemView() {
  const pulse = state.snapshot?.market_pulse || {};
  const liveNews = state.health?.live_sources?.google_news_rss || null;
  const marketData = state.health?.live_sources?.market_data || null;
  const marketFlow = state.health?.live_sources?.market_flow || null;
  const secForm4 = state.health?.live_sources?.sec_form4 || null;
  const sec13f = state.health?.live_sources?.sec_13f || null;
  elements.systemOverview.innerHTML = `
    <div class="workspace-stat-card"><span>Status</span><strong>${elements.healthStatus.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Queue Depth</span><strong>${elements.healthQueue.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Latency</span><strong>${elements.healthLatency.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Market Regime</span><strong>${pulse.sentiment_regime || "neutral"}</strong></div>
    <div class="workspace-stat-card"><span>Database</span><strong>${state.config?.database_provider || "sqlite"}</strong></div>
    <div class="workspace-stat-card"><span>DB Target</span><strong>${state.config?.database_target || "local file"}</strong></div>
    <div class="workspace-stat-card"><span>Deploy</span><strong>${state.config?.deployment_target || "local"}</strong></div>
    <div class="workspace-stat-card"><span>Public URL</span><strong>${state.config?.public_base_url || "not set"}</strong></div>
  `;

  elements.systemSourceQuality.innerHTML = state.snapshot.source_quality.length
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
    <div class="workspace-detail-grid">
      <div class="workspace-stat-card"><span>Runtime</span><strong>Local MVP</strong></div>
      <div class="workspace-stat-card"><span>Streaming</span><strong>SSE</strong></div>
      <div class="workspace-stat-card"><span>Database</span><strong>${state.config?.database_provider || "sqlite"}</strong></div>
      <div class="workspace-stat-card"><span>DB Mode</span><strong>${state.config?.database_enabled ? "Persistent" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Tunnel</span><strong>${state.config?.tunnel_provider || "none"}</strong></div>
      <div class="workspace-stat-card"><span>SSE Heartbeat</span><strong>${state.config?.sse_heartbeat_ms ? `${state.config.sse_heartbeat_ms}ms` : "default"}</strong></div>
      <div class="workspace-stat-card"><span>Mutation Mode</span><strong>${state.config?.dashboard_mutations_enabled ? "Enabled" : "Read Only"}</strong></div>
      <div class="workspace-stat-card"><span>Price Adapter</span><strong>${state.config?.market_data_provider || "synthetic"}</strong></div>
      <div class="workspace-stat-card"><span>Scorer</span><strong>Hybrid Mock</strong></div>
      <div class="workspace-stat-card"><span>Live News</span><strong>${state.config?.live_news_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Last Poll</span><strong>${liveNews?.last_success_at ? formatTime(liveNews.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Market Data</span><strong>${marketData?.fallback_mode ? "Fallback" : "Live"}</strong></div>
      <div class="workspace-stat-card"><span>Market Refresh</span><strong>${marketData?.last_success_at ? formatTime(marketData.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Market Flow</span><strong>${state.config?.market_flow_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Flow Poll</span><strong>${marketFlow?.last_success_at ? formatTime(marketFlow.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>SEC Form 4</span><strong>${state.config?.sec_form4_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Insider Poll</span><strong>${secForm4?.last_success_at ? formatTime(secForm4.last_success_at) : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>SEC 13F</span><strong>${state.config?.sec_13f_enabled ? "Enabled" : "Disabled"}</strong></div>
      <div class="workspace-stat-card"><span>Institutional Poll</span><strong>${sec13f?.last_success_at ? formatTime(sec13f.last_success_at) : "n/a"}</strong></div>
    </div>
    <ul class="workspace-list">
      <li>Tabs now route to live app views instead of acting like static mockup controls.</li>
      <li>The detail chart now uses the configured market data provider when available and falls back to synthetic local series when it is not.</li>
      <li>The dashboard state is now persisted in the configured database provider instead of existing only in memory during the current process lifetime.</li>
      <li>The Google News RSS collector now polls in the background and feeds new stories into the same scoring pipeline.</li>
      <li>The market flow monitor now converts abnormal price and volume spikes into fast money-flow events when live market data is available.</li>
      <li>The SEC Form 4 collector now ingests insider transactions from official EDGAR filings for tracked tickers.</li>
      <li>The SEC 13F collector now compares recent institutional holdings filings for tracked managers and watchlist names.</li>
    </ul>
  `;
}

function render() {
  const pulse = state.snapshot.market_pulse;
  renderGauge(pulse);
  renderSectorStrip();
  renderLeaderboard();
  renderFeed();
  renderDetail();
  renderMarketsView();
  renderWatchView();
  renderAlertsView();
  renderSystemView();
  renderSignalDrawer();
  elements.alertCount.textContent = state.alerts.length;
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

function setActiveView(view) {
  state.activeView = view;
  for (const panel of elements.viewPanels) {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  }
  for (const button of [...elements.topNavButtons, ...elements.sideNavButtons, ...elements.mobileNavButtons]) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  if (view === "trading") {
    fetchExecutionData();
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
    if (!state.config?.dashboard_mutations_enabled) {
      return;
    }
    await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval_ms: 220 })
    });
  }

  elements.replayButton.addEventListener("click", triggerReplay);
  elements.mobileFab.addEventListener("click", triggerReplay);

  for (const btn of (elements.setupFilterBtns || [])) {
    btn.addEventListener("click", () => {
      for (const b of elements.setupFilterBtns) b.classList.remove("active");
      btn.classList.add("active");
      state.setupFilter = btn.dataset.filter;
      renderSetups();
    });
  }

  elements.setupsProvisionalToggle?.addEventListener("change", (e) => {
    state.setupProvisionalOnly = e.target.checked;
    renderSetups();
  });

  elements.setupDrawerClose?.addEventListener("click", () => {
    if (elements.setupDrawer) elements.setupDrawer.hidden = true;
    state.selectedSetup = null;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selectedSetup) {
      if (elements.setupDrawer) elements.setupDrawer.hidden = true;
      state.selectedSetup = null;
    }
  });

  document.getElementById("approval-approve-btn")?.addEventListener("click", async () => {
    if (!state.pendingApproval) return;
    const id = state.pendingApproval.approval_id;
    try {
      const res = await fetch(`/api/execution/approve/${encodeURIComponent(id)}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        alert(`Approval failed: ${err.error}`);
      }
    } catch {
      alert("Network error approving trade.");
    }
  });

  document.getElementById("approval-reject-btn")?.addEventListener("click", async () => {
    if (!state.pendingApproval) return;
    const id = state.pendingApproval.approval_id;
    try {
      await fetch(`/api/execution/reject/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_rejected" })
      });
      hideApprovalCard();
    } catch {
      alert("Network error rejecting trade.");
    }
  });

  document.getElementById("exec-kill-btn")?.addEventListener("click", async () => {
    if (!state.executionState) return;
    const newState = !state.executionState.killSwitch;
    const reason = newState ? "manual halt from dashboard" : "";
    try {
      await fetch("/api/execution/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newState, reason })
      });
    } catch {
      alert("Network error toggling kill switch.");
    }
  });

  document.getElementById("sync-execution-btn")?.addEventListener("click", async () => {
    await fetch("/api/execution/sync", { method: "POST" }).catch(() => {});
    await fetchExecutionData();
  });
}

function renderMacroRegimeBar() {
  const r = state.macroRegime;
  if (!r || !elements.macroRegimeBar) return;

  elements.macroRegimeBar.dataset.regime = r.regime;

  const arrow = r.bias === "bullish" ? " ▲" : r.bias === "bearish" ? " ▼" : "";
  elements.macroRegimeBadge.textContent = r.regime.replace("_", "-").toUpperCase() + arrow;

  const total = (r.breadth?.bullish_sectors ?? 0) + (r.breadth?.bearish_sectors ?? 0) + (r.breadth?.neutral_sectors ?? 0);
  elements.macroRegimeBreadth.textContent = total > 0
    ? `${r.breadth.bullish_sectors}/${total} bullish`
    : "";

  elements.macroRegimeConfidence.textContent = `conf ${Math.round((r.confidence ?? 0) * 100)}%`;

  const updatedAt = new Date(r.as_of);
  elements.macroRegimeUpdated.textContent = updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const staleMs = Date.now() - updatedAt.getTime();
  const isStale = staleMs > 30 * 60 * 1000;
  if (elements.macroRegimeStaleness) elements.macroRegimeStaleness.hidden = !isStale;
  elements.macroRegimeBar.classList.toggle("is-stale", isStale);
}

function convictionDots(conviction) {
  const filled = Math.round(conviction * 5);
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="conviction-dot ${i < filled ? "filled" : ""}"></span>`
  ).join("");
}

function evidenceBar(signal) {
  // signal is -1..+1; center is 0
  const pct = Math.abs(signal) * 50; // 0..50% width from center
  const dir = signal >= 0 ? "bullish" : "bearish";
  return `<div class="evidence-bar-track centered"><div class="evidence-bar-fill ${dir}" style="width:${pct}%"></div></div>`;
}

function getFilteredSetups() {
  return state.tradeSetups.filter((s) => {
    if (state.setupFilter !== "all" && s.action !== state.setupFilter) return false;
    if (state.setupProvisionalOnly && !s.provisional) return false;
    return true;
  });
}

function renderSetups() {
  if (!elements.setupsSummary || !elements.setupsList) return;

  const counts = { long: 0, short: 0, watch: 0, no_trade: 0 };
  for (const s of state.tradeSetups) counts[s.action] = (counts[s.action] || 0) + 1;

  elements.setupsSummary.innerHTML = `
    <span class="setup-count long">${counts.long} LONG</span>
    <span class="setup-count short">${counts.short} SHORT</span>
    <span class="setup-count watch">${counts.watch} WATCH</span>
    <span class="setup-count no-trade">${counts.no_trade} NO TRADE</span>
  `;

  const setups = getFilteredSetups();
  if (!setups.length) {
    elements.setupsList.innerHTML = "";
    if (elements.setupsEmpty) elements.setupsEmpty.hidden = false;
    return;
  }

  if (elements.setupsEmpty) elements.setupsEmpty.hidden = true;
  elements.setupsList.innerHTML = setups.map((s) => renderSetupCard(s)).join("");

  elements.setupsList.querySelectorAll(".setup-card").forEach((card) => {
    card.addEventListener("click", () => {
      const ticker = card.dataset.ticker;
      state.selectedSetup = state.tradeSetups.find((s) => s.ticker === ticker) || null;
      renderSetupDrawer();
    });
  });
}

function renderSetupCard(s) {
  const provisional = s.provisional
    ? `<div class="setup-provisional-badge">PROVISIONAL · bootstrap fundamentals</div>`
    : "";

  const flags = s.risk_flags?.length
    ? `<div class="setup-risk-flags">${s.risk_flags.map((f) => `<span class="risk-flag">${f.replace(/_/g, " ")}</span>`).join("")}</div>`
    : "";

  const mfNotional = (s.evidence.money_flow?.net_notional_usd ?? 0) > 0
    ? ` <span class="mf-notional">$${((s.evidence.money_flow.net_notional_usd) / 1e6).toFixed(1)}M</span>`
    : "";

  const fundTag = s.evidence.fundamentals
    ? `<span class="setup-tag">${s.evidence.fundamentals.regime_label?.replace(/_/g, " ") || ""}${s.evidence.fundamentals.valuation_label ? ` / ${s.evidence.fundamentals.valuation_label}` : ""}</span>`
    : "";

  const macroTag = s.macro_regime?.regime && s.macro_regime.regime !== "neutral"
    ? `<span class="setup-tag macro">${s.macro_regime.regime.replace("_", "-")}</span>`
    : "";

  return `
    <div class="setup-card action-${s.action}${s.provisional ? " provisional" : ""}" data-ticker="${s.ticker}" role="button" tabindex="0">
      <div class="setup-card-header">
        <div class="setup-ticker-block">
          <span class="setup-ticker">${s.ticker}</span>
          <span class="setup-timeframe">${s.timeframe}</span>
        </div>
        <div class="setup-action-block">
          <span class="setup-action-badge action-${s.action}">${s.action.replace("_", " ").toUpperCase()}</span>
          <div class="setup-conviction-row">
            <div class="setup-conviction-meter">${convictionDots(s.conviction)}</div>
            <span class="setup-conviction-value">${Math.round(s.conviction * 100)}</span>
          </div>
        </div>
      </div>
      ${provisional}
      ${(fundTag || macroTag) ? `<div class="setup-tags">${fundTag}${macroTag}</div>` : ""}
      <div class="setup-thesis">${s.thesis}</div>
      <div class="setup-evidence-bars">
        <div class="evidence-bar-row">
          <span class="evidence-label">Sentiment</span>
          ${evidenceBar(s.evidence.sentiment.signal)}
          <span class="evidence-value">${s.evidence.sentiment.signal >= 0 ? "+" : ""}${s.evidence.sentiment.signal.toFixed(2)}</span>
        </div>
        <div class="evidence-bar-row">
          <span class="evidence-label">Money Flow</span>
          ${evidenceBar(s.evidence.money_flow.signal)}
          <span class="evidence-value">${s.evidence.money_flow.signal >= 0 ? "+" : ""}${s.evidence.money_flow.signal.toFixed(2)}${mfNotional}</span>
        </div>
        <div class="evidence-bar-row">
          <span class="evidence-label">Fundamentals</span>
          ${s.evidence.fundamentals ? evidenceBar(s.evidence.fundamentals.signal) : `<div class="evidence-bar-track centered provisional"></div>`}
          <span class="evidence-value ${!s.evidence.fundamentals ? "provisional-text" : ""}">${s.evidence.fundamentals ? (s.evidence.fundamentals.signal >= 0 ? "+" : "") + s.evidence.fundamentals.signal.toFixed(2) : "—"}</span>
        </div>
      </div>
      <div class="setup-guidance-row">
        <span class="guidance-label">ENTRY</span><span class="guidance-text">${s.entry_guidance}</span>
      </div>
      <div class="setup-guidance-row">
        <span class="guidance-label">STOP</span><span class="guidance-text">${s.stop_guidance}</span>
      </div>
      <div class="setup-guidance-row">
        <span class="guidance-label">SIZE</span><span class="guidance-text size-${s.position_size_guidance}">${s.position_size_guidance.toUpperCase()}</span>
      </div>
      ${flags}
    </div>
  `;
}

function renderSetupDrawer() {
  const s = state.selectedSetup;
  if (!s || !elements.setupDrawer) return;

  const ev = s.evidence;
  elements.setupDrawerContent.innerHTML = `
    <div class="drawer-header">
      <span class="setup-ticker" style="font-size:20px">${s.ticker}</span>
      <span class="setup-action-badge action-${s.action}">${s.action.replace("_", " ").toUpperCase()}</span>
      ${s.provisional ? `<span class="setup-provisional-badge">PROVISIONAL</span>` : ""}
    </div>
    <div class="drawer-section">
      <div class="drawer-label">CONVICTION</div>
      <div class="drawer-conviction">
        <div class="setup-conviction-meter">${convictionDots(s.conviction)}</div>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#e2e8f0">${Math.round(s.conviction * 100)} / 100</span>
      </div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">THESIS</div>
      <div class="drawer-text">${s.thesis}</div>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">EVIDENCE</div>
      <table class="drawer-evidence-table">
        <tr><td>Sentiment</td>
          <td style="font-family:'IBM Plex Mono',monospace">${ev.sentiment.signal >= 0 ? "+" : ""}${ev.sentiment.signal.toFixed(3)}</td>
          <td>conf ${Math.round(ev.sentiment.confidence * 100)}%</td>
          <td>Δ ${ev.sentiment.momentum_delta >= 0 ? "+" : ""}${ev.sentiment.momentum_delta.toFixed(3)}</td></tr>
        <tr><td>Money Flow</td>
          <td style="font-family:'IBM Plex Mono',monospace">${ev.money_flow.signal >= 0 ? "+" : ""}${ev.money_flow.signal.toFixed(3)}</td>
          <td>${ev.money_flow.event_count} events</td>
          <td>${ev.money_flow.dominant_bucket}</td></tr>
        ${ev.fundamentals
          ? `<tr><td>Fundamentals</td>
               <td style="font-family:'IBM Plex Mono',monospace">${ev.fundamentals.signal >= 0 ? "+" : ""}${ev.fundamentals.signal.toFixed(3)}</td>
               <td>${ev.fundamentals.direction_label}</td>
               <td>${ev.fundamentals.regime_label}</td></tr>`
          : `<tr><td>Fundamentals</td><td colspan="3" style="color:#fb923c">provisional / missing</td></tr>`}
        ${s.macro_regime ? `<tr><td>Macro</td><td>${s.macro_regime.regime}</td><td>${s.macro_regime.bias}</td><td>conf ${Math.round(s.macro_regime.confidence * 100)}%</td></tr>` : ""}
      </table>
    </div>
    <div class="drawer-section">
      <div class="drawer-label">GUIDANCE</div>
      <div class="drawer-guidance"><strong>Entry:</strong> ${s.entry_guidance}</div>
      <div class="drawer-guidance"><strong>Stop:</strong> ${s.stop_guidance}</div>
      <div class="drawer-guidance"><strong>Target:</strong> ${s.target_guidance}</div>
      <div class="drawer-guidance"><strong>Size:</strong> <span class="size-${s.position_size_guidance}">${s.position_size_guidance.toUpperCase()}</span> (conviction ${Math.round(s.conviction * 100)})</div>
    </div>
    ${s.risk_flags?.length ? `
    <div class="drawer-section">
      <div class="drawer-label">RISK FLAGS</div>
      <div class="drawer-flags">${s.risk_flags.map((f) => `<span class="risk-flag">${f.replace(/_/g, " ")}</span>`).join("")}</div>
    </div>` : ""}
  `;

  elements.setupDrawer.hidden = false;
}

async function fetchTradeSetups() {
  try {
    const res = await fetch("/api/trade-setups");
    if (!res.ok) return;
    const data = await res.json();
    state.tradeSetups = data.setups || [];
    if (data.macro_regime) {
      state.macroRegime = data.macro_regime;
      renderMacroRegimeBar();
    }
    renderSetups();
  } catch {
    // silently ignore — SSE will retry
  }
}

function renderExecutionAccountBar(es) {
  if (!es) return;
  const bar = document.getElementById("execution-account-bar");
  const statusEl = document.getElementById("exec-bar-status");
  const equityEl = document.getElementById("exec-bar-equity");
  const pnlEl = document.getElementById("exec-bar-pnl");
  const posEl = document.getElementById("exec-bar-positions");
  const killBtn = document.getElementById("exec-kill-btn");
  if (!bar) return;

  bar.dataset.enabled = es.enabled ? "true" : "false";
  bar.dataset.halted = es.killSwitch ? "true" : "false";

  if (!es.enabled) {
    statusEl.textContent = "DISABLED";
  } else if (es.killSwitch) {
    statusEl.textContent = "HALTED";
  } else {
    statusEl.textContent = "ACTIVE";
  }

  equityEl.textContent = es.accountEquity > 0
    ? `$${es.accountEquity.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "—";

  const pnl = es.dailyPnl || 0;
  pnlEl.textContent = `${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  pnlEl.className = pnl >= 0 ? "bullish" : "bearish";

  posEl.textContent = es.pending_count > 0
    ? `${state.positions?.length || 0} (+${es.pending_count} pending)`
    : String(state.positions?.length || 0);

  if (killBtn) killBtn.dataset.active = es.killSwitch ? "true" : "false";
}

function showApprovalCard(approval) {
  state.pendingApproval = approval;
  const overlay = document.getElementById("approval-overlay");
  if (!overlay) return;

  document.getElementById("approval-action-badge").textContent = approval.action?.toUpperCase() || "—";
  document.getElementById("approval-action-badge").dataset.action = approval.action || "long";
  document.getElementById("approval-ticker").textContent = approval.ticker || "—";
  document.getElementById("approval-thesis").textContent = approval.thesis || "No thesis available.";

  const flagsEl = document.getElementById("approval-risk-flags");
  flagsEl.innerHTML = (approval.risk_flags || []).map((f) =>
    `<span class="risk-flag">${f}</span>`
  ).join("");

  document.getElementById("approval-entry").textContent = approval.entry ? `$${approval.entry.toFixed(2)}` : "—";
  document.getElementById("approval-stop").textContent = approval.stop ? `$${approval.stop.toFixed(2)}` : "—";
  document.getElementById("approval-target").textContent = approval.target ? `$${approval.target.toFixed(2)}` : "—";
  document.getElementById("approval-shares").textContent = `${approval.shares || 0} shares`;
  document.getElementById("approval-dollar").textContent = approval.dollar_size
    ? `$${approval.dollar_size.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "$—";

  const convFill = document.getElementById("approval-conviction-fill");
  const pct = Math.round((approval.conviction || 0) * 100);
  convFill.style.width = `${pct}%`;
  document.getElementById("approval-conviction-label").textContent = `${pct}% conviction`;

  if (state.approvalCountdownTimer) clearInterval(state.approvalCountdownTimer);
  const expiresAt = new Date(approval.expires_at).getTime();
  function updateCountdown() {
    const remaining = Math.max(0, expiresAt - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const el = document.getElementById("approval-countdown");
    if (el) el.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
    if (remaining <= 0) {
      clearInterval(state.approvalCountdownTimer);
      hideApprovalCard();
    }
  }
  updateCountdown();
  state.approvalCountdownTimer = setInterval(updateCountdown, 1000);

  overlay.hidden = false;
}

function hideApprovalCard() {
  const overlay = document.getElementById("approval-overlay");
  if (overlay) overlay.hidden = true;
  if (state.approvalCountdownTimer) {
    clearInterval(state.approvalCountdownTimer);
    state.approvalCountdownTimer = null;
  }
  state.pendingApproval = null;
}

async function fetchExecutionData() {
  try {
    const [posRes, ordRes, logRes] = await Promise.all([
      fetch("/api/execution/positions"),
      fetch("/api/execution/orders"),
      fetch("/api/execution/log")
    ]);
    const [posData, ordData, logData] = await Promise.all([posRes.json(), ordRes.json(), logRes.json()]);

    state.positions = posData.positions || [];
    state.orders = ordData.orders || [];
    state.executionLog = logData.log || [];

    renderPositionsTable(state.positions);
    renderOrdersTable(state.orders);
    renderExecutionLog(state.executionLog);
  } catch {
    // silent — trading may not be enabled
  }
}

function renderPositionsTable(positions) {
  const tbody = document.getElementById("positions-tbody");
  const subtitle = document.getElementById("positions-subtitle");
  if (!tbody) return;
  if (subtitle) subtitle.textContent = positions.length === 0 ? "No open positions" : `${positions.length} position${positions.length !== 1 ? "s" : ""}`;
  tbody.innerHTML = positions.map((p) => {
    const pnlClass = p.unrealized_pnl >= 0 ? "bullish" : "bearish";
    return `<tr>
      <td><strong>${p.ticker}</strong></td>
      <td><span class="action-badge action-${p.side}">${p.side.toUpperCase()}</span></td>
      <td>${p.qty}</td>
      <td>$${p.entry_price?.toFixed(2) || "—"}</td>
      <td>$${p.current_price?.toFixed(2) || "—"}</td>
      <td class="${pnlClass}">${p.unrealized_pnl >= 0 ? "+" : ""}$${p.unrealized_pnl?.toFixed(0) || "0"}</td>
      <td>$${p.stop_price?.toFixed(2) || "—"}</td>
      <td>$${p.target_price?.toFixed(2) || "—"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty-row">No open positions</td></tr>`;
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;
  tbody.innerHTML = orders.slice(0, 30).map((o) => `<tr>
    <td><strong>${o.ticker}</strong></td>
    <td><span class="action-badge action-${o.side}">${o.side?.toUpperCase()}</span></td>
    <td>${o.qty}</td>
    <td>$${o.entry_price?.toFixed(2) || "—"}</td>
    <td><span class="order-status order-${o.status}">${o.status}</span></td>
    <td>${o.placed_at ? new Date(o.placed_at).toLocaleString() : "—"}</td>
  </tr>`).join("") || `<tr><td colspan="6" class="empty-row">No orders yet</td></tr>`;
}

function renderExecutionLog(log) {
  const container = document.getElementById("execution-log-list");
  if (!container) return;
  container.innerHTML = log.slice(0, 50).map((entry) => {
    const statusClass = entry.status === "approved" ? "bullish" : entry.status === "rejected" ? "bearish" : "neutral";
    return `<div class="exec-log-item">
      <span class="exec-log-status ${statusClass}">${entry.status?.toUpperCase()}</span>
      <span class="exec-log-ticker">${entry.ticker}</span>
      <span class="exec-log-action">${entry.action?.toUpperCase()}</span>
      <span class="exec-log-time">${entry.decided_at ? new Date(entry.decided_at).toLocaleTimeString() : "—"}</span>
    </div>`;
  }).join("") || `<p class="empty-state">No decisions yet</p>`;
}

function startEventStream() {
  const stream = new EventSource("/api/stream");
  const refresh = async () => {
    await loadHealth();
    await loadSnapshot();
  };

  stream.addEventListener("snapshot", async (e) => {
    await refresh();
    // also seed from SSE payload if available (saves a round trip)
    try {
      const payload = JSON.parse(e.data);
      if (payload.macro_regime) { state.macroRegime = payload.macro_regime; renderMacroRegimeBar(); }
      if (payload.trade_setups) { state.tradeSetups = payload.trade_setups; renderSetups(); }
      if (payload.execution) {
        state.executionState = payload.execution;
        renderExecutionAccountBar(payload.execution);
        if (payload.execution.pending_approvals?.length > 0) {
          showApprovalCard(payload.execution.pending_approvals[0]);
        }
      }
    } catch { /* ignore parse failures */ }
  });
  stream.addEventListener("document_scored", refresh);
  stream.addEventListener("ticker_update", refresh);
  stream.addEventListener("alert", refresh);
  stream.addEventListener("market_tick", refresh);

  stream.addEventListener("macro_regime_update", (e) => {
    try {
      const payload = JSON.parse(e.data);
      state.macroRegime = payload;
      renderMacroRegimeBar();
    } catch { /* ignore */ }
  });

  stream.addEventListener("trade_setup_refresh", () => {
    fetchTradeSetups();
  });

  stream.addEventListener("execution_state_update", (e) => {
    try {
      const data = JSON.parse(e.data);
      state.executionState = data.executionState;
      renderExecutionAccountBar(data.executionState);
    } catch { /* ignore */ }
  });

  stream.addEventListener("trade_approval_request", (e) => {
    try {
      const data = JSON.parse(e.data);
      showApprovalCard(data);
    } catch { /* ignore */ }
  });

  stream.addEventListener("trade_approved", (e) => {
    try {
      const data = JSON.parse(e.data);
      hideApprovalCard();
      fetchExecutionData();
      console.log(`[trading] Order placed: ${data.ticker} ${data.action} ${data.shares} shares`);
    } catch { /* ignore */ }
  });

  stream.addEventListener("trade_rejected", () => {
    hideApprovalCard();
  });

  stream.addEventListener("trade_expired", () => {
    hideApprovalCard();
  });
}

async function init() {
  attachEvents();
  await loadConfig();
  await loadHealth();
  await loadSnapshot();
  await fetchTradeSetups();
  setActiveView(state.activeView);
  updateFilterButtons(elements.marketsFilterTabs, "marketFilter", state.marketFilter);
  updateFilterButtons(elements.alertsFilterTabs, "alertFilter", state.alertFilter);
  startEventStream();
}

init().catch((error) => {
  console.error(error);
});
