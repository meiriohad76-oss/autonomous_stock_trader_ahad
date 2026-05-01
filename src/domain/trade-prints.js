import { WATCHLIST } from "./taxonomy.js";

const POLYGON_BASE = "https://api.polygon.io/v3/trades";
const IEX_BASE = "https://cloud.iexapis.com/stable/stock";

function dateSlot() {
  return new Date().toISOString().slice(0, 10);
}

function buildSeenKey(ticker) {
  return `trade_print:${ticker}:${dateSlot()}`;
}

async function fetchPolygonTrades(ticker, apiKey, timeoutMs) {
  const url = `${POLYGON_BASE}/${encodeURIComponent(ticker)}?limit=50&sort=timestamp&order=desc&apiKey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+trade-prints)" }
    });
    if (!response.ok) throw new Error(`Polygon trades ${response.status}`);
    const json = await response.json();
    return (json?.results ?? []).map((t) => ({ price: t.price, size: t.size }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIexTrades(ticker, apiKey, timeoutMs) {
  const url = `${IEX_BASE}/${encodeURIComponent(ticker)}/trades?token=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+trade-prints)" }
    });
    if (!response.ok) throw new Error(`IEX trades ${response.status}`);
    const json = await response.json();
    return (Array.isArray(json) ? json : []).map((t) => ({ price: t.price, size: t.size }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrades(ticker, config) {
  if (config.tradePrintsProvider === "iex") {
    return fetchIexTrades(ticker, config.tradePrintsApiKey, config.tradePrintsRequestTimeoutMs);
  }
  return fetchPolygonTrades(ticker, config.tradePrintsApiKey, config.tradePrintsRequestTimeoutMs);
}

function classifyTrades(trades, basePrice, minNotionalUsd) {
  let buyNotional = 0;
  let sellNotional = 0;
  let blockCount = 0;

  for (const trade of trades) {
    const notional = trade.price * trade.size;
    if (notional < minNotionalUsd) continue;
    blockCount += 1;
    if (trade.price >= basePrice) {
      buyNotional += notional;
    } else {
      sellNotional += notional;
    }
  }

  return { buyNotional, sellNotional, blockCount };
}

function buildRawDocument(entry, action, buyNotional, sellNotional, blockCount, provider) {
  const isBuy = action === "block_trade_buying";
  const dominantNotional = isBuy ? buyNotional : sellNotional;
  const usd = (dominantNotional / 1e6).toFixed(1);
  const sourceName = provider === "iex" ? "iex_trades" : "polygon_trades";
  return {
    source_name: sourceName,
    source_type: "api",
    source_priority: provider === "iex" ? 0.75 : 0.81,
    canonical_url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    title: `${entry.ticker} ${isBuy ? "large block buying" : "large block selling"} — $${usd}M notional (${blockCount} prints)`,
    body: `${isBuy ? "Large block buying" : "Large block selling"} detected in ${entry.ticker}. ${blockCount} block trade print${blockCount === 1 ? "" : "s"} with $${usd}M dominant notional flow. ${isBuy ? "Institutional block buying" : "Institutional block selling"} signal.`,
    language: "en",
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: `${provider}_trade_prints`,
      action,
      block_count: blockCount,
      buy_notional_usd: buyNotional,
      sell_notional_usd: sellNotional
    },
    raw_payload: { buyNotional, sellNotional, blockCount }
  };
}

export function createTradePrintsCollector(app) {
  const { config, pipeline, store } = app;
  const healthKey = `${config.tradePrintsProvider}_trade_prints`;
  let timer = null;
  let running = false;
  let inFlight = false;

  function isEnabled() {
    return Boolean(config.tradePrintsEnabled || config.autonomousDataEnabled);
  }

  function ensureHealthEntry() {
    if (!store.health.liveSources[healthKey]) {
      store.health.liveSources[healthKey] = {
        enabled: isEnabled(),
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0
      };
    }
    store.health.liveSources[healthKey].enabled = isEnabled();
    return store.health.liveSources[healthKey];
  }

  async function pollOnce() {
    if (!isEnabled() || inFlight) return { ingested: 0, skipped: 0 };
    if (!config.tradePrintsApiKey) {
      const health = ensureHealthEntry();
      health.last_poll_at = new Date().toISOString();
      health.last_error = "no API key configured";
      return { ingested: 0, skipped: 0, error: health.last_error };
    }

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;

    try {
      for (const entry of WATCHLIST) {
        const seenKey = buildSeenKey(entry.ticker);
        if (store.seenExternalDocuments.has(seenKey)) {
          skipped += 1;
          continue;
        }

        let trades;
        try {
          trades = await fetchTrades(entry.ticker, config);
        } catch {
          errors += 1;
          continue;
        }

        const { buyNotional, sellNotional, blockCount } = classifyTrades(trades, entry.base_price, config.tradePrintsBlockTradeMinNotionalUsd);
        if (blockCount === 0) {
          skipped += 1;
          continue;
        }

        const action = buyNotional >= sellNotional ? "block_trade_buying" : "block_trade_selling";
        store.seenExternalDocuments.add(seenKey);
        await pipeline.processRawDocument(buildRawDocument(entry, action, buyNotional, sellNotional, blockCount, config.tradePrintsProvider));
        ingested += 1;

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || errors < WATCHLIST.length) health.last_success_at = new Date().toISOString();
      health.last_error = errors > 0 ? `${errors} tickers failed` : null;
      health.consecutive_failures = errors === WATCHLIST.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !isEnabled()) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.tradePrintsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !isEnabled()) return;
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
