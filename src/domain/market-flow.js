import { WATCHLIST } from "./taxonomy.js";
import { shouldUseEvidence } from "./freshness-policy.js";
import { dedupeKey, round } from "../utils/helpers.js";

function ensureHealthEntry(store, config) {
  if (!store.health.liveSources.market_flow) {
    store.health.liveSources.market_flow = {
      enabled: config.marketFlowEnabled,
      polling: false,
      last_poll_at: null,
      last_success_at: null,
      last_error: null,
      polls: 0,
      ingested_documents: 0,
      fallback_mode: config.marketDataProvider === "synthetic" || !config.twelveDataApiKey
    };
  }

  return store.health.liveSources.market_flow;
}

function collectTickerDocs(store, ticker) {
  return store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      return normalized?.primary_ticker === ticker ? { score, normalized } : null;
    })
    .filter(Boolean)
    .filter(({ normalized }) => shouldUseEvidence(normalized, store.config))
    .sort((a, b) => new Date(a.normalized.published_at) - new Date(b.normalized.published_at));
}

export function detectMarketFlowSignal(barHistory, config) {
  if (!Array.isArray(barHistory) || barHistory.length < 8) {
    return null;
  }

  const minPriceMoveThreshold = Number(config.marketFlowMinPriceMoveThreshold ?? 0.01);
  const volumeSpikeThreshold = Number(config.marketFlowVolumeSpikeThreshold ?? 2.2);
  const blockTradeSpikeThreshold = Number(config.marketFlowBlockTradeSpikeThreshold ?? 3.8);
  const blockTradeShockThreshold = Number(config.marketFlowBlockTradeShockThreshold ?? 2.2);
  const blockTradeMinShares = Number(config.marketFlowBlockTradeMinShares ?? 500000);
  const blockTradeMinNotionalUsd = Number(config.marketFlowBlockTradeMinNotionalUsd ?? 25000000);
  const abnormalVolumeMinNotionalUsd = Number(config.marketFlowAbnormalVolumeMinNotionalUsd ?? 10000000);

  const latest = barHistory.at(-1);
  const previous = barHistory.at(-2);
  const referenceBars = barHistory.slice(-7, -1);
  const baselineVolume = referenceBars.reduce((sum, bar) => sum + Math.max(0, bar.volume || 0), 0) / Math.max(1, referenceBars.length);
  const recentMoves = barHistory.slice(-7).map((bar, index, bars) => {
    if (index === 0) {
      return 0;
    }
    const prev = bars[index - 1];
    return Math.abs((bar.close - prev.close) / Math.max(0.01, prev.close));
  });
  const baselineDollarVolume =
    referenceBars.reduce((sum, bar) => sum + Math.max(0, (bar.close || 0) * (bar.volume || 0)), 0) /
    Math.max(1, referenceBars.length);
  const baselineMove = recentMoves.slice(1).reduce((sum, value) => sum + value, 0) / Math.max(1, recentMoves.length - 1);
  const latestMove = (latest.close - previous.close) / Math.max(0.01, previous.close);
  const intrabarMove = (latest.close - latest.open) / Math.max(0.01, latest.open);
  const volumeSpike = (latest.volume || 0) / Math.max(1, baselineVolume);
  const latestDollarVolume = Math.max(0, (latest.close || 0) * (latest.volume || 0));
  const dollarVolumeSpike = latestDollarVolume / Math.max(1, baselineDollarVolume);
  const moveShock = Math.abs(latestMove) / Math.max(0.0025, baselineMove || minPriceMoveThreshold);
  const directionalMove = Math.abs(latestMove) >= minPriceMoveThreshold ? latestMove : intrabarMove;
  const hasAbnormalVolumeSignature =
    (volumeSpike >= volumeSpikeThreshold || dollarVolumeSpike >= volumeSpikeThreshold) &&
    latestDollarVolume >= abnormalVolumeMinNotionalUsd;
  const hasBlockTradeSignature =
    (volumeSpike >= blockTradeSpikeThreshold ||
      dollarVolumeSpike >= blockTradeSpikeThreshold ||
      moveShock >= blockTradeShockThreshold) &&
    ((latest.volume || 0) >= blockTradeMinShares ||
      latestDollarVolume >= blockTradeMinNotionalUsd);

  if (!hasAbnormalVolumeSignature && !hasBlockTradeSignature) {
    return null;
  }

  const blockTrade = hasBlockTradeSignature;
  const direction = directionalMove >= 0 ? "buy" : "sell";
  const eventType = blockTrade
    ? direction === "buy"
      ? "block_trade_buying"
      : "block_trade_selling"
    : direction === "buy"
      ? "abnormal_volume_buying"
      : "abnormal_volume_selling";

  return {
    timestamp: latest.timestamp,
    direction,
    eventType,
    volumeSpike: round(volumeSpike, 2),
    dollarVolumeSpike: round(dollarVolumeSpike, 2),
    moveShock: round(moveShock, 2),
    latestMove: round(latestMove, 4),
    intrabarMove: round(intrabarMove, 4),
    baselineVolume: round(baselineVolume, 0),
    latestVolume: Math.round(latest.volume || 0),
    latestDollarVolume: round(latestDollarVolume, 2),
    baselineDollarVolume: round(baselineDollarVolume, 2),
    severity: blockTrade ? "block" : "abnormal_volume"
  };
}

function buildRawFlowDocument(entry, flow) {
  const phraseByType = {
    abnormal_volume_buying: "abnormal volume surge and bullish tape flow",
    abnormal_volume_selling: "abnormal volume surge and bearish tape flow",
    block_trade_buying: "block trade accumulation and institutional block buying",
    block_trade_selling: "block trade distribution and institutional block selling"
  };
  const verb = flow.direction === "buy" ? "rose" : "fell";

  return {
    source_name: "market_flow",
    source_type: "market_flow",
    source_priority: 0.76,
    canonical_url: `market-flow://${entry.ticker}/${encodeURIComponent(flow.timestamp)}`,
    url: `market-flow://${entry.ticker}/${encodeURIComponent(flow.timestamp)}`,
    title: `${entry.ticker}: ${phraseByType[flow.eventType]}`,
    body: `${entry.company} showed ${phraseByType[flow.eventType]} with price moving ${verb} ${round(Math.abs(flow.latestMove) * 100, 2)}% on approximately ${flow.latestVolume.toLocaleString()} shares. Estimated notional turnover was about $${Math.round(flow.latestDollarVolume).toLocaleString()} with roughly ${flow.volumeSpike}x normal share volume and ${flow.dollarVolumeSpike}x normal dollar volume. This is an inferred live tape-flow signal rather than a direct exchange block print.`,
    language: "en",
    published_at: flow.timestamp,
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "market_flow",
      flow_event_type: flow.eventType,
      flow_direction: flow.direction,
      flow_severity: flow.severity,
      volume_spike: flow.volumeSpike,
      dollar_volume_spike: flow.dollarVolumeSpike,
      move_shock: flow.moveShock,
      latest_move: flow.latestMove,
      intrabar_move: flow.intrabarMove,
      latest_volume: flow.latestVolume,
      baseline_volume: flow.baselineVolume,
      latest_dollar_volume_usd: flow.latestDollarVolume,
      baseline_dollar_volume_usd: flow.baselineDollarVolume
    },
    raw_payload: flow
  };
}

export function createMarketFlowMonitor({ config, store, pipeline, marketDataService }) {
  let timer = null;
  let running = false;
  let inFlight = false;

  async function pollOnce() {
    if (!config.marketFlowEnabled || inFlight) {
      return { ingested: 0 };
    }

    inFlight = true;
    const health = ensureHealthEntry(store, config);
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;
    health.fallback_mode = config.marketDataProvider === "synthetic" || !config.twelveDataApiKey;

    let ingested = 0;

    try {
      if (health.fallback_mode) {
        health.last_error = "Live market flow requires a real market data provider.";
        return { ingested };
      }

      for (const entry of WATCHLIST) {
        const scoredDocs = collectTickerDocs(store, entry.ticker);
        const marketSeries = await marketDataService.getTickerSeries(entry.ticker, scoredDocs, store.health.lastUpdate || new Date().toISOString());
        const flow = detectMarketFlowSignal(marketSeries.bar_history, config);
        if (!flow) {
          continue;
        }

        const seenKey = dedupeKey(["market_flow", entry.ticker, flow.timestamp, flow.eventType]);
        if (store.seenExternalDocuments.has(seenKey)) {
          continue;
        }

        store.seenExternalDocuments.add(seenKey);
        await pipeline.processRawDocument(buildRawFlowDocument(entry, flow));
        ingested += 1;
      }

      health.ingested_documents += ingested;
      health.last_success_at = new Date().toISOString();
      health.last_error = null;
      return { ingested };
    } catch (error) {
      health.last_error = error.message;
      return { ingested, error: error.message };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !config.marketFlowEnabled) {
      return;
    }

    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.marketFlowPollMs);
  }

  return {
    async start() {
      ensureHealthEntry(store, config);
      if (running || !config.marketFlowEnabled) {
        return;
      }
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      ensureHealthEntry(store, config).polling = false;
    },
    async pollOnce() {
      return pollOnce();
    }
  };
}
