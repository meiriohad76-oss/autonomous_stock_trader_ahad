import { WATCHLIST } from "./taxonomy.js";

const STOCKTWITS_BASE = "https://api.stocktwits.com/api/2/streams/symbol";
const BULLISH_SKEW_THRESHOLD = 0.60;
const BEARISH_SKEW_THRESHOLD = 0.40;
const MIN_TAGGED_MESSAGES = 5;

function buildStreamUrl(ticker) {
  return `${STOCKTWITS_BASE}/${encodeURIComponent(ticker)}.json`;
}

function hourlySlot() {
  return Math.floor(Date.now() / 3_600_000);
}

function buildSeenKey(ticker) {
  return `stocktwits:${ticker}:${hourlySlot()}`;
}

async function fetchStream(ticker, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.stocktwitsRequestTimeoutMs);
  const headers = { "User-Agent": "SentimentAnalyst/1.0 (+social-sentiment)" };
  if (config.stocktwitsApiKey) {
    headers.Authorization = `Bearer ${config.stocktwitsApiKey}`;
  }
  try {
    const response = await fetch(buildStreamUrl(ticker), {
      signal: controller.signal,
      headers
    });
    if (response.status === 403) throw new Error("StockTwits blocked this request; configure STOCKTWITS_API_KEY or keep this optional source disabled.");
    if (response.status === 429) throw new Error("StockTwits rate-limited");
    if (!response.ok) throw new Error(`StockTwits ${response.status}`);
    const json = await response.json();
    return json?.messages ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function classifyMessages(messages) {
  let bullish = 0;
  let bearish = 0;
  const snippets = [];

  for (const msg of messages) {
    const basic = msg?.entities?.sentiment?.basic;
    if (basic === "Bullish") bullish += 1;
    else if (basic === "Bearish") bearish += 1;

    if (snippets.length < 3 && msg?.body) {
      snippets.push(msg.body.slice(0, 120).replace(/\s+/g, " "));
    }
  }

  return { bullish, bearish, total: bullish + bearish, snippets };
}

function buildRawDocument(entry, bullish, bearish, total, bullishPct, snippets) {
  const dominant = bullishPct >= BULLISH_SKEW_THRESHOLD ? "Bullish" : "Bearish";
  const pct = Math.round(bullishPct * 100);
  return {
    source_name: "stocktwits",
    source_type: "api",
    source_priority: 0.58,
    canonical_url: `https://stocktwits.com/symbol/${entry.ticker}`,
    url: `https://stocktwits.com/symbol/${entry.ticker}`,
    title: `${entry.ticker} StockTwits: ${pct}% bullish — ${dominant} crowd sentiment dominant`,
    body: [
      `StockTwits social pulse for ${entry.ticker}: ${bullish} bullish, ${bearish} bearish out of ${total} tagged messages.`,
      `Bullish ratio: ${pct}%. ${dominant} social buzz.`,
      snippets.length ? `Recent: "${snippets.join('" | "')}"` : ""
    ].filter(Boolean).join(" "),
    language: "en",
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: "stocktwits_stream",
      bullish_count: bullish,
      bearish_count: bearish,
      tagged_total: total,
      bullish_pct: bullishPct
    },
    raw_payload: { bullish, bearish, total }
  };
}

export function createSocialSentimentCollector(app) {
  const { config, pipeline, store } = app;
  let timer = null;
  let running = false;
  let inFlight = false;

  function isEnabled() {
    return Boolean(config.stocktwitsEnabled || config.autonomousDataEnabled);
  }

  function ensureHealthEntry() {
    if (!store.health.liveSources.stocktwits_stream) {
      store.health.liveSources.stocktwits_stream = {
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
    store.health.liveSources.stocktwits_stream.enabled = isEnabled();
    return store.health.liveSources.stocktwits_stream;
  }

  async function pollOnce() {
    if (!isEnabled() || inFlight) return { ingested: 0, skipped: 0 };

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;
    let lastFailure = null;

    try {
      for (const entry of WATCHLIST) {
        const seenKey = buildSeenKey(entry.ticker);
        if (store.seenExternalDocuments.has(seenKey)) {
          skipped += 1;
          continue;
        }

        let messages;
        try {
          messages = await fetchStream(entry.ticker, config);
        } catch (error) {
          lastFailure = error.message;
          errors += 1;
          continue;
        }

        const { bullish, bearish, total, snippets } = classifyMessages(messages);
        if (total < MIN_TAGGED_MESSAGES) {
          skipped += 1;
          continue;
        }

        const bullishPct = bullish / total;
        const hasSkew = bullishPct >= BULLISH_SKEW_THRESHOLD || bullishPct <= BEARISH_SKEW_THRESHOLD;
        if (!hasSkew) {
          skipped += 1;
          continue;
        }

        store.seenExternalDocuments.add(seenKey);
        await pipeline.processRawDocument(buildRawDocument(entry, bullish, bearish, total, bullishPct, snippets));
        ingested += 1;

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || errors < WATCHLIST.length) health.last_success_at = new Date().toISOString();
      health.last_error = errors > 0 ? `${errors} tickers failed${lastFailure ? `: ${lastFailure}` : ""}` : null;
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
    }, config.stocktwitsPollMs);
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
