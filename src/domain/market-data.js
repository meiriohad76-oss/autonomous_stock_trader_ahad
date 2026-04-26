import { TICKER_LOOKUP, WINDOWS } from "./taxonomy.js";
import { clamp, fingerprint, round } from "../utils/helpers.js";

function deterministicUnit(value) {
  const hex = fingerprint(value).slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function marketHealth(store, config) {
  if (!store.health.liveSources.market_data) {
    store.health.liveSources.market_data = {
      provider: config.marketDataProvider,
      enabled: config.marketDataProvider !== "synthetic",
      polling: false,
      last_poll_at: null,
      last_success_at: null,
      last_error: null,
      cache_entries: 0,
      fallback_mode: config.marketDataProvider === "synthetic"
    };
  }

  return store.health.liveSources.market_data;
}

function parseSeriesTimestamp(value) {
  if (!value) {
    return new Date().toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}Z`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function buildSeriesSignal(scoredDocs, pointTime) {
  const signal = scoredDocs.reduce(
    (acc, item) => {
      const published = new Date(item.normalized.published_at).getTime();
      const pointTimestamp = pointTime.getTime();

      if (published > pointTimestamp) {
        return acc;
      }

      const ageHours = (pointTimestamp - published) / 3_600_000;
      const decay = Math.exp(-ageHours / 12);
      const weight = Math.max(0.05, item.score.impact_score * item.score.final_confidence * decay);
      acc.alpha += item.score.document_alpha * decay;
      acc.weight += weight;
      acc.confidence += item.score.final_confidence * decay;
      return acc;
    },
    { alpha: 0, weight: 0, confidence: 0 }
  );

  return {
    sentiment: signal.weight ? clamp(signal.alpha / signal.weight, -1, 1) : 0,
    confidence: signal.weight ? clamp(signal.confidence / Math.max(1, scoredDocs.length), 0, 1) : 0
  };
}

function buildSyntheticTickerMarketSeries(ticker, scoredDocs, asOf, pointCount = 18) {
  const tickerEntry = TICKER_LOOKUP.get(ticker);
  const basePrice = tickerEntry?.base_price || 100;
  const endTime = new Date(asOf || Date.now());
  const startTime = new Date(endTime.getTime() - 24 * 3_600_000);
  const sentimentHistory = [];
  const priceHistory = [];
  const barHistory = [];
  let price = basePrice;

  for (let index = 0; index < pointCount; index += 1) {
    const ratio = pointCount === 1 ? 1 : index / (pointCount - 1);
    const pointTime = new Date(startTime.getTime() + ratio * (endTime.getTime() - startTime.getTime()));
    const signal = buildSeriesSignal(scoredDocs, pointTime);
    const drift = signal.sentiment * 0.012 * (0.4 + signal.confidence);
    const noise = (deterministicUnit(`${ticker}:${index}:${pointTime.toISOString()}`) - 0.5) * 0.006;
    const open = index === 0 ? basePrice * (1 - drift * 1.8) : price;
    price = index === 0 ? open : price * (1 + drift + noise);
    price = Math.max(1, price);
    const high = Math.max(open, price) * (1 + deterministicUnit(`${ticker}:high:${index}`) * 0.008);
    const low = Math.min(open, price) * (1 - deterministicUnit(`${ticker}:low:${index}`) * 0.008);
    const volume = Math.round(
      900000 +
        deterministicUnit(`${ticker}:volume:${index}:${pointTime.toISOString()}`) * 2500000 * (1 + Math.abs(signal.sentiment))
    );

    sentimentHistory.push({
      timestamp: pointTime.toISOString(),
      sentiment: round(signal.sentiment, 4),
      confidence: round(signal.confidence, 4)
    });
    priceHistory.push({
      timestamp: pointTime.toISOString(),
      price: round(price, 2)
    });
    barHistory.push({
      timestamp: pointTime.toISOString(),
      open: round(open, 2),
      high: round(high, 2),
      low: round(low, 2),
      close: round(price, 2),
      volume
    });
  }

  return buildSeriesPayload(
    priceHistory,
    sentimentHistory,
    WINDOWS.find((window) => window.key === "1d")?.label || "1 Day",
    barHistory
  );
}

function buildSeriesPayload(priceHistory, sentimentHistory, baselineWindow, barHistory = []) {
  const firstPrice = priceHistory[0]?.price || 0;
  const lastPrice = priceHistory.at(-1)?.price || firstPrice;
  const intradayHigh = priceHistory.length ? Math.max(...priceHistory.map((point) => point.price)) : lastPrice;
  const intradayLow = priceHistory.length ? Math.min(...priceHistory.map((point) => point.price)) : lastPrice;
  const denominator = firstPrice || 1;

  return {
    price_history: priceHistory,
    sentiment_history: sentimentHistory,
    bar_history: barHistory,
    market_snapshot: {
      current_price: round(lastPrice, 2),
      absolute_change: round(lastPrice - firstPrice, 2),
      percent_change: round((lastPrice - firstPrice) / denominator, 4),
      intraday_high: round(intradayHigh, 2),
      intraday_low: round(intradayLow, 2),
      baseline_window: baselineWindow
    }
  };
}

async function fetchTwelveDataSeries(config, ticker) {
  const params = new URLSearchParams({
    symbol: ticker,
    interval: config.marketDataInterval,
    outputsize: String(config.marketDataHistoryPoints),
    order: "asc",
    format: "JSON",
    timezone: "UTC",
    apikey: config.twelveDataApiKey
  });
  const request = withTimeout(config.marketDataRequestTimeoutMs);

  try {
    const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`, {
      signal: request.signal,
      headers: {
        "User-Agent": "SentimentAnalyst/1.0 (+market data)"
      }
    });

    if (!response.ok) {
      throw new Error(`Twelve Data request failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.status === "error") {
      throw new Error(payload.message || "Twelve Data returned an error");
    }

    if (!Array.isArray(payload.values) || !payload.values.length) {
      throw new Error("Twelve Data returned no price history");
    }

    return payload;
  } finally {
    request.clear();
  }
}

function mapTwelveDataSeries(payload, scoredDocs) {
  const values = payload.values.map((point) => ({
    timestamp: parseSeriesTimestamp(point.datetime),
    open: Number(point.open),
    high: Number(point.high),
    low: Number(point.low),
    close: Number(point.close),
    volume: Number(point.volume || 0)
  }));

  const sentimentHistory = values.map((point) => {
    const signal = buildSeriesSignal(scoredDocs, new Date(point.timestamp));
    return {
      timestamp: point.timestamp,
      sentiment: round(signal.sentiment, 4),
      confidence: round(signal.confidence, 4)
    };
  });

  const priceHistory = values.map((point) => ({
    timestamp: point.timestamp,
    price: round(point.close, 2)
  }));

  const baselineWindow = WINDOWS.find((window) => window.key === "1d")?.label || payload.meta?.interval || "1 Day";
  return buildSeriesPayload(priceHistory, sentimentHistory, baselineWindow, values.map((point) => ({
    timestamp: point.timestamp,
    open: round(point.open, 2),
    high: round(point.high, 2),
    low: round(point.low, 2),
    close: round(point.close, 2),
    volume: Math.round(point.volume || 0)
  })));
}

export function createMarketDataService({ config, store }) {
  const cache = new Map();
  let timer = null;
  let running = false;

  function updateHealthFromCache() {
    const health = marketHealth(store, config);
    health.cache_entries = cache.size;
    health.provider = config.marketDataProvider;
    health.enabled = config.marketDataProvider !== "synthetic";
    health.fallback_mode = config.marketDataProvider === "synthetic" || !config.twelveDataApiKey;
    return health;
  }

  async function getTickerSeries(ticker, scoredDocs, asOf) {
    const health = updateHealthFromCache();
    const cacheKey = `${ticker}:${config.marketDataProvider}:${config.marketDataInterval}:${config.marketDataHistoryPoints}`;
    const cached = cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.fetchedAt <= config.marketDataCacheMs) {
      return cached.payload;
    }

    if (config.marketDataProvider !== "twelvedata" || !config.twelveDataApiKey) {
      const payload = buildSyntheticTickerMarketSeries(ticker, scoredDocs, asOf, config.marketDataHistoryPoints);
      cache.set(cacheKey, { fetchedAt: now, payload });
      updateHealthFromCache();
      return payload;
    }

    health.polling = true;
    health.last_poll_at = new Date().toISOString();

    try {
      const rawPayload = await fetchTwelveDataSeries(config, ticker);
      const payload = mapTwelveDataSeries(rawPayload, scoredDocs);
      cache.set(cacheKey, { fetchedAt: now, payload });
      health.last_success_at = new Date().toISOString();
      health.last_error = null;
      updateHealthFromCache();
      return payload;
    } catch (error) {
      health.last_error = error.message;
      const fallback = buildSyntheticTickerMarketSeries(ticker, scoredDocs, asOf, config.marketDataHistoryPoints);
      cache.set(cacheKey, { fetchedAt: now, payload: fallback });
      updateHealthFromCache();
      return fallback;
    } finally {
      health.polling = false;
    }
  }

  function scheduleTicks() {
    if (!running) {
      return;
    }

    timer = setTimeout(() => {
      store.bus.emit("event", {
        type: "market_tick",
        timestamp: new Date().toISOString(),
        provider: config.marketDataProvider
      });
      scheduleTicks();
    }, config.marketDataRefreshMs);
  }

  return {
    async getTickerSeries(ticker, scoredDocs, asOf) {
      return getTickerSeries(ticker, scoredDocs, asOf);
    },
    async start() {
      running = true;
      updateHealthFromCache();
      scheduleTicks();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      updateHealthFromCache().polling = false;
    }
  };
}
