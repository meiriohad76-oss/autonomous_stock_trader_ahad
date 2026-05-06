import { shouldUseEvidence } from "./freshness-policy.js";
import { liveMarketDataStatus, liveMarketProviderChain } from "./market-providers.js";
import { getTrackedUniverseEntries, rotateUniverseEntries } from "./tracked-universe.js";
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
      provider: config.marketDataProvider,
      fallback_mode: liveMarketProviderChain(config, config.marketDataProvider, { includeSynthetic: false }).length === 0,
      configured: liveMarketProviderChain(config, config.marketDataProvider, { includeSynthetic: false }).length > 0,
      feed: null,
      missing_config_reason: null,
      universe_symbols: 0,
      last_batch_size: 0
    };
  }

  const providerStatus = liveMarketDataStatus(config, config.marketDataProvider);
  store.health.liveSources.market_flow.provider = config.marketDataProvider;
  store.health.liveSources.market_flow.configured = providerStatus.configured;
  store.health.liveSources.market_flow.provider_chain = providerStatus.provider_chain;
  store.health.liveSources.market_flow.feed = providerStatus.feed;
  store.health.liveSources.market_flow.fallback_mode = providerStatus.fallback_mode;
  store.health.liveSources.market_flow.missing_config_reason = providerStatus.configured
    ? null
    : providerStatus.missing_config_reason;
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
  const latestOpen = Number(latest.open || previous.close || latest.close || 0);
  const intrabarMove = latestOpen > 0 ? (latest.close - latestOpen) / Math.max(0.01, latestOpen) : latestMove;
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

  const direction = directionalMove >= 0 ? "buy" : "sell";
  const eventType = direction === "buy" ? "abnormal_volume_buying" : "abnormal_volume_selling";

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
    severity: hasBlockTradeSignature ? "possible_block_like_volume" : "abnormal_volume",
    directBlockPrint: false
  };
}

function buildRawFlowDocument(entry, flow, config) {
  const phraseByType = {
    abnormal_volume_buying: "abnormal volume surge and bullish tape flow",
    abnormal_volume_selling: "abnormal volume surge and bearish tape flow"
  };
  const verb = flow.direction === "buy" ? "rose" : "fell";
  const sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(entry.ticker)}/chart/`;
  const severityNote =
    flow.severity === "possible_block_like_volume"
      ? "The size is large enough to resemble block-like participation, but it is still bar-derived and not a confirmed exchange block print."
      : "This is a bar-derived abnormal-volume signal.";

  return {
    source_name: "market_flow",
    source_type: "market_flow",
    source_priority: 0.76,
    canonical_url: sourceUrl,
    url: sourceUrl,
    title: `${entry.ticker}: ${phraseByType[flow.eventType]}`,
    body: `${entry.company} showed ${phraseByType[flow.eventType]} with price moving ${verb} ${round(Math.abs(flow.latestMove) * 100, 2)}% on approximately ${flow.latestVolume.toLocaleString()} shares. Estimated notional turnover was about $${Math.round(flow.latestDollarVolume).toLocaleString()} with roughly ${flow.volumeSpike}x normal share volume and ${flow.dollarVolumeSpike}x normal dollar volume. ${severityNote}`,
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
      observation_level: "bar_derived_inferred",
      verification_status: "inferred_from_ohlcv",
      direct_block_print: false,
      reliability_warning: "Market-flow radar is inferred from price/volume bars; only the trade-print collector can confirm block prints.",
      source_url: sourceUrl,
      inferred_from_provider: config.marketDataProvider,
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

export function createMarketFlowMonitor({ config, store, pipeline, marketDataService, getTrackedFundamentalCompanies }) {
  let timer = null;
  let running = false;
  let inFlight = false;
  let cursor = 0;

  function nextBatch() {
    const universe = getTrackedUniverseEntries({ store, getTrackedFundamentalCompanies });
    const maxTickers = Math.max(0, Math.floor(Number(config.marketFlowMaxTickersPerPoll || 0)));
    if (!maxTickers || maxTickers >= universe.length) {
      return { universe, batch: universe };
    }

    const rotated = rotateUniverseEntries(universe, cursor, maxTickers);
    cursor = rotated.nextCursor;
    return { universe, batch: rotated.selected };
  }

  async function pollOnce() {
    if (!config.marketFlowEnabled || inFlight) {
      return { ingested: 0 };
    }

    inFlight = true;
    const health = ensureHealthEntry(store, config);
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;
    const liveProviders = liveMarketProviderChain(config, config.marketDataProvider, { includeSynthetic: false });
    health.configured = liveProviders.length > 0;
    health.provider_chain = liveMarketProviderChain(config, config.marketDataProvider);
    health.fallback_mode = liveProviders.length === 0;

    let ingested = 0;
    let liveSeriesCount = 0;
    let syntheticSeriesCount = 0;

    try {
      const { universe, batch } = nextBatch();
      health.universe_symbols = universe.length;
      health.last_batch_size = batch.length;

      if (health.fallback_mode) {
        health.last_error = "Live market flow requires a real market data provider.";
        return { ingested };
      }

      for (const entry of batch) {
        const scoredDocs = collectTickerDocs(store, entry.ticker);
        const marketSeries = await marketDataService.getTickerSeries(entry.ticker, scoredDocs, store.health.lastUpdate || new Date().toISOString(), { allowLive: true });
        if (!marketSeries.market_snapshot?.live) {
          syntheticSeriesCount += 1;
          continue;
        }
        liveSeriesCount += 1;
        health.active_provider = marketSeries.market_snapshot.provider || health.active_provider || config.marketDataProvider;
        const flow = detectMarketFlowSignal(marketSeries.bar_history, config);
        if (!flow) {
          continue;
        }

        const seenKey = dedupeKey(["market_flow", entry.ticker, flow.timestamp, flow.eventType]);
        if (store.seenExternalDocuments.has(seenKey)) {
          continue;
        }

        store.seenExternalDocuments.add(seenKey);
        await pipeline.processRawDocument(buildRawFlowDocument(entry, flow, config));
        ingested += 1;
      }

      health.ingested_documents += ingested;
      if (liveSeriesCount > 0) {
        health.last_success_at = new Date().toISOString();
      }
      health.last_error =
        syntheticSeriesCount && !liveSeriesCount
          ? "Market data providers returned only synthetic fallback series; market-flow signals were skipped."
          : syntheticSeriesCount
            ? `${syntheticSeriesCount} ticker(s) skipped because only synthetic fallback market data was available.`
            : null;
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
