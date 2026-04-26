import { WATCHLIST } from "./taxonomy.js";
import { dedupeKey, round } from "../utils/helpers.js";

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values, mean = average(values)) {
  if (!Array.isArray(values) || values.length < 2) {
    return 0;
  }

  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function barRangePercent(bar, previousClose = null) {
  const high = asNumber(bar.high, asNumber(bar.close, 0));
  const low = asNumber(bar.low, asNumber(bar.close, 0));
  const close = asNumber(bar.close, asNumber(bar.open, 0));
  const denominator = Math.max(0.01, previousClose ?? close);
  return Math.max(0, high - low) / denominator;
}

function closeLocation(bar) {
  const high = asNumber(bar.high, Math.max(asNumber(bar.open, 0), asNumber(bar.close, 0)));
  const low = asNumber(bar.low, Math.min(asNumber(bar.open, 0), asNumber(bar.close, 0)));
  const close = asNumber(bar.close, asNumber(bar.open, 0));
  const range = Math.max(0.01, high - low);
  return (close - low) / range;
}

function countDirectionalPersistence(barHistory, minPriceMoveThreshold, directionSign) {
  let count = 0;

  for (let index = barHistory.length - 1; index > 0; index -= 1) {
    const current = barHistory[index];
    const previous = barHistory[index - 1];
    const move = (asNumber(current.close, 0) - asNumber(previous.close, 0)) / Math.max(0.01, asNumber(previous.close, 0));
    const sign = Math.sign(move);

    if (sign !== directionSign || Math.abs(move) < minPriceMoveThreshold * 0.4) {
      break;
    }

    count += 1;
  }

  return count;
}

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
    .sort((a, b) => new Date(a.normalized.published_at) - new Date(b.normalized.published_at));
}

export function detectMarketFlowSignal(barHistory, config) {
  if (!Array.isArray(barHistory) || barHistory.length < 8) {
    return null;
  }

  const minPriceMoveThreshold = Number(config.marketFlowMinPriceMoveThreshold ?? 0.01);
  const volumeSpikeThreshold = Number(config.marketFlowVolumeSpikeThreshold ?? 2.2);
  const volumeZScoreThreshold = Number(config.marketFlowVolumeZScoreThreshold ?? 2.4);
  const dollarVolumeZScoreThreshold = Number(config.marketFlowDollarVolumeZScoreThreshold ?? 2.4);
  const blockTradeSpikeThreshold = Number(config.marketFlowBlockTradeSpikeThreshold ?? 3.8);
  const blockTradeShockThreshold = Number(config.marketFlowBlockTradeShockThreshold ?? 2.2);
  const persistenceBarsThreshold = Math.max(1, Number(config.marketFlowPersistenceBars ?? 2));
  const closeLocationThreshold = Number(config.marketFlowCloseLocationThreshold ?? 0.68);
  const blockTradeMinShares = Number(config.marketFlowBlockTradeMinShares ?? 500000);
  const blockTradeMinNotionalUsd = Number(config.marketFlowBlockTradeMinNotionalUsd ?? 25000000);
  const abnormalVolumeMinNotionalUsd = Number(config.marketFlowAbnormalVolumeMinNotionalUsd ?? 10000000);

  const latest = barHistory.at(-1);
  const previous = barHistory.at(-2);
  const referenceBars = barHistory.slice(Math.max(0, barHistory.length - 13), -1);
  const baselineVolume = average(referenceBars.map((bar) => Math.max(0, asNumber(bar.volume, 0))));
  const recentMoves = barHistory.slice(-7).map((bar, index, bars) => {
    if (index === 0) {
      return 0;
    }
    const prev = bars[index - 1];
    return Math.abs((asNumber(bar.close, 0) - asNumber(prev.close, 0)) / Math.max(0.01, asNumber(prev.close, 0)));
  });
  const baselineDollarVolume = average(referenceBars.map((bar) => Math.max(0, asNumber(bar.close, 0) * asNumber(bar.volume, 0))));
  const volumeStdDev = stdDev(referenceBars.map((bar) => Math.max(0, asNumber(bar.volume, 0))), baselineVolume);
  const dollarVolumeStdDev = stdDev(
    referenceBars.map((bar) => Math.max(0, asNumber(bar.close, 0) * asNumber(bar.volume, 0))),
    baselineDollarVolume
  );
  const baselineMove = average(recentMoves.slice(1));
  const recentRanges = referenceBars.map((bar, index) => {
    const prev = index > 0 ? referenceBars[index - 1] : previous;
    return barRangePercent(bar, prev ? asNumber(prev.close, 0) : null);
  });
  const baselineRange = average(recentRanges);
  const latestMove = (asNumber(latest.close, 0) - asNumber(previous.close, 0)) / Math.max(0.01, asNumber(previous.close, 0));
  const intrabarMove = (asNumber(latest.close, 0) - asNumber(latest.open, asNumber(previous.close, 0))) / Math.max(0.01, asNumber(latest.open, asNumber(previous.close, 0)));
  const volumeSpike = asNumber(latest.volume, 0) / Math.max(1, baselineVolume);
  const latestDollarVolume = Math.max(0, asNumber(latest.close, 0) * asNumber(latest.volume, 0));
  const dollarVolumeSpike = latestDollarVolume / Math.max(1, baselineDollarVolume);
  const moveShock = Math.abs(latestMove) / Math.max(0.0025, baselineMove || minPriceMoveThreshold);
  const latestRange = barRangePercent(latest, asNumber(previous.close, 0));
  const rangeExpansion = latestRange / Math.max(0.001, baselineRange || latestRange || minPriceMoveThreshold);
  const volumeZScore = (asNumber(latest.volume, 0) - baselineVolume) / Math.max(1, volumeStdDev || baselineVolume * 0.15);
  const dollarVolumeZScore =
    (latestDollarVolume - baselineDollarVolume) / Math.max(1, dollarVolumeStdDev || baselineDollarVolume * 0.15);
  const directionalMove = Math.abs(latestMove) >= minPriceMoveThreshold ? latestMove : intrabarMove;
  const directionSign = directionalMove >= 0 ? 1 : -1;
  const persistenceBars = countDirectionalPersistence(barHistory, minPriceMoveThreshold, directionSign);
  const latestCloseLocation = closeLocation(latest);
  const directionalCloseLocationConfirmed =
    directionSign > 0 ? latestCloseLocation >= closeLocationThreshold : latestCloseLocation <= 1 - closeLocationThreshold;
  const abnormalVolumeTriggered =
    volumeSpike >= volumeSpikeThreshold ||
    dollarVolumeSpike >= volumeSpikeThreshold ||
    volumeZScore >= volumeZScoreThreshold ||
    dollarVolumeZScore >= dollarVolumeZScoreThreshold;
  const hasAbnormalVolumeSignature =
    abnormalVolumeTriggered &&
    latestDollarVolume >= abnormalVolumeMinNotionalUsd;
  const extremeFlowTriggered =
    volumeSpike >= blockTradeSpikeThreshold ||
    dollarVolumeSpike >= blockTradeSpikeThreshold ||
    moveShock >= blockTradeShockThreshold ||
    volumeZScore >= volumeZScoreThreshold + 1 ||
    dollarVolumeZScore >= dollarVolumeZScoreThreshold + 1;
  const hasBlockTradeSignature =
    extremeFlowTriggered &&
    directionalCloseLocationConfirmed &&
    persistenceBars >= persistenceBarsThreshold &&
    (asNumber(latest.volume, 0) >= blockTradeMinShares || latestDollarVolume >= blockTradeMinNotionalUsd);

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
    volumeZScore: round(volumeZScore, 2),
    dollarVolumeSpike: round(dollarVolumeSpike, 2),
    dollarVolumeZScore: round(dollarVolumeZScore, 2),
    moveShock: round(moveShock, 2),
    rangeExpansion: round(rangeExpansion, 2),
    persistenceBars,
    closeLocation: round(latestCloseLocation, 2),
    latestMove: round(latestMove, 4),
    intrabarMove: round(intrabarMove, 4),
    baselineVolume: round(baselineVolume, 0),
    latestVolume: Math.round(asNumber(latest.volume || 0)),
    latestDollarVolume: round(latestDollarVolume, 2),
    baselineDollarVolume: round(baselineDollarVolume, 2),
    evidenceFlags: [
      volumeSpike >= volumeSpikeThreshold ? "volume_spike" : null,
      dollarVolumeSpike >= volumeSpikeThreshold ? "dollar_volume_spike" : null,
      volumeZScore >= volumeZScoreThreshold ? "volume_zscore" : null,
      dollarVolumeZScore >= dollarVolumeZScoreThreshold ? "dollar_volume_zscore" : null,
      moveShock >= blockTradeShockThreshold ? "move_shock" : null,
      directionalCloseLocationConfirmed ? "close_location_confirmed" : null,
      persistenceBars >= persistenceBarsThreshold ? "persistent_directional_flow" : null
    ].filter(Boolean),
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
    source_type: "manual",
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
      volume_zscore: flow.volumeZScore,
      dollar_volume_spike: flow.dollarVolumeSpike,
      dollar_volume_zscore: flow.dollarVolumeZScore,
      move_shock: flow.moveShock,
      range_expansion: flow.rangeExpansion,
      persistence_bars: flow.persistenceBars,
      close_location: flow.closeLocation,
      latest_move: flow.latestMove,
      intrabar_move: flow.intrabarMove,
      latest_volume: flow.latestVolume,
      baseline_volume: flow.baselineVolume,
      latest_dollar_volume_usd: flow.latestDollarVolume,
      baseline_dollar_volume_usd: flow.baselineDollarVolume,
      evidence_flags: flow.evidenceFlags
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
