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

function screenBadgeClass(row) {
  if (row?.screen_stage === "eligible") {
    return "bullish";
  }
  if (row?.screen_stage === "watch") {
    return "neutral";
  }
  return "bearish";
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
  const visible = overview.visible_universe || visibleScreenerOverview();
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
      `This table now merges the full screened fundamentals universe with currently active sentiment names. Full fundamentals universe: ${fullUniverse.tracked || 0} tracked, ${fullUniverse.eligible || 0} eligible, ${fullUniverse.watch || 0} watch, ${fullUniverse.reject || 0} reject. Current visible table rows: ${visible.tracked} tracked, ${visible.eligible} eligible, ${visible.watch} watch, ${visible.reject} reject. Names with active sentiment right now: ${sentimentVisible.tracked} tracked, ${sentimentVisible.eligible} eligible, ${sentimentVisible.watch} watch, ${sentimentVisible.reject} reject.`,
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
    timestamp: item.timestamp || null,
    sourceName: item.source_name || sourceLabel,
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
    sourceMetadata: doc.source_metadata || null,
    evidenceQuality: doc.evidence_quality || null,
    downstreamWeight: doc.downstream_weight ?? doc.evidence_quality?.downstream_weight ?? null
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
                return `
                  <button type="button" class="money-flow-card ${badgeClass(item.label)}" data-money-flow-index="${sourceLabel}:${index}">
                    <div class="money-flow-card-head">
                      <div>
                        <strong>${item.ticker || "MKT"}: ${eventTypeLabel(item.event_type)}</strong>
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

async function loadConfig() {
  state.config = await getJson("/api/config");
  state.activeWindow = state.config.default_window || "1h";
  state.marketFlowSettings = { ...(state.config.market_flow_settings || {}) };
  elements.universeName.textContent = state.config.universe_name;
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

  state.tickerDetail = await getJson(`/api/sentiment/ticker/${state.selectedTicker}`);
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
  const visibleUniverse = overview.visible_universe || visibleScreenerOverview();
  const sentimentVisibleUniverse = overview.sentiment_visible_universe || visibleUniverse;
  elements.leaderboardExplainer.textContent = `The table now blends the full screened fundamentals universe with names that already have active sentiment. Screen shows the stage-one gate, Composite shows the full fundamentals score, and Sentiment controls the ordering when there is live signal. Full screened universe: ${fullUniverse.eligible || 0} eligible, ${fullUniverse.watch || 0} watch, ${fullUniverse.reject || 0} reject. Visible rows right now: ${visibleUniverse.eligible} eligible, ${visibleUniverse.watch} watch, ${visibleUniverse.reject} reject. Active sentiment subset: ${sentimentVisibleUniverse.eligible || 0} eligible, ${sentimentVisibleUniverse.watch || 0} watch, ${sentimentVisibleUniverse.reject || 0} reject.`;

  if (!rows.length) {
    elements.leaderboardBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No tickers match the current search and screen filter.</td>
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

function renderTradeSetups() {
  const payload = state.tradeSetups || { counts: {}, setups: [] };
  const macro = state.macroRegime || {};
  const counts = payload.counts || {};
  const setups = payload.setups || [];

  elements.tradeSetupSummary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card"><span>Regime</span><strong>${prettyLabel(macro.regime_label || "unknown")}</strong></div>
      <div class="summary-card"><span>Bias</span><strong>${prettyLabel(macro.bias_label || "balanced")}</strong></div>
      <div class="summary-card"><span>Exposure</span><strong>${formatNumber((macro.exposure_multiplier || 0) * 100, 0)}%</strong></div>
      <div class="summary-card"><span>Macro Conf</span><strong>${formatNumber((macro.conviction || 0) * 100, 0)}%</strong></div>
      <div class="summary-card"><span>Tracked</span><strong>${counts.tracked_tickers || 0}</strong></div>
      <div class="summary-card"><span>Long</span><strong>${counts.long || 0}</strong></div>
      <div class="summary-card"><span>Short</span><strong>${counts.short || 0}</strong></div>
      <div class="summary-card"><span>Watch</span><strong>${counts.watch || 0}</strong></div>
    </div>
    ${macro.summary ? `<p class="trade-setup-macro-summary">${macro.summary}</p>` : ""}
  `;

  elements.tradeSetupList.innerHTML = "";

  if (!setups.length) {
    elements.tradeSetupList.innerHTML = `<div class="feed-empty">No trade setups are ready yet.</div>`;
    return;
  }

  setups.forEach((setup) => {
    const article = document.createElement("article");
    const labelStyle =
      setup.action === "long" ? "bullish" : setup.action === "short" ? "bearish" : "neutral";
    article.className = `feed-card ${labelStyle}`;
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
      </div>
    `;
    article.addEventListener("click", async () => {
      if (setup.ticker) {
        await focusTicker(setup.ticker, "overview");
      }
    });
    elements.tradeSetupList.appendChild(article);
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

  const comparisonRows = rows
    .slice()
    .sort((a, b) => {
      const scoreA =
        Math.abs(Number(a.momentum_delta || 0)) * 3 +
        Math.abs(Number(a.weighted_sentiment || 0)) * 2 +
        Number(a.weighted_confidence || 0) +
        Math.min(1.5, Number(a.story_velocity || 0) * 0.25);
      const scoreB =
        Math.abs(Number(b.momentum_delta || 0)) * 3 +
        Math.abs(Number(b.weighted_sentiment || 0)) * 2 +
        Number(b.weighted_confidence || 0) +
        Math.min(1.5, Number(b.story_velocity || 0) * 0.25);
      return scoreB - scoreA;
    })
    .slice(0, 4);

  elements.marketsComparisonStrip.innerHTML = comparisonRows.length
    ? comparisonRows
        .map(
          (row) => `
            <button type="button" class="workspace-card comparison-card ${state.selectedTicker === row.entity_key ? "selected" : ""}" data-compare-ticker="${row.entity_key}">
              <span>${row.entity_key}</span>
              <strong>${formatNumber(row.weighted_sentiment)}</strong>
              <small>${formatSignedPercent(row.momentum_delta)} momentum - ${formatNumber(row.weighted_confidence * 100, 0)}% conf</small>
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
    : `<tr class="empty-row"><td colspan="4">No market rows available.</td></tr>`;

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

  elements.alertsSummaryStrip.innerHTML = `
    <div class="workspace-stat-card"><span>Positive</span><strong>${positiveCount}</strong></div>
    <div class="workspace-stat-card"><span>Negative</span><strong>${negativeCount}</strong></div>
    <div class="workspace-stat-card"><span>Reversal</span><strong>${reversalCount}</strong></div>
    <div class="workspace-stat-card"><span>Money Flow</span><strong>${moneyFlowSignals.length}</strong></div>
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
                <strong>${item.ticker || "MKT"}: ${eventTypeLabel(item.event_type)}</strong>
                <span>${relativeTime(item.timestamp)}</span>
              </div>
              <p>${item.headline}</p>
              <div class="feed-meta">
                <span class="sentiment-badge ${badgeClass(item.label)}">${item.label}</span>
                <span>${formatNumber(item.confidence * 100, 0)}% Conf</span>
                <span>${evidenceQualityLabel(item.evidence_quality)}</span>
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
    <div class="workspace-stat-card"><span>Evidence Quality</span><strong>${evidenceQualityLabel(signal.evidenceQuality)}</strong></div>
    <div class="workspace-stat-card"><span>Downstream Weight</span><strong>${signal.downstreamWeight !== null && signal.downstreamWeight !== undefined ? formatNumber(signal.downstreamWeight, 2) : "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>Source</span><strong>${signal.sourceName || signal.subtitle}</strong></div>
  `;
  elements.signalDrawerExplanation.textContent = signal.explanation;
  elements.signalDrawerContext.innerHTML = [
    signal.timestamp ? `<li>Observed ${relativeTime(signal.timestamp)} at ${formatTime(signal.timestamp)}.</li>` : null,
    signal.sourceName ? `<li>Source: ${signal.sourceName}.</li>` : null,
    signal.evidenceQuality?.explanation ? `<li>Evidence quality: ${signal.evidenceQuality.explanation}</li>` : null,
    signal.ticker ? `<li>Related ticker: ${signal.ticker}.</li>` : "<li>This signal is market-level rather than ticker-specific.</li>",
    `<li>Current classification: ${signal.label.toLowerCase()}.</li>`,
    signal.sourceMetadata?.volume_spike ? `<li>Tape signature: ${formatNumber(signal.sourceMetadata.volume_spike, 1)}x normal volume.</li>` : null,
    signal.sourceMetadata?.latest_dollar_volume_usd ? `<li>Estimated live notional: ${formatUsdCompact(signal.sourceMetadata.latest_dollar_volume_usd)}.</li>` : null,
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
  const evidenceQuality = state.health?.evidence_quality || null;
  const backup = state.health?.database_backup || state.config?.database_backup || null;
  elements.systemOverview.innerHTML = `
    <div class="workspace-stat-card"><span>Status</span><strong>${elements.healthStatus.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Queue Depth</span><strong>${elements.healthQueue.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Latency</span><strong>${elements.healthLatency.textContent}</strong></div>
    <div class="workspace-stat-card"><span>Market Regime</span><strong>${pulse.sentiment_regime || "neutral"}</strong></div>
    <div class="workspace-stat-card"><span>Database</span><strong>${state.config?.database_provider || "sqlite"}</strong></div>
    <div class="workspace-stat-card"><span>DB Target</span><strong>${state.config?.database_target || "local file"}</strong></div>
    <div class="workspace-stat-card"><span>Backups</span><strong>${backup?.enabled ? "Enabled" : backup?.supported ? "Disabled" : "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>Last Backup</span><strong>${backup?.last_backup_at ? relativeTime(backup.last_backup_at) : "n/a"}</strong></div>
    <div class="workspace-stat-card"><span>Evidence Items</span><strong>${evidenceQuality?.total_evidence_items || 0}</strong></div>
    <div class="workspace-stat-card"><span>Avg Evidence Weight</span><strong>${evidenceQuality ? formatNumber(evidenceQuality.average_downstream_weight, 2) : "n/a"}</strong></div>
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
      <div class="workspace-stat-card"><span>Backup Dir</span><strong>${backup?.backup_dir || "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Backup Count</span><strong>${backup?.backup_count ?? 0}</strong></div>
      <div class="workspace-stat-card"><span>Backup Interval</span><strong>${backup?.interval_ms ? `${Math.round(backup.interval_ms / 3600000)}h` : "n/a"}</strong></div>
      <div class="workspace-stat-card"><span>Retention</span><strong>${backup?.retention_count ? `${backup.retention_count} files / ${backup.retention_days}d` : "n/a"}</strong></div>
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
      <li>News sentiment source: Google News RSS with Yahoo Finance RSS fallback, scored through the same normalization and sentiment pipeline as other live events.</li>
      <li>Money-flow sources: inferred tape anomalies from live market bars, SEC Form 4 insider filings, and SEC 13F institutional holdings changes.</li>
      <li>The sentiment watchlist is sentiment-first. Fundamentals enrich those rows, but the full fundamentals universe lives in the Fundamentals dashboard and the Trade Setup Agent.</li>
      <li>The Trade Setup Agent is the true combined decision layer: it blends sentiment, fundamentals, macro regime, recent documents, and alerts.</li>
      <li>SQLite persistence is active for this deployment, and scheduled backups protect the Pi from accidental bad writes or local corruption.</li>
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
  const visibleUniverse = overview.visible_universe || {};
  const labels = {
    all: `All Screens (${visibleUniverse.tracked || fullUniverse.tracked || 0})`,
    eligible: `Eligible (${fullUniverse.eligible || 0})`,
    watch: `Watch (${fullUniverse.watch || 0})`,
    reject: `Reject (${fullUniverse.reject || 0})`
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
    await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval_ms: 220 })
    });
    scheduleRefresh(200);
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
